package wxpay

import (
	"context"
	"fmt"
	"github.com/shopspring/decimal"
	"github.com/wechatpay-apiv3/wechatpay-go/core"
	"github.com/wechatpay-apiv3/wechatpay-go/services/payments/native"
	"net/http"
	sysconfig "one-api/common/config"
	"one-api/payment/types"
	"strconv"
)

// moneyToFen 按十进制四舍五入换算成分；直接 int64(money*100) 会把 1.15 截断成 114
func moneyToFen(money float64) int64 {
	return decimal.NewFromFloat(money).Shift(2).Round(0).IntPart()
}

// handleNativePay 处理微信NATIVE支付请求
func (w *WeChatPay) handleNativePay(client *core.Client, config *types.PayConfig, wechatConfig *WeChatConfig) (*types.PayRequest, error) {
	totalAmount := strconv.FormatFloat(config.Money, 'f', 2, 64)
	req := native.PrepayRequest{
		Appid:       core.String(wechatConfig.AppID),
		Mchid:       core.String(wechatConfig.MchID),
		Description: core.String(sysconfig.SystemName + "-Token充值:" + totalAmount),
		OutTradeNo:  core.String(config.TradeNo),
		NotifyUrl:   core.String(config.NotifyURL),
		Amount: &native.Amount{
			Total: core.Int64(moneyToFen(config.Money)),
		},
	}
	nService := native.NativeApiService{Client: client}
	resp, result, err := nService.Prepay(context.Background(), req)
	if err != nil {
		return nil, fmt.Errorf("wechat native pay failed: %s", err.Error())
	}
	if result.Response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("wechat native pay failed: %s", result.Response.Status)
	}

	payRequest := &types.PayRequest{
		Type: 2,
		Data: types.PayRequestData{
			URL:    *resp.CodeUrl,
			Method: http.MethodGet,
		},
	}
	return payRequest, nil
}
