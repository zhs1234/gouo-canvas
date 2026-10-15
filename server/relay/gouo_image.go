package relay

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/gouo_setting"

	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
	_ "golang.org/x/image/webp"
)

// 光构客户端使用的平台令牌名称，按客户端规则额外校验
const GouoPlaygroundTokenName = "sys_playground"

// gouoImageContextKey 标记需要去重和保存恢复结果的图片请求
const gouoImageContextKey = "gouo_image"

var gouoRequestIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_:-]{1,512}$`)

// gouoImageState 是一次光构图片请求的账务状态，存在 gin 上下文里，跨渠道重试共用
type gouoImageState struct {
	charge   *model.GouoImageCharge
	settled  bool
	capture  *gouoImageCapture
	original gin.ResponseWriter
	buffer   *gouoBufferWriter
}

// gouoBufferWriter 暂存上游响应：图片校验、保存和结算都成功后才回传给客户端，
// 失败时丢弃，由 Relay 的错误处理写出错误
type gouoBufferWriter struct {
	gin.ResponseWriter
	header http.Header
	body   bytes.Buffer
	status int
}

func (w *gouoBufferWriter) Header() http.Header  { return w.header }
func (w *gouoBufferWriter) WriteHeader(code int) { w.status = code }
func (w *gouoBufferWriter) WriteHeaderNow()      {}
func (w *gouoBufferWriter) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.body.Write(data)
}
func (w *gouoBufferWriter) WriteString(s string) (int, error) { return w.Write([]byte(s)) }
func (w *gouoBufferWriter) Status() int {
	if w.status == 0 {
		return http.StatusOK
	}
	return w.status
}
func (w *gouoBufferWriter) Size() int     { return w.body.Len() }
func (w *gouoBufferWriter) Written() bool { return w.status != 0 }
func (w *gouoBufferWriter) Flush()        {}

func gouoError(message, code string, status int) *types.NewAPIError {
	return types.NewErrorWithStatusCode(errors.New(message), types.ErrorCode(code), status, types.ErrOptionWithSkipRetry())
}

// CheckGouoRequest 在原生计费前校验客户端能力并登记请求，金额由 New API 统一处理。
func CheckGouoRequest(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	// 光构规则只约束光构客户端：图片请求用平台令牌，Agent 走原生 Playground 并带 X-Gouo-Agent；其他调用按 New API 原生行为处理
	playground := c.GetString("token_name") == GouoPlaygroundTokenName
	isImage := info.RelayMode == relayconstant.RelayModeImagesGenerations || info.RelayMode == relayconstant.RelayModeImagesEdits
	if !isImage {
		gouoAgent := playground || (c.Request.URL.Path == "/pg/chat/completions" && c.GetHeader("X-Gouo-Agent") != "")
		if gouoAgent && !gouo_setting.Get().AgentEnabled {
			return gouoError("运营方已关闭 Agent", "agent_disabled", http.StatusForbidden)
		}
		return nil
	}
	if !playground {
		return nil
	}
	entry, err := model.FindGouoImageModel(info.OriginModelName)
	if err != nil {
		return types.NewError(err, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
	}
	if entry == nil {
		return gouoError("此模型不是可用的图片模型，请重新选择", "image_model_unavailable", http.StatusBadRequest)
	}
	request, ok := info.Request.(*dto.ImageRequest)
	if !ok {
		return gouoError("图片请求格式无效", "invalid_image_request", http.StatusBadRequest)
	}
	if request.Stream != nil && *request.Stream {
		return gouoError("此模型不支持流式输出", "image_stream_unsupported", http.StatusBadRequest)
	}
	edit := info.RelayMode == relayconstant.RelayModeImagesEdits
	form := c.Request.MultipartForm
	// 编辑只收 multipart：JSON 请求体原样转发给上游，参考图和遮罩查不到
	if edit && form == nil {
		return gouoError("图片编辑请使用 multipart/form-data 提交", "image_edit_multipart_required", http.StatusBadRequest)
	}
	// 生成接口的参考图字段会原样转发给上游，不在参考图计数里
	if !edit && (len(request.Image) > 0 || len(request.Images) > 0 || len(request.Mask) > 0) {
		return gouoError("参考图请通过图片编辑接口提交", "image_reference_requires_edit", http.StatusBadRequest)
	}
	mask := false
	moderation := ""
	if form != nil {
		// 表单字段重复时，校验用的是第一个值，转发给上游的却是全部值（上游常取最后一个），可绕过输出数量等检查
		for _, values := range form.Value {
			if len(values) > 1 {
				return gouoError("请求参数重复", "duplicate_form_field", http.StatusBadRequest)
			}
		}
		// 表单里的文件全部转发给上游，其他字段名的文件不在参考图计数里
		for name := range form.File {
			if name != "image" && name != "image[]" && name != "mask" {
				return gouoError("不支持的上传字段 "+name, "invalid_form_file", http.StatusBadRequest)
			}
		}
		if len(form.File["mask"]) > 1 {
			return gouoError("请求参数重复", "duplicate_form_field", http.StatusBadRequest)
		}
		mask = len(form.File["mask"]) > 0
		moderation = c.Request.PostForm.Get("moderation")
	} else if len(request.Moderation) > 0 {
		_ = common.Unmarshal(request.Moderation, &moderation)
	}
	if id := c.GetHeader("X-Gouo-Request-Id"); id != "" && !gouoRequestIDPattern.MatchString(id) {
		return gouoError("图片请求 ID 无效", "invalid_image_request_id", http.StatusBadRequest)
	}
	n, err := request.ImageCount(false)
	// 光构客户端把多张拆成单图请求
	if err != nil || n != 1 {
		return gouoError("单次请求只能生成 1 张图片", "image_output_limit", http.StatusBadRequest)
	}
	// 光构客户端把一个作品拆成多次请求，按作品内序号核对后台设置的每次最多张数
	limit := gouo_setting.Get().MaxImagesPerTask
	if index, _ := strconv.Atoi(c.GetHeader("X-Gouo-Request-Index")); n > limit || index >= limit {
		return gouoError(fmt.Sprintf("一次最多生成 %d 张", limit), "image_task_limit", http.StatusBadRequest)
	}
	if (edit && !entry.Reference) || (mask && !entry.Mask) {
		return gouoError("此模型不支持当前编辑操作，请重新选择", "image_capability_unavailable", http.StatusBadRequest)
	}
	if message := checkGouoImageParams(request.Size, moderation); message != "" {
		return gouoError(message, "image_param_unavailable", http.StatusBadRequest)
	}
	// 光构客户端必须确认目录价格
	if version := c.GetHeader("X-Gouo-Price-Version"); version != entry.PriceVersion {
		return gouoError("模型价格或能力已更新，请刷新模型列表并重新确认提交", "image_price_changed", http.StatusConflict)
	}
	var capture *gouoImageCapture
	if taskID := c.GetHeader("X-Gouo-Task-Id"); taskID != "" && gouo_setting.Get().CloudLibraryEnabled {
		if len(taskID) > 128 || !gouoRequestIDPattern.MatchString(taskID) {
			return gouoError("作品编号无效", "invalid_image_task_id", http.StatusBadRequest)
		}
		index, err := strconv.Atoi(c.GetHeader("X-Gouo-Request-Index"))
		if err != nil || index < 0 || index >= gouo_setting.Get().AssetMaxTaskFiles {
			index = 0
		}
		capture = &gouoImageCapture{taskID: taskID, index: index, prompt: request.Prompt, model: request.Model, operation: "generation",
			params: map[string]any{"n": n, "size": request.Size, "quality": request.Quality}}
		var format string
		if len(request.OutputFormat) > 0 && common.Unmarshal(request.OutputFormat, &format) == nil {
			capture.params["output_format"] = format
		}
		if edit {
			capture.operation = "edit"
			capture.params["output_format"] = c.Request.PostForm.Get("output_format")
			capture.inputs = append(slices.Clone(form.File["image"]), form.File["image[]"]...)
			if mask {
				capture.mask = form.File["mask"][0]
			}
		}
	}
	requestID := c.GetHeader("X-Gouo-Request-Id")
	if requestID == "" {
		requestID = "auto:" + c.GetString(common.RequestIdKey)
	}
	charge := &model.GouoImageCharge{ID: model.GouoImageRequestID(info.UserId, requestID), UserID: info.UserId, TokenID: info.TokenId,
		ModelName: entry.ID, PriceVersion: entry.PriceVersion}
	if err := model.CreateGouoImageRequest(charge); err != nil {
		if errors.Is(err, model.ErrGouoImageRequestExists) {
			return gouoError(err.Error(), "image_request_exists", http.StatusConflict)
		}
		logger.LogError(c, "保存图片请求失败: "+err.Error())
		return gouoError("保存图片请求失败，请稍后重试", "image_request_save_failed", http.StatusInternalServerError)
	}
	c.Header("X-Gouo-Charge-Id", charge.ID)
	c.Set(gouoImageContextKey, &gouoImageState{charge: charge, capture: capture})
	return nil
}

// 尺寸和审核强度按客户端可选范围校验：尺寸最大到 4K，宽松审核需运营方开放
func checkGouoImageParams(size, moderation string) string {
	if size = strings.ToLower(strings.TrimSpace(size)); size != "" && size != "auto" {
		width, height, ok := strings.Cut(size, "x")
		w, errW := strconv.Atoi(width)
		h, errH := strconv.Atoi(height)
		if !ok || errW != nil || errH != nil || w <= 0 || h <= 0 || model.GouoSizeTier(w, h) == "" {
			return "图片尺寸无效"
		}
	}
	if !gouo_setting.Get().AllowLowModeration && strings.EqualFold(strings.TrimSpace(moderation), "low") {
		return "运营方未开放宽松审核"
	}
	return ""
}

// beginGouoAttempt 在每次向上游派发前运行：记录渠道，并把响应改写到缓冲区，上一次失败尝试写出的内容丢弃
func beginGouoAttempt(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	value, ok := c.Get(gouoImageContextKey)
	if !ok {
		return nil
	}
	state := value.(*gouoImageState)
	if err := model.DispatchGouoImageCharge(state.charge.ID, info.ChannelId); err != nil {
		return gouoError(err.Error(), "image_billing_state_changed", http.StatusConflict)
	}
	if state.original == nil {
		state.original = c.Writer
	}
	// 响应头也单独暂存：失败尝试留下的上游头（如 Content-Length）不能带进错误响应
	state.buffer = &gouoBufferWriter{ResponseWriter: state.original, header: http.Header{}}
	c.Writer = state.buffer
	return nil
}

// finishGouoImage 在上游成功返回后运行：校验图片、保存恢复结果、结算，再把响应回传给客户端。
// 成功时返回 false，让调用方继续 New API 的原生结算。
func finishGouoImage(c *gin.Context, info *relaycommon.RelayInfo) (bool, *types.NewAPIError) {
	value, ok := c.Get(gouoImageContextKey)
	if !ok {
		return false, nil
	}
	state := value.(*gouoImageState)
	data, images, err := normalizeGouoImageResponse(state.buffer.body.Bytes())
	if err != nil {
		return true, types.NewErrorWithStatusCode(errors.New("上游未返回有效图片数据"), types.ErrorCode("invalid_image_response"), http.StatusBadGateway)
	}
	// 只有带客户端请求 ID 的结果能被取回，其余保存只会占用缓存
	if c.GetHeader("X-Gouo-Request-Id") != "" {
		if err := model.SaveGouoImageResult(state.charge.ID, data); err != nil {
			logger.LogError(c, "图片恢复结果保存失败: "+err.Error())
			return true, gouoError("图片结果保存失败，请在使用记录核对本次请求后再重试", "image_result_persist_failed", http.StatusInternalServerError)
		}
	}
	// 先提交账务再回传图片：浏览器断开不能把已经成功的生成误退
	if _, err := model.FinishGouoImageCharge(state.charge.ID, model.GouoChargeSettled, "上游已返回有效图片"); err != nil {
		return true, gouoError(err.Error(), "image_billing_unconfirmed", http.StatusInternalServerError)
	}
	state.settled = true
	if state.capture != nil {
		recordGouoGeneration(c, state.capture, images)
	}
	c.Writer = state.original
	for key, values := range state.buffer.header {
		c.Writer.Header()[key] = values
	}
	c.Writer.Header().Del("Content-Length")
	c.Writer.WriteHeader(state.buffer.Status())
	if _, err := c.Writer.Write(data); err != nil {
		logger.LogWarn(c, "图片响应回传失败，结果可通过请求 ID 取回: "+err.Error())
	}
	return false, nil
}

// 与 New API 的图片计量一致：对象算一张，拆开的 URL/base64 取数量较多的一组，纯提示词不算图片。
func normalizeGouoImageResponse(data []byte) ([]byte, []dto.ImageData, error) {
	payload := gjson.GetBytes(data, "data")
	var items []dto.ImageData
	if payload.IsObject() {
		var item dto.ImageData
		if err := common.Unmarshal([]byte(payload.Raw), &item); err != nil {
			return nil, nil, err
		}
		items = []dto.ImageData{item}
	} else if err := common.Unmarshal([]byte(payload.Raw), &items); err != nil {
		return nil, nil, err
	}
	var encoded, urls []dto.ImageData
	for _, item := range items {
		if strings.TrimSpace(item.B64Json) != "" {
			encoded = append(encoded, item)
		}
		if strings.TrimSpace(item.Url) != "" {
			urls = append(urls, item)
		}
	}
	items = encoded
	if len(urls) > len(encoded) {
		items = urls
	}
	if !validGouoImages(items) {
		return nil, nil, errors.New("上游未返回有效图片数据")
	}
	normalized, err := sjson.SetBytes(data, "data", items)
	return normalized, items, err
}

// EndGouoImage 只更新请求状态并恢复写入器；新请求的退款由原生 BillingSession 处理。
func EndGouoImage(c *gin.Context, apiErr *types.NewAPIError) *types.NewAPIError {
	value, ok := c.Get(gouoImageContextKey)
	if !ok {
		return apiErr
	}
	state := value.(*gouoImageState)
	if state.original != nil {
		c.Writer = state.original
	}
	if state.settled {
		return apiErr
	}
	if _, err := model.FinishGouoImageCharge(state.charge.ID, model.GouoChargeRefunded, "生成失败或连接中断，费用以使用日志为准"); err != nil {
		logger.LogError(c, "更新图片请求状态失败: "+err.Error())
	}
	if apiErr == nil {
		return gouoError("生成结果未返回，请在使用记录核对扣费或退款后再重试", "image_result_missing", http.StatusBadGateway)
	}
	return apiErr
}

// validGouoImages 校验每张图片都能解码或是公网 http(s) 地址，空结果和损坏的图片不能进入结算
func validGouoImages(items []dto.ImageData) bool {
	if len(items) == 0 {
		return false
	}
	for _, item := range items {
		encoded := strings.TrimSpace(item.B64Json)
		if item.B64Json != "" && encoded == "" {
			return false
		}
		if encoded == "" && strings.HasPrefix(item.Url, "data:image/") {
			encoded = item.Url
		}
		if strings.HasPrefix(encoded, "data:image/") {
			_, payload, ok := strings.Cut(encoded, ";base64,")
			if !ok || strings.TrimSpace(payload) == "" {
				return false
			}
			encoded = payload
		}
		if encoded == "" {
			u, err := url.Parse(item.Url)
			if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") {
				return false
			}
			continue
		}
		encoding := base64.StdEncoding
		if len(encoded)%4 != 0 {
			encoding = base64.RawStdEncoding
		}
		cfg, _, err := image.DecodeConfig(base64.NewDecoder(encoding, strings.NewReader(encoded)))
		// ponytail: 完整解码限 64 MP；接入更大输出的模型前需重新评估内存上限
		if err != nil || cfg.Width <= 0 || cfg.Height <= 0 || int64(cfg.Width)*int64(cfg.Height) > 64*1024*1024 {
			return false
		}
		decoded := base64.NewDecoder(encoding, strings.NewReader(encoded))
		if _, _, err := image.Decode(decoded); err != nil {
			return false
		}
		if _, err := io.Copy(io.Discard, decoded); err != nil {
			return false
		}
	}
	return true
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

// ponytail: 生成图上限 64 MB；接入更大输出前调整
const gouoGeneratedImageMaxBytes = 64 * 1024 * 1024

// recordGouoGeneration 在返回图片前把结果写入用户作品库；失败只记日志，图片仍照常返回，并可从恢复缓存取回
func recordGouoGeneration(c *gin.Context, capture *gouoImageCapture, items []dto.ImageData) {
	userID := c.GetInt("id")
	// 已付费的生成结果不受空间配额限制；用户上传的参考图和遮罩按普通上传处理
	save := func(data []byte, name string, enforceQuota bool) (*model.GouoAsset, error) {
		asset, _, err := model.SaveGouoAssetBytes(userID, data, name, enforceQuota)
		return asset, err
	}
	record := model.GouoGenerationRecord{UserID: userID, ClientTaskID: capture.taskID, Index: capture.index, Prompt: capture.prompt, Model: capture.model, Operation: capture.operation}
	record.Params, _ = common.Marshal(capture.params)
	for i, item := range items {
		data, err := gouoImageBytes(item)
		if err == nil {
			var asset *model.GouoAsset
			if asset, err = save(data, fmt.Sprintf("output-%d-%d", capture.index, i), false); err == nil {
				record.Outputs = append(record.Outputs, asset)
				continue
			}
		}
		logger.LogError(c, "保存生成图片失败: "+err.Error())
		return
	}
	maxBytes := gouo_setting.Get().AssetMaxFileBytes
	readUpload := func(header *multipart.FileHeader) (*model.GouoAsset, error) {
		file, err := header.Open()
		if err != nil {
			return nil, err
		}
		defer file.Close()
		data, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
		if err != nil {
			return nil, err
		}
		if int64(len(data)) > maxBytes {
			return nil, fmt.Errorf("文件超过 %d MB", maxBytes/1024/1024)
		}
		return save(data, header.Filename, true)
	}
	for _, header := range capture.inputs {
		asset, err := readUpload(header)
		if err != nil {
			logger.LogError(c, "保存参考图失败: "+err.Error())
		}
		// 失败时追加 nil 占位，客户端按下标绑定参考图编号
		record.Inputs = append(record.Inputs, asset)
	}
	if capture.mask != nil {
		if asset, err := readUpload(capture.mask); err == nil {
			record.Mask = asset
		} else {
			logger.LogError(c, "保存遮罩失败: "+err.Error())
		}
	}
	if err := model.RecordGouoGeneration(record); err != nil {
		logger.LogError(c, "写入作品记录失败: "+err.Error())
	}
}

func gouoImageBytes(item dto.ImageData) ([]byte, error) {
	encoded := strings.TrimSpace(item.B64Json)
	if encoded == "" && strings.HasPrefix(item.Url, "data:image/") {
		encoded = item.Url
	}
	if encoded != "" {
		if _, payload, ok := strings.Cut(encoded, ";base64,"); ok {
			encoded = payload
		}
		encoding := base64.StdEncoding
		if len(encoded)%4 != 0 {
			encoding = base64.RawStdEncoding
		}
		return readGouoImage(base64.NewDecoder(encoding, strings.NewReader(encoded)))
	}
	// 图片地址来自供应商响应，按后台的抓取安全设置下载，防止访问内网
	resp, err := service.DoDownloadRequest(item.Url, "gouo image result")
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
