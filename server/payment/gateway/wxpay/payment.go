package wxpay

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"one-api/model"
	"one-api/payment/types"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"github.com/wechatpay-apiv3/wechatpay-go/core"
	"github.com/wechatpay-apiv3/wechatpay-go/core/auth/verifiers"
	"github.com/wechatpay-apiv3/wechatpay-go/core/downloader"
	"github.com/wechatpay-apiv3/wechatpay-go/core/notify"
	"github.com/wechatpay-apiv3/wechatpay-go/core/option"
	"github.com/wechatpay-apiv3/wechatpay-go/services/payments"
	"github.com/wechatpay-apiv3/wechatpay-go/utils"
)

type WeChatPay struct{}

type WeChatConfig struct {
	AppID                      string  `json:"app_id"`                        //应用ID
	MchID                      string  `json:"mch_id"`                        //商户号
	MchCertificateSerialNumber string  `json:"mch_certificate_serial_number"` //商户证书序列号
	MchAPIv3Key                string  `json:"mch_apiv3_key"`                 //商户APIv3密钥
	MchPrivateKey              string  `json:"mch_private_key"`               //商户私钥
	NotifyURL                  string  `json:"notify_url"`
	PayType                    PayType `json:"pay_type"`
}

func (w *WeChatPay) Name() string {
	return "微信支付"
}

// newClient 每次按当前网关配置创建 client，避免进程内缓存的首个商户配置被后续订单串用
func newClient(config *WeChatConfig) (*core.Client, error) {
	mchPrivateKey, err := utils.LoadPrivateKey(config.MchPrivateKey)
	if err != nil {
		return nil, fmt.Errorf("load merchant private key error: %w", err)
	}
	// 使用商户私钥等初始化 client，并使它具有自动定时获取微信支付平台证书的能力
	return core.NewClient(context.Background(), option.WithWechatPayAutoAuthCipher(config.MchID, config.MchCertificateSerialNumber, mchPrivateKey, config.MchAPIv3Key))
}

// ensureCertificateDownloader 保证回调验签所需的平台证书已注册；进程重启后可能先收到回调、尚未下过单
func ensureCertificateDownloader(config *WeChatConfig) error {
	mgr := downloader.MgrInstance()
	if mgr.HasDownloader(context.Background(), config.MchID) {
		return nil
	}
	mchPrivateKey, err := utils.LoadPrivateKey(config.MchPrivateKey)
	if err != nil {
		return fmt.Errorf("load merchant private key error: %w", err)
	}
	return mgr.RegisterDownloaderWithPrivateKey(context.Background(), mchPrivateKey, config.MchCertificateSerialNumber, config.MchID, config.MchAPIv3Key)
}

func (w *WeChatPay) Pay(config *types.PayConfig, gatewayConfig string) (*types.PayRequest, error) {
	wechatConfig, err := getWeChatConfig(gatewayConfig)
	if err != nil {
		return nil, err
	}

	client, err := newClient(wechatConfig)
	if err != nil {
		return nil, err
	}
	switch wechatConfig.PayType {
	case Native:
		return w.handleNativePay(client, config, wechatConfig)
	default:
		return w.handleNativePay(client, config, wechatConfig)
	}
}

func (w *WeChatPay) HandleCallback(c *gin.Context, gatewayConfig string) (*types.PayNotify, error) {

	wxpayConfig, err := getWeChatConfig(gatewayConfig)
	if err != nil {
		// 接收失败，返回4XX或5XX状态码以及应答报文
		c.JSON(http.StatusBadRequest, NotifyResponse{
			Code:    "FAIL",
			Message: err.Error(),
		})
		return nil, fmt.Errorf("WeChat params failed: %v", err)
	}
	if err := ensureCertificateDownloader(wxpayConfig); err != nil {
		c.JSON(http.StatusInternalServerError, NotifyResponse{
			Code:    "FAIL",
			Message: err.Error(),
		})
		return nil, fmt.Errorf("WeChat certificate init failed: %v", err)
	}
	certificateVisitor := downloader.MgrInstance().GetCertificateVisitor(wxpayConfig.MchID)
	handler := notify.NewNotifyHandler(wxpayConfig.MchAPIv3Key, verifiers.NewSHA256WithRSAVerifier(certificateVisitor))
	transaction := new(payments.Transaction)
	notifyReq, err := handler.ParseNotifyRequest(context.Background(), c.Request, transaction)
	// 如果验签未通过，或者解密失败
	if err != nil {
		// 接收失败，返回4XX或5XX状态码以及应答报文
		c.JSON(http.StatusBadRequest, NotifyResponse{
			Code:    "FAIL",
			Message: err.Error(),
		})
		return nil, fmt.Errorf("WeChat Signature verification failed: %v", err)
	}
	if notifyReq.EventType != "TRANSACTION.SUCCESS" {
		c.Status(http.StatusNoContent)
		return nil, fmt.Errorf("WeChat Transaction failed: %v", notifyReq.EventType)
	}
	if transaction.TradeState == nil || *transaction.TradeState != "SUCCESS" {
		c.Status(http.StatusNoContent)
		return nil, fmt.Errorf("tradeNo: %v, TransactionId: %v, err: %v", transaction.OutTradeNo, transaction.TransactionId, err)
	}
	if transaction.OutTradeNo == nil || transaction.TransactionId == nil || transaction.Amount == nil || transaction.Amount.Total == nil || transaction.Amount.Currency == nil || transaction.Mchid == nil || *transaction.Mchid != wxpayConfig.MchID || transaction.Appid == nil || *transaction.Appid != wxpayConfig.AppID {
		return nil, fmt.Errorf("WeChat transaction fields invalid")
	}

	payNotify := &types.PayNotify{
		TradeNo:   *transaction.OutTradeNo,
		GatewayNo: *transaction.TransactionId,
		Amount:    decimal.NewFromInt(*transaction.Amount.Total).Shift(-2).String(),
		Currency:  model.CurrencyType(*transaction.Amount.Currency),
	}
	return payNotify, nil

}

func getWeChatConfig(gatewayConfig string) (*WeChatConfig, error) {
	var wechatConfig WeChatConfig
	if err := json.Unmarshal([]byte(gatewayConfig), &wechatConfig); err != nil {
		return nil, errors.New("config error")
	}

	return &wechatConfig, nil
}

func (w *WeChatPay) CreatedPay(_ string, _ *model.Payment) error {
	return nil
}
