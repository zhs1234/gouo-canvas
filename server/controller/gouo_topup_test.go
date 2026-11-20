package controller

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"one-api/common/config"
	"one-api/common/logger"
	"one-api/model"
	"one-api/payment"
	"one-api/payment/gateway/epay"
	"one-api/payment/types"
)

// 记录下单参数的假网关，替换需要访问外网的 Stripe
type fakeTopupGateway struct{ last *types.PayConfig }

func (f *fakeTopupGateway) Name() string { return "fake" }
func (f *fakeTopupGateway) Pay(cfg *types.PayConfig, _ string) (*types.PayRequest, error) {
	f.last = cfg
	return &types.PayRequest{Type: 1, Data: types.PayRequestData{URL: "https://pay.example/checkout"}}, nil
}
func (f *fakeTopupGateway) CreatedPay(string, *model.Payment) error { return nil }
func (f *fakeTopupGateway) HandleCallback(*gin.Context, string) (*types.PayNotify, error) {
	return nil, nil
}

func setupGouoTopupTest(t *testing.T) (*gorm.DB, *gin.Engine, *fakeTopupGateway) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	oldDB, oldRedis, oldLogger, oldStripe := model.DB, config.RedisEnabled, logger.Logger, payment.Gateways["stripe"]
	oldOnline, oldPackages, oldCustom, oldMin, oldMax := config.GouoOnlineTopup, config.GouoTopupPackages, config.GouoTopupCustom, config.GouoTopupCustomMin, config.GouoTopupCustomMax
	oldRate, oldUnit, oldAddress := config.PaymentUSDRate, config.QuotaPerUnit, config.ServerAddress
	t.Cleanup(func() {
		model.DB, config.RedisEnabled, logger.Logger, payment.Gateways["stripe"] = oldDB, oldRedis, oldLogger, oldStripe
		config.GouoOnlineTopup, config.GouoTopupPackages, config.GouoTopupCustom, config.GouoTopupCustomMin, config.GouoTopupCustomMax = oldOnline, oldPackages, oldCustom, oldMin, oldMax
		config.PaymentUSDRate, config.QuotaPerUnit, config.ServerAddress = oldRate, oldUnit, oldAddress
	})
	config.RedisEnabled, logger.Logger = false, zap.NewNop()
	config.GouoOnlineTopup, config.GouoTopupCustom, config.GouoTopupCustomMin, config.GouoTopupCustomMax = true, true, 1, 5000
	config.GouoTopupPackages = `[{"price":10,"points":1000,"bonus":0},{"price":30,"points":3000,"bonus":150},{"price":100,"points":10000,"bonus":1000}]`
	config.PaymentUSDRate, config.QuotaPerUnit, config.ServerAddress = 7.3, 500000, "https://app.example/"
	fake := &fakeTopupGateway{}
	payment.Gateways["stripe"] = fake

	db, err := gorm.Open(sqlite.Open(t.TempDir()+"/topup.db"), &gorm.Config{})
	require.NoError(t, err)
	conn, err := db.DB()
	require.NoError(t, err)
	conn.SetMaxOpenConns(1)
	t.Cleanup(func() { conn.Close() })
	model.DB = db
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Order{}, &model.Payment{}, &model.Log{}, &model.UserGroup{}, &model.Option{}))
	for _, id := range []int{1, 2} {
		require.NoError(t, db.Create(&model.User{Id: id, Username: fmt.Sprintf("topup-%d", id), AccessToken: fmt.Sprintf("token-%d", id), AffCode: fmt.Sprintf("aff-%d", id)}).Error)
	}
	disabled := false
	epayConfig := `{"key":"test-only-epay-key","partner_id":"test","pay_domain":"https://epay.example","pay_type":"alipay"}`
	for _, p := range []*model.Payment{
		{ID: 1, UUID: "epay", Type: "epay", Currency: model.CurrencyTypeCNY, Config: epayConfig},
		{ID: 2, UUID: "epay-percent", Type: "epay", Currency: model.CurrencyTypeCNY, PercentFee: 0.05, Config: epayConfig},
		{ID: 3, UUID: "epay-fixed", Type: "epay", Currency: model.CurrencyTypeCNY, FixedFee: 0.5, Config: epayConfig},
		{ID: 4, UUID: "stripe-usd", Type: "stripe", Currency: model.CurrencyTypeUSD},
		{ID: 5, UUID: "stripe-usd-fee", Type: "stripe", Currency: model.CurrencyTypeUSD, PercentFee: 0.1},
		{ID: 6, UUID: "stripe-usd-fixed", Type: "stripe", Currency: model.CurrencyTypeUSD, FixedFee: 0.3},
		{ID: 7, UUID: "epay-off", Type: "epay", Currency: model.CurrencyTypeCNY, Enable: &disabled, Config: epayConfig},
		{ID: 8, UUID: "epay-usd", Type: "epay", Currency: model.CurrencyTypeUSD, Config: epayConfig},
	} {
		require.NoError(t, db.Create(p).Error)
	}
	model.ResetEnabledPaymentCache()

	r := gin.New()
	r.Use(func(c *gin.Context) {
		id, _ := strconv.Atoi(c.GetHeader("X-Test-User"))
		c.Set("id", id)
	})
	r.GET("/status", GetStatus)
	r.POST("/topup/order", CreateGouoTopupOrder)
	r.GET("/topup/orders", ListGouoTopupOrders)
	r.Any("/notify/:uuid", PaymentCallback)
	return db, r, fake
}

