package controller

import (
	"net/http"
	"slices"
	"sort"
	"strings"

	"one-api/common/config"
	"one-api/model"

	"github.com/gin-gonic/gin"
)

type gouoAgentModel struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	ToolCalls        bool   `json:"tool_calls"`
	Vision           bool   `json:"vision"`
	ContextLength    int    `json:"context_length"`
	MaxTokens        int    `json:"max_tokens"`
	CapabilitySource string `json:"capability_source"`
	Default          bool   `json:"default,omitempty"`
	Description      string `json:"description,omitempty"`
	// 每百万 token 的人民币价格，客户端换算成积分展示；实际扣费还会乘以用户分组倍率
	InputPriceCNY   float64 `json:"input_price_cny"`
	OutputPriceCNY  float64 `json:"output_price_cny"`
	MaxOutputTokens int     `json:"max_output_tokens,omitempty"`
	sort            int
}

func gouoAgentCapabilities(price *model.Price) *gouoAgentModel {
	info := price.ModelInfo
	if price.GouoEnabled || strings.ContainsAny(price.Model, "*#") || !model.GouoAgentListed(info) {
		return nil
	}
	name := info.Name
	if name == "" {
		name = price.Model
	}
	return &gouoAgentModel{ID: price.Model, Name: name, ToolCalls: true, Vision: slices.Contains(info.InputModalities, "image"), ContextLength: info.ContextLength, MaxTokens: info.MaxTokens, CapabilitySource: "model_info", Description: strings.TrimSpace(info.Description), sort: price.GouoSort,
		InputPriceCNY: price.GetInput() * 1e6 * config.PaymentUSDRate / config.QuotaPerUnit, OutputPriceCNY: price.GetOutput() * 1e6 * config.PaymentUSDRate / config.QuotaPerUnit, MaxOutputTokens: price.GouoMaxTokens}
}

func GetGouoAgentModels(c *gin.Context) {
	token, groups := gouoModelAccess(c)
	if token == nil {
		return
	}
	// 后台关闭 Agent 时目录为空，客户端隐藏入口
	if !config.GouoAgentEnabled {
		c.JSON(http.StatusOK, gin.H{"success": true, "data": []*gouoAgentModel{}, "message": "", "agent_enabled": false})
		return
	}
	entries := make([]*gouoAgentModel, 0)
	model.PricingInstance.RLock()
	for _, price := range model.PricingInstance.Prices {
		if entry := gouoAgentCapabilities(price); entry != nil {
			entries = append(entries, entry)
		}
	}
	model.PricingInstance.RUnlock()
	// 按后台设置的顺序排列，同序按模型 ID
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].sort != entries[j].sort {
			return entries[i].sort < entries[j].sort
		}
		return entries[i].ID < entries[j].ID
	})
	data := make([]*gouoAgentModel, 0, len(entries))
	limits := token.Setting.Data().Limits.LimitModelSetting
	for _, entry := range entries {
		if limits.Enabled && !slices.Contains(limits.Models, entry.ID) {
			continue
		}
		for _, group := range groups {
			if group == "" || model.GlobalUserGroupRatio.GetBySymbol(group) == nil {
				continue
			}
			if _, err := model.ChannelGroup.Next(group, entry.ID, model.FilterDisabledStream(entry.ID)); err == nil {
				data = append(data, entry)
				break
			}
		}
	}
	// 后台指定的默认模型可用时标出它，否则标出目录第一个
	preferred := strings.TrimSpace(config.GouoAgentDefaultModel)
	defaultIndex := slices.IndexFunc(data, func(entry *gouoAgentModel) bool { return entry.ID == preferred })
	if defaultIndex < 0 && len(data) > 0 {
		defaultIndex = 0
	}
	if defaultIndex >= 0 {
		data[defaultIndex].Default = true
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data, "message": "", "agent_enabled": true, "system_prompt": config.GouoAgentSystemPrompt, "max_rounds": config.GouoAgentMaxRounds, "confirm_images": config.GouoAgentConfirmImages, "billing_unit": "platform_text_usage", "configuration_hint": "Agent 模型需在模型信息中配置 output_modalities: [\"text\"] 与 tags: [\"tools\"]，并启用支持流式工具调用的渠道。"})
}
