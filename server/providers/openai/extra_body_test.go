package openai

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"one-api/common/config"
	"one-api/common/requester"
	"one-api/model"
	"one-api/types"
)

func TestGouoImageRequestIgnoresRawExtraBody(t *testing.T) {
	// JSON 键名不区分大小写、重复键取最后一个：解析后 size 为空、moderation 为空，原始请求体里却是 4K 和 low
	raw := `{"model":"image-a","prompt":"p","size":"3840x2160","Size":"","moderation":"low","Moderation":null,"seed":7}`
	body := func(gouoImage bool) map[string]any {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", strings.NewReader(raw))
		c.Set(config.GinRequestBodyKey, []byte(raw))
		if gouoImage {
			c.Set("gouo_image_model", true)
		}
		proxy := ""
		p := CreateOpenAIProvider(&model.Channel{Type: config.ChannelTypeOpenAI, Proxy: &proxy, Key: "k", AllowExtraBody: true}, "http://127.0.0.1")
		p.SetContext(c)
		req, err := p.GetRequestTextBody(config.RelayModeImagesGenerations, "image-a", &types.ImageRequest{Model: "image-a", Prompt: "p"})
		require.Nil(t, err)
		data, readErr := io.ReadAll(req.Body)
		require.NoError(t, readErr)
		var sent map[string]any
		require.NoError(t, json.Unmarshal(data, &sent))
		return sent
	}
	// 普通渠道请求照常透传额外字段
	require.Equal(t, "3840x2160", body(false)["size"])
	sent := body(true)
	require.NotContains(t, sent, "size")
	require.NotContains(t, sent, "moderation")
	require.NotContains(t, sent, "seed")
	require.Equal(t, "image-a", sent["model"])
}

func TestGouoImageUpstreamRequestHonorsDeadline(t *testing.T) {
	release := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(func() {
		close(release)
		upstream.Close()
	})
	oldClient := requester.HTTPClient
	requester.HTTPClient = upstream.Client()
	t.Cleanup(func() { requester.HTTPClient = oldClient })
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", strings.NewReader(`{"model":"image-a","prompt":"p"}`))
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	c.Set(config.GinGouoUpstreamContextKey, ctx)
	proxy := ""
	p := CreateOpenAIProvider(&model.Channel{Type: config.ChannelTypeOpenAI, Proxy: &proxy, Key: "k"}, upstream.URL)
	p.SetContext(c)
	start := time.Now()
	_, err := p.CreateImageGenerations(&types.ImageRequest{Model: "image-a", Prompt: "p", N: 1})
	// 上游卡住时按截止时间中止，不能一直占着请求、等退款后再白付上游费用
	require.NotNil(t, err)
	require.Less(t, time.Since(start), 5*time.Second)
}
