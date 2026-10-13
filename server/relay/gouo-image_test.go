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
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"one-api/common/config"
	"one-api/common/logger"
	"one-api/model"
	"one-api/providers/claude"
	"one-api/providers/gemini"
	"one-api/safty"
	"one-api/types"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestGouoPlatformTokenFollowsAdminSettings(t *testing.T) {
	old, oldMax, oldAgent := model.PricingInstance, config.GouoMaxImagesPerTask, config.GouoAgentEnabled
	model.PricingInstance = &model.Pricing{Prices: map[string]*model.Price{"image-a": {Model: "image-a", GouoEnabled: true, GouoPriceCNY: 0.2, GouoMaxOutputs: 4}}}
	config.GouoMaxImagesPerTask, config.GouoAgentEnabled = 2, false
	t.Cleanup(func() {
		model.PricingInstance, config.GouoMaxImagesPerTask, config.GouoAgentEnabled = old, oldMax, oldAgent
	})
	entry, err := model.PricingInstance.GetGouoModel("image-a")
	require.NoError(t, err)
	image := func(tokenName string, n int, index string) *types.OpenAIErrorWithStatusCode {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("POST", "/v1/images/generations", nil)
		c.Request.Header.Set("X-Gouo-Price-Version", entry.PriceVersion)
		c.Request.Header.Set("X-Gouo-Request-Index", index)
		c.Set("token_name", tokenName)
		r := NewRelayImageGenerations(c)
		r.request = types.ImageRequest{Model: "image-a", N: n}
		r.setOriginalModel("image-a")
		return prepareGouoImage(c, r)
	}
	// 客户端按作品拆成多次请求，单次数量和作品内序号都不能超过后台设置；普通 API 用户只受模型上限约束
	require.Nil(t, image("sys_playground", 2, ""))
	require.Equal(t, "image_task_limit", image("sys_playground", 3, "").Code)
	require.Nil(t, image("sys_playground", 1, "1"))
	require.Equal(t, "image_task_limit", image("sys_playground", 1, "2").Code)
	require.Nil(t, image("api-user", 4, "3"))

	chat := func(tokenName string) *types.OpenAIErrorWithStatusCode {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
		c.Set("token_name", tokenName)
		r := NewRelayImageGenerations(c)
		r.setOriginalModel("gpt-4o")
		return prepareGouoImage(c, r)
	}
	require.Equal(t, "agent_disabled", chat("sys_playground").Code)
	require.Nil(t, chat("api-user"))
	config.GouoAgentEnabled = true
	require.Nil(t, chat("sys_playground"))
}

func TestGouoImagePromptSafetyCheck(t *testing.T) {
	old, oldSafe, oldTool, oldWords, oldLogger := model.PricingInstance, config.EnableSafe, config.SafeToolName, config.SafeKeyWords, logger.Logger
	logger.Logger = zap.NewNop()
	model.PricingInstance = &model.Pricing{Prices: map[string]*model.Price{"image-a": {Model: "image-a", GouoEnabled: true, GouoPriceCNY: 0.2, GouoMaxOutputs: 1}}}
	t.Cleanup(func() {
		model.PricingInstance, config.EnableSafe, config.SafeToolName, config.SafeKeyWords, logger.Logger = old, oldSafe, oldTool, oldWords, oldLogger
	})
	require.NoError(t, safty.InitSaftyTools())
	// 后台保存时末尾的空行不能把所有请求都判为违规
	config.EnableSafe, config.SafeToolName, config.SafeKeyWords = true, "Keyword", []string{"违禁词", ""}
	entry, err := model.PricingInstance.GetGouoModel("image-a")
	require.NoError(t, err)
	check := func(prompt string) *types.OpenAIErrorWithStatusCode {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("POST", "/v1/images/generations", nil)
		c.Request.Header.Set("X-Gouo-Price-Version", entry.PriceVersion)
		r := NewRelayImageGenerations(c)
		r.request = types.ImageRequest{Model: "image-a", Prompt: prompt, N: 1}
		r.setOriginalModel("image-a")
		return prepareGouoImage(c, r)
	}
	require.NotNil(t, check("画一张含违禁词的海报"))
	require.Nil(t, check("画一只红色苹果"))
	config.EnableSafe = false
	require.Nil(t, check("画一张含违禁词的海报"))
}

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

	// 表单里重复的单值字段（如两个 n）会让校验与上游看到的值不同，必须拒绝
	for _, fields := range [][2]string{{"n", "1"}, {"model", "image-a"}} {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		require.NoError(t, writer.WriteField("model", "image-a"))
		require.NoError(t, writer.WriteField("prompt", "改色"))
		require.NoError(t, writer.WriteField("n", "1"))
		require.NoError(t, writer.WriteField(fields[0], fields[1]))
		require.NoError(t, writer.Close())
		dup, _ := gin.CreateTestContext(httptest.NewRecorder())
		dup.Request = httptest.NewRequest("POST", "/v1/images/edits", &body)
		dup.Request.Header.Set("Content-Type", writer.FormDataContentType())
		require.NoError(t, dup.Request.ParseMultipartForm(1<<20))
		dupEdit := NewRelayImageEdits(dup)
		dupEdit.request.N = 1
		dupEdit.setOriginalModel("image-a")
		errDup := prepareGouoImage(dup, dupEdit)
		require.NotNil(t, errDup, fields[0])
		require.Equal(t, "duplicate_form_field", errDup.Code)
	}

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

