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
	"one-api/safty"
	"one-api/types"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

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
			return common.StringErrorWrapperLocal("图片结果保存失败，预扣积分已自动退回，可直接重试", "image_result_persist_failed", http.StatusInternalServerError)
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
		// 光构图片模型的价格只在图片接口按目录结算；对话、recraft 等入口走通用计费，其 Price 没有设置单价，会免费放行
		if model.PricingInstance.GetPrice(relay.getOriginalModel()).GouoEnabled {
			return common.StringErrorWrapperLocal("此模型只能通过图片生成接口调用", "image_model_endpoint", http.StatusBadRequest)
		}
		if c.GetString("token_name") != "sys_playground" {
			return nil
		}
		// 光构客户端只有 Agent 走文本接口，后台关闭 Agent 后不能再用平台令牌直接调用
		if !config.GouoAgentEnabled {
			return common.StringErrorWrapperLocal("运营方已关闭 Agent", "agent_disabled", http.StatusForbidden)
		}
		// 客户端 Agent 只用对话接口；其他文本接口（responses、completions、Claude messages 等）不放行，
		// 否则会绕过下面的单次回复上限
		r, ok := relay.(*relayChat)
		if !ok {
			return common.StringErrorWrapperLocal("平台令牌只能用于 Agent 对话", "platform_token_endpoint", http.StatusForbidden)
		}
		// 后台为模型设置了单次回复上限时，客户端请求一律按上限截断
		if limit := model.PricingInstance.GetPrice(relay.getOriginalModel()).GouoMaxTokens; limit > 0 {
			if r.chatRequest.MaxCompletionTokens <= 0 || r.chatRequest.MaxCompletionTokens > limit {
				r.chatRequest.MaxCompletionTokens = limit
			}
			if r.chatRequest.MaxTokens > limit {
				r.chatRequest.MaxTokens = limit
			}
		}
		return nil
	}
	form := c.Request.MultipartForm
	// 编辑和变体只收 multipart：JSON 请求体会原样转发给上游，而 JSON 键名不区分大小写、重复键取最后一个，
	// 这里校验的提示词、张数等可能和上游实际读到的不一致，画质、遮罩、参考图也查不到
	switch relay.(type) {
	case *relayImageEdits, *relayImageVariations:
		if form == nil {
			return common.StringErrorWrapperLocal("图片编辑请使用 multipart/form-data 提交", "image_edit_multipart_required", http.StatusBadRequest)
		}
	}
	// 表单字段重复时，校验和计费用的是第一个值，转发给上游的却是全部值（上游常取最后一个），可绕过输出数量上限等检查
	if form != nil {
		for _, values := range form.Value {
			if len(values) > 1 {
				return common.StringErrorWrapperLocal("请求参数重复", "duplicate_form_field", http.StatusBadRequest)
			}
		}
		if len(form.File["mask"]) > 1 {
			return common.StringErrorWrapperLocal("请求参数重复", "duplicate_form_field", http.StatusBadRequest)
		}
		// 表单里的文件全部转发给上游，其他字段名的文件不在参考图计数里
		for name := range form.File {
			if name != "image" && name != "image[]" && name != "mask" {
				return common.StringErrorWrapperLocal("不支持的上传字段 "+name, "invalid_form_file", http.StatusBadRequest)
			}
		}
	}
	// 内容审查在扣费前完成，未通过的请求不产生费用；开关和关键词沿用后台“运营设置”
	prompt := ""
	switch r := relay.(type) {
	case *relayImageGenerations:
		prompt = r.request.Prompt
	case *relayImageEdits:
		prompt = r.request.Prompt
	}
	if utf8.RuneCountInString(prompt) > gouoImagePromptMaxRunes {
		return common.StringErrorWrapperLocal(fmt.Sprintf("提示词不能超过 %d 字", gouoImagePromptMaxRunes), "prompt_too_long", http.StatusBadRequest)
	}
	// 参考图和遮罩原样转发给上游，扣费前按内容核对格式和大小，伪造扩展名或超大的文件不进入上游请求
	if form != nil {
		for _, name := range []string{"image", "image[]", "mask"} {
			for _, header := range form.File[name] {
				if err := checkGouoImageUpload(header); err != nil {
					return err
				}
			}
		}
	}
	if result, _ := safty.CheckContent(prompt); !result.IsSafe {
		return common.StringErrorWrapperLocal("提示词包含不允许的内容，请修改后重试", result.Code, http.StatusBadRequest)
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
	n, inputs := 1, 0
	edit, mask := false, false
	size, quality, moderation := "", "", ""
	switch r := relay.(type) {
	case *relayImageGenerations:
		n, size, quality = r.request.N, r.request.Size, r.request.Quality
		if r.request.Moderation != nil {
			moderation = *r.request.Moderation
		}
	case *relayImageEdits:
		// 编辑请求的画质和审核强度不在结构体里，从表单读取
		n, size, quality, moderation = r.request.N, r.request.Size, c.PostForm("quality"), c.PostForm("moderation")
		edit = true
	case *relayImageVariations:
		n, size = r.request.N, r.request.Size
		edit = true
	}
	if edit {
		// 按表单里实际的文件数计：同名的 image 字段可以重复，绑定到结构体时只保留第一个，但会全部转发给上游
		inputs = len(form.File["image"]) + len(form.File["image[]"])
		mask = len(form.File["mask"]) > 0
	}
	if n == 0 {
		n = 1
	}
	if n < 1 || n > entry.MaxOutputs {
		return common.StringErrorWrapperLocal("单次输出数量超过模型限制", "image_output_limit", http.StatusBadRequest)
	}
	// 光构客户端把一个作品拆成多次请求，按作品内序号核对后台设置的每次最多张数；普通 API 用户只受模型上限约束
	if c.GetString("token_name") == "sys_playground" {
		index, _ := strconv.Atoi(c.GetHeader("X-Gouo-Request-Index"))
		if n > config.GouoMaxImagesPerTask || index >= config.GouoMaxImagesPerTask {
			return common.StringErrorWrapperLocal(fmt.Sprintf("一次最多生成 %d 张", config.GouoMaxImagesPerTask), "image_task_limit", http.StatusBadRequest)
		}
	}
	if (edit && !entry.Reference) || (mask && !entry.Mask) {
		return common.StringErrorWrapperLocal("此模型不支持当前编辑操作，请重新选择", "image_capability_unavailable", http.StatusBadRequest)
	}
	if message := checkGouoImageParams(entry, size, quality, moderation, inputs); message != "" {
		return common.StringErrorWrapperLocal(message, "image_param_unavailable", http.StatusBadRequest)
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
			capture.inputs = append(slices.Clone(form.File["image"]), form.File["image[]"]...)
			capture.mask = r.request.Mask
		default:
			return nil
		}
		c.Set("gouo_image_capture", capture)
	}
	return nil
}

