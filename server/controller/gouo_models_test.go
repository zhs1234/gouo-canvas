package controller

import (
	"encoding/json"
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
	// 尺寸、画质、参考图限制：保存后出现在目录和列表里，非法值拒绝
	require.Equal(t, http.StatusOK, update(`{"model":"image-new","gouo_enabled":true,"gouo_price_cny":0.3,"gouo_reference":true,"gouo_max_outputs":2,"gouo_max_size":"2k","gouo_qualities":["low","medium"],"gouo_max_inputs":4}`).Code)
	after, err = model.PricingInstance.GetGouoModel("image-new")
	require.NoError(t, err)
	require.Equal(t, "2K", after.MaxSize)
	require.Equal(t, []string{"low", "medium"}, after.Qualities)
	require.Equal(t, 4, after.MaxInputs)
	_, models = list()
	require.Equal(t, "2K", models["image-new"]["gouo_max_size"])
	require.Equal(t, []any{"low", "medium"}, models["image-new"]["gouo_qualities"])
	for _, body := range []string{
		`{"model":"image-new","gouo_enabled":true,"gouo_price_cny":0.3,"gouo_max_outputs":1,"gouo_max_size":"8K"}`,
		`{"model":"image-new","gouo_enabled":true,"gouo_price_cny":0.3,"gouo_max_outputs":1,"gouo_qualities":["ultra"]}`,
		`{"model":"image-new","gouo_enabled":true,"gouo_price_cny":0.3,"gouo_max_outputs":1,"gouo_max_inputs":17}`,
	} {
		require.Equal(t, http.StatusBadRequest, update(body).Code, body)
	}
	// 改回不限：价格版本回到原值
	require.Equal(t, http.StatusOK, update(`{"model":"image-new","gouo_enabled":true,"gouo_price_cny":0.3,"gouo_reference":true,"gouo_max_outputs":2,"gouo_max_size":"","gouo_qualities":[],"gouo_max_inputs":0}`).Code)
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
