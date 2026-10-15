package relay

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/png"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCheckGouoImageParams(t *testing.T) {
	entry := &model.GouoImageModel{Sizes: []string{"1K"}, Qualities: []string{"low", "medium"}, MaxInputs: 2}
	cases := []struct {
		size, quality, moderation string
		inputs                    int
		ok                        bool
	}{
		{"1024x1024", "low", "", 0, true},
		{"auto", "medium", "auto", 2, true},
		{"2048x2048", "low", "", 0, false}, // 2K 未开放
		{"1024x", "low", "", 0, false},
		{"1024x1024", "", "", 0, false}, // 自动画质可能选到未开放的高画质
		{"1024x1024", "high", "", 0, false},
		{"1024x1024", "low", "low", 0, false}, // 未开放宽松审核
		{"1024x1024", "low", "", 3, false},
	}
	for _, tc := range cases {
		message := checkGouoImageParams(entry, tc.size, tc.quality, tc.moderation, tc.inputs)
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
