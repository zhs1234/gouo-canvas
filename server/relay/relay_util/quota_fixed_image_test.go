package relay_util

import (
	"errors"
	"net/http/httptest"
	"one-api/common/config"
	"one-api/common/logger"
	"one-api/model"
	"one-api/types"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestGouoImageQuotaRetriesRefundAndSnapshot(t *testing.T) {
	oldLogger := logger.Logger
	logger.Logger = zap.NewNop()
	t.Cleanup(func() { logger.Logger = oldLogger })
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Token{}, &model.Price{}, &model.Log{}, &model.Channel{}, &model.GouoImageCharge{}))
	oldDB, oldPricing := model.DB, model.PricingInstance
	oldBatch, oldRedis, oldLogging := config.BatchUpdateEnabled, config.RedisEnabled, config.LogConsumeEnabled
	model.DB = db
	config.BatchUpdateEnabled, config.RedisEnabled, config.LogConsumeEnabled = false, false, true
	model.PricingInstance = &model.Pricing{Prices: map[string]*model.Price{}}
	t.Cleanup(func() {
		model.DB, model.PricingInstance = oldDB, oldPricing
		config.BatchUpdateEnabled, config.RedisEnabled, config.LogConsumeEnabled = oldBatch, oldRedis, oldLogging
	})
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "test", Quota: 1000}).Error)
	require.NoError(t, db.Session(&gorm.Session{SkipHooks: true}).Create(&model.Token{Id: 1, UserId: 1, Name: "sys_playground", RemainQuota: 1000, ExpiredTime: -1}).Error)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/images/generations", nil)
	c.Set("id", 1)
	c.Set("token_id", 1)
	c.Set("channel_id", 2)
	c.Set("token_name", "sys_playground")
	c.Set("requestStartTime", time.Now())
	c.Set("gouo_image_model", &model.GouoImageModel{ID: "public-model", PriceCNY: 0.2, Quota: 10, PriceVersion: "snapshot"})
	q := NewQuota(c, "mapped-upstream", 0)
	require.Nil(t, q.PreQuotaConsumption())
	require.Nil(t, q.PreQuotaConsumption())
	balance, err := model.GetUserQuota(1)
	require.NoError(t, err)
	require.Equal(t, 990, balance)
	q.Undo(c)
	q.Undo(c)
	balance, err = model.GetUserQuota(1)
	require.NoError(t, err)
	require.Equal(t, 1000, balance)
	q = NewQuota(c, "mapped-upstream", 0)
	require.Nil(t, q.PreQuotaConsumption())
	c.Set("channel_id", 3)
	require.Nil(t, q.DispatchImage(c))
	q.Consume(c, &types.Usage{}, false)
	q.Consume(c, &types.Usage{}, false)
	q.Undo(c)
	balance, err = model.GetUserQuota(1)
	require.NoError(t, err)
	require.Equal(t, 990, balance)
	var logs []model.Log
	require.NoError(t, db.Where("type = ?", model.LogTypeConsume).Find(&logs).Error)
	require.Len(t, logs, 1)
	require.Equal(t, "public-model", logs[0].ModelName)
	require.Equal(t, 3, logs[0].ChannelId)
	require.Equal(t, 10, logs[0].Quota)
	require.Equal(t, 0.2, logs[0].Metadata.Data()["price_cny"])
	require.Equal(t, "successful_request", logs[0].Metadata.Data()["billing_unit"])

	// 已拿到结果但结算写入失败时保留待核对记录，不能因返回错误而退款。
	q = NewQuota(c, "mapped-upstream", 0)
	require.Nil(t, q.PreQuotaConsumption())
	require.Nil(t, q.DispatchImage(c))
	require.NoError(t, db.Callback().Create().Before("gorm:create").Register("fail_image_log", func(tx *gorm.DB) {
		if tx.Statement.Table == "logs" {
			tx.AddError(errors.New("log unavailable"))
		}
	}))
	t.Cleanup(func() { db.Callback().Create().Remove("fail_image_log") })
	require.Error(t, q.CompleteImage(c, &types.Usage{}))
	q.Undo(c)
	var charge model.GouoImageCharge
	require.NoError(t, db.First(&charge, "id = ?", q.imageCharge.ID).Error)
	require.Equal(t, model.GouoChargeReview, charge.Status)
	balance, err = model.GetUserQuota(1)
	require.NoError(t, err)
	require.Equal(t, 980, balance)
	require.NoError(t, db.Where("type = ?", model.LogTypeConsume).Find(&logs).Error)
	require.Len(t, logs, 1)

	c.Request.Header.Set("X-Gouo-Request-Id", "agent-tool-call-1")
	q = NewQuota(c, "mapped-upstream", 0)
	require.Equal(t, model.GouoImageRequestID(1, "agent-tool-call-1"), q.imageCharge.ID)
	require.Nil(t, q.PreQuotaConsumption())
	require.Nil(t, q.DispatchImage(c))
	q.MarkImageUnknown(c, "连接中断")
	duplicate := NewQuota(c, "mapped-upstream", 0)
	duplicateErr := duplicate.PreQuotaConsumption()
	require.NotNil(t, duplicateErr)
	require.Equal(t, 409, duplicateErr.StatusCode)
	require.Equal(t, "image_request_exists", duplicateErr.Code)
	duplicate.Undo(c)
	balance, err = model.GetUserQuota(1)
	require.NoError(t, err)
	require.Equal(t, 970, balance)
}
