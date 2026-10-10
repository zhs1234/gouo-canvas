package controller

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
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
	"one-api/payment/gateway/epay"
)

func TestPaymentCallbackAtomicCreditAndReplay(t *testing.T) {
	oldDB, oldRedis, oldBatch, oldLogger := model.DB, config.RedisEnabled, config.BatchUpdateEnabled, logger.Logger
	t.Cleanup(func() {
		model.DB, config.RedisEnabled, config.BatchUpdateEnabled, logger.Logger = oldDB, oldRedis, oldBatch, oldLogger
	})
	config.RedisEnabled, config.BatchUpdateEnabled, logger.Logger = false, true, zap.NewNop()
	db, err := gorm.Open(sqlite.Open(t.TempDir()+"/payment.db"), &gorm.Config{})
	require.NoError(t, err)
	conn, err := db.DB()
	require.NoError(t, err)
	conn.SetMaxOpenConns(1)
	t.Cleanup(func() { conn.Close() })
	model.DB = db
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Order{}, &model.Payment{}, &model.Log{}, &model.UserGroup{}))
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "payment-test"}).Error)
	for _, id := range []int{1, 2} {
		require.NoError(t, db.Create(&model.Payment{ID: id, UUID: fmt.Sprintf("epay-%d", id), Type: "epay", Currency: model.CurrencyTypeCNY, Config: `{"key":"test-only-epay-key","partner_id":"test"}`}).Error)
	}
	require.NoError(t, db.Create(&model.Order{UserId: 1, GatewayId: 1, TradeNo: "order-1", Quota: 100, OrderAmount: 1, OrderCurrency: model.CurrencyTypeCNY, Status: model.OrderStatusPending}).Error)
	r := gin.New()
	r.GET("/notify/:uuid", PaymentCallback)
	r.POST("/notify/:uuid", PaymentCallback)
	callback := func(gateway, amount, signature string) *httptest.ResponseRecorder {
		values := map[string]string{"pid": "test", "trade_no": "gateway-trade-1", "out_trade_no": "order-1", "trade_status": "TRADE_SUCCESS", "money": amount}
		client := epay.Client{Key: "test-only-epay-key"}
		values["sign"] = client.Sign(values)
		if signature != "" {
			values["sign"] = signature
		}
		q := url.Values{}
		for k, v := range values {
			q.Set(k, v)
		}
		res := httptest.NewRecorder()
		r.ServeHTTP(res, httptest.NewRequest("GET", "/notify/"+gateway+"?"+q.Encode(), nil))
		return res
	}
	for _, attempt := range []struct{ gateway, amount, signature string }{
		{"epay-1", "1.00", "invalid"}, {"epay-2", "1.00", ""}, {"epay-1", "0.01", ""}, {"epay-1", "NaN", ""},
	} {
		res := callback(attempt.gateway, attempt.amount, attempt.signature)
		// 发到其他网关的回调找不到本网关的订单，只确认收到、不入账
		if attempt.gateway == "epay-1" {
			require.NotEqual(t, "success", res.Body.String())
		}
		order, err := model.GetOrderByTradeNo("order-1")
		require.NoError(t, err)
		require.Equal(t, model.OrderStatusPending, order.Status)
	}
	_, _, err = model.CompletePaidOrder("order-1", "gateway-trade-1", 1, "1.00", model.CurrencyTypeUSD)
	require.Error(t, err)

	require.NoError(t, db.Callback().Update().Before("gorm:update").Register("fail-payment-credit", func(tx *gorm.DB) {
		if tx.Statement.Table == "users" {
			tx.AddError(errors.New("simulated credit write failure"))
		}
	}))
	failed := callback("epay-1", "1.00", "")
	require.Equal(t, http.StatusInternalServerError, failed.Code)
	require.NotEqual(t, "success", failed.Body.String())
	order, err := model.GetOrderByTradeNo("order-1")
	require.NoError(t, err)
	require.Equal(t, model.OrderStatusPending, order.Status)
	quota, err := model.GetUserQuota(1)
	require.NoError(t, err)
	require.Zero(t, quota)
	require.NoError(t, db.Callback().Update().Remove("fail-payment-credit"))

	// 不依赖进程内锁，20 个并发通知也只能到账一次，且批量模式不能延迟入账。
	var wg sync.WaitGroup
	responses := make(chan *httptest.ResponseRecorder, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); responses <- callback("epay-1", "1.00", "") }()
	}
	wg.Wait()
	close(responses)
	for res := range responses {
		require.Equal(t, "success", res.Body.String())
	}
	quota, err = model.GetUserQuota(1)
	require.NoError(t, err)
	require.Equal(t, 100, quota)
	order, err = model.GetOrderByTradeNo("order-1")
	require.NoError(t, err)
	require.Equal(t, model.OrderStatusSuccess, order.Status)
	var logs int64
	require.NoError(t, db.Model(&model.Log{}).Count(&logs).Error)
	require.EqualValues(t, 1, logs)
	_, _, err = model.CompletePaidOrder("order-1", "different-transaction", 1, "1", model.CurrencyTypeCNY)
	require.Error(t, err)

	// 迟到的真实付款不能因为本地定时关闭订单而丢失。
	require.NoError(t, db.Create(&model.Order{UserId: 1, GatewayId: 1, TradeNo: "late", Quota: 100, OrderAmount: 1, OrderCurrency: model.CurrencyTypeCNY, Status: model.OrderStatusClosed}).Error)
	_, credited, err := model.CompletePaidOrder("late", "late-transaction", 1, "1", model.CurrencyTypeCNY)
	require.NoError(t, err)
	require.True(t, credited)

	// Stripe 的已签名无关事件/未付款会话应安全确认，只有已付款会话到账。
	require.NoError(t, db.Create(&model.Payment{ID: 3, UUID: "stripe-test", Type: "stripe", Config: `{"webhook_secret":"whsec_test_only"}`}).Error)
	require.NoError(t, db.Create(&model.Order{UserId: 1, GatewayId: 3, TradeNo: "stripe-order", Quota: 100, OrderAmount: 1, OrderCurrency: model.CurrencyTypeUSD, Status: model.OrderStatusPending}).Error)
	stripeCallback := func(event, status string) *httptest.ResponseRecorder {
		body := fmt.Sprintf(`{"id":"evt_test","object":"event","api_version":%q,"type":%q,"data":{"object":{"id":"cs_test","client_reference_id":"stripe-order","payment_status":%q,"payment_intent":"pi_test","amount_total":100,"currency":"usd"}}}`, stripe.APIVersion, event, status)
		signed := webhook.GenerateTestSignedPayload(&webhook.UnsignedPayload{Payload: []byte(body), Secret: "whsec_test_only"})
		req := httptest.NewRequest("POST", "/notify/stripe-test", strings.NewReader(body))
		req.Header.Set("Stripe-Signature", signed.Header)
		res := httptest.NewRecorder()
		r.ServeHTTP(res, req)
		return res
	}
	for _, event := range []string{"customer.created", "checkout.session.completed"} {
		require.Equal(t, http.StatusOK, stripeCallback(event, "unpaid").Code)
		order, err = model.GetOrderByTradeNo("stripe-order")
		require.NoError(t, err)
		require.Equal(t, model.OrderStatusPending, order.Status)
	}
	require.Equal(t, http.StatusOK, stripeCallback("checkout.session.async_payment_succeeded", "paid").Code)
	require.Equal(t, http.StatusOK, stripeCallback("checkout.session.completed", "paid").Code)
	quota, err = model.GetUserQuota(1)
	require.NoError(t, err)
	require.Equal(t, 300, quota)

	// 无需先发起支付，重启后的支付宝回调也能使用当前网关配置验签。
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	publicKey, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	require.NoError(t, err)
	alipayConfig, err := json.Marshal(map[string]string{
		"app_id":      "app-test",
		"private_key": string(pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})),
		"public_key":  string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicKey})),
	})
	require.NoError(t, err)
	require.NoError(t, db.Create(&model.Payment{ID: 4, UUID: "alipay-test", Type: "alipay", Config: string(alipayConfig)}).Error)
	require.NoError(t, db.Create(&model.Order{UserId: 1, GatewayId: 4, TradeNo: "alipay-order", Quota: 100, OrderAmount: 1, OrderCurrency: model.CurrencyTypeCNY, Status: model.OrderStatusPending}).Error)
	for _, attempt := range []struct {
		appID  string
		tamper bool
	}{{"wrong-app", false}, {"app-test", true}, {"app-test", false}, {"app-test", false}} {
		appID := attempt.appID
		data := "app_id=" + appID + "&out_trade_no=alipay-order&total_amount=1.00&trade_no=alipay-transaction&trade_status=TRADE_SUCCESS"
		hash := sha256.Sum256([]byte(data))
		signature, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, hash[:])
		require.NoError(t, err)
		form, err := url.ParseQuery(data)
		require.NoError(t, err)
		form.Set("sign", base64.StdEncoding.EncodeToString(signature))
		if attempt.tamper {
			form.Set("sign", base64.StdEncoding.EncodeToString(make([]byte, len(signature))))
		}
		form.Set("sign_type", "RSA2")
		req := httptest.NewRequest("POST", "/notify/alipay-test", strings.NewReader(form.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		res := httptest.NewRecorder()
		r.ServeHTTP(res, req)
		if appID == "wrong-app" || attempt.tamper {
			require.NotEqual(t, "success", res.Body.String())
		} else {
			require.Equal(t, "success", res.Body.String())
		}
	}
	quota, err = model.GetUserQuota(1)
	require.NoError(t, err)
	require.Equal(t, 400, quota)
}
