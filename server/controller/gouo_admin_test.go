package controller

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/gouo_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type gouoAdminResponse struct {
	Success    bool   `json:"success"`
	MessageKey string `json:"message_key"`
	Data       struct {
		Items []map[string]any `json:"items"`
		Total int              `json:"total"`
	} `json:"data"`
}

// callGouoAdmin 以指定管理员身份直接调用后台接口（鉴权中间件由 New API 自己的测试覆盖）
func callGouoAdmin(t *testing.T, handler gin.HandlerFunc, role int, method, target, body string, params gin.Params) gouoAdminResponse {
	t.Helper()
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(method, target, bytes.NewBufferString(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Params = params
	c.Set("id", 1)
	c.Set("role", role)
	handler(c)
	require.Equal(t, http.StatusOK, recorder.Code)
	var result gouoAdminResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &result))
	return result
}

func TestGouoAdminAPIs(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			driver := sqlite.Open(":memory:")
			switch dialect {
			case "mysql":
				if os.Getenv("TEST_MYSQL_DSN") == "" {
					t.Skip("TEST_MYSQL_DSN is not configured")
				}
				driver = mysql.Open(os.Getenv("TEST_MYSQL_DSN"))
			case "postgres":
				if os.Getenv("TEST_POSTGRES_DSN") == "" {
					t.Skip("TEST_POSTGRES_DSN is not configured")
				}
				driver = postgres.Open(os.Getenv("TEST_POSTGRES_DSN"))
			}
			db, err := gorm.Open(driver, &gorm.Config{Logger: logger.Discard})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			tables := []any{&model.User{}, &model.Option{}, &model.GouoImageCharge{}, &model.GouoAsset{}, &model.GouoTask{}, &model.GouoDocument{}, &model.GouoStorageQuota{}}
			require.NoError(t, db.Migrator().DropTable(tables...))
			require.NoError(t, db.AutoMigrate(tables...))
			previousDB, previousRedis, previousSetting, previousOptions := model.DB, common.RedisEnabled, *gouo_setting.Get(), common.OptionMap
			model.DB, common.RedisEnabled, common.OptionMap = db, false, map[string]string{}
			t.Cleanup(func() {
				model.DB, common.RedisEnabled, *gouo_setting.Get(), common.OptionMap = previousDB, previousRedis, previousSetting, previousOptions
				require.NoError(t, db.Migrator().DropTable(tables...))
				require.NoError(t, sqlDB.Close())
			})

			users := []model.User{
				{Username: "gouo-admin", Role: common.RoleAdminUser, AffCode: "a1"},
				{Username: "gouo-user", Role: common.RoleCommonUser, AffCode: "a2"},
				{Username: "gouo-peer", Role: common.RoleAdminUser, AffCode: "a3"},
			}
			for i := range users {
				users[i].Password, users[i].Status = "password123", common.UserStatusEnabled
				require.NoError(t, db.Create(&users[i]).Error)
			}
			common := users[1]
			for _, charge := range []model.GouoImageCharge{
				{ID: model.GouoImageRequestID(common.Id, "req-1"), UserID: common.Id, Quota: 100, Status: model.GouoChargeSettled, CreatedAt: 3},
				{ID: model.GouoImageRequestID(common.Id, "req-2"), UserID: common.Id, Quota: 100, Status: model.GouoChargeRefunded, CreatedAt: 2},
				{ID: model.GouoImageRequestID(users[2].Id, "req-3"), UserID: users[2].Id, Quota: 100, Status: model.GouoChargeSettled, CreatedAt: 1},
			} {
				require.NoError(t, db.Create(&charge).Error)
			}

			// 普通管理员只看得到权限比自己低的账号；root 看得到全部
			result := callGouoAdmin(t, ListGouoAdminImageCharges, 10, http.MethodGet, "/?p=1&page_size=10", "", nil)
			require.True(t, result.Success)
			assert.Equal(t, 2, result.Data.Total)
			assert.Equal(t, "gouo-user", result.Data.Items[0]["username"])
			assert.Equal(t, 3, callGouoAdmin(t, ListGouoAdminImageCharges, 100, http.MethodGet, "/", "", nil).Data.Total)
			// 分页、状态筛选、按客户端请求号筛选
			page := callGouoAdmin(t, ListGouoAdminImageCharges, 100, http.MethodGet, "/?p=2&page_size=1", "", nil)
			assert.Equal(t, 3, page.Data.Total)
			require.Len(t, page.Data.Items, 1)
			assert.Equal(t, model.GouoChargeRefunded, page.Data.Items[0]["status"])
			assert.Equal(t, 2, callGouoAdmin(t, ListGouoAdminImageCharges, 100, http.MethodGet, "/?status=settled", "", nil).Data.Total)
			byRequest := callGouoAdmin(t, ListGouoAdminImageCharges, 100, http.MethodGet, "/?request_id=req-2&user_id="+itoa(common.Id), "", nil)
			require.Equal(t, 1, byRequest.Data.Total)
			assert.Equal(t, model.GouoImageRequestID(common.Id, "req-2"), byRequest.Data.Items[0]["id"])

			// 设置：校验失败返回 message_key，部分更新只改出现的字段
			invalid := callGouoAdmin(t, UpdateGouoAdminSettings, 10, http.MethodPut, "/", `{"max_images_per_task":30}`, nil)
			assert.False(t, invalid.Success)
			assert.Equal(t, "Images per task must be an integer from {{min}} to {{max}}", invalid.MessageKey)
			contact := gouo_setting.Get().SupportContact
			require.True(t, callGouoAdmin(t, UpdateGouoAdminSettings, 10, http.MethodPut, "/", `{"max_images_per_task":3}`, nil).Success)
			assert.Equal(t, 3, gouo_setting.Get().MaxImagesPerTask)
			assert.Equal(t, contact, gouo_setting.Get().SupportContact)
			var saved model.Option
			require.NoError(t, db.Where(&model.Option{Key: "gouo_setting.max_images_per_task"}).First(&saved).Error)
			assert.Equal(t, "3", saved.Value)

			// 配额：不能管理同级账号，也不能低于已用空间
			peer := gin.Params{{Key: "id", Value: itoa(users[2].Id)}}
			denied := callGouoAdmin(t, UpdateGouoAdminStorageQuota, 10, http.MethodPut, "/", `{"quota_bytes":1048576}`, peer)
			assert.Equal(t, "No permission to manage users of the same or higher role", denied.MessageKey)
			require.NoError(t, db.Create(&model.GouoAsset{ID: "asset-1", UserID: common.Id, SHA256: "sha", StoragePath: "a.png", MimeType: "image/png", FileSize: 2048}).Error)
			target := gin.Params{{Key: "id", Value: itoa(common.Id)}}
			below := callGouoAdmin(t, UpdateGouoAdminStorageQuota, 10, http.MethodPut, "/", `{"quota_bytes":1024}`, target)
			assert.Equal(t, "Storage quota cannot be lower than the space the user already uses", below.MessageKey)
			require.True(t, callGouoAdmin(t, UpdateGouoAdminStorageQuota, 10, http.MethodPut, "/", `{"quota_bytes":4096}`, target).Success)
			storage := callGouoAdmin(t, ListGouoAdminStorageUsers, 10, http.MethodGet, "/?p=1&page_size=10", "", nil)
			require.Equal(t, 1, storage.Data.Total)
			assert.EqualValues(t, 4096, storage.Data.Items[0]["quota_bytes"])
			assert.EqualValues(t, 2048, storage.Data.Items[0]["used_bytes"])
		})
	}
}

