package relay

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"gorm.io/datatypes"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"one-api/common/config"
	"one-api/common/requester"
	"one-api/model"
	"one-api/providers/openai"
	"one-api/relay/relay_util"
	"one-api/types"
)

// 测试用的图片模型：flare 开放超高/极致画质和透明背景，image-b 是没有设置新字段的旧模型
func gouoTestPricing(t *testing.T) {
	oldPricing, oldRate, oldUnits := model.PricingInstance, config.PaymentUSDRate, config.QuotaPerUnit
	t.Cleanup(func() {
		model.PricingInstance, config.PaymentUSDRate, config.QuotaPerUnit = oldPricing, oldRate, oldUnits
	})
	config.PaymentUSDRate, config.QuotaPerUnit = 7.3, 500000
	tiers := datatypes.NewJSONType(map[string]float64{"2K": 2, "4K": 4})
	qualities := datatypes.NewJSONType(map[string]float64{"low": 0.5, "max": 30})
	flare := &model.Price{Model: "gpt-image-2.5-flare", GouoEnabled: true, GouoPriceCNY: 0.1, GouoReference: true, GouoMask: true, GouoMaxOutputs: 4,
		GouoSizes: "1K,2K", GouoQualities: "low,medium,high,max", GouoTierRatios: &tiers, GouoQualityRatios: &qualities, GouoTransparent: true}
	model.PricingInstance = &model.Pricing{Prices: map[string]*model.Price{
		"gpt-image-2.5-flare": flare,
		"image-b":             {Model: "image-b", GouoEnabled: true, GouoPriceCNY: 0.1, GouoReference: true, GouoMaxOutputs: 4, GouoSizes: "1K"},
		"my-image":            {Model: "my-image", GouoEnabled: true, GouoPriceCNY: 0.1, GouoReference: true, GouoMask: true, GouoMaxOutputs: 1, GouoSizes: "1K", GouoTransparent: true},
	}}
}

func gouoTestPNG(t *testing.T) []byte {
	var data bytes.Buffer
	require.NoError(t, png.Encode(&data, image.NewRGBA(image.Rect(0, 0, 2, 2))))
	return data.Bytes()
}

func gouoGenerate(t *testing.T, body string) (*gin.Context, *relayImageGenerations, *types.OpenAIErrorWithStatusCode) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	r := NewRelayImageGenerations(c)
	require.NoError(t, r.setRequest())
	return c, r, prepareGouoImage(c, r)
}

func gouoEditForm(t *testing.T, fields map[string]string, files ...string) (*bytes.Buffer, string) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for name, value := range fields {
		require.NoError(t, writer.WriteField(name, value))
	}
	for _, name := range files {
		part, err := writer.CreateFormFile(name, name+".png")
		require.NoError(t, err)
		_, err = part.Write(gouoTestPNG(t))
		require.NoError(t, err)
	}
	require.NoError(t, writer.Close())
	return &body, writer.FormDataContentType()
}

func gouoEdit(t *testing.T, fields map[string]string, files ...string) (*gin.Context, *relayImageEdits, *types.OpenAIErrorWithStatusCode) {
	body, contentType := gouoEditForm(t, fields, files...)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/edits", body)
	c.Request.Header.Set("Content-Type", contentType)
	r := NewRelayImageEdits(c)
	require.NoError(t, r.setRequest())
	return c, r, prepareGouoImage(c, r)
}

