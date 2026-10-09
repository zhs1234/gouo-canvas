package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
	"github.com/stretchr/testify/require"

	"one-api/middleware"
	"one-api/router"
)

func preserveBrowserConfig(t *testing.T) {
	t.Helper()
	for _, key := range []string{"gouo_allowed_origins", "session_cookie_secure", "session_cookie_same_site"} {
		value := viper.Get(key)
		t.Cleanup(func() { viper.Set(key, value) })
	}
	viper.Set("gouo_allowed_origins", "")
	viper.Set("session_cookie_secure", false)
	viper.Set("session_cookie_same_site", "strict")
}

func TestBrowserPolicyRejectsUnsafeCrossSiteCookies(t *testing.T) {
	preserveBrowserConfig(t)
	policy, err := middleware.LoadBrowserPolicy()
	require.NoError(t, err)
	require.Equal(t, http.SameSiteStrictMode, policy.Cookie.SameSite)
	require.True(t, policy.Cookie.HttpOnly)
	require.False(t, policy.Cookie.Secure)
	require.Empty(t, policy.Origins)
	for _, origin := range []string{"*", "https://*.example.com", "https://example.com/path", "https://user:password@example.com", "https://example.com?query=1", "null"} {
		viper.Set("gouo_allowed_origins", origin)
		_, err := middleware.LoadBrowserPolicy()
		require.Error(t, err, origin)
	}
	viper.Set("gouo_allowed_origins", "https://app.example.com")
	viper.Set("session_cookie_same_site", "none")
	_, err = middleware.LoadBrowserPolicy()
	require.Error(t, err)
	viper.Set("session_cookie_secure", true)
	policy, err = middleware.LoadBrowserPolicy()
	require.NoError(t, err)
	require.Equal(t, http.SameSiteNoneMode, policy.Cookie.SameSite)
	require.True(t, policy.Cookie.Secure)
	viper.Set("gouo_allowed_origins", "")
	_, err = middleware.LoadBrowserPolicy()
	require.Error(t, err)
}

func TestAccountCORSIsInstalledBeforeRealRoutes(t *testing.T) {
	preserveBrowserConfig(t)
	gin.SetMode(gin.TestMode)
	request := func(r *gin.Engine, method, path, origin string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, nil)
		req.Header.Set("Origin", origin)
		if method == "OPTIONS" {
			req.Header.Set("Access-Control-Request-Method", "PUT")
			req.Header.Set("Access-Control-Request-Headers", "Content-Type,X-Gouo-Token")
		}
		res := httptest.NewRecorder()
		r.ServeHTTP(res, req)
		return res
	}
	r := gin.New()
	router.SetApiRouter(r)
	require.Equal(t, 200, request(r, "GET", "/api/status", "").Code)
	require.Equal(t, 200, request(r, "GET", "/api/status", "http://example.com").Code)
	require.Equal(t, 403, request(r, "GET", "/api/status", "https://untrusted.example").Code)
	require.Equal(t, 403, request(r, "GET", "/api/status", "http://example.com:444").Code)
	viper.Set("gouo_allowed_origins", "https://app.example.com")
	r = gin.New()
	router.SetApiRouter(r)
	res := request(r, "OPTIONS", "/api/user/self", "https://app.example.com")
	require.Equal(t, 204, res.Code)
	require.Equal(t, "https://app.example.com", res.Header().Get("Access-Control-Allow-Origin"))
	require.Equal(t, "true", res.Header().Get("Access-Control-Allow-Credentials"))
	require.Contains(t, res.Header().Get("Access-Control-Allow-Methods"), "PUT")
	res = request(r, "GET", "/api/status", "https://app.example.com")
	require.Equal(t, 200, res.Code)
	require.Equal(t, "https://app.example.com", res.Header().Get("Access-Control-Allow-Origin"))
	require.Equal(t, 403, request(r, "POST", "/api/user/logout", "https://app.example.com.evil.invalid").Code)
	res = request(r, "OPTIONS", "/v1/chat/completions", "https://app.example.com")
	require.Equal(t, "true", res.Header().Get("Access-Control-Allow-Credentials"))
	res = request(r, "OPTIONS", "/v1/chat/completions", "https://api-client.example")
	require.Equal(t, 204, res.Code)
	require.Equal(t, "*", res.Header().Get("Access-Control-Allow-Origin"))
	require.Empty(t, res.Header().Get("Access-Control-Allow-Credentials"))
}