func gouoTopupRequest(t *testing.T, r *gin.Engine, method, path, user, body string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("X-Test-User", user)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	var res map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &res), rec.Body.String())
	return rec.Code, res
}

func TestGouoTopupSettings(t *testing.T) {
	setupGouoTopupTest(t)
	config.GlobalOption.RegisterBool("GouoOnlineTopup", &config.GouoOnlineTopup)
	config.GlobalOption.RegisterString("GouoTopupPackages", &config.GouoTopupPackages)
	config.GlobalOption.RegisterBool("GouoTopupCustom", &config.GouoTopupCustom)
	config.GlobalOption.RegisterInt("GouoTopupCustomMin", &config.GouoTopupCustomMin)
	config.GlobalOption.RegisterInt("GouoTopupCustomMax", &config.GouoTopupCustomMax)
	oldPricing := model.PricingInstance
	model.PricingInstance = &model.Pricing{Prices: map[string]*model.Price{}}
	t.Cleanup(func() { model.PricingInstance = oldPricing })
	r := gin.New()
	r.PUT("/settings", UpdateGouoAdminSettings)
	r.PUT("/option", UpdateOption)
	put := func(path string, body any) int {
		raw, err := json.Marshal(body)
		require.NoError(t, err)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, path, strings.NewReader(string(raw))))
		return rec.Code
	}

	// 合法配置压缩保存，价格可以有两位小数，积分不必等于价格 × 100
	require.Equal(t, http.StatusOK, put("/settings", map[string]string{"GouoOnlineTopup": "true", "GouoTopupPackages": ` [ {"price": 9.9, "points": 1000, "bonus": 0} ] `}))
	require.True(t, config.GouoOnlineTopup)
	require.Equal(t, `[{"price":9.9,"points":1000,"bonus":0}]`, config.GouoTopupPackages)
	require.Equal(t, http.StatusOK, put("/settings", map[string]string{"GouoTopupPackages": "[]"}))

	twelve := make([]gouoTopupPackage, 13)
	for i := range twelve {
		twelve[i] = gouoTopupPackage{Price: 1, Points: 100}
	}
	tooMany, _ := json.Marshal(twelve)
	for _, raw := range []string{
		``, `null`, `{}`, `[1]`, `[{"price":10,"points":1000}] x`,
		`[{"price":0,"points":100,"bonus":0}]`,
		`[{"price":-1,"points":100,"bonus":0}]`,
		`[{"price":1.234,"points":100,"bonus":0}]`,
		`[{"price":100000.01,"points":100,"bonus":0}]`,
		`[{"price":10,"points":0,"bonus":0}]`,
		`[{"price":10,"points":10.5,"bonus":0}]`,
		`[{"price":10,"points":1000,"bonus":-1}]`,
		`[{"price":10,"points":1000,"bonus":0,"extra":1}]`,
		`[{"price":"10","points":1000,"bonus":0}]`,
		string(tooMany),
	} {
		require.Equal(t, http.StatusBadRequest, put("/settings", map[string]string{"GouoTopupPackages": raw}), raw)
	}
	require.Equal(t, "[]", config.GouoTopupPackages)

	// 上下限 1~100000 且下限不大于上限；一起保存时按新值比较
	for _, body := range []map[string]string{
		{"GouoTopupCustomMin": "0"},
		{"GouoTopupCustomMax": "100001"},
		{"GouoTopupCustomMin": "1.5"},
		{"GouoTopupCustomMin": "6000"},
		{"GouoTopupCustomMin": "50", "GouoTopupCustomMax": "10"},
		{"GouoTopupCustom": "1"},
		// 汇率 7.3、每单位 500000 额度时，单笔超过约 31390 元换算出的额度超出订单范围，保存了也买不了
		{"GouoTopupCustomMax": "50000"},
		{"GouoTopupPackages": `[{"price":500,"points":3000000,"bonus":200000}]`},
	} {
		require.Equal(t, http.StatusBadRequest, put("/settings", body), body)
	}
	require.Equal(t, http.StatusOK, put("/settings", map[string]string{"GouoTopupCustomMax": "30000", "GouoTopupPackages": `[{"price":300,"points":3000000,"bonus":0}]`}))
	require.Equal(t, http.StatusOK, put("/settings", map[string]string{"GouoTopupCustomMin": "6000", "GouoTopupCustomMax": "8000", "GouoTopupCustom": "false"}))
	require.Equal(t, 6000, config.GouoTopupCustomMin)
	require.Equal(t, 8000, config.GouoTopupCustomMax)
	require.False(t, config.GouoTopupCustom)
	// 通用设置接口逐项保存，同样不能把下限改到上限之上
	require.Equal(t, http.StatusBadRequest, put("/option", map[string]string{"key": "GouoTopupCustomMin", "value": "9000"}))
	require.Equal(t, http.StatusBadRequest, put("/option", map[string]string{"key": "GouoTopupPackages", "value": "[{}]"}))
	require.Equal(t, 6000, config.GouoTopupCustomMin)
}

