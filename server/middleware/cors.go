package middleware

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/gin-contrib/cors"
	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
)

type BrowserPolicy struct {
	Origins []string
	Cookie  sessions.Options
}

func LoadBrowserPolicy() (BrowserPolicy, error) {
	policy := BrowserPolicy{Cookie: sessions.Options{Path: "/", MaxAge: 2592000, HttpOnly: true, Secure: viper.GetBool("session_cookie_secure"), SameSite: http.SameSiteStrictMode}}
	for _, value := range strings.Split(viper.GetString("gouo_allowed_origins"), ",") {
		origin := strings.TrimSpace(value)
		if origin == "" {
			continue
		}
		u, err := url.Parse(origin)
		if err != nil || u.Hostname() == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || strings.Contains(origin, "*") {
			return policy, fmt.Errorf("gouo_allowed_origins 必须是完整且不含路径或通配符的 http(s) origin")
		}
		policy.Origins = append(policy.Origins, origin)
	}
	switch strings.ToLower(strings.TrimSpace(viper.GetString("session_cookie_same_site"))) {
	case "", "strict":
	case "lax":
		policy.Cookie.SameSite = http.SameSiteLaxMode
	case "none":
		if !policy.Cookie.Secure || len(policy.Origins) == 0 {
			return policy, fmt.Errorf("session_cookie_same_site=none 必须同时设置 session_cookie_secure=true 和 gouo_allowed_origins")
		}
		policy.Cookie.SameSite = http.SameSiteNoneMode
	default:
		return policy, fmt.Errorf("session_cookie_same_site 仅支持 strict、lax、none")
	}
	return policy, nil
}

func CORS() gin.HandlerFunc {
	policy, err := LoadBrowserPolicy()
	if err != nil {
		panic(err)
	}
	settings := cors.DefaultConfig()
	settings.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	settings.AllowHeaders = []string{"Content-Type", "Authorization", "X-Gouo-Token", "X-Gouo-Price-Version", "X-Gouo-Request-Id"}
	settings.ExposeHeaders = []string{"X-Gouo-Charge-Id", "X-Gouo-Billing-Status", "X-Request-Id", "Retry-After"}
	settings.AllowOriginFunc = func(origin string) bool {
		for _, allowed := range policy.Origins {
			if origin == allowed {
				return true
			}
		}
		return false
	}
	settings.AllowCredentials = true
	accountCORS := cors.New(settings)
	// 中继使用 Bearer 令牌；保留公开浏览器 API，不能将跨域 Cookie 权限扩散到任意来源。
	settings.AllowOriginFunc = nil
	settings.AllowAllOrigins = true
	settings.AllowCredentials = false
	settings.AllowHeaders = []string{"*"}
	apiCORS := cors.New(settings)
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin == "" && strings.HasPrefix(c.Request.URL.Path, "/api/") {
			path := c.Request.URL.Path
			// OAuth 回跳依靠各处理器验证 session 中的 state；其余跨站导航不能借 Cookie 修改账号。
			oauthCallback := c.Request.Method == http.MethodGet && (path == "/api/oauth/github" || path == "/api/oauth/lark" || path == "/api/oauth/oidc")
			fetchSite := c.GetHeader("Sec-Fetch-Site")
			_, cookieErr := c.Request.Cookie("session")
			untrustedSession := policy.Cookie.SameSite == http.SameSiteNoneMode && cookieErr == nil && fetchSite != "same-origin"
			if !oauthCallback && (fetchSite == "cross-site" || untrustedSession) {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"success": false, "message": "跨站账号请求已拒绝，请从光构页面操作"})
				return
			}
		}
		scheme := "http"
		if c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https" {
			scheme = "https"
		}
		if origin == "" || origin == scheme+"://"+c.Request.Host {
			c.Next()
			return
		}
		for _, allowed := range policy.Origins {
			if origin == allowed {
				accountCORS(c)
				return
			}
		}
		if !strings.HasPrefix(c.Request.URL.Path, "/api/") {
			apiCORS(c)
			return
		}
		accountCORS(c)
	}
}
