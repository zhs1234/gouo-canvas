package controller

import (
	"net/http"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/gouo_setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
)

type gouoAgentModel struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	ToolCalls        bool   `json:"tool_calls"`
	Vision           bool   `json:"vision"`
	CapabilitySource string `json:"capability_source"`
	Default          bool   `json:"default,omitempty"`
	Description      string `json:"description,omitempty"`
	// 每百万 token 的人民币价格，客户端换算成积分展示；实际扣费还会乘以用户分组倍率
	InputPriceCNY   float64 `json:"input_price_cny"`
	OutputPriceCNY  float64 `json:"output_price_cny"`
	MaxOutputTokens int     `json:"max_output_tokens,omitempty"`
}

// gouoAgentPrice 按 New API 的模型倍率换算每百万 token 的人民币价格；
// 按次计费和表达式计费的模型无法按 token 估价，客户端不展示，返回原因
func gouoAgentPrice(id string) (float64, float64, string) {
	if _, fixed := ratio_setting.GetModelPrice(id, false); fixed {
		return 0, 0, "Per-request priced models cannot be used by Agent; switch to token pricing in model pricing"
	}
	if billing_setting.GetBillingMode(id) == billing_setting.BillingModeTieredExpr {
		return 0, 0, "Expression-priced models cannot be used by Agent; switch to token pricing in model pricing"
	}
	ratio, ok, _ := ratio_setting.GetModelRatio(id)
	if !ok {
		return 0, 0, "No price is set in model pricing yet"
	}
	input := ratio * 1e6 / common.QuotaPerUnit * operation_setting.USDExchangeRate
	return input, input * ratio_setting.GetCompletionRatio(id), ""
}

func GetGouoAgentModels(c *gin.Context) {
	s := gouo_setting.Get()
	// 后台关闭 Agent 时目录为空，客户端隐藏入口
	if !s.AgentEnabled {
		c.JSON(http.StatusOK, gin.H{"success": true, "data": []*gouoAgentModel{}, "message": "", "agent_enabled": false})
		return
	}
	group, err := model.GetUserGroup(c.GetInt("id"), false)
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "group_unavailable", "读取账号分组失败")
		return
	}
	rows, err := model.ListGouoAgentModels()
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "models_unavailable", "读取模型目录失败")
		return
	}
	available := model.GetGroupEnabledModels(group)
	data := make([]*gouoAgentModel, 0)
	for _, row := range rows {
		if !row.Listed || !slices.Contains(available, row.Model) {
			continue
		}
		input, output, reason := gouoAgentPrice(row.Model)
		if reason != "" {
			continue
		}
		name := row.Name
		if name == "" {
			name = row.Model
		}
		data = append(data, &gouoAgentModel{ID: row.Model, Name: name, ToolCalls: true, Vision: row.Vision, CapabilitySource: "gouo_catalog",
			Description: row.Description, InputPriceCNY: input, OutputPriceCNY: output, MaxOutputTokens: row.MaxTokens})
	}
	// 后台指定的默认模型可用时标出它，否则标出目录第一个
	if len(data) > 0 {
		idx := slices.IndexFunc(data, func(entry *gouoAgentModel) bool { return entry.ID == strings.TrimSpace(s.AgentDefaultModel) })
		data[max(idx, 0)].Default = true
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data, "message": "", "agent_enabled": true, "system_prompt": s.AgentSystemPrompt,
		"max_rounds": s.AgentMaxRounds, "confirm_images": s.AgentConfirmImages, "billing_unit": "platform_text_usage"})
}
