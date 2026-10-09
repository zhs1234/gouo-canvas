package relay

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"net/http/httptest"
	"one-api/model"
	"one-api/types"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestGouoImageRequestQuoteAndCapabilities(t *testing.T) {
	old := model.PricingInstance
	model.PricingInstance = &model.Pricing{Prices: map[string]*model.Price{"image-a": {Model: "image-a", GouoEnabled: true, GouoPriceCNY: 0.2, GouoMaxOutputs: 2}}}
	t.Cleanup(func() { model.PricingInstance = old })
	entry, err := model.PricingInstance.GetGouoModel("image-a")
	require.NoError(t, err)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/images/generations", nil)
	c.Set("token_name", "sys_playground")
	r := NewRelayImageGenerations(c)
	r.request = types.ImageRequest{Model: "image-a", N: 2}
	r.setOriginalModel("image-a")
	errQuote := prepareGouoImage(c, r)
	require.NotNil(t, errQuote)
	require.Equal(t, 409, errQuote.StatusCode)
	c.Request.Header.Set("X-Gouo-Price-Version", entry.PriceVersion)
	require.Nil(t, prepareGouoImage(c, r))
	c.Request.Header.Set("X-Gouo-Request-Id", "request/invalid")
	errQuote = prepareGouoImage(c, r)
	require.NotNil(t, errQuote)
	require.Equal(t, "invalid_image_request_id", errQuote.Code)
	c.Request.Header.Set("X-Gouo-Request-Id", "task-request_1")
	require.Nil(t, prepareGouoImage(c, r))
	for _, id := range []string{"agent:7c2d0d72-25c5-4e3e-8401-625c36d42b94:call_1", "7c2d0d72-25c5-4e3e-8401-625c36d42b94:0", "agent:7c2d0d72-25c5-4e3e-8401-625c36d42b94:" + strings.Repeat("c", 200), strings.Repeat("r", 512)} {
		c.Request.Header.Set("X-Gouo-Request-Id", id)
		require.Nil(t, prepareGouoImage(c, r), id)
	}
	c.Request.Header.Set("X-Gouo-Request-Id", strings.Repeat("r", 513))
	require.Equal(t, "invalid_image_request_id", prepareGouoImage(c, r).Code)
	c.Request.Header.Set("X-Gouo-Request-Id", "task-request_1")
	r.request.N = 3
	require.NotNil(t, prepareGouoImage(c, r))
	r.request.Model = "image-a#option"
	r.request.N = 1
	require.NotNil(t, prepareGouoImage(c, r))
	edit := NewRelayImageEdits(c)
	edit.setOriginalModel("image-a")
	require.NotNil(t, prepareGouoImage(c, edit))

	// 其他入口不经过光构结算，按通用计费会免费放行，必须拒绝；普通模型不受影响
	for _, path := range []string{"/recraftAI/v1/images/generations", "/v1/chat/completions", "/v1/responses"} {
		other, _ := gin.CreateTestContext(httptest.NewRecorder())
		other.Request = httptest.NewRequest("POST", path, nil)
		relay := NewRelayImageGenerations(other)
		relay.setOriginalModel("image-a")
		errEndpoint := prepareGouoImage(other, relay)
		require.NotNil(t, errEndpoint, path)
		require.Equal(t, "image_model_endpoint", errEndpoint.Code)
		relay.setOriginalModel("gpt-4o")
		require.Nil(t, prepareGouoImage(other, relay), path)
	}
}

func TestImageResponsePayloadValidation(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	var pngData, jpegData, gifData bytes.Buffer
	require.NoError(t, png.Encode(&pngData, img))
	require.NoError(t, jpeg.Encode(&jpegData, img, nil))
	require.NoError(t, gif.Encode(&gifData, img, nil))
	largeHeader := append([]byte(nil), pngData.Bytes()[:33]...)
	binary.BigEndian.PutUint32(largeHeader[16:20], 100000)
	binary.BigEndian.PutUint32(largeHeader[20:24], 100000)
	binary.BigEndian.PutUint32(largeHeader[29:33], crc32.ChecksumIEEE(largeHeader[12:29]))
	_, _, err := image.DecodeConfig(bytes.NewReader(largeHeader))
	require.NoError(t, err)
	for _, tc := range []struct {
		name  string
		item  types.ImageResponseDataInner
		valid bool
	}{
		{name: "png", item: types.ImageResponseDataInner{B64JSON: base64.StdEncoding.EncodeToString(pngData.Bytes())}, valid: true},
		{name: "jpeg", item: types.ImageResponseDataInner{B64JSON: base64.StdEncoding.EncodeToString(jpegData.Bytes())}, valid: true},
		{name: "gif", item: types.ImageResponseDataInner{B64JSON: base64.StdEncoding.EncodeToString(gifData.Bytes())}, valid: true},
		{name: "webp", item: types.ImageResponseDataInner{B64JSON: "UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAdQiirUo/+BiOh/AAA="}, valid: true},
		{name: "raw-base64", item: types.ImageResponseDataInner{B64JSON: base64.RawStdEncoding.EncodeToString(pngData.Bytes())}, valid: true},
		{name: "b64-data-url", item: types.ImageResponseDataInner{B64JSON: "data:image/png;base64," + base64.StdEncoding.EncodeToString(pngData.Bytes())}, valid: true},
		{name: "url-data-url", item: types.ImageResponseDataInner{URL: "data:image/png;base64," + base64.StdEncoding.EncodeToString(pngData.Bytes())}, valid: true},
		{name: "text", item: types.ImageResponseDataInner{B64JSON: base64.StdEncoding.EncodeToString([]byte("not an image"))}},
		{name: "truncated", item: types.ImageResponseDataInner{B64JSON: base64.StdEncoding.EncodeToString(pngData.Bytes()[:33])}},
		{name: "oversized-dimensions", item: types.ImageResponseDataInner{B64JSON: base64.StdEncoding.EncodeToString(largeHeader)}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			res := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(res)
			err := responseImageClient(c, &types.ImageResponse{Data: []types.ImageResponseDataInner{tc.item}}, &types.Usage{})
			if tc.valid {
				require.Nil(t, err)
				require.Equal(t, 200, res.Code)
				return
			}
			require.NotNil(t, err)
			require.Equal(t, "invalid_image_response", err.Code)
			require.False(t, c.Writer.Written())
		})
	}
}
