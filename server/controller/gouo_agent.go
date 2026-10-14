package controller

import (
	"net/http"
	"slices"
	"sort"
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
		return 0, 0, "按次计费的模型不能用于 Agent，请在模型定价里改为按 token 计费"
	}
	if billing_setting.GetBillingMode(id) == billing_setting.BillingModeTieredExpr {
		return 0, 0, "表达式计费的模型不能用于 Agent，请在模型定价里改为按 token 计费"
	}
	ratio, ok, _ := ratio_setting.GetModelRatio(id)
	if !ok {
		return 0, 0, "还没有在模型定价里设置价格"
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

type gouoAdminAgentModel struct {
	model.GouoAgentModelConfig
	InputPriceCNY  float64  `json:"input_price_cny"`
	OutputPriceCNY float64  `json:"output_price_cny"`
	Groups         []string `json:"groups"`
	// 客户端看不到它的第一个原因，空表示可见
	Reason string `json:"reason"`
}

// ListGouoAdminAgentModels 列出已上架的和渠道上的全部文本模型（已启用为图片模型的除外），以及客户端能否看到
func ListGouoAdminAgentModels(c *gin.Context) {
	rows, err := model.ListGouoAgentModels()
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "models_unavailable", "读取模型目录失败")
		return
	}
	byModel := map[string]*gouoAdminAgentModel{}
	for _, row := range rows {
		byModel[row.Model] = &gouoAdminAgentModel{GouoAgentModelConfig: *row, Groups: []string{}}
	}
	for _, ability := range model.GetAllEnableAbilities() {
		if model.IsGouoImageModel(ability.Model) {
			continue
		}
		item := byModel[ability.Model]
		if item == nil {
			item = &gouoAdminAgentModel{GouoAgentModelConfig: model.GouoAgentModelConfig{Model: ability.Model}, Groups: []string{}}
			byModel[ability.Model] = item
		}
		if !slices.Contains(item.Groups, ability.Group) {
			item.Groups = append(item.Groups, ability.Group)
		}
	}
	models := make([]*gouoAdminAgentModel, 0, len(byModel))
	for _, item := range byModel {
		sort.Strings(item.Groups)
		item.InputPriceCNY, item.OutputPriceCNY, item.Reason = gouoAgentPrice(item.Model)
		switch {
		case !item.Listed:
			item.Reason = "未上架"
		case len(item.Groups) == 0:
			item.Reason = "没有启用中的渠道支持此模型"
		}
		models = append(models, item)
	}
	sort.Slice(models, func(i, j int) bool {
		if models[i].Listed != models[j].Listed {
			return models[i].Listed
		}
		if models[i].Listed && models[i].Sort != models[j].Sort {
			return models[i].Sort < models[j].Sort
		}
		return models[i].Model < models[j].Model
	})
	common.ApiSuccess(c, gin.H{"default_model": gouo_setting.Get().AgentDefaultModel, "models": models})
}

// UpdateGouoAdminAgentModel 上架、下架或编辑一个 Agent 文本模型；价格在 New API 的模型定价里设置
func UpdateGouoAdminAgentModel(c *gin.Context) {
	var row model.GouoAgentModelConfig
	if err := common.UnmarshalBodyReusable(c, &row); err != nil {
		gouoFail(c, http.StatusBadRequest, "invalid_model", "模型配置无效")
		return
	}
	row.Model, row.Name, row.Description = strings.TrimSpace(row.Model), strings.TrimSpace(row.Name), strings.TrimSpace(row.Description)
	if err := model.SaveGouoAgentModel(&row); err != nil {
		gouoFail(c, http.StatusBadRequest, "invalid_agent_model", err.Error())
		return
	}
	common.ApiSuccess(c, nil)
}