// 与客户端输入框的上限一致（gpt-image 系列上游同为 32000 字符）
const gouoImagePromptMaxRunes = 32000

// 上游编辑接口普遍只收这几种格式；按文件头解码判断，不信任文件名和声明的类型
var gouoImageUploadFormats = []string{"png", "jpeg", "webp"}

func checkGouoImageUpload(header *multipart.FileHeader) *types.OpenAIErrorWithStatusCode {
	if header.Size > config.GouoAssetMaxFileBytes {
		return common.StringErrorWrapperLocal(fmt.Sprintf("单张图片不能超过 %d MB", config.GouoAssetMaxFileBytes>>20), "file_too_large", http.StatusRequestEntityTooLarge)
	}
	file, err := header.Open()
	if err != nil {
		return common.StringErrorWrapperLocal("无法读取上传的图片", "file_open_failed", http.StatusBadRequest)
	}
	defer file.Close()
	cfg, format, err := image.DecodeConfig(file)
	if err != nil || cfg.Width <= 0 || cfg.Height <= 0 || !slices.Contains(gouoImageUploadFormats, format) {
		return common.StringErrorWrapperLocal("仅支持 PNG、JPEG 和 WebP 图片", "unsupported_image", http.StatusUnsupportedMediaType)
	}
	return nil
}

// 图片按张计价，尺寸、画质和参考图张数直接影响上游成本，按后台为模型限定的范围校验；审核强度按运营方设置
func checkGouoImageParams(entry *model.GouoImageModel, size, quality, moderation string, inputs int) string {
	// 很多上游不支持任意分辨率，只放行后台为模型开放的档位；没有开放档位时只能用自动尺寸
	if size = strings.ToLower(strings.TrimSpace(size)); size != "" && size != "auto" {
		width, height, ok := strings.Cut(size, "x")
		w, errW := strconv.Atoi(width)
		h, errH := strconv.Atoi(height)
		if !ok || errW != nil || errH != nil || w <= 0 || h <= 0 {
			return "图片尺寸无效"
		}
		if !slices.Contains(entry.Sizes, model.GouoSizeTier(w, h)) {
			return "此模型不支持该分辨率，请选择自动尺寸或已开放的分辨率"
		}
	}
	if len(entry.Qualities) > 0 {
		quality = strings.ToLower(strings.TrimSpace(quality))
		// 自动画质可能由上游选成高画质，只有开放高画质时才允许
		if quality == "" || quality == "auto" {
			if !slices.Contains(entry.Qualities, "high") {
				return "此模型不开放自动画质，请选择具体画质"
			}
		} else if !slices.Contains(entry.Qualities, quality) {
			return "此模型不开放所选画质，请重新选择"
		}
	}
	if !config.GouoAllowLowModeration && strings.EqualFold(strings.TrimSpace(moderation), "low") {
		return "运营方未开放宽松审核"
	}
	if entry.MaxInputs > 0 && inputs > entry.MaxInputs {
		return fmt.Sprintf("此模型最多使用 %d 张参考图", entry.MaxInputs)
	}
	return ""
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
	// 已付费的生成结果不受配额限制；用户上传的参考图和遮罩按普通上传处理
	save := func(data []byte, name string, enforceQuota bool) (*model.GouoAsset, error) {
		asset, _, err := model.SaveGouoAssetBytes(userID, data, name, enforceQuota)
		return asset, err
	}
	record := model.GouoGenerationRecord{UserID: userID, ClientTaskID: capture.taskID, Index: capture.index, Prompt: capture.prompt, Model: capture.model, Operation: capture.operation}
	params, _ := json.Marshal(capture.params)
	record.Params = params
	for i, item := range response.Data {
		data, err := gouoImageBytes(item)
		if err == nil {
			var asset *model.GouoAsset
			if asset, err = save(data, fmt.Sprintf("output-%d-%d", capture.index, i), false); err == nil {
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
		data, err := io.ReadAll(io.LimitReader(file, config.GouoAssetMaxFileBytes+1))
		if err != nil {
			return nil, err
		}
		if int64(len(data)) > config.GouoAssetMaxFileBytes {
			return nil, fmt.Errorf("文件超过 %d MB", config.GouoAssetMaxFileBytes/1024/1024)
		}
		return save(data, header.Filename, true)
	}
	for _, header := range capture.inputs {
		asset, err := readUpload(header)
		if err != nil {
			logger.LogError(c.Request.Context(), "保存参考图失败: "+err.Error())
		}
		// 失败时追加 nil 占位，客户端按下标绑定参考图编号
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
