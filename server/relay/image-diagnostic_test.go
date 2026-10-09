package relay

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"

	"one-api/types"
)

func TestImageUnknownDiagnosticPreservesOnlySafeClassifications(t *testing.T) {
	for _, test := range []struct {
		name, code, param, reason, stage string
		status                           int
	}{
		{"transport", "http_request_failed", "", "transport_failure", "request", 500},
		{"decode", "decode_response_failed", "image_sse_invalid", "image_sse_invalid", "response_decode", 500},
		{"read", "read_response_body_failed", "", "body_read_failure", "response_read", 500},
		{"network timeout", "http_request_failed", "network_timeout", "network_timeout", "request", 500},
		{"http timeout", "gateway_timeout", "", "upstream_timeout", "upstream_response", 504},
		{"cloud timeout", "sk-private-code", "Authorization: Bearer private", "upstream_timeout", "upstream_response", 524},
	} {
		t.Run(test.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", nil)
			err := &types.OpenAIErrorWithStatusCode{StatusCode: test.status, OpenAIError: types.OpenAIError{
				Code: test.code, Param: test.param, Message: "https://upstream.invalid/?key=private prompt=private base64=private", Type: "sk-private-type", InnerError: "private-inner-error",
			}}
			diagnostic := imageUnknownDiagnostic(c, err)
			require.Contains(t, diagnostic, "stage="+test.stage)
			require.Contains(t, diagnostic, "reason="+test.reason)
			for _, secret := range []string{"private", "upstream.invalid", "Authorization", "prompt=", "base64="} {
				require.NotContains(t, diagnostic, secret)
			}
		})
	}
	for _, timeout := range []bool{false, true} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		ctx, cancel := context.WithCancel(context.Background())
		if timeout {
			cancel()
			ctx, cancel = context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
		}
		cancel()
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", nil).WithContext(ctx)
		err := &types.OpenAIErrorWithStatusCode{StatusCode: 500, OpenAIError: types.OpenAIError{Code: "http_request_failed"}}
		diagnostic := imageUnknownDiagnostic(c, err)
		if timeout {
			require.Contains(t, diagnostic, "reason=request_deadline_exceeded")
		} else {
			require.Contains(t, diagnostic, "reason=request_canceled")
		}
	}
}
