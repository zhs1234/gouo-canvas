package middleware_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"

	"one-api/common/config"
	"one-api/middleware"
)

type turnstileTransport func(*http.Request) (*http.Response, error)

func (f turnstileTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestTurnstileProtectedAccountRequests(t *testing.T) {
	oldEnabled, oldSecret, oldClient := config.TurnstileCheckEnabled, config.TurnstileSecretKey, http.DefaultClient
	t.Cleanup(func() {
		config.TurnstileCheckEnabled, config.TurnstileSecretKey, http.DefaultClient = oldEnabled, oldSecret, oldClient
	})
	config.TurnstileCheckEnabled, config.TurnstileSecretKey = true, "local-test-secret"
	verified := 0
	http.DefaultClient = &http.Client{Transport: turnstileTransport(func(req *http.Request) (*http.Response, error) {
		verified++
		require.Equal(t, "https://challenges.cloudflare.com/turnstile/v0/siteverify", req.URL.String())
		require.NoError(t, req.ParseForm())
		require.Equal(t, "local-test-secret", req.Form.Get("secret"))
		result := `{"success":false}`
		if req.Form.Get("response") == "local-test-token" {
			result = `{"success":true}`
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(result)), Header: make(http.Header)}, nil
	})}
	r := gin.New()
	r.Use(sessions.Sessions("turnstile-test", cookie.NewStore([]byte("local-test-cookie-key"))))
	accepted := 0
	for _, path := range []string{"/register", "/verification", "/reset_password"} {
		r.GET(path, middleware.TurnstileCheck(), func(c *gin.Context) { accepted++; c.JSON(200, gin.H{"success": true}) })
		for _, token := range []string{"", "invalid", "local-test-token"} {
			res := httptest.NewRecorder()
			r.ServeHTTP(res, httptest.NewRequest("GET", path+"?turnstile="+token, nil))
			if token == "local-test-token" {
				require.Contains(t, res.Body.String(), `"success":true`)
			} else {
				require.Contains(t, res.Body.String(), `"success":false`)
			}
		}
	}
	require.Equal(t, 3, accepted)
	require.Equal(t, 6, verified)
}
