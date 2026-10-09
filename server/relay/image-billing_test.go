package relay

import (
	"bytes"
	"encoding/base64"
	"errors"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
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
	oldDir := config.GouoAssetDir
	resultDir := t.TempDir()
	config.GouoAssetDir = resultDir
	t.Cleanup(func() {
		model.DB, model.PricingInstance, requester.HTTPClient, logger.Logger = oldDB, oldPricing, oldClient, oldLogger
		config.RedisEnabled, config.BatchUpdateEnabled, config.LogConsumeEnabled = oldRedis, oldBatch, oldLogging
		config.GouoAssetDir = oldDir
	})
	logCore, observedLogs := observer.New(zap.ErrorLevel)
	logger.Logger = zap.New(logCore)
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
	encodedImage := base64.StdEncoding.EncodeToString(pngData.Bytes())
	for _, tc := range []struct {
		name, body, diagnostic, contentType             string
		status                                          int
		failWrite, retry, unknown, success, storageFail bool
	}{
		{name: "malformed-response", body: `{`, unknown: true, diagnostic: "stage=response_decode; code=decode_response_failed; status=500"},
		{name: "upstream-timeout", status: http.StatusGatewayTimeout, body: `{"error":{"code":"sk-secret-upstream-code","message":"Authorization: Bearer sk-secret-value https://upstream.invalid/?key=secret-value prompt=private base64=private"}}`, unknown: true, diagnostic: "stage=upstream_response; code=unrecognized; status=504; reason=upstream_timeout"},
		{name: "heyroute-completed", contentType: "text/event-stream", success: true, body: "event: started\ndata: {}\n\nevent: heartbeat\ndata: {}\n\nevent: completed\ndata: {\"data\":[{\"b64_json\":\"" + encodedImage + "\"}]}\n\nevent: done\ndata: {}\n\n"},
		{name: "heyroute-heartbeat-eof", contentType: "text/event-stream", unknown: true, body: "event: started\ndata: {}\n\nevent: heartbeat\ndata: {}\n\n", diagnostic: "stage=response_decode; code=decode_response_failed; status=500; reason=image_response_incomplete"},
		{name: "heyroute-partial-then-done", contentType: "text/event-stream", unknown: true, body: "event: image_generation.partial_image\ndata: {\"b64_json\":\"" + encodedImage + "\"}\n\nevent: done\ndata: {}\n\n", diagnostic: "stage=response_decode; code=decode_response_failed; status=500; reason=image_response_incomplete"},
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
		{name: "result-save-failure", body: `{"data":[{"url":"https://example.invalid/image.png"}]}`, storageFail: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			config.GouoAssetDir = resultDir
			if tc.storageFail {
				config.GouoAssetDir = filepath.Join(t.TempDir(), "occupied")
				require.NoError(t, os.WriteFile(config.GouoAssetDir, []byte("occupied"), 0o600))
			}
			observedLogs.TakeAll()
			var consumeLogsBefore int64
			require.NoError(t, db.Model(&model.Log{}).Where("type = ?", model.LogTypeConsume).Count(&consumeLogsBefore).Error)
			require.NoError(t, db.Model(&model.User{}).Where("id = 1").Update("quota", 100).Error)
			require.NoError(t, db.Model(&model.Token{}).Where("id = 1").Updates(map[string]any{"remain_quota": 100, "used_quota": 0}).Error)
			var requests atomic.Int32
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				w.Header().Set("Content-Type", "application/json")
				if tc.contentType != "" {
					w.Header().Set("Content-Type", tc.contentType)
				}
				if tc.status != 0 {
					w.WriteHeader(tc.status)
				}
				w.Write([]byte(tc.body))
			}))
			defer upstream.Close()
			requester.HTTPClient = upstream.Client()
			res := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(res)
			c.Request = httptest.NewRequest("POST", "/v1/images/generations", strings.NewReader(`{"model":"image-a","prompt":"test","n":1}`))
			c.Request.Header.Set("Content-Type", "application/json")
			c.Request.Header.Set("X-Gouo-Request-Id", tc.name)
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
			if tc.success {
				require.Nil(t, apiErr)
				require.Contains(t, res.Body.String(), encodedImage)
			} else {
				require.NotNil(t, apiErr)
			}
			if tc.unknown || tc.storageFail {
				require.Equal(t, "image_result_unknown", apiErr.Code)
				require.False(t, shouldRetry(c, apiErr, config.ChannelTypeOpenAI))
			}
			qValue, exists := c.Get("gouo_image_quota")
			require.True(t, exists)
			q := qValue.(*relay_util.Quota)
			if tc.success {
				// Relay 已完成结算，再次触发收尾也不能重复扣款或新增消费记录。
				q.Consume(c, &types.Usage{}, false)
				q.Consume(c, &types.Usage{}, false)
			}
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
			if tc.success {
				var charge model.GouoImageCharge
				require.NoError(t, db.Where("id = ?", res.Header().Get("X-Gouo-Charge-Id")).First(&charge).Error)
				require.Equal(t, model.GouoChargeSettled, charge.Status)
				require.Equal(t, 1, charge.Attempts)
				require.Positive(t, charge.LogID)
				var consumeLogsAfter int64
				require.NoError(t, db.Model(&model.Log{}).Where("type = ?", model.LogTypeConsume).Count(&consumeLogsAfter).Error)
				require.Equal(t, consumeLogsBefore+1, consumeLogsAfter)
				require.EqualValues(t, 1, requests.Load())
			}
			if tc.unknown || tc.storageFail {
				var charge model.GouoImageCharge
				require.NoError(t, db.Where("id = ?", res.Header().Get("X-Gouo-Charge-Id")).First(&charge).Error)
				require.Equal(t, model.GouoChargeReview, charge.Status)
				require.Equal(t, 1, charge.Attempts)
				require.Zero(t, charge.LogID)
				require.EqualValues(t, 1, requests.Load())
				require.Contains(t, charge.Note, tc.diagnostic)
				if tc.storageFail {
					require.Contains(t, charge.Note, "恢复结果保存失败")
				}
				logs := observedLogs.FilterMessageSnippet("image result uncertain:").All()
				require.Len(t, logs, 1)
				require.Contains(t, logs[0].Message, tc.diagnostic)
				for _, secret := range []string{"sk-secret", "Authorization", "upstream.invalid", "prompt=", "base64="} {
					require.NotContains(t, charge.Note, secret)
					require.NotContains(t, logs[0].Message, secret)
				}
			}
			quota, err := model.GetUserQuota(1)
			require.NoError(t, err)
			token, err := model.GetTokenById(1)
			require.NoError(t, err)
			if tc.retry || tc.failWrite || tc.unknown || tc.success || tc.storageFail {
				require.Equal(t, 90, quota)
				require.Equal(t, 90, token.RemainQuota)
				require.Equal(t, 10, token.UsedQuota)
			} else {
				require.Equal(t, 100, quota)
				require.Equal(t, 100, token.RemainQuota)
				require.Zero(t, token.UsedQuota)
			}
			if tc.success || tc.failWrite {
				result, err := model.GetGouoImageResult(1, tc.name)
				require.NoError(t, err)
				require.True(t, result.Recoverable)
				require.Equal(t, model.GouoChargeSettled, result.Status)
				require.Len(t, result.Result.Data, 1)
				if tc.success {
					require.Equal(t, encodedImage, result.Result.Data[0].B64JSON)
				}
				if tc.failWrite {
					require.Equal(t, "https://example.invalid/image.png", result.Result.Data[0].URL)
					duplicate, _ := gin.CreateTestContext(httptest.NewRecorder())
					duplicate.Request = httptest.NewRequest("POST", "/v1/images/generations", strings.NewReader(`{"model":"image-a","prompt":"test"}`))
					duplicate.Request.Header.Set("X-Gouo-Request-Id", tc.name)
					duplicate.Request.Header.Set("Content-Type", "application/json")
					duplicate.Set("id", 1)
					duplicate.Set("token_id", 1)
					duplicate.Set("gouo_image_model", &model.GouoImageModel{ID: "image-a", Quota: 10})
					r2 := NewRelayImageGenerations(duplicate)
					require.NoError(t, r2.setRequest())
					r2.provider, r2.modelName = p, "image-a"
					repeated, done := RelayHandler(r2)
					require.True(t, done)
					require.Equal(t, "image_request_exists", repeated.Code)
					require.EqualValues(t, 1, requests.Load())
					balance, err := model.GetUserQuota(1)
					require.NoError(t, err)
					require.Equal(t, 90, balance)
				}
			}
		})
	}
	var logs int64
	require.NoError(t, db.Model(&model.Log{}).Where("type = ?", model.LogTypeConsume).Count(&logs).Error)
	require.EqualValues(t, 3, logs)
}