func TestGouoImageQuoteInContext(t *testing.T) {
	gouoTestPricing(t)
	quota := func(price float64) int { return int(math.Ceil(price / 7.3 * 500000)) }
	for _, tc := range []struct {
		body  string
		price float64
	}{
		// 自动尺寸按 1K、自动画质按 high
		{`{"model":"gpt-image-2.5-flare","prompt":"p"}`, 0.1},
		{`{"model":"gpt-image-2.5-flare","prompt":"p","size":"auto","quality":"auto"}`, 0.1},
		{`{"model":"gpt-image-2.5-flare","prompt":"p","size":"2048x2048","quality":"low"}`, 0.1},
		{`{"model":"gpt-image-2.5-flare","prompt":"p","size":"1024x1024","quality":"max"}`, 3},
		// 张数大于 1 时按张数乘，不能只扣一张
		{`{"model":"gpt-image-2.5-flare","prompt":"p","size":"2048x2048","quality":"max","n":3}`, 18},
		{`{"model":"gpt-image-2.5-flare","prompt":"p","size":"2048x2048","quality":"medium","n":2}`, 0.4},
		{`{"model":"image-b","prompt":"p","size":"1024x1024","n":4}`, 0.4},
	} {
		c, _, err := gouoGenerate(t, tc.body)
		require.Nil(t, err, tc.body)
		value, _ := c.Get("gouo_image_model")
		entry := value.(*model.GouoImageModel)
		require.InDelta(t, tc.price, entry.PriceCNY, 1e-9, tc.body)
		require.Equal(t, quota(entry.PriceCNY), entry.Quota, tc.body)
		// 目录里的单张基础价和价格版本不变
		catalog, catalogErr := model.PricingInstance.GetGouoModel(entry.ID)
		require.NoError(t, catalogErr)
		require.Equal(t, catalog.PriceVersion, entry.PriceVersion)
		require.InDelta(t, 0.1, catalog.PriceCNY, 1e-9)
	}
	// 编辑按表单里的尺寸、画质和张数计价
	c, _, err := gouoEdit(t, map[string]string{"model": "gpt-image-2.5-flare", "prompt": "p", "size": "2048x2048", "quality": "low", "n": "2"}, "image")
	require.Nil(t, err)
	value, _ := c.Get("gouo_image_model")
	require.InDelta(t, 0.2, value.(*model.GouoImageModel).PriceCNY, 1e-9)
}

func TestGouoImageQualityAndBackgroundChecks(t *testing.T) {
	gouoTestPricing(t)
	generate := func(body string) *types.OpenAIErrorWithStatusCode {
		_, _, err := gouoGenerate(t, body)
		return err
	}
	// 显式开放的极致画质放行，没有开放的超高画质拒绝；不限画质的旧模型也不能用超高和极致
	require.Nil(t, generate(`{"model":"gpt-image-2.5-flare","prompt":"p","quality":"max"}`))
	require.Equal(t, "image_param_unavailable", generate(`{"model":"gpt-image-2.5-flare","prompt":"p","quality":"xhigh"}`).Code)
	for _, quality := range []string{"xhigh", "max", "MAX"} {
		require.Equal(t, "image_param_unavailable", generate(`{"model":"image-b","prompt":"p","quality":"`+quality+`"}`).Code, quality)
	}
	for _, quality := range []string{"low", "medium", "high", "auto", ""} {
		require.Nil(t, generate(`{"model":"image-b","prompt":"p","quality":"`+quality+`"}`), quality)
	}

	for _, tc := range []struct {
		body, message string
	}{
		{`{"model":"gpt-image-2.5-flare","prompt":"p","background":"transparent"}`, ""},
		{`{"model":"gpt-image-2.5-flare","prompt":"p","background":"transparent","output_format":"png"}`, ""},
		{`{"model":"gpt-image-2.5-flare","prompt":"p","background":"Transparent","output_format":"WEBP"}`, ""},
		{`{"model":"gpt-image-2.5-flare","prompt":"p","background":"transparent","output_format":"jpeg"}`, "透明背景需要 PNG 或 WebP 格式"},
		{`{"model":"image-b","prompt":"p","background":"transparent","output_format":"png"}`, "该模型不支持透明背景"},
		{`{"model":"image-b","prompt":"p","background":"opaque","output_format":"jpeg"}`, ""},
		{`{"model":"image-b","prompt":"p","background":"auto"}`, ""},
		{`{"model":"image-b","prompt":"p","background":""}`, ""},
		{`{"model":"image-b","prompt":"p","background":"checkerboard"}`, "背景参数无效"},
	} {
		err := generate(tc.body)
		if tc.message == "" {
			require.Nil(t, err, tc.body)
			continue
		}
		require.NotNil(t, err, tc.body)
		require.Equal(t, http.StatusBadRequest, err.StatusCode, tc.body)
		require.Equal(t, tc.message, err.Message, tc.body)
	}
	// 编辑从表单读取背景和输出格式
	edit := func(model, background, format string) *types.OpenAIErrorWithStatusCode {
		_, _, err := gouoEdit(t, map[string]string{"model": model, "prompt": "p", "background": background, "output_format": format}, "image")
		return err
	}
	require.Nil(t, edit("gpt-image-2.5-flare", "transparent", "webp"))
	require.Equal(t, "透明背景需要 PNG 或 WebP 格式", edit("gpt-image-2.5-flare", "transparent", "jpeg").Message)
	require.Equal(t, "该模型不支持透明背景", edit("image-b", "transparent", "png").Message)
	require.Nil(t, edit("image-b", "opaque", "jpeg"))
}

