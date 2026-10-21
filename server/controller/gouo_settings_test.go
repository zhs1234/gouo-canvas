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

func TestGouoAdminSettings(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Option{}))
	oldDB, oldNotice, oldHelp, oldDefault, oldPricing := model.DB, config.GouoNotice, config.GouoRedemptionHelp, config.GouoDefaultImageModel, model.PricingInstance
	model.DB = db
	model.PricingInstance = &model.Pricing{Prices: map[string]*model.Price{}}
	t.Cleanup(func() {
		model.DB, config.GouoNotice, config.GouoRedemptionHelp, config.GouoDefaultImageModel, model.PricingInstance = oldDB, oldNotice, oldHelp, oldDefault, oldPricing
	})
	config.GouoNotice, config.GouoRedemptionHelp, config.GouoDefaultImageModel = "", "旧说明", ""
	// 测试不经过 InitOptionMap，手动登记这些设置项
	config.GlobalOption.RegisterString("GouoNotice", &config.GouoNotice)
	config.GlobalOption.RegisterString("GouoRedemptionHelp", &config.GouoRedemptionHelp)
	config.GlobalOption.RegisterString("GouoSupportContact", &config.GouoSupportContact)
	config.GlobalOption.RegisterString("GouoDefaultImageModel", &config.GouoDefaultImageModel)
	config.GlobalOption.RegisterBool("GouoAgentEnabled", &config.GouoAgentEnabled)
	config.GlobalOption.RegisterInt("GouoMaxImagesPerTask", &config.GouoMaxImagesPerTask)
	config.GlobalOption.RegisterString("GouoAgentSystemPrompt", &config.GouoAgentSystemPrompt)
	oldAgent, oldMax, oldPrompt := config.GouoAgentEnabled, config.GouoMaxImagesPerTask, config.GouoAgentSystemPrompt
	t.Cleanup(func() {
		config.GouoAgentEnabled, config.GouoMaxImagesPerTask, config.GouoAgentSystemPrompt = oldAgent, oldMax, oldPrompt
	})

	router := gin.New()
	router.GET("/settings", GetGouoAdminSettings)
	router.PUT("/settings", UpdateGouoAdminSettings)
	put := func(body string) (int, map[string]any) {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/settings", strings.NewReader(body)))
		var res map[string]any
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &res))
		return rec.Code, res
	}

	// 只改请求中的键，公告压成单行
	code, res := put(`{"GouoNotice":"  国庆活动\n 全场 8 折  ","GouoDefaultImageModel":" image-b "}`)
	require.Equal(t, http.StatusOK, code)
	data := res["data"].(map[string]any)
	require.Equal(t, "国庆活动 全场 8 折", data["GouoNotice"])
	require.Equal(t, "image-b", data["GouoDefaultImageModel"])
	require.Equal(t, "旧说明", data["GouoRedemptionHelp"])
	require.Equal(t, "国庆活动 全场 8 折", config.GouoNotice)
	var stored model.Option
	require.NoError(t, db.First(&stored, "key = ?", "GouoNotice").Error)
	require.Equal(t, "国庆活动 全场 8 折", stored.Value)

	// 开关、数量和多行提示词按类型保存
	code, res = put(`{"GouoAgentEnabled":"false","GouoMaxImagesPerTask":"4","GouoAgentSystemPrompt":"  回答简洁。\n只用中文。  "}`)
	require.Equal(t, http.StatusOK, code)
	require.False(t, config.GouoAgentEnabled)
	require.Equal(t, 4, config.GouoMaxImagesPerTask)
	require.Equal(t, "回答简洁。\n只用中文。", config.GouoAgentSystemPrompt)

	// 存储设置：保留天数生效，字节数按范围校验后写入数据库
	config.GlobalOption.RegisterInt("GouoTrashRetentionDays", &config.GouoTrashRetentionDays)
	oldRetention := config.GouoTrashRetentionDays
	t.Cleanup(func() { config.GouoTrashRetentionDays = oldRetention })
	code, _ = put(`{"GouoTrashRetentionDays":"7","GouoAssetMaxFileBytes":"52428800"}`)
	require.Equal(t, http.StatusOK, code)
	require.Equal(t, 7, config.GouoTrashRetentionDays)
	var maxFile model.Option
	require.NoError(t, db.First(&maxFile, "key = ?", "GouoAssetMaxFileBytes").Error)
	require.Equal(t, "52428800", maxFile.Value)

	// 任一项不合法时整批不保存；不接受白名单以外的系统设置
	for _, body := range []string{
		`{"GouoTrashRetentionDays":"0"}`,
		`{"GouoTrashRetentionDays":"31"}`,
		`{"GouoAssetMaxFileBytes":"104857601"}`,
		`{"GouoAssetUserQuotaBytes":"1024"}`,
		`{"GouoCloudLibraryEnabled":"on"}`,
		`{"GouoAgentEnabled":"yes"}`,
		`{"GouoMaxImagesPerTask":"0"}`,
		`{"GouoMaxImagesPerTask":"11"}`,
		`{"GouoAgentSystemPrompt":"` + strings.Repeat("长", 4001) + `"}`,
		`{"GouoNotice":"新公告","GouoSupportContact":"` + strings.Repeat("长", 2001) + `"}`,
		`{"GouoNotice":"` + strings.Repeat("长", 201) + `"}`,
		`{"RegisterEnabled":"false"}`,
		`{}`,
	} {
		code, res = put(body)
		require.Equal(t, http.StatusBadRequest, code, body)
		require.Equal(t, false, res["success"])
	}
	require.Equal(t, "国庆活动 全场 8 折", config.GouoNotice)

	// 写库失败时报错，内存里的设置一项都不改
	require.NoError(t, db.Migrator().DropTable(&model.Option{}))
	code, _ = put(`{"GouoNotice":"写不进去","GouoMaxImagesPerTask":"2"}`)
	require.Equal(t, http.StatusInternalServerError, code)
	require.Equal(t, "国庆活动 全场 8 折", config.GouoNotice)
}

func TestNormalizeGouoModelPolicySettings(t *testing.T) {
	for key, cases := range map[string]map[string]bool{
		"GouoAllowLowModeration": {"true": true, "false": true, "yes": false},
		"GouoAgentMaxRounds":     {"1": true, "20": true, "0": false, "21": false, "x": false},
		"GouoAgentConfirmImages": {"1": true, "10": true, "0": false, "11": false},
	} {
		for value, ok := range cases {
			_, err := normalizeGouoSetting(key, value)
			require.Equal(t, ok, err == nil, key+"="+value)
		}
	}
}
