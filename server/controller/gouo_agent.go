package controller

import (
	"net/http"
	"slices"
	"sort"
	"strings"

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
}

func gouoAgentCapabilities(price *model.Price) *gouoAgentModel {
	info := price.ModelInfo
	if price.GouoEnabled || strings.ContainsAny(price.Model, "*#") || info == nil || !slices.Contains(info.OutputModalities, "text") {
		return nil
	}
	tools := false
	for _, tag := range info.Tags {
		switch strings.ToLower(strings.TrimSpace(tag)) {
		case "tools", "tool_calls", "function_calling", "function-calling":
			tools = true
		}
	}
	if !tools {
		return nil
	}
	name := info.Name
	if name == "" {
		name = price.Model
	}
	return &gouoAgentModel{ID: price.Model, Name: name, ToolCalls: true, Vision: slices.Contains(info.InputModalities, "image"), ContextLength: info.ContextLength, MaxTokens: info.MaxTokens, CapabilitySource: "model_info"}
}

func GetGouoAgentModels(c *gin.Context) {
	token, groups := gouoModelAccess(c)
	if token == nil {
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
	sort.Slice(entries, func(i, j int) bool { return entries[i].ID < entries[j].ID })
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
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data, "message": "", "billing_unit": "platform_text_usage", "configuration_hint": "Agent 模型需在模型信息中配置 output_modalities: [\"text\"] 与 tags: [\"tools\"]，并启用支持流式工具调用的渠道。"})
}
