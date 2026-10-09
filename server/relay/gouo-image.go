package relay

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"one-api/common"
	"one-api/common/config"
	"one-api/common/logger"
	"one-api/common/utils"
	"one-api/model"
	"one-api/relay/relay_util"
	"one-api/types"
	"regexp"
	"strconv"
	"strings"
	"time"

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
		if value, ok := c.Get("gouo_image_capture"); ok {
			recordGouoGeneration(c, value.(*gouoImageCapture), response)
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
	if taskID := c.GetHeader("X-Gouo-Task-Id"); taskID != "" && config.GouoCloudLibraryEnabled {
		if len(taskID) > 128 || !gouoImageRequestID.MatchString(taskID) {
			return common.StringErrorWrapperLocal("作品编号无效", "invalid_image_task_id", http.StatusBadRequest)
		}
		index, err := strconv.Atoi(c.GetHeader("X-Gouo-Request-Index"))
		if err != nil || index < 0 || index >= config.GouoAssetMaxTaskFiles {
			index = 0
		}
		capture := &gouoImageCapture{taskID: taskID, index: index, operation: "generation", params: map[string]any{"n": 1}}
		switch r := relay.(type) {
		case *relayImageGenerations:
			capture.prompt, capture.model = r.request.Prompt, r.request.Model
			capture.params["size"], capture.params["quality"] = r.request.Size, r.request.Quality
			if r.request.OutputFormat != nil {
				capture.params["output_format"] = *r.request.OutputFormat
			}
		case *relayImageEdits:
			capture.prompt, capture.model, capture.operation = r.request.Prompt, r.request.Model, "edit"
			capture.params["size"], capture.params["quality"], capture.params["output_format"] = r.request.Size, c.PostForm("quality"), c.PostForm("output_format")
			if r.request.Image != nil {
				capture.inputs = append(capture.inputs, r.request.Image)
			}
			capture.inputs = append(capture.inputs, r.request.Images...)
			capture.mask = r.request.Mask
		default:
			return nil
		}
		c.Set("gouo_image_capture", capture)
	}
	return nil
}

type gouoImageCapture struct {
	taskID    string
	index     int
	prompt    string
	model     string
	operation string
	params    map[string]any
	inputs    []*multipart.FileHeader
	mask      *multipart.FileHeader
}

// ponytail: 生成图上限 64 MB；接入更大输出前调整。
const gouoGeneratedImageMaxBytes = 64 * 1024 * 1024

// 图片 URL 来自供应商响应，只允许下载公网地址；测试中可替换
var gouoImageDownloadClient = utils.NewPublicHTTPClient(60 * time.Second)

// recordGouoGeneration 在返回图片前把结果写入用户作品库；失败只记日志，图片仍按原流程返回并保留在恢复缓存中。
func recordGouoGeneration(c *gin.Context, capture *gouoImageCapture, response *types.ImageResponse) {
	userID := c.GetInt("id")
	save := func(data []byte, name string) (*model.GouoAsset, error) {
		asset, _, err := model.SaveGouoAssetBytes(userID, data, name, false)
		return asset, err
	}
	record := model.GouoGenerationRecord{UserID: userID, ClientTaskID: capture.taskID, Index: capture.index, Prompt: capture.prompt, Model: capture.model, Operation: capture.operation}
	params, _ := json.Marshal(capture.params)
	record.Params = params
	for i, item := range response.Data {
		data, err := gouoImageBytes(item)
		if err == nil {
			var asset *model.GouoAsset
			if asset, err = save(data, fmt.Sprintf("output-%d-%d", capture.index, i)); err == nil {
				record.Outputs = append(record.Outputs, asset)
				continue
			}
		}
		logger.LogError(c.Request.Context(), "保存生成图片失败: "+err.Error())
		return
	}
	readUpload := func(header *multipart.FileHeader) (*model.GouoAsset, error) {
		file, err := header.Open()
		if err != nil {
			return nil, err
		}
		defer file.Close()
		data, err := io.ReadAll(io.LimitReader(file, gouoGeneratedImageMaxBytes))
		if err != nil {
			return nil, err
		}
		return save(data, header.Filename)
	}
	for _, header := range capture.inputs {
		asset, err := readUpload(header)
		if err != nil {
			logger.LogError(c.Request.Context(), "保存参考图失败: "+err.Error())
			continue
		}
		record.Inputs = append(record.Inputs, asset)
	}
	if capture.mask != nil {
		if asset, err := readUpload(capture.mask); err == nil {
			record.Mask = asset
		} else {
			logger.LogError(c.Request.Context(), "保存遮罩失败: "+err.Error())
		}
	}
	if err := model.RecordGouoGeneration(record); err != nil {
		logger.LogError(c.Request.Context(), "写入作品记录失败: "+err.Error())
	}
}

func gouoImageBytes(item types.ImageResponseDataInner) ([]byte, error) {
	encoded := strings.TrimSpace(item.B64JSON)
	if encoded == "" && strings.HasPrefix(item.URL, "data:image/") {
		encoded = item.URL
	}
	if encoded != "" {
		if _, data, ok := strings.Cut(encoded, ";base64,"); ok {
			encoded = data
		}
		encoding := base64.StdEncoding
		if len(encoded)%4 != 0 {
			encoding = base64.RawStdEncoding
		}
		return readGouoImage(base64.NewDecoder(encoding, strings.NewReader(encoded)))
	}
	resp, err := gouoImageDownloadClient.Get(item.URL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("下载生成图片失败：HTTP %d", resp.StatusCode)
	}
	return readGouoImage(resp.Body)
}

// readGouoImage 超过上限直接报错，截断的图片不能入库
func readGouoImage(r io.Reader) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(r, gouoGeneratedImageMaxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > gouoGeneratedImageMaxBytes {
		return nil, fmt.Errorf("生成图片超过 %d MB", gouoGeneratedImageMaxBytes/1024/1024)
	}
	return data, nil
}
