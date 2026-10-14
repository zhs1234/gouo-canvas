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
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/gouo_setting"

	"github.com/gin-gonic/gin"
	_ "golang.org/x/image/webp"
)

// 光构客户端使用的平台令牌名称，按客户端规则额外校验
const GouoPlaygroundTokenName = "sys_playground"

var gouoRequestIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_:-]{1,512}$`)

// gouoImageState 是一次光构图片请求的账务状态，存在 gin 上下文里，跨渠道重试共用
type gouoImageState struct {
	entry    *model.GouoImageModel
	charge   *model.GouoImageCharge
	settled  bool
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

// CheckGouoRequest 在 New API 计费之前运行：光构图片模型按后台目录校验参数并预扣，其他模型只做光构客户端相关的限制
func CheckGouoRequest(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	row, enabled, err := model.GetGouoImageModel(info.OriginModelName)
	if err != nil {
		return types.NewError(err, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
	}
	playground := c.GetString("token_name") == GouoPlaygroundTokenName
	isImage := info.RelayMode == relayconstant.RelayModeImagesGenerations || info.RelayMode == relayconstant.RelayModeImagesEdits
	if !enabled {
		// 光构客户端只有 Agent 走文本接口，后台关闭 Agent 后不能再用平台令牌直接调用
		if playground && !isImage && !gouo_setting.Get().AgentEnabled {
			return gouoError("运营方已关闭 Agent", "agent_disabled", http.StatusForbidden)
		}
		return nil
	}
	request, ok := info.Request.(*dto.ImageRequest)
	if !isImage || !ok {
		return gouoError("此模型只能通过图片生成接口调用", "image_model_endpoint", http.StatusBadRequest)
	}
	entry, err := row.Entry()
	if err != nil {
		return gouoError(err.Error(), "image_model_unavailable", http.StatusBadRequest)
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
	inputs, mask := 0, false
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
		inputs, mask = len(form.File["image"])+len(form.File["image[]"]), len(form.File["mask"]) > 0
		moderation = c.Request.PostForm.Get("moderation")
	} else if len(request.Moderation) > 0 {
		_ = common.Unmarshal(request.Moderation, &moderation)
	}
	if id := c.GetHeader("X-Gouo-Request-Id"); id != "" && !gouoRequestIDPattern.MatchString(id) {
		return gouoError("图片请求 ID 无效", "invalid_image_request_id", http.StatusBadRequest)
	}
	n, err := request.ImageCount(false)
	if err != nil || n < 1 || n > entry.MaxOutputs {
		return gouoError("单次输出数量超过模型限制", "image_output_limit", http.StatusBadRequest)
	}
	// 光构客户端把一个作品拆成多次请求，按作品内序号核对后台设置的每次最多张数；普通 API 用户只受模型上限约束
	if limit := gouo_setting.Get().MaxImagesPerTask; playground {
		index, _ := strconv.Atoi(c.GetHeader("X-Gouo-Request-Index"))
		if n > limit || index >= limit {
			return gouoError(fmt.Sprintf("一次最多生成 %d 张", limit), "image_task_limit", http.StatusBadRequest)
		}
	}
	if (edit && !entry.Reference) || (mask && !entry.Mask) {
		return gouoError("此模型不支持当前编辑操作，请重新选择", "image_capability_unavailable", http.StatusBadRequest)
	}
	if message := checkGouoImageParams(entry, request.Size, request.Quality, moderation, inputs); message != "" {
		return gouoError(message, "image_param_unavailable", http.StatusBadRequest)
	}
	// 光构客户端必须确认目录价格；普通 API 用户可省略版本，仍使用请求开始时的价格
	if version := c.GetHeader("X-Gouo-Price-Version"); (playground || version != "") && version != entry.PriceVersion {
		return gouoError("模型价格或能力已更新，请刷新模型列表并重新确认提交", "image_price_changed", http.StatusConflict)
	}
	requestID := c.GetHeader("X-Gouo-Request-Id")
	if requestID == "" {
		requestID = "auto:" + c.GetString(common.RequestIdKey)
	}
	charge := &model.GouoImageCharge{ID: model.GouoImageRequestID(info.UserId, requestID), UserID: info.UserId, TokenID: info.TokenId,
		ModelName: entry.ID, PriceCNY: entry.PriceCNY, PriceVersion: entry.PriceVersion, Quota: entry.Quota}
	if err := model.ReserveGouoQuota(charge); err != nil {
		if errors.Is(err, model.ErrGouoImageRequestExists) {
			return gouoError(err.Error(), "image_request_exists", http.StatusConflict)
		}
		return gouoError(err.Error(), "insufficient_image_quota", http.StatusPaymentRequired)
	}
	c.Header("X-Gouo-Charge-Id", charge.ID)
	c.Set(helper.GouoImageContextKey, &gouoImageState{entry: entry, charge: charge})
	return nil
}

// 图片按次计价，尺寸、画质和参考图张数直接影响上游成本，按后台为模型限定的范围校验；审核强度按运营方设置
func checkGouoImageParams(entry *model.GouoImageModel, size, quality, moderation string, inputs int) string {
	// 很多上游不支持任意分辨率，只放行后台为模型开放的档位；没有开放档位时只能用自动尺寸
	if size = strings.ToLower(strings.TrimSpace(size)); size != "" && size != "auto" {
		width, height, ok := strings.Cut(size, "x")
		w, errW := strconv.Atoi(width)
		h, errH := strconv.Atoi(height)
		if !ok || errW != nil || errH != nil || w <= 0 || h <= 0 || w > 100000 || h > 100000 {
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
	if !gouo_setting.Get().AllowLowModeration && strings.EqualFold(strings.TrimSpace(moderation), "low") {
		return "运营方未开放宽松审核"
	}
	if entry.MaxInputs > 0 && inputs > entry.MaxInputs {
		return fmt.Sprintf("此模型最多使用 %d 张参考图", entry.MaxInputs)
	}
	return ""
}

// beginGouoAttempt 在每次向上游派发前运行：记录渠道，并把响应改写到缓冲区，上一次失败尝试写出的内容丢弃
func beginGouoAttempt(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	value, ok := c.Get(helper.GouoImageContextKey)
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
// 返回 true 表示这是光构图片请求，调用方不再走 New API 的结算
func finishGouoImage(c *gin.Context, info *relaycommon.RelayInfo) (bool, *types.NewAPIError) {
	value, ok := c.Get(helper.GouoImageContextKey)
	if !ok {
		return false, nil
	}
	state := value.(*gouoImageState)
	data := state.buffer.body.Bytes()
	var response dto.ImageResponse
	if err := common.Unmarshal(data, &response); err != nil || !validGouoImages(response.Data) {
		return true, types.NewErrorWithStatusCode(errors.New("上游未返回有效图片数据"), types.ErrorCode("invalid_image_response"), http.StatusBadGateway)
	}
	// 只有带客户端请求 ID 的结果能被取回，其余保存只会占用缓存
	if c.GetHeader("X-Gouo-Request-Id") != "" {
		if err := model.SaveGouoImageResult(state.charge.ID, data); err != nil {
			logger.LogError(c, "图片恢复结果保存失败: "+err.Error())
			return true, gouoError("图片结果保存失败，预扣积分已自动退回，可直接重试", "image_result_persist_failed", http.StatusInternalServerError)
		}
	}
	// 先提交账务再回传图片：浏览器断开不能把已经成功的生成误退
	if _, err := model.FinishGouoImageCharge(state.charge.ID, model.GouoChargeSettled, "上游已返回有效图片"); err != nil {
		return true, gouoError(err.Error(), "image_billing_unconfirmed", http.StatusInternalServerError)
	}
	state.settled = true
	other := model.NewLogOther()
	other.SetPublic("billing_unit", "successful_request")
	other.SetPublic("price_cny", state.entry.PriceCNY)
	other.SetPublic("gouo_charge_id", state.charge.ID)
	other.SetAdmin("price_version", state.entry.PriceVersion)
	model.RecordConsumeLog(c, info.UserId, model.RecordConsumeLogParams{
		ChannelId: info.ChannelId, ModelName: state.entry.ID, TokenName: c.GetString("token_name"), Quota: state.charge.Quota,
		TokenId: info.TokenId, Group: info.UsingGroup, Other: other, UseTimeSeconds: int(common.GetTimestamp() - info.StartTime.Unix()),
		Content: []*common.Message{common.NewMessage("光构图片按次计费 {{price}} 元", map[string]any{"price": state.entry.PriceCNY})},
	})
	c.Writer = state.original
	for key, values := range state.buffer.header {
		c.Writer.Header()[key] = values
	}
	c.Writer.WriteHeader(state.buffer.Status())
	if _, err := c.Writer.Write(data); err != nil {
		logger.LogWarn(c, "图片响应回传失败，结果可通过请求 ID 取回: "+err.Error())
	}
	return true, nil
}

// EndGouoImage 在 Relay 结束时运行：恢复响应写入器，没有结算的预扣全部退回（含上游结果未知的情况，这类费用由平台承担）
func EndGouoImage(c *gin.Context, apiErr *types.NewAPIError) *types.NewAPIError {
	value, ok := c.Get(helper.GouoImageContextKey)
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
	if _, err := model.FinishGouoImageCharge(state.charge.ID, model.GouoChargeRefunded, "生成失败，退回预扣积分"); err != nil {
		logger.LogError(c, "图片预扣退款失败: "+err.Error())
	}
	if apiErr == nil {
		return gouoError("生成结果未返回，预扣积分已自动退回，可直接重试", "image_result_missing", http.StatusBadGateway)
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
