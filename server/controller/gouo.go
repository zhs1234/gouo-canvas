package controller

import (
	"errors"
	"net/http"
	"regexp"
	"slices"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay"
	"github.com/QuantumNous/new-api/setting/gouo_setting"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

var gouoClientRequestID = regexp.MustCompile(`^[a-zA-Z0-9_:-]{1,512}$`)

// 素材 ID 由服务端生成（32 位小写十六进制）；MySQL 比较不区分大小写，而清理时在 Go 里按原样比较，大写 ID 会让被引用的图片被清理
var gouoAssetIDPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)

func gouoFail(c *gin.Context, status int, code, message string) {
	c.JSON(status, gin.H{"success": false, "message": message, "code": code})
}

// addGouoStatus 把光构客户端需要的运营设置并入 /api/status
func addGouoStatus(data gin.H) {
	s := gouo_setting.Get()
	data["gouo_cloud_library"] = s.CloudLibraryEnabled
	data["gouo_redemption_help"] = s.RedemptionHelp
	data["gouo_support_contact"] = s.SupportContact
	data["gouo_notice"] = s.Notice
	data["gouo_canvas_enabled"] = s.CanvasEnabled
	data["gouo_agent_enabled"] = s.AgentEnabled
	data["gouo_max_images"] = s.MaxImagesPerTask
	data["gouo_allow_low_moderation"] = s.AllowLowModeration
	data["gouo_trash_retention_days"] = s.TrashRetentionDays
	data["gouo_max_upload_bytes"] = s.AssetMaxFileBytes
	// 客户端据此决定是否显示邮箱绑定和找回密码
	data["email_service"] = common.SMTPServer != ""
}

// GetGouoModels 返回当前用户分组可用的图片模型目录，按后台顺序排列；默认模型不可用时用第一个
func GetGouoModels(c *gin.Context) {
	group, err := model.GetUserGroup(c.GetInt("id"), false)
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "group_unavailable", "读取账号分组失败")
		return
	}
	rows, err := model.ListGouoImageModels()
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "models_unavailable", "读取模型目录失败")
		return
	}
	available := model.GetGroupEnabledModels(group)
	data := make([]*model.GouoImageModel, 0)
	for _, row := range rows {
		if !row.Enabled || !slices.Contains(available, row.Model) {
			continue
		}
		if entry, err := row.Entry(); err == nil {
			data = append(data, entry)
		}
	}
	if len(data) > 0 {
		idx := slices.IndexFunc(data, func(entry *model.GouoImageModel) bool { return entry.ID == gouo_setting.Get().DefaultImageModel })
		data[max(idx, 0)].Default = true
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data, "message": "", "billing_unit": "native", "currency": "CNY"})
}

func GetGouoImageResult(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	id := c.Query("client_request_id")
	if !gouoClientRequestID.MatchString(id) {
		gouoFail(c, http.StatusBadRequest, "invalid_request_id", "图片请求 ID 无效")
		return
	}
	result, err := model.GetGouoImageResult(c.GetInt("id"), id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		gouoFail(c, http.StatusNotFound, "image_request_not_found", "未找到本账号的图片请求，不会重新生成")
		return
	}
	if err != nil {
		logger.LogError(c, "读取图片恢复结果失败: "+err.Error())
		gouoFail(c, http.StatusInternalServerError, "image_result_read_failed", "读取图片结果失败，请稍后重试，不会重新生成")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": result})
}

// GetGouoPlaygroundToken 返回光构客户端调用模型用的平台令牌，没有时创建：不限额度、不过期，额度从账号余额扣
func GetGouoPlaygroundToken(c *gin.Context) {
	userID := c.GetInt("id")
	var token model.Token
	err := model.DB.Where("user_id = ? AND name = ?", userID, relay.GouoPlaygroundTokenName).First(&token).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		key, keyErr := common.GenerateKey()
		if keyErr != nil {
			gouoFail(c, http.StatusInternalServerError, "token_create_failed", "创建平台令牌失败")
			return
		}
		now := common.GetTimestamp()
		token = model.Token{UserId: userID, Name: relay.GouoPlaygroundTokenName, Key: key, Status: common.TokenStatusEnabled,
			CreatedTime: now, AccessedTime: now, ExpiredTime: -1, UnlimitedQuota: true}
		err = token.Insert()
	}
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "token_unavailable", "读取平台令牌失败")
		return
	}
	common.ApiSuccess(c, token.Key)
}
