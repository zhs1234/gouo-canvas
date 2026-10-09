package middleware

import (
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
)

// SetTrustedProxies 只信任部署中的反向代理转发的来源 IP。
// gin 默认信任所有来源的 X-Forwarded-For，客户端可自带该头伪造 IP，绕过按 IP 的限流和令牌 IP 白名单。
// 默认信任本机与私有网段（同机或容器内的 nginx 等反向代理），可用 trusted_proxies 覆盖，多个值用逗号分隔。
func SetTrustedProxies(engine *gin.Engine) error {
	items := viper.GetStringSlice("trusted_proxies")
	// viper 把值为空的环境变量当作未设置；显式设为空表示不信任任何代理
	if value, ok := os.LookupEnv("TRUSTED_PROXIES"); ok {
		items = []string{value}
	}
	var proxies []string
	for _, item := range items {
		proxies = append(proxies, strings.FieldsFunc(item, func(r rune) bool { return r == ',' || r == ' ' })...)
	}
	return engine.SetTrustedProxies(proxies)
}
