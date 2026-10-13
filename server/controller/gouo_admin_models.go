package controller

import (
	"errors"
	"math"
	"net/http"
	"one-api/common/config"
	"one-api/common/utils"
	"one-api/model"
	"slices"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type gouoAdminChannel struct {
	ID       int      `json:"id"`
	Name     string   `json:"name"`
	Status   int      `json:"status"`
	Groups   []string `json:"groups"`
	OnlyChat bool     `json:"only_chat"`
	// 渠道是否允许这个模型流式输出，Agent 必须流式调用
	Stream bool `json:"stream"`
	// 渠道把这个模型映射到的上游模型；映射值以 + 开头时按原模型计费
	MappedTo        string `json:"mapped_to,omitempty"`
	BillingOriginal bool   `json:"billing_original,omitempty"`
}

type gouoAdminModel struct {
	Model       string             `json:"model"`
	Priced      bool               `json:"priced"`
	Enabled     bool               `json:"gouo_enabled"`
	PriceCNY    float64            `json:"gouo_price_cny"`
	Reference   bool               `json:"gouo_reference"`
	Mask        bool               `json:"gouo_mask"`
	MaxOutputs  int                `json:"gouo_max_outputs"`
	Name        string             `json:"name"`
	Description string             `json:"description"`
	Sort        int                `json:"gouo_sort"`
	MaxSize     string             `json:"gouo_max_size"`
	Qualities   []string           `json:"gouo_qualities"`
	MaxInputs   int                `json:"gouo_max_inputs"`
	Error       string             `json:"error,omitempty"`
	Channels    []gouoAdminChannel `json:"channels"`
	// 有启用中的渠道支持、且是有效用户分组的分组，即客户端可能看到这个模型的分组
	OpenGroups []string `json:"open_groups"`
	// image / text / 空（无法判断），后台按此把图片模型和文本模型分到各自的标签页
	Kind string `json:"kind"`
}

type gouoAdminAgentModel struct {
	Model        string             `json:"model"`
	Priced       bool               `json:"priced"`
	InputPoints  float64            `json:"input_points"`
	OutputPoints float64            `json:"output_points"`
	Name         string             `json:"name"`
	Description  string             `json:"description"`
	Sort         int                `json:"gouo_sort"`
	MaxTokens    int                `json:"gouo_max_tokens"`
	Listed       bool               `json:"listed"`
	Vision       bool               `json:"vision"`
	Channels     []gouoAdminChannel `json:"channels"`
	OpenGroups   []string           `json:"open_groups"`
	Visible      bool               `json:"visible"`
	Reason       string             `json:"reason"`
	// 渠道映射到其他模型且没有按原模型计费时，实际按上游模型的价格扣费，这里填的价格不生效
	PriceWarning string `json:"price_warning,omitempty"`
	Kind         string `json:"kind"`
	// times 表示按次计费，此时 InputPoints 是每次请求的积分，OutputPoints 为 0
	PriceType string `json:"price_type,omitempty"`
}

// 常见图片模型的名称特征，模型资料没有声明输出类型时用来区分图片模型和文本模型
var gouoImageNameHints = []string{"image", "dall-e", "flux", "midjourney", "imagen", "seedream", "stable-diffusion", "recraft", "ideogram", "cogview", "kolors", "jimeng", "wanx", "t2i"}

// 近期主流文本模型的名称前缀，用于还没有价格记录、只配在渠道上的模型；图片模型先按上面的名称特征排除，
// 所以 gemini-3-pro-image 这类名称不会被 gemini-3 归成文本模型
var gouoTextModelPrefixes = []string{
	"gpt-5", "gpt-4.1", "gpt-4o", "chatgpt-4o", "o1", "o3", "o4-mini", "claude-", "gemini-2.5-", "gemini-3",
	"grok-3", "grok-4", "deepseek-", "qwen3", "qwen-max", "qwen-plus", "qwen-turbo", "qwen-flash", "qwq",
	"glm-4", "glm-5", "kimi-", "moonshot-", "doubao-seed-", "doubao-1-5", "minimax-", "ernie-", "hunyuan-", "mistral-", "llama-",
}

// gouoModelKind 判断模型是图片模型还是文本模型；判断不了时返回空字符串，两个标签页都会列出。
// 已启用的图片模型和已上架的 Agent 模型以当前状态为准，其余依次看模型资料是否只输出图片、图片模型名称特征、模型资料是否输出文本、主流文本模型名称和计费方式
func gouoModelKind(id string, price *model.Price, info *model.ModelInfoResponse) string {
	if price != nil && price.GouoEnabled {
		return "image"
	}
	if model.GouoAgentListed(info) {
		return "text"
	}
	outputsImage, outputsText := false, false
	if info != nil {
		outputsImage, outputsText = slices.Contains(info.OutputModalities, "image"), slices.Contains(info.OutputModalities, "text")
	}
	if outputsImage && !outputsText {
		return "image"
	}
	// 名称特征排在“只输出文本”之前：图片模型被上架过 Agent 再下架后，资料里仍留着上架时加的文本输出
	lower := strings.ToLower(id)
	if slices.ContainsFunc(gouoImageNameHints, func(hint string) bool { return strings.Contains(lower, hint) }) {
		return "image"
	}
	if outputsText {
		return "text"
	}
	// 渠道模型可能带供应商前缀，如 anthropic/claude-sonnet-4-6
	base := lower[strings.LastIndex(lower, "/")+1:]
	if slices.ContainsFunc(gouoTextModelPrefixes, func(prefix string) bool { return strings.HasPrefix(base, prefix) }) {
		return "text"
	}
	if price != nil && price.Type == model.TokensPriceType {
		return "text"
	}
	return ""
}

// 模型 → 支持它的渠道
func gouoChannelsByModel() (map[string][]gouoAdminChannel, error) {
	var channels []*model.Channel
	if err := model.DB.Find(&channels).Error; err != nil {
		return nil, err
	}
	result := map[string][]gouoAdminChannel{}
	model.PricingInstance.RLock()
	ids := make([]string, 0, len(model.PricingInstance.Prices))
	for id := range model.PricingInstance.Prices {
		ids = append(ids, id)
	}
	model.PricingInstance.RUnlock()
	for _, channel := range channels {
		groups := splitTrimmed(channel.Group)
		mapping, _ := utils.UnmarshalString[map[string]string](channel.GetModelMapping())
		models := splitTrimmed(channel.Models)
		for _, pattern := range splitTrimmed(channel.Models) {
			if !strings.HasSuffix(pattern, "*") {
				continue
			}
			for _, id := range ids {
				if strings.HasPrefix(id, strings.TrimRight(pattern, "*")) && !slices.Contains(models, id) {
					models = append(models, id)
				}
			}
		}
		for _, id := range models {
			item := gouoAdminChannel{ID: channel.Id, Name: channel.Name, Status: channel.Status, Groups: groups, OnlyChat: channel.OnlyChat, Stream: channel.AllowStream(id)}
			if target := strings.TrimSpace(mapping[id]); target != "" {
				item.BillingOriginal = strings.HasPrefix(target, "+")
				item.MappedTo = strings.TrimPrefix(target, "+")
			}
			result[id] = append(result[id], item)
		}
	}
	return result, nil
}

// 启用中且满足 usable 的渠道里，属于有效用户分组的分组
func gouoOpenGroups(channels []gouoAdminChannel, usable func(gouoAdminChannel) bool) []string {
	groups := []string{}
	for _, channel := range channels {
		if channel.Status != 1 || !usable(channel) {
			continue
		}
		for _, group := range channel.Groups {
			if model.GlobalUserGroupRatio.GetBySymbol(group) != nil && !slices.Contains(groups, group) {
				groups = append(groups, group)
			}
		}
	}
	sort.Strings(groups)
	return groups
}

func gouoModelText(price *model.Price) (string, string) {
	if price.ModelInfo == nil {
		return "", ""
	}
	return price.ModelInfo.Name, price.ModelInfo.Description
}

func gouoModelInfos() (map[string]*model.ModelInfoResponse, error) {
	infos, err := model.GetAllModelInfo()
	if err != nil {
		return nil, err
	}
	result := map[string]*model.ModelInfoResponse{}
	for _, info := range infos {
		result[info.Model] = info.ToResponse()
	}
	return result, nil
}

// ListGouoAdminModels 列出已定价或已配置在渠道上的模型，以及各自的光构配置和支持它的渠道，
// 便于在一处看到哪些模型会出现在客户端
func ListGouoAdminModels(c *gin.Context) {
	channelsByModel, err := gouoChannelsByModel()
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "channels_unavailable", "读取渠道失败")
		return
	}
	infos, err := gouoModelInfos()
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "model_info_unavailable", "读取模型资料失败")
		return
	}
	byModel := map[string]*gouoAdminModel{}
	entry := func(id string) *gouoAdminModel {
		if byModel[id] == nil {
			byModel[id] = &gouoAdminModel{Model: id, MaxOutputs: 1, Channels: []gouoAdminChannel{}}
		}
		return byModel[id]
	}
	model.PricingInstance.RLock()
	for id, price := range model.PricingInstance.Prices {
		item := entry(id)
		item.Priced = true
		item.Enabled, item.PriceCNY, item.Reference, item.Mask, item.MaxOutputs, item.Sort = price.GouoEnabled, price.GouoPriceCNY, price.GouoReference, price.GouoMask, price.GouoMaxOutputs, price.GouoSort
		item.Name, item.Description = gouoModelText(price)
		item.MaxSize, item.Qualities, item.MaxInputs = price.GouoMaxSize, model.GouoQualityList(price), price.GouoMaxInputs
	}
	model.PricingInstance.RUnlock()
	for id, channels := range channelsByModel {
		item := entry(id)
		item.Channels = channels
		if info := infos[id]; !item.Priced && info != nil {
			item.Name, item.Description = info.Name, info.Description
		}
	}
	models := make([]*gouoAdminModel, 0, len(byModel))
	model.PricingInstance.RLock()
	for id, item := range byModel {
		item.Kind = gouoModelKind(id, model.PricingInstance.Prices[id], infos[id])
	}
	model.PricingInstance.RUnlock()
	for _, item := range byModel {
		if item.Enabled {
			if _, err := model.PricingInstance.GetGouoModel(item.Model); err != nil {
				item.Error = err.Error()
			}
		}
		// 图片目录不使用“仅对话”渠道
		item.OpenGroups = gouoOpenGroups(item.Channels, func(channel gouoAdminChannel) bool { return !channel.OnlyChat })
		models = append(models, item)
	}
	// 已启用的按客户端顺序排在前面，其余按名称
	sort.Slice(models, func(i, j int) bool {
		if models[i].Enabled != models[j].Enabled {
			return models[i].Enabled
		}
		if models[i].Enabled && models[i].Sort != models[j].Sort {
			return models[i].Sort < models[j].Sort
		}
		return models[i].Model < models[j].Model
	})
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": gin.H{"default_model": config.GouoDefaultImageModel, "models": models}})
}