func TestGouoTopupStatus(t *testing.T) {
	db, r, _ := setupGouoTopupTest(t)
	status := func() map[string]any {
		_, res := gouoTopupRequest(t, r, http.MethodGet, "/status", "", "")
		return res["data"].(map[string]any)
	}

	data := status()
	require.Equal(t, true, data["gouo_online_topup"])
	// 余额提醒阈值随状态下发，客户端据此标出余额不足
	require.Equal(t, float64(config.GouoBalanceRemindPoints), data["gouo_balance_remind_points"])
	require.Len(t, data["gouo_topup_packages"], 3)
	require.Equal(t, map[string]any{"price": 30.0, "points": 3000.0, "bonus": 150.0}, data["gouo_topup_packages"].([]any)[1])
	require.Equal(t, map[string]any{"min": 1.0, "max": 5000.0}, data["gouo_topup_custom"])

	config.GouoTopupCustom = false
	require.Nil(t, status()["gouo_topup_custom"])

	// 配置损坏时按无积分包处理
	config.GouoTopupPackages = "not json"
	require.Equal(t, []any{}, status()["gouo_topup_packages"])

	config.GouoOnlineTopup = false
	data = status()
	require.Equal(t, false, data["gouo_online_topup"])
	require.Equal(t, []any{}, data["gouo_topup_packages"])
	require.Nil(t, data["gouo_topup_custom"])

	// 开启但没有启用的网关时仍视为未开放
	config.GouoOnlineTopup, config.GouoTopupCustom = true, true
	require.NoError(t, db.Model(&model.Payment{}).Where("1 = 1").Update("enable", false).Error)
	// 网关状态缓存 30 秒；后台保存网关时会立即失效，这里直接写表，手动失效
	require.Equal(t, true, status()["gouo_online_topup"])
	model.ResetEnabledPaymentCache()
	data = status()
	require.Equal(t, false, data["gouo_online_topup"])
	require.Nil(t, data["gouo_topup_custom"])
}

