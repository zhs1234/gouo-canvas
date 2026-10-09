package stripe

import (
	"encoding/json"
	"fmt"
	"math"
	"one-api/model"
	"one-api/payment/types"
	"slices"
	"strconv"
	"strings"

	sysconfig "one-api/common/config"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"github.com/stripe/stripe-go/v80"
	"github.com/stripe/stripe-go/v80/client"
	"github.com/stripe/stripe-go/v80/webhook"
	"github.com/stripe/stripe-go/v80/webhookendpoint"
)

// Stripe 结构体实现支付接口
type Stripe struct{}

// Name 返回支付方式名称
func (e *Stripe) Name() string {
	return "Stripe"
}

// Pay 处理支付请求
func (e *Stripe) Pay(config *types.PayConfig, gatewayConfig string) (*types.PayRequest, error) {
	var stripeConfig StripeConfig
	// 使用 json.Unmarshal 解析 JSON 字符串到结构体
	err := json.Unmarshal([]byte(gatewayConfig), &stripeConfig)
	if err != nil {
		fmt.Println("Error parsing JSON:", err)
		return nil, err
	}

	sc := &client.API{}
	sc.Init(stripeConfig.SecretKey, nil)
	currency := stripe.String("USD")
	if config.Currency == "CNY" {
		currency = stripe.String("CNY")
	}

	params := &stripe.CheckoutSessionParams{
		Mode:              stripe.String(string(stripe.CheckoutSessionModePayment)),
		SuccessURL:        stripe.String(config.ReturnURL),
		ClientReferenceID: stripe.String(config.TradeNo),

		LineItems: []*stripe.CheckoutSessionLineItemParams{
			{
				PriceData: &stripe.CheckoutSessionLineItemPriceDataParams{
					Currency: currency,
					ProductData: &stripe.CheckoutSessionLineItemPriceDataProductDataParams{
						Name: stripe.String(sysconfig.SystemName + "-Token充值:" + strconv.FormatFloat(config.Money, 'f', 0, 64) + " " + string(config.Currency)),
					},
					UnitAmount: stripe.Int64(int64(math.Round(config.Money * 100))),
				},
				Quantity: stripe.Int64(1),
			},
		},
		Metadata: map[string]string{
			"user_id": fmt.Sprintf("%d", config.User.Id),
		},
	}

	if config.User.Email != "" {
		params.CustomerEmail = stripe.String(config.User.Email)
	}

	result, err := sc.CheckoutSessions.New(params)
	if err != nil {
		return nil, err
	}
	// 构造支付请求
	payRequest := &types.PayRequest{
		Type: 1,
		Data: types.PayRequestData{
			URL: result.URL,
			Params: map[string]interface{}{
				"tradeNo": config.TradeNo,
				"linkId":  result.ID,
			},
		},
	}

	return payRequest, nil
}

