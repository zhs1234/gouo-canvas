package relay

import (
	"encoding/base64"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"net/url"
	"one-api/common"
	"one-api/model"
	"one-api/relay/relay_util"
	"one-api/types"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	_ "golang.org/x/image/webp"
)

var gouoImageRequestID = regexp.MustCompile(`^[a-zA-Z0-9_:-]{1,512}$`)

// 在写出成功响应之前校验，空结果和无效图片字段不能进入结算。
func responseImageClient(c *gin.Context, response *types.ImageResponse, usage *types.Usage) *types.OpenAIErrorWithStatusCode {
	invalid := func() *types.OpenAIErrorWithStatusCode {
		return common.StringErrorWrapper("上游未返回有效图片数据", "invalid_image_response", http.StatusBadGateway)
	}
	if response == nil || len(response.Data) == 0 {
		return invalid()
	}
	for _, item := range response.Data {
		encoded := strings.TrimSpace(item.B64JSON)
		if item.B64JSON != "" && encoded == "" {
			return invalid()
		}
		if encoded == "" && strings.HasPrefix(item.URL, "data:image/") {
			encoded = item.URL
		}
		if strings.HasPrefix(encoded, "data:image/") {
			_, data, ok := strings.Cut(encoded, ";base64,")
			if !ok || strings.TrimSpace(data) == "" {
				return invalid()
			}
			encoded = data
		}
		if encoded != "" {
			encoding := base64.StdEncoding
			if len(encoded)%4 != 0 {
				encoding = base64.RawStdEncoding
			}
			cfg, _, err := image.DecodeConfig(base64.NewDecoder(encoding, strings.NewReader(encoded)))
			// ponytail: 完整解码限 64 MP；接入更大输出的模型前需重新评估内存上限。
			if err != nil || cfg.Width <= 0 || cfg.Height <= 0 || int64(cfg.Width)*int64(cfg.Height) > 64*1024*1024 {
				return invalid()
			}
			decoded := base64.NewDecoder(encoding, strings.NewReader(encoded))
			if _, _, err := image.Decode(decoded); err != nil {
				return invalid()
			}
			if _, err := io.Copy(io.Discard, decoded); err != nil {
				return invalid()
			}
			continue
		}
		u, err := url.Parse(item.URL)
		if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") {
			return invalid()
		}
	}
	if value, ok := c.Get("gouo_image_quota"); ok {
		quota := value.(*relay_util.Quota)
		if err := quota.SaveImageResult(c, response); err != nil {
			return common.StringErrorWrapperLocal("图片已生成，但恢复结果保存失败，额度待核对，请勿重复提交", "image_result_persist_failed", http.StatusInternalServerError)
		}
		if err := quota.CompleteImage(c, usage); err != nil {
			return common.ErrorWrapperLocal(err, "image_billing_unconfirmed", http.StatusInternalServerError)
		}
	}
	return responseJsonClient(c, response)
}

func prepareGouoImage(c *gin.Context, relay RelayBaseInterface) *types.OpenAIErrorWithStatusCode {
	if !strings.HasPrefix(c.Request.URL.Path, "/v1/images/") {
		return nil
	}
	if id := c.GetHeader("X-Gouo-Request-Id"); id != "" && !gouoImageRequestID.MatchString(id) {
		return common.StringErrorWrapperLocal("图片请求 ID 无效", "invalid_image_request_id", http.StatusBadRequest)
	}
	if r, ok := relay.(*relayImageGenerations); ok && strings.Contains(r.request.Model, "#") {
		return common.StringErrorWrapperLocal("图片模型 ID 无效", "invalid_image_model", http.StatusBadRequest)
	}
	if r, ok := relay.(*relayImageEdits); ok && strings.Contains(r.request.Model, "#") {
		return common.StringErrorWrapperLocal("图片模型 ID 无效", "invalid_image_model", http.StatusBadRequest)
	}
	if r, ok := relay.(*relayImageVariations); ok && strings.Contains(r.request.Model, "#") {
		return common.StringErrorWrapperLocal("图片模型 ID 无效", "invalid_image_model", http.StatusBadRequest)
	}
	entry, err := model.PricingInstance.GetGouoModel(relay.getOriginalModel())
	if err != nil {
		return common.ErrorWrapperLocal(err, "image_model_unavailable", http.StatusBadRequest)
	}
	n := 1
	edit, mask := false, false
	switch r := relay.(type) {
	case *relayImageGenerations:
		n = r.request.N
	case *relayImageEdits:
		n = r.request.N
		edit = true
		mask = r.request.Mask != nil
	case *relayImageVariations:
		n = r.request.N
		edit = true
	}
	if n == 0 {
		n = 1
	}
	if n < 1 || n > entry.MaxOutputs {
		return common.StringErrorWrapperLocal("单次输出数量超过模型限制", "image_output_limit", http.StatusBadRequest)
	}
	if (edit && !entry.Reference) || (mask && !entry.Mask) {
		return common.StringErrorWrapperLocal("此模型不支持当前编辑操作，请重新选择", "image_capability_unavailable", http.StatusBadRequest)
	}
	version := c.GetHeader("X-Gouo-Price-Version")
	// 光构客户端必须确认目录价格；普通API用户可省略版本，仍使用请求开始时的快照。
	if (c.GetString("token_name") == "sys_playground" || version != "") && version != entry.PriceVersion {
		return common.StringErrorWrapperLocal("模型价格或能力已更新，请刷新模型列表并重新确认提交", "image_price_changed", http.StatusConflict)
	}
	c.Set("gouo_image_model", entry)
	c.Set("skip_only_chat", true)
	return nil
}
