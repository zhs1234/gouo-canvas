package controller

import (
	"net/http"
	"one-api/common/utils"
	"one-api/model"
	"slices"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
)

func GetGouoModels(c *gin.Context) {
	key := strings.TrimPrefix(c.GetHeader("X-Gouo-Token"), "sk-")
	token, err := model.ValidateUserToken(key)
	if err != nil || token.UserId != c.GetInt("id") {
		gouoFail(c, http.StatusUnauthorized, "invalid_token", "图片令牌无效，请重新登录")
		return
	}
	setting := token.Setting.Data()
	if setting.Limits.LimitsIPSetting.Enabled && len(setting.Limits.LimitsIPSetting.Whitelist) > 0 {
		allowed := false
		for _, ip := range setting.Limits.LimitsIPSetting.Whitelist {
			if ip == c.ClientIP() || (strings.Contains(ip, "/") && utils.IsIpInCidr(c.ClientIP(), ip)) {
				allowed = true
				break
			}
		}
		if !allowed {
			gouoFail(c, http.StatusForbidden, "ip_not_allowed", "当前 IP 无权使用图片令牌")
			return
		}
	}
	group, err := model.CacheGetUserGroup(token.UserId)
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "group_unavailable", "读取账号分组失败")
		return
	}
	primary := token.Group
	if primary == "" {
		primary = token.BackupGroup
	}
	if primary == "" {
		primary = group
	}
	groups := []string{primary, token.BackupGroup}
	data := make([]*model.GouoImageModel, 0)
	model.PricingInstance.RLock()
	ids := make([]string, 0, len(model.PricingInstance.Prices))
	for id := range model.PricingInstance.Prices {
		ids = append(ids, id)
	}
	model.PricingInstance.RUnlock()
	sort.Strings(ids)
	for _, id := range ids {
		entry, err := model.PricingInstance.GetGouoModel(id)
		if err != nil {
			continue
		}
		limits := setting.Limits.LimitModelSetting
		if limits.Enabled && !slices.Contains(limits.Models, id) {
			continue
		}
		for _, group := range groups {
			ratio := model.GlobalUserGroupRatio.GetBySymbol(group)
			if ratio == nil {
				continue
			}
			if _, err := model.ChannelGroup.Next(group, id, model.FilterOnlyChat()); err == nil {
				data = append(data, entry)
				break
			}
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data, "message": "", "billing_unit": "successful_request", "currency": "CNY"})
}
