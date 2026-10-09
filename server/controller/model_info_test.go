package controller

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"one-api/model"
)

func modelInfoTestRouter(t *testing.T) (*gin.Engine, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Price{}, &model.ModelInfo{}))
	sqlDB, err := db.DB()
	require.NoError(t, err)
	oldDB, oldPricing, oldMode := model.DB, model.PricingInstance, gin.Mode()
	model.DB = db
	model.PricingInstance = &model.Pricing{Prices: map[string]*model.Price{}}
	gin.SetMode(gin.TestMode)
	t.Cleanup(func() {
		model.DB, model.PricingInstance = oldDB, oldPricing
		gin.SetMode(oldMode)
		require.NoError(t, sqlDB.Close())
	})
	router := gin.New()
	router.POST("/model_info", CreateModelInfo)
	router.PUT("/model_info", UpdateModelInfo)
	router.DELETE("/model_info/:id", DeleteModelInfo)
	return router, db
}

func modelInfoTestRequest(t *testing.T, router *gin.Engine, method, path string, value any) map[string]any {
	t.Helper()
	data, err := json.Marshal(value)
	require.NoError(t, err)
	req := httptest.NewRequest(method, path, bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)
	require.Equal(t, http.StatusOK, res.Code)
	var response map[string]any
	require.NoError(t, json.Unmarshal(res.Body.Bytes(), &response))
	return response
}

func TestModelInfoChangesImmediatelyRefreshAgentCapabilities(t *testing.T) {
	router, db := modelInfoTestRouter(t)
	for _, id := range []string{"agent-one", "agent-two"} {
		require.NoError(t, db.Create(&model.Price{Model: id, Type: model.TokensPriceType, Input: 1, Output: 2}).Error)
	}
	require.NoError(t, model.PricingInstance.Init())
	require.Nil(t, gouoAgentCapabilities(model.PricingInstance.GetPrice("agent-one")))
	info := model.ModelInfo{Model: "agent-one", Name: "First agent", InputModalities: `["text"]`, OutputModalities: `["text"]`, Tags: `["tools"]`}
	require.Equal(t, true, modelInfoTestRequest(t, router, "POST", "/model_info", info)["success"])
	require.NoError(t, db.Where("model = ?", info.Model).First(&info).Error)
	entry := gouoAgentCapabilities(model.PricingInstance.GetPrice("agent-one"))
	require.NotNil(t, entry)
	require.Equal(t, "First agent", entry.Name)
	require.False(t, entry.Vision)

	info.Tags = `[]`
	require.Equal(t, true, modelInfoTestRequest(t, router, "PUT", "/model_info", info)["success"])
	require.Nil(t, gouoAgentCapabilities(model.PricingInstance.GetPrice("agent-one")))
	info.Tags, info.InputModalities, info.Name = `["tools"]`, `["text","image"]`, "Vision agent"
	require.Equal(t, true, modelInfoTestRequest(t, router, "PUT", "/model_info", info)["success"])
	entry = gouoAgentCapabilities(model.PricingInstance.GetPrice("agent-one"))
	require.NotNil(t, entry)
	require.True(t, entry.Vision)
	require.Equal(t, "Vision agent", entry.Name)

	// 模型重命名必须移除旧型号的能力，不能让旧缓存继续出现在目录。
	info.Model = "agent-two"
	require.Equal(t, true, modelInfoTestRequest(t, router, "PUT", "/model_info", info)["success"])
	require.Nil(t, gouoAgentCapabilities(model.PricingInstance.GetPrice("agent-one")))
	require.NotNil(t, gouoAgentCapabilities(model.PricingInstance.GetPrice("agent-two")))
	require.Equal(t, true, modelInfoTestRequest(t, router, "DELETE", "/model_info/"+strconv.Itoa(info.Id), nil)["success"])
	require.Nil(t, gouoAgentCapabilities(model.PricingInstance.GetPrice("agent-two")))
	var prices []model.Price
	require.NoError(t, db.Find(&prices).Error)
	require.Len(t, prices, 2)
	for _, price := range prices {
		require.Equal(t, float64(1), price.Input)
		require.Equal(t, float64(2), price.Output)
	}
}

func TestModelInfoReportsSavedDataWhenCatalogRefreshFails(t *testing.T) {
	router, db := modelInfoTestRouter(t)
	require.NoError(t, db.Migrator().DropTable(&model.Price{}))
	response := modelInfoTestRequest(t, router, "POST", "/model_info", model.ModelInfo{Model: "saved-agent", Tags: `["tools"]`})
	require.Equal(t, false, response["success"])
	require.Contains(t, response["message"], "模型信息已变更，但模型目录刷新失败")
	var count int64
	require.NoError(t, db.Model(&model.ModelInfo{}).Where("model = ?", "saved-agent").Count(&count).Error)
	require.Equal(t, int64(1), count)
}