func TestAccountCORSRejectsCrossSiteRequestsWithoutOrigin(t *testing.T) {
	preserveBrowserConfig(t)
	viper.Set("gouo_allowed_origins", "https://app.example.com")
	viper.Set("session_cookie_secure", true)
	viper.Set("session_cookie_same_site", "none")
	r := gin.New()
	r.Use(middleware.CORS())
	r.Any("/*path", func(c *gin.Context) { c.Status(http.StatusOK) })
	for _, test := range []struct {
		name, method, path, origin, fetchSite string
		cookie                                bool
		status                                int
	}{
		{"cross-site image logout", "GET", "/api/user/logout", "", "cross-site", true, 403},
		{"unknown session client", "GET", "/api/user/logout", "", "", true, 403},
		{"untrusted sibling origin", "GET", "/api/user/logout", "", "same-site", true, 403},
		{"same-origin request", "GET", "/api/user/self", "", "same-origin", true, 200},
		{"allowed cross-site fetch", "PUT", "/api/user/self", "https://app.example.com", "cross-site", true, 200},
		{"anonymous healthcheck", "GET", "/api/status", "", "", false, 200},
		{"public bearer relay", "POST", "/v1/chat/completions", "", "cross-site", false, 200},
		{"github callback", "GET", "/api/oauth/github?state=example", "", "cross-site", true, 200},
		{"lark callback", "GET", "/api/oauth/lark?state=example", "", "cross-site", true, 200},
		{"oidc callback", "GET", "/api/oauth/oidc?state=example", "", "cross-site", true, 200},
		{"callback cannot allow other methods", "POST", "/api/oauth/github", "", "cross-site", true, 403},
		{"state creation is not callback", "GET", "/api/oauth/state", "", "cross-site", true, 403},
	} {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest(test.method, test.path, nil)
			req.Header.Set("Origin", test.origin)
			req.Header.Set("Sec-Fetch-Site", test.fetchSite)
			if test.cookie {
				req.AddCookie(&http.Cookie{Name: "session", Value: "test-session"})
			}
			res := httptest.NewRecorder()
			r.ServeHTTP(res, req)
			require.Equal(t, test.status, res.Code)
		})
	}
	// 默认 Strict 保持无 Fetch Metadata 客户端兼容，但也拦截明确的跨站请求。
	viper.Set("session_cookie_same_site", "strict")
	r = gin.New()
	r.Use(middleware.CORS())
	r.GET("/api/user/logout", func(c *gin.Context) { c.Status(http.StatusOK) })
	for _, fetchSite := range []string{"", "cross-site"} {
		req := httptest.NewRequest("GET", "/api/user/logout", nil)
		req.AddCookie(&http.Cookie{Name: "session", Value: "test-session"})
		req.Header.Set("Sec-Fetch-Site", fetchSite)
		res := httptest.NewRecorder()
		r.ServeHTTP(res, req)
		if fetchSite == "" {
			require.Equal(t, 200, res.Code)
		} else {
			require.Equal(t, 403, res.Code)
		}
	}
}

func TestAccountCORSPreservesProxyOriginPorts(t *testing.T) {
	preserveBrowserConfig(t)
	r := gin.New()
	r.Use(middleware.CORS())
	r.POST("/api/user/login", func(c *gin.Context) { c.Status(http.StatusOK) })
	for _, test := range []struct {
		host, origin, forwardedProto string
		status                       int
	}{
		{"127.0.0.1:5173", "http://127.0.0.1:5173", "", 200},
		{"localhost:8080", "http://localhost:8080", "http", 200},
		{"app.example.com:8443", "https://app.example.com:8443", "https", 200},
		{"localhost:8080", "http://localhost:8081", "http", 403},
		{"localhost:8080", "https://untrusted.example", "http", 403},
	} {
		req := httptest.NewRequest(http.MethodPost, "http://"+test.host+"/api/user/login", nil)
		req.Header.Set("Origin", test.origin)
		req.Header.Set("X-Forwarded-Proto", test.forwardedProto)
		res := httptest.NewRecorder()
		r.ServeHTTP(res, req)
		require.Equal(t, test.status, res.Code, test.origin)
	}
}