func TestGouoImageParamLimits(t *testing.T) {
	oldLow := config.GouoAllowLowModeration
	t.Cleanup(func() { config.GouoAllowLowModeration = oldLow })
	config.GouoAllowLowModeration = false
	open := &model.GouoImageModel{}
	limited := &model.GouoImageModel{MaxSize: "1K", Qualities: []string{"low", "medium"}, MaxInputs: 2}
	// 不限时任何尺寸、画质、参考图张数都放行
	require.Empty(t, checkGouoImageParams(open, "3840x2160", "high", "", 16))
	// 尺寸按档位的像素上限比较，auto 放行
	require.Empty(t, checkGouoImageParams(limited, "1024x1536", "low", "", 0))
	require.Empty(t, checkGouoImageParams(limited, "auto", "low", "", 0))
	require.Contains(t, checkGouoImageParams(limited, "2048x2048", "low", "", 0), "最大支持 1K")
	require.Equal(t, "图片尺寸无效", checkGouoImageParams(limited, "big", "low", "", 0))
	// 只开放部分画质时，自动画质可能被上游选成高画质，不放行
	require.Contains(t, checkGouoImageParams(limited, "auto", "high", "", 0), "不开放所选画质")
	require.Contains(t, checkGouoImageParams(limited, "auto", "auto", "", 0), "不开放自动画质")
	require.Contains(t, checkGouoImageParams(limited, "auto", "", "", 0), "不开放自动画质")
	require.Empty(t, checkGouoImageParams(&model.GouoImageModel{Qualities: []string{"high"}}, "auto", "auto", "", 0))
	require.Contains(t, checkGouoImageParams(limited, "auto", "low", "", 3), "最多使用 2 张参考图")
	// 宽松审核默认不开放，开放后放行
	require.Equal(t, "运营方未开放宽松审核", checkGouoImageParams(open, "auto", "", "low", 0))
	config.GouoAllowLowModeration = true
	require.Empty(t, checkGouoImageParams(open, "auto", "", "low", 0))
}

func TestGouoImageParamLimitsInRequest(t *testing.T) {
	old := model.PricingInstance
	model.PricingInstance = &model.Pricing{Prices: map[string]*model.Price{
		"image-a": {Model: "image-a", GouoEnabled: true, GouoPriceCNY: 0.2, GouoMaxOutputs: 1, GouoMaxSize: "1K", GouoQualities: "low,medium"},
		"image-b": {Model: "image-b", GouoEnabled: true, GouoPriceCNY: 0.2, GouoMaxOutputs: 1},
	}}
	t.Cleanup(func() { model.PricingInstance = old })
	limitedEntry, err := model.PricingInstance.GetGouoModel("image-a")
	require.NoError(t, err)
	require.Equal(t, []string{"low", "medium"}, limitedEntry.Qualities)
	openEntry, err := model.PricingInstance.GetGouoModel("image-b")
	require.NoError(t, err)
	// 不限时目录里不出现限制字段，原有模型的价格版本保持不变
	require.Empty(t, openEntry.MaxSize)
	require.NotEqual(t, limitedEntry.PriceVersion, openEntry.PriceVersion)
	generate := func(size, quality string) *types.OpenAIErrorWithStatusCode {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("POST", "/v1/images/generations", nil)
		c.Request.Header.Set("X-Gouo-Price-Version", limitedEntry.PriceVersion)
		r := NewRelayImageGenerations(c)
		r.request = types.ImageRequest{Model: "image-a", N: 1, Size: size, Quality: quality}
		r.setOriginalModel("image-a")
		return prepareGouoImage(c, r)
	}
	require.Nil(t, generate("1024x1024", "medium"))
	require.Equal(t, "image_param_unavailable", generate("2048x2048", "medium").Code)
	require.Equal(t, "image_param_unavailable", generate("1024x1024", "high").Code)
}