// 返回上游收到的请求，请求体已读出，可以再次解析
func gouoUpstream(t *testing.T) (*httptest.Server, *http.Request, *[]byte) {
	got := &http.Request{}
	var body []byte
	encoded := base64.StdEncoding.EncodeToString(gouoTestPNG(t))
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ = io.ReadAll(r.Body)
		*got = *httptest.NewRequest(r.Method, r.URL.Path, bytes.NewReader(body))
		got.Header = r.Header.Clone()
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"data":[{"b64_json":"` + encoded + `"}]}`))
	}))
	t.Cleanup(upstream.Close)
	oldClient := requester.HTTPClient
	requester.HTTPClient = upstream.Client()
	t.Cleanup(func() { requester.HTTPClient = oldClient })
	return upstream, got, &body
}

func TestGouoImageStripsUnsupportedParamsForGenerations(t *testing.T) {
	gouoTestPricing(t)
	upstream, _, body := gouoUpstream(t)
	c, r, err := gouoGenerate(t, `{"model":"gpt-image-2.5-flare","prompt":"p","size":"1024x1024","quality":"max","background":"transparent","output_format":"png","response_format":"url","style":"vivid","input_fidelity":"high"}`)
	require.Nil(t, err)
	require.Empty(t, r.request.ResponseFormat)
	require.Empty(t, r.request.Style)
	proxy := ""
	// 渠道允许透传额外参数时，光构请求也不能把原始请求体里的字段带给上游
	p := openai.CreateOpenAIProvider(&model.Channel{Type: config.ChannelTypeOpenAI, Key: "k", Proxy: &proxy, AllowExtraBody: true}, upstream.URL)
	p.SetContext(c)
	p.SetOriginalModel("gpt-image-2.5-flare")
	p.SetUsage(&types.Usage{})
	_, err = p.CreateImageGenerations(&r.request)
	require.Nil(t, err)
	var sent map[string]any
	require.NoError(t, json.Unmarshal(*body, &sent))
	for _, name := range []string{"response_format", "style", "input_fidelity"} {
		require.NotContains(t, sent, name)
	}
	require.Equal(t, "max", sent["quality"])
	require.Equal(t, "transparent", sent["background"])
	require.Equal(t, "png", sent["output_format"])
	require.Equal(t, "1024x1024", sent["size"])
}

func TestGouoImageStripsUnsupportedParamsForEdits(t *testing.T) {
	gouoTestPricing(t)
	fields := map[string]string{"prompt": "p", "size": "1024x1024", "quality": "high", "background": "transparent", "output_format": "webp", "output_compression": "80",
		"response_format": "b64_json", "style": "natural", "input_fidelity": "high"}
	send := func(public, upstreamModel string) *http.Request {
		upstream, got, _ := gouoUpstream(t)
		form := map[string]string{"model": public}
		for name, value := range fields {
			form[name] = value
		}
		c, r, err := gouoEdit(t, form, "image[]", "image[]", "mask")
		require.Nil(t, err)
		proxy := ""
		p := openai.CreateOpenAIProvider(&model.Channel{Type: config.ChannelTypeOpenAI, Key: "k", Proxy: &proxy}, upstream.URL)
		p.SetContext(c)
		p.SetOriginalModel(public)
		p.SetUsage(&types.Usage{})
		r.request.Model = upstreamModel
		_, err = p.CreateImageEdits(&r.request)
		require.Nil(t, err)
		require.NoError(t, got.ParseMultipartForm(32<<20))
		return got
	}
	check := func(got *http.Request, upstreamModel string) {
		form := got.MultipartForm
		for _, name := range []string{"response_format", "style", "input_fidelity"} {
			require.NotContains(t, form.Value, name)
		}
		require.Equal(t, []string{upstreamModel}, form.Value["model"])
		for _, name := range []string{"prompt", "size", "quality", "background", "output_format", "output_compression"} {
			require.Equal(t, []string{fields[name]}, form.Value[name], name)
		}
		// 参考图和遮罩原样转发
		require.Len(t, form.File["image[]"], 2)
		require.Len(t, form.File["mask"], 1)
		file, err := form.File["mask"][0].Open()
		require.NoError(t, err)
		data, err := io.ReadAll(file)
		file.Close()
		require.NoError(t, err)
		require.Equal(t, gouoTestPNG(t), data)
	}
	// 没有模型映射时原来会原样转发原始请求体，现在按剔除后的表单重建
	check(send("gpt-image-2.5-flare", "gpt-image-2.5-flare"), "gpt-image-2.5-flare")
	// 渠道把其他模型映射到 gpt-image-2 系列时同样去掉 input_fidelity
	check(send("my-image", "gpt-image-2.5-sunburst-2026-09-08"), "gpt-image-2.5-sunburst-2026-09-08")
}

func TestGouoImageQuoteDrivesBilling(t *testing.T) {
	gouoTestPricing(t)
	oldDB, oldRedis, oldBatch, oldLogging := model.DB, config.RedisEnabled, config.BatchUpdateEnabled, config.LogConsumeEnabled
	t.Cleanup(func() {
		model.DB, config.RedisEnabled, config.BatchUpdateEnabled, config.LogConsumeEnabled = oldDB, oldRedis, oldBatch, oldLogging
	})
	config.RedisEnabled, config.BatchUpdateEnabled, config.LogConsumeEnabled = false, false, true
	db, err := gorm.Open(sqlite.Open(t.TempDir()+"/billing.db"), &gorm.Config{})
	require.NoError(t, err)
	conn, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { conn.Close() })
	for _, table := range []any{&model.Channel{}, &model.Token{}, &model.User{}, &model.Log{}, &model.GouoImageCharge{}} {
		require.NoError(t, db.AutoMigrate(table))
	}
	model.DB = db
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "billing", Quota: 10000000}).Error)
	require.NoError(t, db.Session(&gorm.Session{SkipHooks: true}).Create(&model.Token{Id: 1, UserId: 1, Key: "billing-key", RemainQuota: 10000000, ExpiredTime: -1}).Error)
	start := func(id string) (*gin.Context, *relay_util.Quota, *model.GouoImageModel) {
		c, _, apiErr := gouoGenerate(t, `{"model":"gpt-image-2.5-flare","prompt":"p","size":"2048x2048","quality":"max","n":2}`)
		require.Nil(t, apiErr)
		c.Request.Header.Set("X-Gouo-Request-Id", id)
		c.Set("id", 1)
		c.Set("token_id", 1)
		c.Set("channel_id", 1)
		value, _ := c.Get("gouo_image_model")
		entry := value.(*model.GouoImageModel)
		q := relay_util.NewQuota(c, entry.ID, 0)
		require.Nil(t, q.PreQuotaConsumption())
		return c, q, entry
	}
	balance := func() int {
		quota, err := model.GetUserQuota(1)
		require.NoError(t, err)
		return quota
	}
	// 0.1 元 × 2K 系数 2 × 极致系数 30 × 2 张 = 12 元
	c, q, entry := start("settle")
	require.InDelta(t, 12, entry.PriceCNY, 1e-9)
	require.Equal(t, int(math.Ceil(12/7.3*500000)), entry.Quota)
	require.Equal(t, 10000000-entry.Quota, balance())
	require.NoError(t, q.CompleteImage(c, &types.Usage{}))
	var charge model.GouoImageCharge
	require.NoError(t, db.Where("id = ?", model.GouoImageRequestID(1, "settle")).First(&charge).Error)
	require.Equal(t, model.GouoChargeSettled, charge.Status)
	require.Equal(t, entry.Quota, charge.Quota)
	require.InDelta(t, 12, charge.PriceCNY, 1e-9)
	var log model.Log
	require.NoError(t, db.Where("id = ?", charge.LogID).First(&log).Error)
	require.Equal(t, entry.Quota, log.Quota)
	require.InDelta(t, 12, log.Metadata.Data()["price_cny"], 1e-9)
	require.Equal(t, 10000000-entry.Quota, balance())
	// 失败时按同一份额度全额退回
	c, q, _ = start("refund")
	require.Equal(t, 10000000-2*entry.Quota, balance())
	q.Undo(c)
	require.Equal(t, 10000000-entry.Quota, balance())
}
