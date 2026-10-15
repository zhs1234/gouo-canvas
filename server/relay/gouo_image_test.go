package relay

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/gouo_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCheckGouoImageParams(t *testing.T) {
	cases := []struct {
		size, moderation string
		ok               bool
	}{
		{"1024x1024", "", true},
		{"auto", "auto", true},
		{"3840x2160", "", true},
		{"4096x4096", "", false}, // 超过 4K
		{"1024x", "", false},
		{"1024x1024", "low", false}, // 未开放宽松审核
	}
	for _, tc := range cases {
		message := checkGouoImageParams(tc.size, tc.moderation)
		assert.Equal(t, tc.ok, message == "", "%+v: %s", tc, message)
	}
}

func TestValidGouoImages(t *testing.T) {
	var buf bytes.Buffer
	require.NoError(t, png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 2, 2))))
	encoded := base64.StdEncoding.EncodeToString(buf.Bytes())
	assert.True(t, validGouoImages([]dto.ImageData{{B64Json: encoded}, {Url: "https://example.com/a.png"}, {Url: "data:image/png;base64," + encoded}}))
	for _, bad := range [][]dto.ImageData{
		nil,
		{{B64Json: "   "}},
		{{B64Json: "bm90IGFuIGltYWdl"}},
		{{Url: "ftp://example.com/a.png"}},
		{{Url: "data:image/png;base64,"}},
		{{RevisedPrompt: "only prompt"}},
	} {
		assert.False(t, validGouoImages(bad), "%+v", bad)
	}
}

func TestNormalizeGouoNativeImageResponse(t *testing.T) {
	var buf bytes.Buffer
	require.NoError(t, png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 2, 2))))
	encoded := base64.StdEncoding.EncodeToString(buf.Bytes())
	for _, data := range []any{
		map[string]any{"b64_json": encoded},
		[]map[string]any{{"url": "https://example.com/image.png"}, {"b64_json": encoded}, {"revised_prompt": "only description"}},
	} {
		payload, err := common.Marshal(map[string]any{"data": data, "usage": map[string]any{"input_tokens": 200}})
		require.NoError(t, err)
		normalized, images, err := normalizeGouoImageResponse(payload)
		require.NoError(t, err)
		require.Len(t, images, 1)
		assert.Equal(t, encoded, images[0].B64Json)
		var response dto.ImageResponse
		require.NoError(t, common.Unmarshal(normalized, &response))
		require.Len(t, response.Data, 1)
		assert.Contains(t, string(normalized), `"input_tokens":200`)
	}
}

// 光构规则只约束光构客户端：Agent 走原生 Playground 带 X-Gouo-Agent 或用平台令牌时受 Agent 开关约束，其他调用按原生行为处理
func TestCheckGouoAgentRequest(t *testing.T) {
	enabled := gouo_setting.Get().AgentEnabled
	t.Cleanup(func() { gouo_setting.Get().AgentEnabled = enabled })

	cases := []struct {
		name         string
		path         string
		agentHeader  bool
		tokenName    string
		relayMode    int
		agentEnabled bool
		wantCode     int
	}{
		{name: "gouo agent on playground is allowed when agent enabled", path: "/pg/chat/completions", agentHeader: true, agentEnabled: true},
		{name: "gouo agent on playground blocked when agent disabled", path: "/pg/chat/completions", agentHeader: true, wantCode: http.StatusForbidden},
		{name: "admin playground test without header is untouched", path: "/pg/chat/completions"},
		{name: "platform token chat blocked when agent disabled", path: "/v1/chat/completions", tokenName: GouoPlaygroundTokenName, wantCode: http.StatusForbidden},
		{name: "ordinary api token chat is untouched", path: "/v1/chat/completions", tokenName: "my-key"},
		{name: "ordinary api token image request is untouched", path: "/v1/images/generations", tokenName: "my-key", relayMode: relayconstant.RelayModeImagesGenerations},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gouo_setting.Get().AgentEnabled = tc.agentEnabled
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, tc.path, nil)
			if tc.agentHeader {
				c.Request.Header.Set("X-Gouo-Agent", "1")
			}
			c.Set("token_name", tc.tokenName)
			mode := tc.relayMode
			if mode == 0 {
				mode = relayconstant.RelayModeChatCompletions
			}
			info := &relaycommon.RelayInfo{OriginModelName: "gpt-agent", RelayMode: mode, Request: &dto.GeneralOpenAIRequest{Model: "gpt-agent"}}

			apiErr := CheckGouoRequest(c, info)
			if tc.wantCode != 0 {
				require.NotNil(t, apiErr)
				assert.Equal(t, tc.wantCode, apiErr.StatusCode)
				return
			}
			assert.Nil(t, apiErr)
		})
	}
}