func TestGouoAgentMaxTokensForPlatformToken(t *testing.T) {
	old := model.PricingInstance
	model.PricingInstance = &model.Pricing{Prices: map[string]*model.Price{"chat-a": {Model: "chat-a", Type: model.TokensPriceType, GouoMaxTokens: 2000}}}
	t.Cleanup(func() { model.PricingInstance = old })
	chat := func(tokenName string, maxCompletion, maxTokens int) types.ChatCompletionRequest {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
		c.Set("token_name", tokenName)
		r := NewRelayChat(c)
		r.chatRequest = types.ChatCompletionRequest{Model: "chat-a", MaxCompletionTokens: maxCompletion, MaxTokens: maxTokens}
		r.setOriginalModel("chat-a")
		require.Nil(t, prepareGouoImage(c, r))
		return r.chatRequest
	}
	// 平台令牌：未设置或超过上限时按上限截断，更小的值保留
	require.Equal(t, 2000, chat("sys_playground", 0, 0).MaxCompletionTokens)
	require.Equal(t, 2000, chat("sys_playground", 50000, 0).MaxCompletionTokens)
	require.Equal(t, 500, chat("sys_playground", 500, 0).MaxCompletionTokens)
	require.Equal(t, 2000, chat("sys_playground", 0, 9000).MaxTokens)
	for _, limits := range [][2]int{{0, 0}, {50000, 9000}, {500, 0}, {500, 100}, {0, 100}} {
		req := chat("sys_playground", limits[0], limits[1])
		want := req.MaxCompletionTokens
		if req.MaxTokens > 0 {
			want = min(want, req.MaxTokens)
		}
		claudeReq, err := claude.ConvertFromChatOpenai(&req)
		require.Nil(t, err)
		require.Equal(t, want, claudeReq.MaxTokens)
		geminiReq, err := gemini.ConvertFromChatOpenai(&req)
		require.Nil(t, err)
		require.Equal(t, want, geminiReq.GenerationConfig.MaxOutputTokens)
	}
	// 普通 API 令牌不受影响
	require.Equal(t, 0, chat("api-user", 0, 0).MaxCompletionTokens)
}

func TestGouoImageEditFormChecks(t *testing.T) {
	old := model.PricingInstance
	model.PricingInstance = &model.Pricing{Prices: map[string]*model.Price{
		"image-a": {Model: "image-a", GouoEnabled: true, GouoPriceCNY: 0.2, GouoMaxOutputs: 1, GouoReference: true, GouoMaxInputs: 2},
	}}
	t.Cleanup(func() { model.PricingInstance = old })
	edit := func(files ...string) *types.OpenAIErrorWithStatusCode {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		require.NoError(t, writer.WriteField("model", "image-a"))
		require.NoError(t, writer.WriteField("prompt", "改色"))
		for _, name := range files {
			part, err := writer.CreateFormFile(name, "a.png")
			require.NoError(t, err)
			_, err = part.Write([]byte("png"))
			require.NoError(t, err)
		}
		require.NoError(t, writer.Close())
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("POST", "/v1/images/edits", &body)
		c.Request.Header.Set("Content-Type", writer.FormDataContentType())
		require.NoError(t, c.Request.ParseMultipartForm(1<<20))
		r := NewRelayImageEdits(c)
		r.request.N = 1
		r.setOriginalModel("image-a")
		return prepareGouoImage(c, r)
	}
	require.Nil(t, edit("image", "image"))
	require.Nil(t, edit("image[]", "image[]"))
	// 同名 image 重复时结构体只绑定第一个，但全部会转发给上游，按实际文件数核对参考图上限
	require.Equal(t, "image_param_unavailable", edit("image", "image", "image").Code)
	require.Equal(t, "image_param_unavailable", edit("image", "image[]", "image[]").Code)
	// 其他字段名的文件同样会转发，不在计数里，直接拒绝
	require.Equal(t, "invalid_form_file", edit("image", "image[0]").Code)
	// 遮罩按表单里的文件判断，模型不支持遮罩时拒绝
	require.Equal(t, "image_capability_unavailable", edit("image", "mask").Code)

	// JSON 请求体会原样转发给上游，提示词、张数等可能和这里校验的不一致，必须拒绝
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/images/edits", strings.NewReader(`{"model":"image-a","prompt":"改色"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	r := NewRelayImageEdits(c)
	r.request = types.ImageEditRequest{Model: "image-a", Prompt: "改色", N: 1}
	r.setOriginalModel("image-a")
	require.Equal(t, "image_edit_multipart_required", prepareGouoImage(c, r).Code)
}

func TestGouoRealtimeFollowsAgentSwitch(t *testing.T) {
	old, oldLogger := config.GouoAgentEnabled, logger.Logger
	config.GouoAgentEnabled, logger.Logger = false, zap.NewNop()
	t.Cleanup(func() { config.GouoAgentEnabled, logger.Logger = old, oldLogger })
	res := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(res)
	c.Request = httptest.NewRequest("GET", "/v1/realtime?model=gpt-realtime", nil)
	c.Set("token_name", "sys_playground")
	ChatRealtime(c)
	require.Equal(t, http.StatusForbidden, res.Code)
}
