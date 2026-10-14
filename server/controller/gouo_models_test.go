package controller

import (
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"one-api/common/config"
	"one-api/model"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"gorm.io/datatypes"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestMarkGouoDefaultModel(t *testing.T) {
	catalog := func() []*model.GouoImageModel {
		return []*model.GouoImageModel{{ID: "image-a"}, {ID: "image-b"}}
	}
	defaults := func(models []*model.GouoImageModel) []string {
		var ids []string
		for _, entry := range models {
			if entry.Default {
				ids = append(ids, entry.ID)
			}
		}
		return ids
	}
	// 后台设置的默认模型可用时标出它
	models := catalog()
	markGouoDefaultModel(models, " image-b ")
	require.Equal(t, []string{"image-b"}, defaults(models))
	// 未设置或对当前令牌不可用时，取目录第一个
	for _, preferred := range []string{"", "image-x"} {
		models = catalog()
		markGouoDefaultModel(models, preferred)
		require.Equal(t, []string{"image-a"}, defaults(models))
	}
	markGouoDefaultModel(nil, "image-a")
}

func TestGouoAdminModelsListAndUpdate(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Price{}, &model.ModelInfo{}, &model.Channel{}))
	oldDB, oldPricing, oldDefault := model.DB, model.PricingInstance, config.GouoDefaultImageModel
	model.DB, config.GouoDefaultImageModel = db, "image-a"
	model.PricingInstance = &model.Pricing{Prices: map[string]*model.Price{}}
	oldGroups := model.GlobalUserGroupRatio.UserGroup
	model.GlobalUserGroupRatio.UserGroup = map[string]*model.UserGroup{"default": {Symbol: "default", Ratio: 1}}
	t.Cleanup(func() {
		model.DB, model.PricingInstance, config.GouoDefaultImageModel = oldDB, oldPricing, oldDefault
		model.GlobalUserGroupRatio.UserGroup = oldGroups
	})
	require.NoError(t, db.Create(&model.Price{Model: "image-a", Type: model.TimesPriceType, GouoEnabled: true, GouoPriceCNY: 0.1, GouoMaxOutputs: 1}).Error)
	require.NoError(t, db.Create(&model.Channel{Name: "上游", Status: 1, Models: "image-a, image-new", Group: "default,vip"}).Error)
	require.NoError(t, db.Create(&model.ModelInfo{Model: "image-new", Name: "已有图片名称", Description: "已有图片说明"}).Error)
	require.NoError(t, db.Create(&model.Channel{Name: "通配符", Status: 1, Models: "image-*,image-a", Group: "default"}).Error)
	require.NoError(t, model.PricingInstance.Init())

	router := gin.New()
	router.GET("/models", ListGouoAdminModels)
	router.PUT("/models", UpdateGouoAdminModel)
	list := func() (string, map[string]map[string]any) {
		res := httptest.NewRecorder()
		router.ServeHTTP(res, httptest.NewRequest("GET", "/models", nil))
		require.Equal(t, http.StatusOK, res.Code)
		var body struct {
			Data struct {
				DefaultModel string           `json:"default_model"`
				Models       []map[string]any `json:"models"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(res.Body.Bytes(), &body))
		byID := map[string]map[string]any{}
		for _, item := range body.Data.Models {
			byID[item["model"].(string)] = item
		}
		return body.Data.DefaultModel, byID
	}
	defaultModel, models := list()
	require.Equal(t, "image-a", defaultModel)
	require.Equal(t, true, models["image-a"]["gouo_enabled"])
	// 只在渠道上配置、还没有价格的模型也列出，便于直接启用
	require.Equal(t, false, models["image-new"]["priced"])
	require.Equal(t, "已有图片名称", models["image-new"]["name"])
	require.Equal(t, "已有图片说明", models["image-new"]["description"])
	require.Len(t, models["image-a"]["channels"], 2)
	require.Len(t, models["image-new"]["channels"], 1)
	require.Equal(t, []any{"default", "vip"}, models["image-new"]["channels"].([]any)[0].(map[string]any)["groups"])
	// vip 不是有效的用户分组，不算开放分组
	require.Equal(t, []any{"default"}, models["image-new"]["open_groups"])

	update := func(body string) *httptest.ResponseRecorder {
		res := httptest.NewRecorder()
		router.ServeHTTP(res, httptest.NewRequest("PUT", "/models", strings.NewReader(body)))
		return res
	}
	// 启用新模型：新建价格记录
	require.Equal(t, http.StatusOK, update(`{"model":"image-new","gouo_enabled":true,"gouo_price_cny":0.3,"gouo_reference":true,"gouo_max_outputs":2}`).Code)
	_, models = list()
	require.Equal(t, true, models["image-new"]["gouo_enabled"])
	require.Equal(t, 0.3, models["image-new"]["gouo_price_cny"])
	before, err := model.PricingInstance.GetGouoModel("image-new")
	require.NoError(t, err)
	require.Equal(t, "已有图片名称", before.Name)
	// 显示名称、说明和排序不参与价格版本，修改后用户不必重新确认价格
	require.Equal(t, http.StatusOK, update(`{"model":"image-new","gouo_enabled":true,"gouo_price_cny":0.3,"gouo_reference":true,"gouo_max_outputs":2,"name":" 标准画质 ","description":"速度快，适合草图","gouo_sort":-1}`).Code)
	after, err := model.PricingInstance.GetGouoModel("image-new")
	require.NoError(t, err)
	require.Equal(t, before.PriceVersion, after.PriceVersion)
	require.Equal(t, "标准画质", after.Name)
	require.Equal(t, "速度快，适合草图", after.Description)
	require.Equal(t, -1, after.Sort)
	_, models = list()
	require.Equal(t, "标准画质", models["image-new"]["name"])
	require.Equal(t, float64(-1), models["image-new"]["gouo_sort"])
	// 名称过长时拒绝
	require.Equal(t, http.StatusBadRequest, update(`{"model":"image-new","gouo_enabled":true,"gouo_price_cny":0.3,"gouo_max_outputs":1,"name":"`+strings.Repeat("长", 41)+`"}`).Code)
	// 省略名称等字段（如下架按钮）时保持原值
	require.Equal(t, http.StatusOK, update(`{"model":"image-new","gouo_enabled":true,"gouo_price_cny":0.3,"gouo_reference":true,"gouo_max_outputs":2}`).Code)
	after, err = model.PricingInstance.GetGouoModel("image-new")
	require.NoError(t, err)
	require.Equal(t, "标准画质", after.Name)
	require.Equal(t, -1, after.Sort)
	// 分辨率档位、画质、参考图限制：保存后出现在目录和列表里，非法值拒绝
	require.Equal(t, http.StatusOK, update(`{"model":"image-new","gouo_enabled":true,"gouo_price_cny":0.3,"gouo_reference":true,"gouo_max_outputs":2,"gouo_sizes":["1k","2K"],"gouo_qualities":["low","medium"],"gouo_max_inputs":4}`).Code)
	after, err = model.PricingInstance.GetGouoModel("image-new")
	require.NoError(t, err)
	require.Equal(t, []string{"1K", "2K"}, after.Sizes)
	require.Equal(t, []string{"low", "medium"}, after.Qualities)
	require.Equal(t, 4, after.MaxInputs)
	_, models = list()
	require.Equal(t, []any{"1K", "2K"}, models["image-new"]["gouo_sizes"])
	require.Equal(t, []any{"low", "medium"}, models["image-new"]["gouo_qualities"])
	for _, body := range []string{
		`{"model":"image-new","gouo_enabled":true,"gouo_price_cny":0.3,"gouo_max_outputs":1,"gouo_sizes":["8K"]}`,
		`{"model":"image-new","gouo_enabled":true,"gouo_price_cny":0.3,"gouo_max_outputs":1,"gouo_qualities":["ultra"]}`,
		`{"model":"image-new","gouo_enabled":true,"gouo_price_cny":0.3,"gouo_max_outputs":1,"gouo_max_inputs":17}`,
	} {
		require.Equal(t, http.StatusBadRequest, update(body).Code, body)
	}
	// 改回原样（不开放档位、画质和张数不限）：价格版本回到原值
	require.Equal(t, http.StatusOK, update(`{"model":"image-new","gouo_enabled":true,"gouo_price_cny":0.3,"gouo_reference":true,"gouo_max_outputs":2,"gouo_sizes":[],"gouo_qualities":[],"gouo_max_inputs":0}`).Code)
	after, err = model.PricingInstance.GetGouoModel("image-new")
	require.NoError(t, err)
	require.Equal(t, before.PriceVersion, after.PriceVersion)
	// 售价无效、只开遮罩不开参考图时拒绝
	require.Equal(t, http.StatusBadRequest, update(`{"model":"image-a","gouo_enabled":true,"gouo_price_cny":0}`).Code)
	require.Equal(t, http.StatusBadRequest, update(`{"model":"image-a","gouo_enabled":true,"gouo_price_cny":0.1,"gouo_mask":true}`).Code)
	// 关闭后客户端目录不再包含它
	require.Equal(t, http.StatusOK, update(`{"model":"image-a","gouo_enabled":false}`).Code)
	_, err = model.PricingInstance.GetGouoModel("image-a")
	require.Error(t, err)
}

func TestGouoAdminAgentModels(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Price{}, &model.ModelInfo{}, &model.Channel{}))
	oldDB, oldPricing, oldRate, oldUnit := model.DB, model.PricingInstance, config.PaymentUSDRate, config.QuotaPerUnit
	oldGroups := model.GlobalUserGroupRatio.UserGroup
	model.DB, config.PaymentUSDRate, config.QuotaPerUnit = db, 7.3, 500000
	model.PricingInstance = &model.Pricing{Prices: map[string]*model.Price{}}
	model.GlobalUserGroupRatio.UserGroup = map[string]*model.UserGroup{"default": {Symbol: "default", Ratio: 1}}
	t.Cleanup(func() {
		model.DB, model.PricingInstance, config.PaymentUSDRate, config.QuotaPerUnit = oldDB, oldPricing, oldRate, oldUnit
		model.GlobalUserGroupRatio.UserGroup = oldGroups
	})
	noStream := datatypes.NewJSONSlice([]string{"chat-b"})
	require.NoError(t, db.Create(&model.Channel{Name: "文本", Status: 1, Models: "chat-a,chat-b,image-x", Group: "default", DisabledStream: &noStream}).Error)
	require.NoError(t, db.Create(&model.Price{Model: "image-x", Type: model.TimesPriceType, GouoEnabled: true, GouoPriceCNY: 0.1, GouoMaxOutputs: 1}).Error)
	require.NoError(t, db.Create(&model.ModelInfo{Model: "chat-b", Name: "已有助手", Description: "已有说明", InputModalities: `["text","image"]`, OutputModalities: `["text"]`, Tags: `["tools"]`}).Error)
	require.NoError(t, db.Create(&model.ModelInfo{Model: "chat-wild", OutputModalities: `["text"]`, Tags: `["tools"]`}).Error)
	require.NoError(t, db.Create(&model.Price{Model: "chat-wild", Type: model.TokensPriceType}).Error)
	wildNoStream := datatypes.NewJSONSlice([]string{"chat-wild"})
	wildMapping := `{"chat-wild":"+upstream"}`
	require.NoError(t, db.Create(&model.Channel{Name: "通配符", Status: 1, Models: "chat-*", Group: "default", DisabledStream: &wildNoStream, ModelMapping: &wildMapping}).Error)
	require.NoError(t, model.PricingInstance.Init())

	router := gin.New()
	router.GET("/agent-models", ListGouoAdminAgentModels)
	router.PUT("/agent-models", UpdateGouoAdminAgentModel)
	list := func() map[string]map[string]any {
		res := httptest.NewRecorder()
		router.ServeHTTP(res, httptest.NewRequest("GET", "/agent-models", nil))
		require.Equal(t, http.StatusOK, res.Code)
		var body struct {
			Data struct {
				Models []map[string]any `json:"models"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(res.Body.Bytes(), &body))
		byID := map[string]map[string]any{}
		for _, item := range body.Data.Models {
			byID[item["model"].(string)] = item
		}
		return byID
	}
	update := func(body string) *httptest.ResponseRecorder {
		res := httptest.NewRecorder()
		router.ServeHTTP(res, httptest.NewRequest("PUT", "/agent-models", strings.NewReader(body)))
		return res
	}
	models := list()
	// 已作为图片模型启用的不出现在 Agent 列表
	require.NotContains(t, models, "image-x")
	require.Equal(t, "未上架", models["chat-a"]["reason"])
	require.Equal(t, false, models["chat-a"]["priced"])
	require.Equal(t, "已有助手", models["chat-b"]["name"])
	require.Equal(t, "已有说明", models["chat-b"]["description"])
	require.Equal(t, true, models["chat-b"]["vision"])
	require.Equal(t, true, models["chat-b"]["listed"])
	require.Equal(t, "渠道关闭了此模型的流式输出", models["chat-wild"]["reason"])
	require.Len(t, models["chat-wild"]["channels"], 1)
	wildChannel := models["chat-wild"]["channels"].([]any)[0].(map[string]any)
	require.Equal(t, "upstream", wildChannel["mapped_to"])
	require.Equal(t, true, wildChannel["billing_original"])

	// 首次上架必须填价格；已启用的图片模型不能上架为 Agent
	require.Equal(t, http.StatusBadRequest, update(`{"model":"chat-a","listed":true}`).Code)
	require.Equal(t, http.StatusBadRequest, update(`{"model":"image-x","listed":true,"input_points":1,"output_points":1}`).Code)
	require.Equal(t, http.StatusBadRequest, update(`{"model":"chat-a","listed":true,"input_points":-1,"output_points":1}`).Code)

	// 按“积分/百万 token”填写，存成每 token 的额度倍率：1460 积分 = 倍率 1
	require.Equal(t, http.StatusOK, update(`{"model":"chat-a","listed":true,"name":"通用助手","description":"适合日常创作","vision":true,"gouo_sort":2,"input_points":1460,"output_points":2920}`).Code)
	price := model.PricingInstance.Prices["chat-a"]
	require.InDelta(t, 1.0, price.Input, 1e-9)
	require.InDelta(t, 2.0, price.Output, 1e-9)
	require.True(t, price.Locked)
	require.Equal(t, 2, price.GouoSort)
	agent := gouoAgentCapabilities(price)
	require.NotNil(t, agent)
	// 目录返回每百万 token 的人民币价格：1460 积分 = 14.6 元
	require.InDelta(t, 14.6, agent.InputPriceCNY, 1e-9)
	require.InDelta(t, 29.2, agent.OutputPriceCNY, 1e-9)
	// 单次回复上限
	require.Equal(t, http.StatusOK, update(`{"model":"chat-a","listed":true,"gouo_max_tokens":4000}`).Code)
	require.Equal(t, 4000, model.PricingInstance.Prices["chat-a"].GouoMaxTokens)
	require.Equal(t, http.StatusBadRequest, update(`{"model":"chat-a","listed":true,"gouo_max_tokens":-1}`).Code)
	price = model.PricingInstance.Prices["chat-a"]
	require.Equal(t, "通用助手", agent.Name)
	require.Equal(t, "适合日常创作", agent.Description)
	require.True(t, agent.Vision)
	models = list()
	require.Equal(t, true, models["chat-a"]["visible"])
	require.InDelta(t, 1460.0, models["chat-a"]["input_points"].(float64), 1e-6)
	require.Equal(t, []any{"default"}, models["chat-a"]["open_groups"])

	// 渠道把模型映射到其他上游模型、且没有用 + 按原模型计费时，提示这里的价格不生效
	mapped, billedOriginal := `{"chat-c":"chat-a"}`, `{"chat-d":"+chat-a"}`
	require.NoError(t, db.Create(&model.Channel{Name: "映射", Status: 1, Models: "chat-c", Group: "default", ModelMapping: &mapped}).Error)
	require.NoError(t, db.Create(&model.Channel{Name: "原价", Status: 1, Models: "chat-d", Group: "default", ModelMapping: &billedOriginal}).Error)
	models = list()
	require.Contains(t, models["chat-c"]["price_warning"], "实际按 chat-a 的价格扣费")
	require.Nil(t, models["chat-d"]["price_warning"])
	require.Nil(t, models["chat-a"]["price_warning"])

	// 渠道关闭了流式输出时给出原因
	require.Equal(t, http.StatusOK, update(`{"model":"chat-b","listed":true,"input_points":0,"output_points":0}`).Code)
	require.Equal(t, true, list()["chat-b"]["visible"])
	require.NoError(t, db.Model(&model.Channel{}).Where("name = ?", "通配符").Update("disabled_stream", datatypes.NewJSONSlice([]string{"chat-b", "chat-wild"})).Error)
	require.Equal(t, "渠道关闭了此模型的流式输出", list()["chat-b"]["reason"])
	require.Equal(t, "已有助手", model.PricingInstance.Prices["chat-b"].ModelInfo.Name)
	require.Contains(t, model.PricingInstance.Prices["chat-b"].ModelInfo.InputModalities, "image")

	// 下架只去掉工具声明，价格和名称保留
	require.Equal(t, http.StatusOK, update(`{"model":"chat-a","listed":false}`).Code)
	price = model.PricingInstance.Prices["chat-a"]
	require.Nil(t, gouoAgentCapabilities(price))
	require.InDelta(t, 1.0, price.Input, 1e-9)
	require.Equal(t, "通用助手", price.ModelInfo.Name)
	require.Equal(t, "未上架", list()["chat-a"]["reason"])
}

