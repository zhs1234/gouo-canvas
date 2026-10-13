package controller

import (
	"errors"
	"net/http"
	"one-api/common/config"
	"one-api/model"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

// 光构客户端相关的设置。系统设置接口只允许 root，这些设置普通管理员也需要日常维护
var gouoSettingKeys = []string{"GouoNotice", "GouoRedemptionHelp", "GouoSupportContact", "GouoDefaultImageModel"}

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
	case "GouoDefaultImageModel":
		if len(value) > 100 {
			return "", errors.New("模型名称无效")
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
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": data})
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
	for key, value := range values {
		if err := model.UpdateOption(key, value); err != nil {
			gouoFail(c, http.StatusInternalServerError, "settings_save_failed", "保存设置失败")
			return
		}
	}
	GetGouoAdminSettings(c)
}
