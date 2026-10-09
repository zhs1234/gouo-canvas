package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"one-api/common/config"
)

func TestGouoCloudRateLimitDoesNotBlockForeground(t *testing.T) {
	previous := config.RedisEnabled
	config.RedisEnabled = false
	defer func() { config.RedisEnabled = previous }()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(GlobalAPIRateLimit())
	for _, path := range []string{"/api/gouo/sync", "/api/gouo/assets/:id/content", "/api/gouo/models", "/api/user/self", "/api/user/topup"} {
		router.GET(path, func(c *gin.Context) { c.Status(http.StatusOK) })
	}
	request := func(path string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.RemoteAddr = "192.0.2.207:1234"
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w
	}
	for i := 0; i < GlobalApiRateLimitNum; i++ {
		if w := request("/api/gouo/sync"); w.Code != http.StatusOK {
			t.Fatalf("sync %d: %d", i, w.Code)
		}
	}
	if w := request("/api/gouo/assets/fixture/content"); w.Code != http.StatusTooManyRequests || w.Header().Get("Retry-After") != "180" {
		t.Fatalf("cloud limit: %d, retry after %s", w.Code, w.Header().Get("Retry-After"))
	}
	for _, path := range []string{"/api/gouo/models", "/api/user/self", "/api/user/topup"} {
		if w := request(path); w.Code != http.StatusOK {
			t.Fatalf("foreground %s: %d", path, w.Code)
		}
	}
}