func TestGouoModelKind(t *testing.T) {
	agentInfo := &model.ModelInfoResponse{OutputModalities: []string{"text"}, Tags: []string{"tools"}}
	cases := []struct {
		name  string
		id    string
		price *model.Price
		info  *model.ModelInfoResponse
		want  string
	}{
		{"已启用的图片模型", "chat-x", &model.Price{GouoEnabled: true, Type: model.TokensPriceType}, nil, "image"},
		{"已上架的 Agent 模型", "gpt-image-1", nil, agentInfo, "text"},
		{"资料只输出图片", "chat-y", nil, &model.ModelInfoResponse{OutputModalities: []string{"image"}}, "image"},
		{"资料只输出文本", "my-assistant", nil, &model.ModelInfoResponse{OutputModalities: []string{"text"}}, "text"},
		{"图片模型从 Agent 下架后资料仍留着文本输出，按名称归图片", "gpt-image-1", nil, &model.ModelInfoResponse{OutputModalities: []string{"text"}, Tags: []string{}}, "image"},
		{"按名称识别图片模型", "black-forest-labs/FLUX.1-dev", nil, nil, "image"},
		{"按 token 计费的是文本模型", "gpt-4o", &model.Price{Type: model.TokensPriceType}, nil, "text"},
		{"主流文本模型没有价格也能识别", "gpt-5.5", nil, nil, "text"},
		{"带供应商前缀的主流文本模型", "anthropic/claude-sonnet-4-6", nil, nil, "text"},
		{"图片名称特征优先于文本前缀", "gemini-3-pro-image-preview", nil, nil, "image"},
		{"豆包图片模型不算豆包文本模型", "doubao-seedream-4-0-250828", nil, nil, "image"},
		{"即梦", "jimeng-4.0", nil, nil, "image"},
		{"通义万相", "wan2.5-t2i-preview", nil, nil, "image"},
		{"dall-e 即使按 token 计费也是图片模型", "dall-e-3", &model.Price{Type: model.TokensPriceType}, nil, "image"},
		{"无法判断", "mystery", &model.Price{Type: model.TimesPriceType}, nil, ""},
	}
	for _, tc := range cases {
		require.Equal(t, tc.want, gouoModelKind(tc.id, tc.price, tc.info), tc.name)
	}
}

