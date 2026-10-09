package alipay

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"testing"

	"one-api/payment/types"

	"github.com/stretchr/testify/require"
)

func testGatewayConfig(t *testing.T, appID string) string {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	publicKey, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	require.NoError(t, err)
	config, err := json.Marshal(AlipayConfig{
		AppID:      appID,
		PrivateKey: base64.StdEncoding.EncodeToString(x509.MarshalPKCS1PrivateKey(key)),
		PublicKey:  base64.StdEncoding.EncodeToString(publicKey),
		PayType:    PagePay,
	})
	require.NoError(t, err)
	return string(config)
}

func TestPayUsesCurrentMerchantConfig(t *testing.T) {
	merchantA := testGatewayConfig(t, "app-a")
	merchantB := testGatewayConfig(t, "app-b")
	gateway := &Alipay{}

	// 交替使用两个商户，每笔订单都必须使用自己的 AppID
	for i, tt := range []struct {
		config string
		appID  string
	}{{merchantA, "app-a"}, {merchantB, "app-b"}, {merchantA, "app-a"}} {
		request, err := gateway.Pay(&types.PayConfig{Money: 1.15, TradeNo: "trade-" + tt.appID, NotifyURL: "https://example.invalid/notify"}, tt.config)
		require.NoError(t, err, i)
		require.Equal(t, tt.appID, request.Data.Params.(map[string]string)["app_id"], i)
	}
}
