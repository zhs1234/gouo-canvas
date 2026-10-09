package relay

import (
	"bytes"
	"encoding/base64"
	"errors"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"one-api/common/config"
	"one-api/common/logger"
	"one-api/common/requester"
	"one-api/model"
	"one-api/providers/openai"
	"one-api/relay/relay_util"
	"one-api/types"
)

type failedImageWriter struct{ gin.ResponseWriter }

func (w failedImageWriter) Write([]byte) (int, error) { return 0, errors.New("client disconnected") }

func TestImageResultBillingAndRefund(t *testing.T) {
	oldDB, oldPricing, oldClient, oldLogger := model.DB, model.PricingInstance, requester.HTTPClient, logger.Logger
	oldRedis, oldBatch, oldLogging := config.RedisEnabled, config.BatchUpdateEnabled, config.LogConsumeEnabled
	t.Cleanup(func() {
		model.DB, model.PricingInstance, requester.HTTPClient, logger.Logger = oldDB, oldPricing, oldClient, oldLogger
		config.RedisEnabled, config.BatchUpdateEnabled, config.LogConsumeEnabled = oldRedis, oldBatch, oldLogging
	})
	logger.Logger = zap.NewNop()
	config.RedisEnabled, config.BatchUpdateEnabled, config.LogConsumeEnabled = false, false, true
	db, err := gorm.Open(sqlite.Open(t.TempDir()+"/images.db"), &gorm.Config{})
	require.NoError(t, err)
	conn, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { conn.Close() })
	// 与正式 InitDB 保持相同建表顺序。
	for _, table := range []any{&model.Channel{}, &model.Token{}, &model.User{}, &model.Log{}, &model.GouoImageCharge{}} {
		require.NoError(t, db.AutoMigrate(table))
	}
	model.DB = db
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "image-test", Quota: 100}).Error)
	require.NoError(t, db.Session(&gorm.Session{SkipHooks: true}).Create(&model.Token{Id: 1, UserId: 1, Key: "test-key", RemainQuota: 100, ExpiredTime: -1}).Error)
	model.PricingInstance = &model.Pricing{Prices: map[string]*model.Price{"image-a": {Model: "image-a"}}}
	var pngData bytes.Buffer
	require.NoError(t, png.Encode(&pngData, image.NewRGBA(image.Rect(0, 0, 1, 1))))
	truncated := pngData.Bytes()[:33] // 有效 PNG 文件头，但缺少像素数据。
	_, _, err = image.DecodeConfig(bytes.NewReader(truncated))
	require.NoError(t, err)
	for _, tc := range []struct {
		name, body                string
		failWrite, retry, unknown bool
	}{
		{name: "malformed-response", body: `{`, unknown: true},
		{name: "empty", body: `{"data":[]}`},
		{name: "missing-fields", body: `{"data":[{"revised_prompt":"no image"}]}`},
		{name: "invalid-url", body: `{"data":[{"url":"javascript:alert(1)"}]}`},
		{name: "invalid-base64", body: `{"data":[{"b64_json":"%%%"}]}`},
		{name: "base64-not-image", body: `{"data":[{"b64_json":"bm90IGFuIGltYWdl"}]}`},
		{name: "truncated-image", body: `{"data":[{"b64_json":"` + base64.StdEncoding.EncodeToString(truncated) + `"}]}`},
		{name: "non-image-data-url", body: `{"data":[{"url":"data:image/png;base64,bm90IGFuIGltYWdl"}]}`},
		{name: "blank-base64", body: `{"data":[{"b64_json":" ","url":"https://example.invalid/image.png"}]}`},
		{name: "empty-data-url", body: `{"data":[{"b64_json":"data:image/png;base64,","url":"https://example.invalid/image.png"}]}`},
		{name: "retry-success", body: `{"data":[]}`, retry: true},
		{name: "client-write-failure", body: `{"data":[{"url":"https://example.invalid/image.png"}]}`, failWrite: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			require.NoError(t, db.Model(&model.User{}).Where("id = 1").Update("quota", 100).Error)
			require.NoError(t, db.Model(&model.Token{}).Where("id = 1").Updates(map[string]any{"remain_quota": 100, "used_quota": 0}).Error)
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.Write([]byte(tc.body))
			}))
			defer upstream.Close()
			requester.HTTPClient = upstream.Client()
			res := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(res)
			c.Request = httptest.NewRequest("POST", "/v1/images/generations", strings.NewReader(`{"model":"image-a","prompt":"test","n":1}`))
			c.Request.Header.Set("Content-Type", "application/json")
			c.Set("id", 1)
			c.Set("token_id", 1)
			c.Set("channel_id", 1)
			c.Set("requestStartTime", time.Now())
			c.Set("gouo_image_model", &model.GouoImageModel{ID: "image-a", PriceCNY: 0.1, Quota: 10})
			if tc.failWrite {
				c.Writer = failedImageWriter{c.Writer}
			}
			proxy := ""
			p := openai.CreateOpenAIProvider(&model.Channel{Id: 1, Type: config.ChannelTypeOpenAI, Key: "test-key", Proxy: &proxy}, upstream.URL)
			p.SetContext(c)
			r := NewRelayImageGenerations(c)
			require.NoError(t, r.setRequest())
			r.provider, r.modelName = p, "image-a"
			apiErr, _ := RelayHandler(r)
			require.NotNil(t, apiErr)
			if tc.unknown {
				require.Equal(t, "image_result_unknown", apiErr.Code)
				require.False(t, shouldRetry(c, apiErr, config.ChannelTypeOpenAI))
			}
			qValue, exists := c.Get("gouo_image_quota")
			require.True(t, exists)
			q := qValue.(*relay_util.Quota)
			if tc.retry {
				require.False(t, c.Writer.Written())
				require.True(t, shouldRetry(c, apiErr, config.ChannelTypeOpenAI))
				success := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					w.Write([]byte(`{"data":[{"url":"https://example.invalid/image.png"}]}`))
				}))
				defer success.Close()
				p = openai.CreateOpenAIProvider(&model.Channel{Id: 2, Type: config.ChannelTypeOpenAI, Key: "test-key", Proxy: &proxy}, success.URL)
				p.SetContext(c)
				r.provider = p
				apiErr, _ = RelayHandler(r)
				require.Nil(t, apiErr)
				q.Consume(c, &types.Usage{}, false)
			}
			q.Undo(c)
			q.Undo(c)
			quota, err := model.GetUserQuota(1)
			require.NoError(t, err)
			token, err := model.GetTokenById(1)
			require.NoError(t, err)
			if tc.retry || tc.failWrite || tc.unknown {
				require.Equal(t, 90, quota)
				require.Equal(t, 90, token.RemainQuota)
				require.Equal(t, 10, token.UsedQuota)
			} else {
				require.Equal(t, 100, quota)
				require.Equal(t, 100, token.RemainQuota)
				require.Zero(t, token.UsedQuota)
			}
		})
	}
	var logs int64
	require.NoError(t, db.Model(&model.Log{}).Where("type = ?", model.LogTypeConsume).Count(&logs).Error)
	require.EqualValues(t, 2, logs)
}
