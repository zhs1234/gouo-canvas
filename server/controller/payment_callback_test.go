package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"github.com/stripe/stripe-go/v80"
	"github.com/stripe/stripe-go/v80/webhook"
	"go.uber.org/zap"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"one-api/common/config"
	"one-api/common/logger"
	"one-api/model"
)

func TestStripeCallbackGatewayEdgeCases(t *testing.T) {
	oldDB, oldRedis, oldLogger := model.DB, config.RedisEnabled, logger.Logger
	t.Cleanup(func() { model.DB, config.RedisEnabled, logger.Logger = oldDB, oldRedis, oldLogger })
	config.RedisEnabled, logger.Logger = false, zap.NewNop()
	db, err := gorm.Open(sqlite.Open(t.TempDir()+"/stripe.db"), &gorm.Config{})
	require.NoError(t, err)
	conn, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { conn.Close() })
	model.DB = db
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Order{}, &model.Payment{}, &model.Log{}, &model.UserGroup{}))
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "stripe-test"}).Error)
	r := gin.New()
	r.POST("/notify/:uuid", PaymentCallback)
	quota := func() int {
		value, err := model.GetUserQuota(1)
		require.NoError(t, err)
		return value
	}
	send := func(uuid, secret, reference string) *httptest.ResponseRecorder {
		body := fmt.Sprintf(`{"id":"evt_test","object":"event","api_version":%q,"type":"checkout.session.completed","data":{"object":{"id":"cs_test","client_reference_id":%q,"payment_status":"paid","payment_intent":"pi_%s","amount_total":100,"currency":"usd"}}}`, stripe.APIVersion, reference, uuid)
		signed := webhook.GenerateTestSignedPayload(&webhook.UnsignedPayload{Payload: []byte(body), Secret: secret})
		req := httptest.NewRequest("POST", "/notify/"+uuid, strings.NewReader(body))
		req.Header.Set("Stripe-Signature", signed.Header)
		res := httptest.NewRecorder()
		r.ServeHTTP(res, req)
		return res
	}

	// 签名密钥为空的网关：用空密钥伪造的回调不能入账
	require.NoError(t, db.Create(&model.Payment{ID: 1, UUID: "no-secret", Type: "stripe", Config: `{"webhook_secret":""}`}).Error)
	require.NoError(t, db.Create(&model.Order{UserId: 1, GatewayId: 1, TradeNo: "forged", Quota: 100, OrderAmount: 1, OrderCurrency: model.CurrencyTypeUSD, Status: model.OrderStatusPending}).Error)
	require.NotEqual(t, http.StatusOK, send("no-secret", "", "forged").Code)
	require.Zero(t, quota())

	// 同一 Stripe 账户下其他网关或其他业务的会话：确认收到，不入账、不报错
	require.NoError(t, db.Create(&model.Payment{ID: 2, UUID: "usd", Type: "stripe", Config: `{"webhook_secret":"whsec_usd"}`}).Error)
	require.NoError(t, db.Create(&model.Payment{ID: 3, UUID: "cny", Type: "stripe", Config: `{"webhook_secret":"whsec_cny"}`}).Error)
	require.NoError(t, db.Create(&model.Order{UserId: 1, GatewayId: 3, TradeNo: "cny-order", Quota: 100, OrderAmount: 1, OrderCurrency: model.CurrencyTypeUSD, Status: model.OrderStatusPending}).Error)
	for _, reference := range []string{"cny-order", "", "unknown-order"} {
		require.Equal(t, http.StatusOK, send("usd", "whsec_usd", reference).Code, reference)
	}
	require.Zero(t, quota())

	// 网关停用并删除后，已付款订单的回调仍按原配置验签入账
	require.NoError(t, db.Model(&model.Payment{}).Where("id = ?", 3).Update("enable", false).Error)
	require.NoError(t, db.Delete(&model.Payment{}, 3).Error)
	require.Equal(t, http.StatusOK, send("cny", "whsec_cny", "cny-order").Code)
	require.Equal(t, 100, quota())
}
