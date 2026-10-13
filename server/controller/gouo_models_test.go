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
	t.Cleanup(func() { model.DB, model.PricingInstance, config.GouoDefaultImageModel = oldDB, oldPricing, oldDefault })
	require.NoError(t, db.Create(&model.Price{Model: "image-a", Type: model.TimesPriceType, GouoEnabled: true, GouoPriceCNY: 0.1, GouoMaxOutputs: 1}).Error)
	require.NoError(t, db.Create(&model.Channel{Name: "上游", Status: 1, Models: "image-a, image-new", Group: "default,vip"}).Error)
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
	require.Len(t, models["image-new"]["channels"], 1)
	require.Equal(t, []any{"default", "vip"}, models["image-new"]["channels"].([]any)[0].(map[string]any)["groups"])

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
	_, err = model.PricingInstance.GetGouoModel("image-new")
	require.NoError(t, err)
	// 售价无效、只开遮罩不开参考图时拒绝
	require.Equal(t, http.StatusBadRequest, update(`{"model":"image-a","gouo_enabled":true,"gouo_price_cny":0}`).Code)
	require.Equal(t, http.StatusBadRequest, update(`{"model":"image-a","gouo_enabled":true,"gouo_price_cny":0.1,"gouo_mask":true}`).Code)
	// 关闭后客户端目录不再包含它
	require.Equal(t, http.StatusOK, update(`{"model":"image-a","gouo_enabled":false}`).Code)
	_, err = model.PricingInstance.GetGouoModel("image-a")
	require.Error(t, err)
}