func itoa(value int) string {
	data, _ := common.Marshal(value)
	return string(data)
}

func TestGouoAgentExpressionPricing(t *testing.T) {
	setting := config.GlobalConfig.Get("billing_setting").(*billing_setting.BillingSetting)
	previous := *setting
	prices, err := common.Marshal(ratio_setting.GetModelPriceCopy())
	require.NoError(t, err)
	t.Cleanup(func() {
		*setting = previous
		require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(string(prices)))
	})
	// 切换到表达式后，旧按次价格仍会保存，不能让它挡住生效的表达式。
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"gouo-expr-test":0.01}`))
	setting.BillingMode = map[string]string{"gouo-expr-test": billing_setting.BillingModeTieredExpr}
	for _, test := range []struct {
		name, expression, reason string
	}{
		{"token and cache", `tier("base", p * 2 + c * 8 + cr * 0.2)`, ""},
		{"context tiers", `len <= 200000 ? tier("short", p * 2 + c * 8) : tier("long", p * 4 + c * 12)`, ""},
		{"request multiplier", `tier("base", p * 2 + c * 8) * (param("service_tier") == "fast" ? 2 : 1)`, ""},
		{"fixed request", `tier("request", fixed(0.01))`, ""},
		{"explicit free", `tier("request", fixed(0))`, ""},
		{"missing", "", "No price is set in model pricing yet"},
		{"invalid", `tier(`, "Expression error"},
		{"negative", `tier("base", p * -2)`, "Expression error"},
		{"task usage", `tier("task", u("seconds") * 0.4)`, "Expression error"},
	} {
		t.Run(test.name, func(t *testing.T) {
			setting.BillingExpr = map[string]string{"gouo-expr-test": test.expression}
			input, output, reason := gouoAgentPrice("gouo-expr-test")
			assert.Equal(t, test.reason, reason)
			assert.Zero(t, input)
			assert.Zero(t, output)
		})
	}
	setting.BillingMode = map[string]string{}
	_, _, reason := gouoAgentPrice("gouo-expr-test")
	assert.Empty(t, reason)
	assert.Equal(t, "per_request", model.GouoBillingMode("gouo-expr-test"))
}

// 客户端目录来自 New API 原生模型：图片模型由原生端点识别，Agent 模型是带 tools 标签的已定价文本模型，模型管理里停用的不出现
func TestGouoCatalogFromNativeModels(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Ability{}, &model.Model{}, &model.Vendor{}))
	previousDB := model.DB
	model.DB = db
	prices, err := common.Marshal(ratio_setting.GetModelRatioCopy())
	require.NoError(t, err)
	t.Cleanup(func() {
		model.DB = previousDB
		model.InvalidatePricingCache()
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(string(prices)))
		require.NoError(t, sqlDB.Close())
	})
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"gpt-chat":1,"plain-chat":1,"hidden-chat":1}`))
	require.NoError(t, db.Create(&model.Channel{Id: 1, Type: constant.ChannelTypeOpenAI, Status: common.ChannelStatusEnabled, Name: "c"}).Error)
	for _, name := range []string{"gpt-image-2", "gpt-chat", "plain-chat", "hidden-chat", "unpriced-chat"} {
		require.NoError(t, db.Create(&model.Ability{Group: "default", Model: name, ChannelId: 1, Enabled: true}).Error)
	}
	for _, meta := range []model.Model{
		{ModelName: "gpt-image-2", Tags: "edit,mask", Status: 1},
		{ModelName: "gpt-chat", Tags: "tools,vision", Description: "对话", Status: 1},
		{ModelName: "hidden-chat", Tags: "tools", Status: 2},
		{ModelName: "unpriced-chat", Tags: "tools", Status: 1},
	} {
		require.NoError(t, db.Create(&meta).Error)
	}
	model.InvalidatePricingCache()

	images, agents := gouoCatalog(nil)
	require.Len(t, images, 1)
	assert.Equal(t, "gpt-image-2", images[0].ID)
	assert.True(t, images[0].Mask)
	require.Len(t, agents, 1)
	assert.Equal(t, "gpt-chat", agents[0].ID)
	assert.True(t, agents[0].Vision)
	assert.Equal(t, "对话", agents[0].Description)

	// 只保留当前用户分组可用的模型
	images, agents = gouoCatalog([]string{"gpt-chat"})
	assert.Empty(t, images)
	assert.Len(t, agents, 1)
}
