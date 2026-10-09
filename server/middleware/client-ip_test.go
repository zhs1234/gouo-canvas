package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
	"github.com/stretchr/testify/require"

	"one-api/middleware"
)

func TestClientIPOnlyTrustsConfiguredProxies(t *testing.T) {
	gin.SetMode(gin.TestMode)
	old := viper.Get("trusted_proxies")
	t.Cleanup(func() { viper.Set("trusted_proxies", old) })
	clientIP := func(proxies any, remote string) string {
		viper.Set("trusted_proxies", proxies)
		engine := gin.New()
		require.NoError(t, middleware.SetTrustedProxies(engine))
		var got string
		engine.GET("/", func(c *gin.Context) { got = c.ClientIP() })
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = remote + ":1234"
		// nginx 的 $proxy_add_x_forwarded_for 把真实地址追加在客户端自带值的后面
		req.Header.Set("X-Forwarded-For", "1.2.3.4, 198.51.100.7")
		engine.ServeHTTP(httptest.NewRecorder(), req)
		return got
	}
	defaults := []string{"127.0.0.0/8", "::1/128", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"}

	// 客户端直连公网端口：忽略自带的转发头
	require.Equal(t, "203.0.113.9", clientIP(defaults, "203.0.113.9"))
	// 经容器内 nginx 转发：取 nginx 追加的真实地址，忽略伪造的最左侧值
	require.Equal(t, "198.51.100.7", clientIP(defaults, "172.18.0.5"))
	// 环境变量以逗号分隔
	require.Equal(t, "198.51.100.7", clientIP("10.0.0.0/8,172.16.0.0/12", "172.18.0.5"))
	// 设为空时不信任任何代理
	require.Equal(t, "172.18.0.5", clientIP("", "172.18.0.5"))
}