func validateGouoModelText(name, description *string) error {
	if name != nil && utf8.RuneCountInString(strings.TrimSpace(*name)) > 40 {
		return errors.New("显示名称不能超过 40 个字")
	}
	if description != nil && utf8.RuneCountInString(strings.TrimSpace(*description)) > 100 {
		return errors.New("说明不能超过 100 个字")
	}
	return nil
}

// 显示名称、说明和能力声明存在模型详情里，与“模型详情”页共用同一条记录；没有记录时新建
func saveGouoModelInfo(id string, edit func(info *model.ModelInfo)) error {
	info, err := model.GetModelInfoByModel(id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		info = &model.ModelInfo{Model: id, InputModalities: "[]", OutputModalities: "[]", Tags: "[]", SupportUrl: "[]"}
		edit(info)
		return model.CreateModelInfo(info)
	}
	if err != nil {
		return err
	}
	edit(info)
	return model.UpdateModelInfo(info)
}

func applyGouoModelText(info *model.ModelInfo, name, description *string) {
	if name != nil {
		info.Name = strings.TrimSpace(*name)
	}
	if description != nil {
		info.Description = strings.TrimSpace(*description)
	}
}

// UpdateGouoAdminModel 修改一个模型的光构配置；模型还没有价格记录时新建一条，只用于光构计费。
// 显示名称、说明和排序可以省略，省略时保持原值
func UpdateGouoAdminModel(c *gin.Context) {
	var input struct {
		Model       string  `json:"model"`
		Enabled     bool    `json:"gouo_enabled"`
		PriceCNY    float64 `json:"gouo_price_cny"`
		Reference   bool    `json:"gouo_reference"`
		Mask        bool    `json:"gouo_mask"`
		MaxOutputs  int     `json:"gouo_max_outputs"`
		Name        *string `json:"name"`
		Description *string `json:"description"`
		Sort        *int    `json:"gouo_sort"`
		// 尺寸、画质和参考图限制可以省略，省略时保持原值；空字符串、空列表或 0 表示不限
		MaxSize   *string   `json:"gouo_max_size"`
		Qualities *[]string `json:"gouo_qualities"`
		MaxInputs *int      `json:"gouo_max_inputs"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || strings.TrimSpace(input.Model) == "" || len(input.Model) > 100 {
		gouoFail(c, http.StatusBadRequest, "invalid_model", "模型名称无效")
		return
	}
	if err := validateGouoModelText(input.Name, input.Description); err != nil {
		gouoFail(c, http.StatusBadRequest, "invalid_model_text", err.Error())
		return
	}
	id := strings.TrimSpace(input.Model)
	model.PricingInstance.RLock()
	existing, ok := model.PricingInstance.Prices[id]
	var price model.Price
	if ok {
		price = *existing
	}
	model.PricingInstance.RUnlock()
	if !ok {
		price = model.Price{Model: id, Type: model.TimesPriceType, ChannelType: config.ChannelTypeUnknown}
	}
	if input.Enabled && !price.GouoEnabled {
		err := model.CheckGouoImageExclusive(id)
		if errors.Is(err, model.ErrGouoAgentListed) {
			gouoFail(c, http.StatusBadRequest, "agent_model_listed", err.Error())
			return
		}
		if err != nil {
			gouoFail(c, http.StatusInternalServerError, "model_info_unavailable", "读取模型资料失败")
			return
		}
	}
	price.GouoEnabled, price.GouoPriceCNY, price.GouoReference, price.GouoMask, price.GouoMaxOutputs = input.Enabled, input.PriceCNY, input.Reference, input.Mask, input.MaxOutputs
	if price.GouoMaxOutputs < 1 {
		price.GouoMaxOutputs = 1
	}
	if input.Sort != nil {
		price.GouoSort = *input.Sort
	}
	if input.MaxSize != nil {
		price.GouoMaxSize = strings.ToUpper(strings.TrimSpace(*input.MaxSize))
	}
	if input.Qualities != nil {
		price.GouoQualities = strings.Join(*input.Qualities, ",")
	}
	if input.MaxInputs != nil {
		price.GouoMaxInputs = *input.MaxInputs
	}
	// 先校验价格，避免价格无效时模型详情已被改掉
	if err := model.ValidateGouoPrice(&price); err != nil {
		gouoFail(c, http.StatusBadRequest, "invalid_gouo_price", err.Error())
		return
	}
	if input.Name != nil || input.Description != nil {
		if err := saveGouoModelInfo(id, func(info *model.ModelInfo) { applyGouoModelText(info, input.Name, input.Description) }); err != nil {
			gouoFail(c, http.StatusInternalServerError, "model_info_save_failed", "保存显示名称失败")
			return
		}
	}
	var err error
	if ok {
		err = model.PricingInstance.UpdatePrice(id, &price)
	} else {
		err = model.PricingInstance.AddPrice(&price)
	}
	if err != nil {
		gouoFail(c, http.StatusBadRequest, "invalid_gouo_price", err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// 文本模型按 token 计费：价格记录里存的是每 token 的额度倍率，后台按“积分/百万 token”展示和填写。
// 实际扣费还会乘以用户分组倍率
func gouoPointsPerMillionTokens() float64 {
	return 1e6 * config.PaymentUSDRate / config.QuotaPerUnit * 100
}

// 按客户端 Agent 目录的条件逐项检查，返回第一个不满足的原因
func gouoAgentReason(item *gouoAdminAgentModel) string {
	enabled := slices.ContainsFunc(item.Channels, func(channel gouoAdminChannel) bool { return channel.Status == 1 })
	streaming := slices.ContainsFunc(item.Channels, func(channel gouoAdminChannel) bool { return channel.Status == 1 && channel.Stream })
	switch {
	case strings.ContainsAny(item.Model, "*#"):
		return "模型 ID 不能含 * 或 #"
	case !item.Listed:
		return "未上架"
	case !item.Priced:
		return "还没有价格记录"
	case !enabled:
		return "没有启用中的渠道支持此模型"
	case !streaming:
		return "渠道关闭了此模型的流式输出"
	case len(item.OpenGroups) == 0:
		return "渠道分组都不是有效的用户分组"
	}
	return ""
}

// ListGouoAdminAgentModels 列出可用作 Agent 的文本模型：已上架的、已定价的和渠道上配置了的；已作为图片模型启用的不在此列
func ListGouoAdminAgentModels(c *gin.Context) {
	channelsByModel, err := gouoChannelsByModel()
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "channels_unavailable", "读取渠道失败")
		return
	}
	infos, err := gouoModelInfos()
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "model_info_unavailable", "读取模型资料失败")
		return
	}
	rate := gouoPointsPerMillionTokens()
	byModel := map[string]*gouoAdminAgentModel{}
	imageModels := map[string]bool{}
	model.PricingInstance.RLock()
	for id, price := range model.PricingInstance.Prices {
		if price.GouoEnabled {
			imageModels[id] = true
			continue
		}
		item := &gouoAdminAgentModel{Model: id, Priced: true, Sort: price.GouoSort, MaxTokens: price.GouoMaxTokens, Listed: model.GouoAgentListed(price.ModelInfo), Kind: gouoModelKind(id, price, price.ModelInfo)}
		item.InputPoints, item.OutputPoints, item.PriceType = price.GetInput()*rate, price.GetOutput()*rate, price.Type
		if price.Type == model.TimesPriceType {
			// 按次计费每次扣 1000 × Input 额度，不能按每百万 token 换算
			item.InputPoints, item.OutputPoints = price.GetInput()*rate/1000, 0
		}
		item.Name, item.Description = gouoModelText(price)
		item.Vision = price.ModelInfo != nil && slices.Contains(price.ModelInfo.InputModalities, "image")
		byModel[id] = item
	}
	model.PricingInstance.RUnlock()
	for id, channels := range channelsByModel {
		if imageModels[id] {
			continue
		}
		if byModel[id] == nil {
			byModel[id] = &gouoAdminAgentModel{Model: id}
			if info := infos[id]; info != nil {
				byModel[id].Name, byModel[id].Description = info.Name, info.Description
				byModel[id].Listed = model.GouoAgentListed(info)
				byModel[id].Vision = slices.Contains(info.InputModalities, "image")
			}
			byModel[id].Kind = gouoModelKind(id, nil, infos[id])
		}
		byModel[id].Channels = channels
	}
	models := make([]*gouoAdminAgentModel, 0, len(byModel))
	for _, item := range byModel {
		if item.Channels == nil {
			item.Channels = []gouoAdminChannel{}
		}
		item.OpenGroups = gouoOpenGroups(item.Channels, func(channel gouoAdminChannel) bool { return channel.Stream })
		item.Reason = gouoAgentReason(item)
		item.Visible = item.Reason == ""
		for _, channel := range item.Channels {
			if channel.Status == 1 && channel.MappedTo != "" && channel.MappedTo != item.Model && !channel.BillingOriginal {
				item.PriceWarning = "渠道「" + channel.Name + "」把它映射到 " + channel.MappedTo + "，实际按 " + channel.MappedTo + " 的价格扣费；要按这里的价格扣费，请在渠道的模型映射里写成 \"+" + channel.MappedTo + "\""
				break
			}
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
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": gin.H{"default_model": config.GouoAgentDefaultModel, "models": models}})
}

func setGouoListItem(raw string, item string, on bool) string {
	list, _ := utils.UnmarshalString[[]string](raw)
	list = slices.DeleteFunc(list, func(value string) bool { return strings.EqualFold(strings.TrimSpace(value), item) })
	if on {
		list = append(list, item)
	}
	if list == nil {
		list = []string{}
	}
	return utils.Marshal(list)
}

// UpdateGouoAdminAgentModel 上架、下架或编辑一个 Agent 文本模型。
// 上架即在模型详情里声明“输出文本”和“工具调用”，与客户端 Agent 目录的判断条件一致；下架只去掉工具调用声明，价格保留
func UpdateGouoAdminAgentModel(c *gin.Context) {
	var input struct {
		Model        string   `json:"model"`
		Listed       bool     `json:"listed"`
		Name         *string  `json:"name"`
		Description  *string  `json:"description"`
		Sort         *int     `json:"gouo_sort"`
		Vision       *bool    `json:"vision"`
		InputPoints  *float64 `json:"input_points"`
		OutputPoints *float64 `json:"output_points"`
		MaxTokens    *int     `json:"gouo_max_tokens"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || strings.TrimSpace(input.Model) == "" || len(input.Model) > 100 {
		gouoFail(c, http.StatusBadRequest, "invalid_model", "模型名称无效")
		return
	}
	id := strings.TrimSpace(input.Model)
	if strings.ContainsAny(id, "*#") {
		gouoFail(c, http.StatusBadRequest, "invalid_model", "模型 ID 不能含 * 或 #")
		return
	}
	if err := validateGouoModelText(input.Name, input.Description); err != nil {
		gouoFail(c, http.StatusBadRequest, "invalid_model_text", err.Error())
		return
	}
	if input.MaxTokens != nil && (*input.MaxTokens < 0 || *input.MaxTokens > 1000000) {
		gouoFail(c, http.StatusBadRequest, "invalid_max_tokens", "单次回复最多输出 token 必须在 0 到 100 万之间，0 表示不限")
		return
	}
	for _, points := range []*float64{input.InputPoints, input.OutputPoints} {
		if points != nil && (math.IsNaN(*points) || math.IsInf(*points, 0) || *points < 0 || *points > 1e7) {
			gouoFail(c, http.StatusBadRequest, "invalid_agent_price", "价格必须在 0 到 1000 万积分/百万 token 之间")
			return
		}
	}
	model.PricingInstance.RLock()
	existing, priced := model.PricingInstance.Prices[id]
	var price model.Price
	if priced {
		price = *existing
	}
	model.PricingInstance.RUnlock()
	if priced && price.GouoEnabled {
		gouoFail(c, http.StatusBadRequest, "image_model_enabled", "该模型已作为图片模型启用，请先在图片模型里下架")
		return
	}
	if !priced && input.Listed && (input.InputPoints == nil || input.OutputPoints == nil) {
		gouoFail(c, http.StatusBadRequest, "invalid_agent_price", "首次上架请填写输入和输出价格")
		return
	}
	// 价格相关的校验都要在写入模型资料之前做完，否则校验失败时模型已经被标成上架
	pointsSet := input.InputPoints != nil || input.OutputPoints != nil
	// 按次计费改成按 token 时两个价格都要重新填，否则另一个沿用按次计费的数值
	if priced && price.Type == model.TimesPriceType && pointsSet && (input.InputPoints == nil || input.OutputPoints == nil) {
		gouoFail(c, http.StatusBadRequest, "invalid_agent_price", "该模型当前按次计费，改为按 token 计费需同时填写输入和输出价格")
		return
	}
	// 汇率和额度单位为 0、无穷大或 NaN 时换算倍率不是有限正数，价格会被存成无穷大或 0（等于免费）
	rate := gouoPointsPerMillionTokens()
	if pointsSet && !(rate > 0 && !math.IsInf(rate, 0)) {
		gouoFail(c, http.StatusBadRequest, "invalid_agent_price", "支付汇率或额度单位未设置，无法换算积分价格")
		return
	}
	if err := saveGouoModelInfo(id, func(info *model.ModelInfo) {
		applyGouoModelText(info, input.Name, input.Description)
		for _, tag := range model.GouoToolTags {
			info.Tags = setGouoListItem(info.Tags, tag, false)
		}
		if input.Listed {
			info.Tags = setGouoListItem(info.Tags, "tools", true)
			info.OutputModalities = setGouoListItem(info.OutputModalities, "text", true)
			info.InputModalities = setGouoListItem(info.InputModalities, "text", true)
		}
		if input.Vision != nil {
			info.InputModalities = setGouoListItem(info.InputModalities, "image", *input.Vision)
		}
	}); err != nil {
		gouoFail(c, http.StatusInternalServerError, "model_info_save_failed", "保存模型能力失败")
		return
	}
	changed := input.Sort != nil || input.InputPoints != nil || input.OutputPoints != nil || input.MaxTokens != nil
	if !changed {
		// 只改了模型详情（例如下架），不动价格记录，免得把上游同步来的价格锁定
		if err := model.PricingInstance.Init(); err != nil {
			gouoFail(c, http.StatusInternalServerError, "pricing_reload_failed", "刷新模型目录失败")
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
		return
	}
	if !priced {
		price = model.Price{Model: id, Type: model.TokensPriceType, ChannelType: config.ChannelTypeUnknown}
	}
	if input.InputPoints != nil {
		price.Type, price.Input = model.TokensPriceType, *input.InputPoints/rate
	}
	if input.OutputPoints != nil {
		price.Type, price.Output = model.TokensPriceType, *input.OutputPoints/rate
	}
	if input.Sort != nil {
		price.GouoSort = *input.Sort
	}
	if input.MaxTokens != nil {
		price.GouoMaxTokens = *input.MaxTokens
	}
	// 在这里定的价格不随上游价格同步被覆盖或删除；只改排序或回复上限时不锁定
	if pointsSet {
		price.Locked = true
	}
	var err error
	if priced {
		err = model.PricingInstance.UpdatePrice(id, &price)
	} else {
		err = model.PricingInstance.AddPrice(&price)
	}
	if err != nil {
		gouoFail(c, http.StatusBadRequest, "invalid_agent_price", err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

func splitTrimmed(value string) []string {
	var items []string
	for _, item := range strings.Split(value, ",") {
		if item = strings.TrimSpace(item); item != "" {
			items = append(items, item)
		}
	}
	return items
}