func TestGouoTopupCreateOrder(t *testing.T) {
	db, r, fake := setupGouoTopupTest(t)
	create := func(body string) (int, map[string]any) {
		return gouoTopupRequest(t, r, http.MethodPost, "/topup/order", "1", body)
	}
	order := func(res map[string]any) *model.Order {
		o, err := model.GetOrderByTradeNo(res["data"].(map[string]any)["trade_no"].(string))
		require.NoError(t, err)
		return o
	}

	// 客户端看到的积分包与服务端当前配置不同（后台改过积分包）时拒绝下单，不按同序号的新包收款
	for _, body := range []string{`{"gateway":"epay","package":1,"price":0.01,"points":3150}`, `{"gateway":"epay","package":1,"price":30,"points":999999}`} {
		code, res := create(body)
		require.Equal(t, http.StatusConflict, code, body)
		require.Equal(t, "package_changed", res["code"])
	}
	// 积分包：价格和积分按服务端配置计算，回跳地址带订单号
	code, res := create(`{"gateway":"epay","package":1,"price":30,"points":3150}`)
	require.Equal(t, http.StatusOK, code, res)
	data := res["data"].(map[string]any)
	require.Equal(t, 30.0, data["pay_amount"])
	require.Equal(t, "CNY", data["currency"])
	require.Equal(t, 3150.0, data["points"])
	require.Equal(t, 1.0, data["type"])
	tradeNo := data["trade_no"].(string)
	params := data["data"].(map[string]any)["params"].(map[string]any)
	require.Equal(t, "https://app.example/topup?trade_no="+tradeNo, params["return_url"])
	require.Equal(t, "https://app.example/api/payment/notify/epay", params["notify_url"])
	require.Equal(t, "30.00", params["money"])
	o := order(res)
	require.Equal(t, 1, o.UserId)
	require.Equal(t, model.OrderStatusPending, o.Status)
	require.Equal(t, int(math.Round(31.5/7.3*500000)), o.Quota)
	require.Equal(t, 4, o.Amount)
	require.Equal(t, 30.0, o.OrderAmount)
	require.Zero(t, o.Fee)
	require.Zero(t, o.Discount)

	// 旧接口的回跳地址不变
	service, err := payment.NewPaymentService("epay")
	require.NoError(t, err)
	legacy, err := service.Pay("legacy", 1, &model.User{Id: 1})
	require.NoError(t, err)
	require.Equal(t, "https://app.example/topup", (*legacy.Data.Params.(*map[string]string))["return_url"])

	// 自定义金额：1 元 = 100 积分；比例手续费按价格计
	code, res = create(`{"gateway":"epay-percent","amount":50}`)
	require.Equal(t, http.StatusOK, code, res)
	require.Equal(t, 52.5, res["data"].(map[string]any)["pay_amount"])
	require.Equal(t, 5000.0, res["data"].(map[string]any)["points"])
	o = order(res)
	require.Equal(t, int(math.Round(50/7.3*500000)), o.Quota)
	require.Equal(t, 0.34, o.Fee)

	// 固定手续费以「单位」计，人民币网关按汇率换成元
	code, res = create(`{"gateway":"epay-fixed","package":0}`)
	require.Equal(t, http.StatusOK, code, res)
	require.Equal(t, 13.65, res["data"].(map[string]any)["pay_amount"])
	require.Equal(t, 0.5, order(res).Fee)

	// USD 网关按汇率换成美元再加手续费
	for gateway, want := range map[string]float64{"stripe-usd": 13.7, "stripe-usd-fee": 15.07, "stripe-usd-fixed": 14} {
		code, res = create(`{"gateway":"` + gateway + `","package":2}`)
		require.Equal(t, http.StatusOK, code, res)
		data = res["data"].(map[string]any)
		require.Equal(t, want, data["pay_amount"], gateway)
		require.Equal(t, "USD", data["currency"])
		require.Equal(t, 11000.0, data["points"])
		require.Equal(t, want, fake.last.Money)
		require.Equal(t, model.CurrencyTypeUSD, fake.last.Currency)
		require.Equal(t, "https://app.example/topup?trade_no="+data["trade_no"].(string), fake.last.ReturnURL)
		require.Equal(t, int(math.Round(110/7.3*500000)), order(res).Quota)
	}

	var before int64
	require.NoError(t, db.Model(&model.Order{}).Count(&before).Error)
	for _, attempt := range []struct {
		body string
		code int
	}{
		{`{"gateway":"epay"}`, http.StatusBadRequest},
		{`{"gateway":"epay","package":0,"amount":10}`, http.StatusBadRequest},
		{`{"gateway":"epay","package":3}`, http.StatusBadRequest},
		{`{"gateway":"epay","package":-1}`, http.StatusBadRequest},
		{`{"gateway":"epay","amount":0}`, http.StatusBadRequest},
		{`{"gateway":"epay","amount":5001}`, http.StatusBadRequest},
		{`{"gateway":"epay","amount":10.5}`, http.StatusBadRequest},
		{`{"gateway":"missing","package":0}`, http.StatusBadRequest},
		{`{"gateway":"epay-off","package":0}`, http.StatusBadRequest},
		{`{"gateway":"epay-usd","package":0}`, http.StatusBadRequest},
		{`not json`, http.StatusBadRequest},
	} {
		code, res = create(attempt.body)
		require.Equal(t, attempt.code, code, attempt.body)
		require.Equal(t, false, res["success"])
		require.NotEmpty(t, res["message"])
	}

	config.GouoTopupCustom = false
	code, _ = create(`{"gateway":"epay","amount":10}`)
	require.Equal(t, http.StatusBadRequest, code)

	// 额度超出 int32 时拒绝下单
	config.QuotaPerUnit = 1e12
	code, _ = create(`{"gateway":"epay","package":0}`)
	require.Equal(t, http.StatusBadRequest, code)
	config.QuotaPerUnit = 500000

	config.GouoOnlineTopup = false
	code, res = create(`{"gateway":"epay","package":0}`)
	require.Equal(t, http.StatusForbidden, code)
	require.Equal(t, "topup_disabled", res["code"])

	var after int64
	require.NoError(t, db.Model(&model.Order{}).Count(&after).Error)
	require.Equal(t, before, after)
}

