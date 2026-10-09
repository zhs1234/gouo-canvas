package controller

import (
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"one-api/common/logger"
	"one-api/model"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func ListGouoImageCharges(c *gin.Context)      { listGouoImageCharges(c, false) }
func ListGouoAdminImageCharges(c *gin.Context) { listGouoImageCharges(c, true) }

var gouoResultClientID = regexp.MustCompile(`^[a-zA-Z0-9_:-]{1,512}$`)

func GetGouoImageResult(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	id := c.Query("client_request_id")
	if !gouoResultClientID.MatchString(id) {
		gouoFail(c, http.StatusBadRequest, "invalid_request_id", "图片请求 ID 无效")
		return
	}
	result, err := model.GetGouoImageResult(c.GetInt("id"), id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		gouoFail(c, http.StatusNotFound, "image_request_not_found", "未找到本账号的图片请求，不会重新生成")
		return
	}
	if err != nil {
		logger.LogError(c.Request.Context(), "读取图片恢复结果失败: "+err.Error())
		gouoFail(c, http.StatusInternalServerError, "image_result_read_failed", "读取图片结果失败，请稍后重试，不会重新生成")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": result})
}

func listGouoImageCharges(c *gin.Context, admin bool) {
	userID := c.GetInt("id")
	if admin {
		userID = 0
		if value := c.Query("user_id"); value != "" {
			parsed, err := strconv.Atoi(value)
			if err != nil || parsed < 1 {
				gouoFail(c, http.StatusBadRequest, "invalid_user", "用户 ID 无效")
				return
			}
			userID = parsed
		}
	}
	params := model.PaginationParams{}
	if err := c.ShouldBindQuery(&params); err != nil {
		gouoFail(c, http.StatusBadRequest, "invalid_query", "分页参数无效")
		return
	}
	requestID := c.Query("request_id")
	if clientID := c.Query("client_request_id"); clientID != "" {
		if userID < 1 || len(clientID) > 512 {
			gouoFail(c, http.StatusBadRequest, "invalid_request_id", "按客户端请求 ID 查询时必须指定用户")
			return
		}
		requestID = model.GouoImageRequestID(userID, clientID)
	}
	result, err := model.ListGouoImageCharges(userID, requestID, c.Query("status"), &params)
	if err != nil {
		logger.LogError(c.Request.Context(), "图片账务查询失败: "+err.Error())
		gouoFail(c, http.StatusInternalServerError, "billing_query_failed", "读取图片请求记录失败")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": result})
}

func ResolveGouoImageCharge(c *gin.Context) {
	var input struct {
		Status string `json:"status"`
		Note   string `json:"note"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || (input.Status != model.GouoChargeSettled && input.Status != model.GouoChargeRefunded) || strings.TrimSpace(input.Note) == "" || len([]rune(input.Note)) > 1000 {
		gouoFail(c, http.StatusBadRequest, "invalid_resolution", "请选择结算或退款并填写核对依据")
		return
	}
	charge, err := model.GetGouoImageCharge(c.Param("id"))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		gouoFail(c, http.StatusNotFound, "billing_not_found", "图片请求记录不存在")
		return
	}
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "billing_query_failed", "读取图片请求记录失败")
		return
	}
	// 普通管理员只能核对权限比自己低的账号的请求，因此也不能核对自己的请求
	if !gouoAdminCanAccess(c, charge.UserID) {
		gouoFail(c, http.StatusForbidden, "user_forbidden", "无权核对同级或更高等级用户的请求")
		return
	}
	if err := model.ResolveGouoImageCharge(c.Param("id"), input.Status, c.GetInt("id"), input.Note); err != nil {
		code, message := http.StatusInternalServerError, "账务处理失败，请刷新核对状态后重试"
		if errors.Is(err, model.ErrGouoChargeState) {
			code, message = http.StatusConflict, err.Error()
		} else if errors.Is(err, gorm.ErrRecordNotFound) {
			code, message = http.StatusNotFound, "图片请求记录不存在"
		}
		logger.LogError(c.Request.Context(), "图片账务处理失败: "+err.Error())
		gouoFail(c, code, "billing_resolution_failed", message)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "账务处理完成"})
}