func (e *Stripe) CreatedPay(notifyURL string, gatewayConfig *model.Payment) error {
	eventName := "checkout.session.completed"
	asyncEventName := "checkout.session.async_payment_succeeded"
	var stripeConfig StripeConfig
	err := json.Unmarshal([]byte(gatewayConfig.Config), &stripeConfig)
	if err != nil {
		fmt.Println("Error parsing JSON:", err)
		return err
	}
	stripe.Key = stripeConfig.SecretKey
	params := &stripe.WebhookEndpointListParams{}
	params.Limit = stripe.Int64(100)
	i := webhookendpoint.List(params)

	var existingWebhook *stripe.WebhookEndpoint
	for i.Next() {
		webhook := i.WebhookEndpoint()
		if webhook.URL == notifyURL && slices.Contains(webhook.EnabledEvents, eventName) {
			existingWebhook = webhook
			break
		}
	}

	if err := i.Err(); err != nil {
		return fmt.Errorf("error listing webhooks: %v", err)
	}
	// 如果不存在匹配的 Webhook，则创建新的
	var wh *stripe.WebhookEndpoint

	if existingWebhook == nil {
		createParams := &stripe.WebhookEndpointParams{
			URL: stripe.String(notifyURL),
			EnabledEvents: []*string{
				stripe.String(eventName),
				stripe.String(asyncEventName),
			},
			APIVersion: stripe.String("2024-09-30.acacia"),
		}
		newWebhook, err := webhookendpoint.New(createParams)
		if err != nil {
			return fmt.Errorf("error creating webhook: %v", err)
		}
		wh = newWebhook
		fmt.Printf("Created new webhook: %s\n", newWebhook.ID)
	} else {
		wh = existingWebhook
		if !slices.Contains(wh.EnabledEvents, asyncEventName) && !slices.Contains(wh.EnabledEvents, "*") {
			events := make([]*string, 0, len(wh.EnabledEvents)+1)
			for _, event := range wh.EnabledEvents {
				events = append(events, stripe.String(event))
			}
			events = append(events, stripe.String(asyncEventName))
			if _, err := webhookendpoint.Update(wh.ID, &stripe.WebhookEndpointParams{EnabledEvents: events}); err != nil {
				return fmt.Errorf("error updating webhook: %v", err)
			}
		}
	}

	// Stripe 不会在查询已有端点时再次返回签名密钥。
	if wh.Secret != "" {
		stripeConfig.WebhookSecret = wh.Secret
	}
	if stripeConfig.WebhookSecret == "" {
		return fmt.Errorf("existing webhook signing secret is missing")
	}
	config, err := json.Marshal(stripeConfig)
	if err != nil {
		return fmt.Errorf("error creating webhook: %v", err)
	}

	gatewayConfig.Config = string(config)
	err = gatewayConfig.Update(true)
	if err != nil {
		return fmt.Errorf("error creating webhook: %v", err)
	}
	return nil
}

// HandleCallback 处理支付回调
func (e *Stripe) HandleCallback(c *gin.Context, gatewayConfig string) (*types.PayNotify, error) {
	body, err := c.GetRawData()
	if err != nil {
		return nil, fmt.Errorf("failed to read request body: %v", err)
	}

	var stripeConfig StripeConfig

	if err := json.Unmarshal([]byte(gatewayConfig), &stripeConfig); err != nil {
		return nil, fmt.Errorf("failed to parse gateway config: %v", err)
	}

	// 签名密钥为空时任何人都能用空密钥伪造回调
	if stripeConfig.WebhookSecret == "" {
		return nil, fmt.Errorf("webhook signing secret is not configured")
	}

	stripeSignature := c.GetHeader("Stripe-Signature")
	event, err := webhook.ConstructEvent(body, stripeSignature, stripeConfig.WebhookSecret)
	if err != nil {
		return nil, fmt.Errorf("failed to verify webhook: %v", err)
	}

	// 处理事件
	switch event.Type {
	case "checkout.session.completed", "checkout.session.async_payment_succeeded":
		var session stripe.CheckoutSession
		err := json.Unmarshal(event.Data.Raw, &session)
		if err != nil {
			return nil, fmt.Errorf("failed to parse session data: %v", err)
		}
		if session.PaymentStatus != stripe.CheckoutSessionPaymentStatusPaid {
			return nil, nil
		}
		if session.PaymentIntent == nil || session.PaymentIntent.ID == "" {
			return nil, fmt.Errorf("missing payment intent")
		}

		// 获取订单号；没有订单号的会话不是本系统创建的，确认收到即可
		orderID := session.ClientReferenceID
		if orderID == "" {
			return nil, nil
		}

		// 构造 PayNotify
		payNotify := &types.PayNotify{
			TradeNo:   orderID,
			GatewayNo: session.PaymentIntent.ID,
			Amount:    decimal.NewFromInt(session.AmountTotal).Shift(-2).String(),
			Currency:  model.CurrencyType(strings.ToUpper(string(session.Currency))),
		}

		return payNotify, nil
	default:
		return nil, nil
	}
}