func TestGouoTopupOrdersAndCallback(t *testing.T) {
	db, r, _ := setupGouoTopupTest(t)
	code, res := gouoTopupRequest(t, r, http.MethodPost, "/topup/order", "1", `{"gateway":"epay","package":1}`)
	require.Equal(t, http.StatusOK, code, res)
	tradeNo := res["data"].(map[string]any)["trade_no"].(string)
	code, res = gouoTopupRequest(t, r, http.MethodPost, "/topup/order", "2", `{"gateway":"epay","amount":20}`)
	require.Equal(t, http.StatusOK, code, res)
	otherTradeNo := res["data"].(map[string]any)["trade_no"].(string)
	require.NoError(t, db.Create(&model.Order{UserId: 1, GatewayId: 1, TradeNo: "old-failed", Quota: 500000, OrderAmount: 7.3, OrderCurrency: model.CurrencyTypeCNY, Status: model.OrderStatusFailed}).Error)

	list := func(user, query string) []any {
		code, res := gouoTopupRequest(t, r, http.MethodGet, "/topup/orders"+query, user, "")
		require.Equal(t, http.StatusOK, code, res)
		return res["data"].([]any)
	}
	// 只返回本人订单，最新的在前
	orders := list("1", "")
	require.Len(t, orders, 2)
	require.Equal(t, "old-failed", orders[0].(map[string]any)["trade_no"])
	require.Equal(t, 730.0, orders[0].(map[string]any)["points"])
	require.Equal(t, "failed", orders[0].(map[string]any)["status"])
	first := orders[1].(map[string]any)
	require.Equal(t, tradeNo, first["trade_no"])
	require.Equal(t, "pending", first["status"])
	require.Equal(t, 3150.0, first["points"])
	require.Equal(t, 30.0, first["pay_amount"])
	require.Equal(t, "CNY", first["currency"])
	require.NotZero(t, first["created_at"])
	// 新订单记录了下单时的到账积分，之后改汇率不影响显示；旧订单仍按当前汇率折算
	config.PaymentUSDRate = 7
	orders = list("1", "")
	require.Equal(t, 3150.0, orders[1].(map[string]any)["points"])
	require.Equal(t, 700.0, orders[0].(map[string]any)["points"])
	config.PaymentUSDRate = 7.3
	require.Len(t, list("1", "?trade_no="+url.QueryEscape(tradeNo)), 1)
	require.Empty(t, list("1", "?trade_no="+otherTradeNo))
	require.Len(t, list("2", ""), 1)
	for i := 0; i < 25; i++ {
		require.NoError(t, db.Create(&model.Order{UserId: 2, GatewayId: 1, TradeNo: fmt.Sprintf("bulk-%d", i), Status: model.OrderStatusClosed}).Error)
	}
	require.Len(t, list("2", ""), 20)

	// 光构订单走现有回调到账，金额必须与订单一致，重复回调不重复入账
	callback := func(money string) *httptest.ResponseRecorder {
		values := map[string]string{"pid": "test", "trade_no": "gateway-" + tradeNo, "out_trade_no": tradeNo, "trade_status": "TRADE_SUCCESS", "money": money}
		values["sign"] = (&epay.Client{Key: "test-only-epay-key"}).Sign(values)
		q := url.Values{}
		for k, v := range values {
			q.Set(k, v)
		}
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/notify/epay?"+q.Encode(), nil))
		return rec
	}
	require.NotEqual(t, "success", callback("0.01").Body.String())
	quota, err := model.GetUserQuota(1)
	require.NoError(t, err)
	require.Zero(t, quota)
	for i := 0; i < 3; i++ {
		require.Equal(t, "success", callback("30.00").Body.String())
	}
	quota, err = model.GetUserQuota(1)
	require.NoError(t, err)
	require.Equal(t, int(math.Round(31.5/7.3*500000)), quota)
	var logs []model.Log
	require.NoError(t, db.Where("user_id = ? AND type = ?", 1, model.LogTypeTopup).Find(&logs).Error)
	require.Len(t, logs, 1)
	require.Contains(t, logs[0].Content, "3150 积分")
	require.Equal(t, "success", list("1", "?trade_no="+tradeNo)[0].(map[string]any)["status"])
	quota, err = model.GetUserQuota(2)
	require.NoError(t, err)
	require.Zero(t, quota)
}
