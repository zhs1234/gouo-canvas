package controller

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"one-api/common/logger"
	"one-api/model"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func ListGouoImageCharges(c *gin.Context)      { listGouoImageCharges(c, false) }
func ListGouoAdminImageCharges(c *gin.Context) { listGouoImageCharges(c, true) }

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
	result, err := model.ListGouoImageCharges(userID, c.Query("request_id"), c.Query("status"), &params)
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