func TestGouoAdminModelKindSeparation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Price{}, &model.ModelInfo{}, &model.Channel{}))
	oldDB, oldPricing := model.DB, model.PricingInstance
	oldGroups := model.GlobalUserGroupRatio.UserGroup
	model.DB = db
	model.PricingInstance = &model.Pricing{Prices: map[string]*model.Price{}}
	model.GlobalUserGroupRatio.UserGroup = map[string]*model.UserGroup{"default": {Symbol: "default", Ratio: 1}}
	t.Cleanup(func() {
		model.DB, model.PricingInstance = oldDB, oldPricing
		model.GlobalUserGroupRatio.UserGroup = oldGroups
	})
	require.NoError(t, db.Create(&model.Channel{Name: "混合", Status: 1, Models: "gpt-image-1,gpt-4o,chat-agent,mystery", Group: "default"}).Error)
	require.NoError(t, db.Create(&model.Price{Model: "gpt-4o", Type: model.TokensPriceType, Input: 1, Output: 2}).Error)
	require.NoError(t, db.Create(&model.Price{Model: "chat-agent", Type: model.TokensPriceType, Input: 1, Output: 2}).Error)
	require.NoError(t, db.Create(&model.ModelInfo{Model: "chat-agent", OutputModalities: `["text"]`, Tags: `["tools"]`}).Error)
	require.NoError(t, model.PricingInstance.Init())

	router := gin.New()
	router.GET("/models", ListGouoAdminModels)
	router.PUT("/models", UpdateGouoAdminModel)
	router.GET("/agent-models", ListGouoAdminAgentModels)
	router.PUT("/agent-models", UpdateGouoAdminAgentModel)
	kinds := func(path string) map[string]string {
		res := httptest.NewRecorder()
		router.ServeHTTP(res, httptest.NewRequest("GET", path, nil))
		require.Equal(t, http.StatusOK, res.Code)
		var body struct {
			Data struct {
				Models []map[string]any `json:"models"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(res.Body.Bytes(), &body))
		byID := map[string]string{}
		for _, item := range body.Data.Models {
			byID[item["model"].(string)] = item["kind"].(string)
		}
		return byID
	}
	update := func(path, body string) *httptest.ResponseRecorder {
		res := httptest.NewRecorder()
		router.ServeHTTP(res, httptest.NewRequest("PUT", path, strings.NewReader(body)))
		return res
	}
	want := map[string]string{"gpt-image-1": "image", "gpt-4o": "text", "chat-agent": "text", "mystery": ""}
	require.Equal(t, want, kinds("/models"))
	require.Equal(t, want, kinds("/agent-models"))

	// 已上架为 Agent 的模型不能再作为图片模型启用
	res := update("/models", `{"model":"chat-agent","gouo_enabled":true,"gouo_price_cny":0.1,"gouo_max_outputs":1}`)
	require.Equal(t, http.StatusBadRequest, res.Code)
	require.Contains(t, res.Body.String(), "agent_model_listed")
	require.False(t, model.PricingInstance.Prices["chat-agent"].GouoEnabled)
	// 在 Agent 里下架后可以启用；启用后反过来也不能再上架为 Agent
	require.Equal(t, http.StatusOK, update("/agent-models", `{"model":"chat-agent","listed":false}`).Code)
	// 别的实例刚重新上架、本实例价格缓存还没刷新时，也以数据库为准
	require.NotNil(t, model.PricingInstance.Prices["chat-agent"].ModelInfo)
	require.NoError(t, db.Model(&model.ModelInfo{}).Where("model = ?", "chat-agent").Update("tags", `["tools"]`).Error)
	require.Equal(t, http.StatusBadRequest, update("/models", `{"model":"chat-agent","gouo_enabled":true,"gouo_price_cny":0.1,"gouo_max_outputs":1}`).Code)
	require.NoError(t, db.Model(&model.ModelInfo{}).Where("model = ?", "chat-agent").Update("tags", `[]`).Error)
	require.Equal(t, http.StatusOK, update("/models", `{"model":"chat-agent","gouo_enabled":true,"gouo_price_cny":0.1,"gouo_max_outputs":1}`).Code)
	require.Equal(t, "image", kinds("/models")["chat-agent"])
	require.NotContains(t, kinds("/agent-models"), "chat-agent")
	require.Equal(t, http.StatusBadRequest, update("/agent-models", `{"model":"chat-agent","listed":true,"input_points":1,"output_points":1}`).Code)
	// 未上架为 Agent 的模型照常启用，已启用的模型再次保存不受影响
	require.Equal(t, http.StatusOK, update("/models", `{"model":"gpt-image-1","gouo_enabled":true,"gouo_price_cny":0.2,"gouo_max_outputs":1}`).Code)
	require.Equal(t, http.StatusOK, update("/models", `{"model":"gpt-image-1","gouo_enabled":true,"gouo_price_cny":0.3,"gouo_max_outputs":1}`).Code)
}

func TestGouoAdminAgentPriceKeepsBilling(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Price{}, &model.ModelInfo{}, &model.Channel{}))
	oldDB, oldPricing, oldRate, oldUnit := model.DB, model.PricingInstance, config.PaymentUSDRate, config.QuotaPerUnit
	oldGroups := model.GlobalUserGroupRatio.UserGroup
	model.DB, config.PaymentUSDRate, config.QuotaPerUnit = db, 7.3, 500000
	model.PricingInstance = &model.Pricing{Prices: map[string]*model.Price{}}
	model.GlobalUserGroupRatio.UserGroup = map[string]*model.UserGroup{"default": {Symbol: "default", Ratio: 1}}
	t.Cleanup(func() {
		model.DB, model.PricingInstance, config.PaymentUSDRate, config.QuotaPerUnit = oldDB, oldPricing, oldRate, oldUnit
		model.GlobalUserGroupRatio.UserGroup = oldGroups
	})
	require.NoError(t, db.Create(&model.Channel{Name: "文本", Status: 1, Models: "chat-times,chat-sync", Group: "default"}).Error)
	require.NoError(t, db.Create(&model.Price{Model: "chat-times", Type: model.TimesPriceType, Input: 0.5, Output: 0.5}).Error)
	require.NoError(t, db.Create(&model.Price{Model: "chat-sync", Type: model.TokensPriceType, Input: 1, Output: 2}).Error)
	for _, id := range []string{"chat-times", "chat-sync"} {
		require.NoError(t, db.Create(&model.ModelInfo{Model: id, OutputModalities: `["text"]`, Tags: `["tools"]`}).Error)
	}
	require.NoError(t, model.PricingInstance.Init())

	router := gin.New()
	router.GET("/agent-models", ListGouoAdminAgentModels)
	router.PUT("/agent-models", UpdateGouoAdminAgentModel)
	update := func(body string) int {
		res := httptest.NewRecorder()
		router.ServeHTTP(res, httptest.NewRequest("PUT", "/agent-models", strings.NewReader(body)))
		return res.Code
	}
	res := httptest.NewRecorder()
	router.ServeHTTP(res, httptest.NewRequest("GET", "/agent-models", nil))
	var body struct {
		Data struct {
			Models []map[string]any `json:"models"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(res.Body.Bytes(), &body))
	byID := map[string]map[string]any{}
	for _, item := range body.Data.Models {
		byID[item["model"].(string)] = item
	}
	// 按次计费显示每次请求的积分：每次扣 1000 × 0.5 额度 = 1000 × 0.5 / 500000 美元 × 7.3 × 100 积分
	require.Equal(t, "times", byID["chat-times"]["price_type"])
	require.InDelta(t, 0.73, byID["chat-times"]["input_points"].(float64), 1e-9)
	require.InDelta(t, 0.0, byID["chat-times"]["output_points"].(float64), 1e-9)
	require.Equal(t, "tokens", byID["chat-sync"]["price_type"])
	// 客户端按每百万 token 显示 Agent 价格，按次计费的模型即使已上架也不进目录
	require.Equal(t, true, byID["chat-times"]["listed"])
	require.Equal(t, false, byID["chat-times"]["visible"])
	require.Contains(t, byID["chat-times"]["reason"], "按次计费")
	require.Nil(t, gouoAgentCapabilities(model.PricingInstance.Prices["chat-times"]))

	// 下架不改价格记录，上游同步来的价格不会因此被锁定
	require.Equal(t, http.StatusOK, update(`{"model":"chat-sync","listed":false}`))
	price := model.PricingInstance.Prices["chat-sync"]
	require.False(t, price.Locked)
	require.Nil(t, gouoAgentCapabilities(price))
	// 只改排序也不锁定
	require.Equal(t, http.StatusOK, update(`{"model":"chat-sync","listed":false,"gouo_sort":3}`))
	require.False(t, model.PricingInstance.Prices["chat-sync"].Locked)
	require.Equal(t, 3, model.PricingInstance.Prices["chat-sync"].GouoSort)

	// 按次计费改为按 token 必须同时填两个价格；校验失败时不改动上架状态
	require.Equal(t, http.StatusOK, update(`{"model":"chat-times","listed":false}`))
	require.Equal(t, http.StatusBadRequest, update(`{"model":"chat-times","listed":true,"input_points":1460}`))
	require.Equal(t, model.TimesPriceType, model.PricingInstance.Prices["chat-times"].Type)
	stored, err := model.GetModelInfoByModel("chat-times")
	require.NoError(t, err)
	require.False(t, model.GouoAgentListed(stored.ToResponse()))
	require.Equal(t, http.StatusOK, update(`{"model":"chat-times","listed":true,"input_points":1460,"output_points":2920}`))
	price = model.PricingInstance.Prices["chat-times"]
	require.Equal(t, model.TokensPriceType, price.Type)
	require.InDelta(t, 2.0, price.Output, 1e-9)
	require.True(t, price.Locked)
	require.NotNil(t, gouoAgentCapabilities(price))

	// 汇率或额度单位未设置时无法换算，拒绝而不是存入无穷大或 0；也不能先把模型标成上架
	for _, zero := range []func(){
		func() { config.PaymentUSDRate = 0 },
		func() { config.PaymentUSDRate, config.QuotaPerUnit = 7.3, 0 },
		func() { config.PaymentUSDRate, config.QuotaPerUnit = math.Inf(1), 500000 },
		func() { config.PaymentUSDRate, config.QuotaPerUnit = 7.3, math.Inf(1) },
		func() { config.PaymentUSDRate, config.QuotaPerUnit = math.NaN(), 500000 },
		// 倍率是有限正数，但换算出的价格溢出成无穷大
		func() { config.PaymentUSDRate, config.QuotaPerUnit = 1e-315, 500000 },
	} {
		zero()
		require.Equal(t, http.StatusBadRequest, update(`{"model":"chat-sync","listed":true,"input_points":1,"output_points":1}`))
		require.InDelta(t, 1.0, model.PricingInstance.Prices["chat-sync"].Input, 1e-9)
		stored, err := model.GetModelInfoByModel("chat-sync")
		require.NoError(t, err)
		require.False(t, model.GouoAgentListed(stored.ToResponse()))
	}
}
