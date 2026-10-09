package alipay

import (
	"encoding/json"
	"errors"
	"fmt"
	"one-api/model"
	"one-api/payment/types"

	"github.com/gin-gonic/gin"
	"github.com/smartwalle/alipay/v3"
)

type Alipay struct{}

type AlipayConfig struct {
	AppID      string  `json:"app_id"`
	PrivateKey string  `json:"private_key"`
	PublicKey  string  `json:"public_key"`
	PayType    PayType `json:"pay_type"`
}

const isProduction bool = true

func (a *Alipay) Name() string {
	return "支付宝"
}

// newClient 每次按当前网关配置创建 client，避免进程内缓存的首个商户配置被后续订单串用
func newClient(config *AlipayConfig) (*alipay.Client, error) {
	client, err := alipay.New(config.AppID, config.PrivateKey, isProduction)
	if err != nil {
		return nil, err
	}
	if err := client.LoadAliPayPublicKey(config.PublicKey); err != nil {
		return nil, err
	}
	return client, nil
}

func (a *Alipay) Pay(config *types.PayConfig, gatewayConfig string) (*types.PayRequest, error) {
	alipayConfig, err := getAlipayConfig(gatewayConfig)
	if err != nil {
		return nil, err
	}

	client, err := newClient(alipayConfig)
	if err != nil {
		return nil, err
	}

	switch alipayConfig.PayType {
	case PagePay:
		return a.handlePagePay(client, config)
	case WapPay:
		return a.handleWapPay(client, config)
	default:
		return a.handleTradePreCreate(client, config)
	}
}

func (a *Alipay) HandleCallback(c *gin.Context, gatewayConfig string) (*types.PayNotify, error) {
	config, err := getAlipayConfig(gatewayConfig)
	if err != nil {
		return nil, err
	}
	// 回调可能发生在重启后，且必须使用当前网关的公钥。
	callbackClient, err := newClient(config)
	if err != nil {
		return nil, err
	}
	// 获取通知参数
	params := c.Request.URL.Query()
	if err := c.Request.ParseForm(); err != nil {
		c.Writer.Write([]byte("failure"))
		return nil, fmt.Errorf("Alipay params failed: %v", err)
	}
	for k, v := range c.Request.PostForm {
		params[k] = v
	}
	// SDK 在解析通知前会校验签名。
	noti, err := callbackClient.DecodeNotification(params)
	if err != nil {
		c.Writer.Write([]byte("failure"))
		return nil, fmt.Errorf("Alipay Error decoding notification: %v", err)
	}

	if noti.AppId == config.AppID && (noti.TradeStatus == alipay.TradeStatusSuccess || noti.TradeStatus == alipay.TradeStatusFinished) {
		payNotify := &types.PayNotify{
			TradeNo:   noti.OutTradeNo,
			GatewayNo: noti.TradeNo,
			Amount:    noti.TotalAmount,
			Currency:  model.CurrencyTypeCNY,
		}
		return payNotify, nil
	}
	c.Writer.Write([]byte("failure"))
	return nil, fmt.Errorf("trade status not success")
}

func getAlipayConfig(gatewayConfig string) (*AlipayConfig, error) {
	var alipayConfig AlipayConfig
	if err := json.Unmarshal([]byte(gatewayConfig), &alipayConfig); err != nil {
		return nil, errors.New("config error")
	}

	return &alipayConfig, nil
}

func (a *Alipay) CreatedPay(_ string, _ *model.Payment) error {
	return nil
}
