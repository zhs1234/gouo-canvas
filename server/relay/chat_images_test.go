package relay

import (
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestChatRequestLimitsRemoteImages(t *testing.T) {
	gin.SetMode(gin.TestMode)
	request := func(count int) error {
		parts := []string{`{"type":"text","text":"看图"}`}
		for i := 0; i < count; i++ {
			parts = append(parts, fmt.Sprintf(`{"type":"image_url","image_url":{"url":"https://example.com/%d.png"}}`, i))
		}
		// data URL 不需要后端下载，不计入
		parts = append(parts, `{"type":"image_url","image_url":{"url":"data:image/png;base64,iVBORw0KGgo="}}`)
		body := `{"model":"claude-test","messages":[{"role":"user","content":[` + strings.Join(parts, ",") + `]}]}`
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		return NewRelayChat(c).setRequest()
	}
	require.NoError(t, request(maxRemoteImagesPerRequest))
	require.ErrorContains(t, request(maxRemoteImagesPerRequest+1), "too many remote images")
}
