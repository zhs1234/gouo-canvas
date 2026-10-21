package controller

import (
	"errors"
	"net/http"
	"one-api/common/config"
	"one-api/model"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

// 光构客户端相关的设置。系统设置接口只允许 root，这些设置普通管理员也需要日常维护
var gouoSettingKeys = []string{"GouoNotice", "GouoRedemptionHelp", "GouoSupportContact", "GouoDefaultImageModel", "GouoCanvasEnabled", "GouoAgentEnabled", "GouoAgentDefaultModel", "GouoAgentSystemPrompt", "GouoAgentSiteGuide", "GouoMaxImagesPerTask", "GouoAllowLowModeration", "GouoAgentMaxRounds", "GouoAgentConfirmImages", "GouoSkillsEnabled", "GouoSkillImportEnabled", "GouoSkillGithubImport", "GouoCloudLibraryEnabled", "GouoAssetUserQuotaBytes", "GouoAssetMaxFileBytes", "GouoTrashRetentionDays"}

func normalizeGouoSetting(key, value string) (string, error) {
	value = strings.TrimSpace(value)
	switch key {
	case "GouoNotice":
		// 公告在客户端以单行横幅显示
		value = strings.Join(strings.Fields(value), " ")
		if utf8.RuneCountInString(value) > 200 {
			return "", errors.New("公告不能超过 200 个字符")
		}
	case "GouoRedemptionHelp", "GouoSupportContact":
		if utf8.RuneCountInString(value) > 2000 {
			return "", errors.New("兑换码说明和客服信息不能超过 2000 个字符")
		}
	case "GouoDefaultImageModel", "GouoAgentDefaultModel":
		if len(value) > 100 {
			return "", errors.New("模型名称无效")
		}
	case "GouoAgentSystemPrompt":
		if utf8.RuneCountInString(value) > 4000 {
			return "", errors.New("Agent 附加提示词不能超过 4000 个字符")
		}
	case "GouoAgentSiteGuide":
		if utf8.RuneCountInString(value) > 8000 {
			return "", errors.New("网站使用说明不能超过 8000 个字符")
		}
	case "GouoCanvasEnabled", "GouoAgentEnabled", "GouoCloudLibraryEnabled", "GouoAllowLowModeration", "GouoSkillsEnabled", "GouoSkillImportEnabled", "GouoSkillGithubImport":
		if value != "true" && value != "false" {
			return "", errors.New("开关只能是 true 或 false")
		}
	case "GouoMaxImagesPerTask":
		if n, err := strconv.Atoi(value); err != nil || n < 1 || n > 10 {
			return "", errors.New("一次最多生成张数必须是 1 到 10 的整数")
		}
	case "GouoAgentMaxRounds":
		if n, err := strconv.Atoi(value); err != nil || n < 1 || n > 20 {
			return "", errors.New("Agent 每条消息最多工具轮数必须是 1 到 20 的整数")
		}
	case "GouoAgentConfirmImages":
		if n, err := strconv.Atoi(value); err != nil || n < 1 || n > 10 {
			return "", errors.New("Agent 需确认的图片张数必须是 1 到 10 的整数")
		}
	case "GouoTrashRetentionDays":
		if n, err := strconv.Atoi(value); err != nil || n < 1 || n > 30 {
			return "", errors.New("回收站保留天数必须是 1 到 30 的整数")
		}
	case "GouoAssetUserQuotaBytes":
		if n, err := strconv.ParseInt(value, 10, 64); err != nil || n < 1<<20 || n > 1<<40 {
			return "", errors.New("默认用户空间必须在 1 MB 到 1 TB 之间")
		}
	case "GouoAssetMaxFileBytes":
		if n, err := strconv.ParseInt(value, 10, 64); err != nil || n < 1<<20 || n > 100<<20 {
			return "", errors.New("单文件上传上限必须在 1 MB 到 100 MB 之间")
		}
	default:
		return "", errors.New("不支持的光构设置：" + key)
	}
	return value, nil
}

func GetGouoAdminSettings(c *gin.Context) {
	data := map[string]string{}
	for _, key := range gouoSettingKeys {
		data[key] = config.GlobalOption.Get(key)
	}
	// 可选作默认 Agent 模型的文本模型（不区分用户分组和令牌限制）
	agentModels := make([]string, 0)
	model.PricingInstance.RLock()
	for _, price := range model.PricingInstance.Prices {
		if gouoAgentCapabilities(price) != nil {
			agentModels = append(agentModels, price.Model)
		}
	}
	model.PricingInstance.RUnlock()
	sort.Strings(agentModels)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": data, "agent_models": agentModels})
}

// UpdateGouoAdminSettings 只修改请求中出现的键；先全部校验，避免部分保存
func UpdateGouoAdminSettings(c *gin.Context) {
	var input map[string]string
	if err := c.ShouldBindJSON(&input); err != nil || len(input) == 0 {
		gouoFail(c, http.StatusBadRequest, "invalid_settings", "设置内容无效")
		return
	}
	values := map[string]string{}
	for key, value := range input {
		normalized, err := normalizeGouoSetting(key, value)
		if err != nil {
			gouoFail(c, http.StatusBadRequest, "invalid_settings", err.Error())
			return
		}
		values[key] = normalized
	}
	if err := model.UpdateOptions(values); err != nil {
		gouoFail(c, http.StatusInternalServerError, "settings_save_failed", "保存设置失败")
		return
	}
	GetGouoAdminSettings(c)
}
