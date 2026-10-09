package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"

	"one-api/middleware"
)

func TestGouoAccountMatch(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/gouo/storage", func(c *gin.Context) { c.Set("id", 2) }, middleware.GouoAccountMatch(), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"success": true})
	})
	request := func(user string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/api/gouo/storage", nil)
		if user != "" {
			req.Header.Set("X-Gouo-User", user)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}

	require.Equal(t, http.StatusOK, request("").Code)
	require.Equal(t, http.StatusOK, request("2").Code)
	// 页面仍是 1 号账号的本地空间，会话已变成 2 号账号
	w := request("1")
	require.Equal(t, http.StatusConflict, w.Code)
	require.Contains(t, w.Body.String(), "account_mismatch")
}
