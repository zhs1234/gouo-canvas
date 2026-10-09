package relay_util

import (
	"context"
	"errors"
	"math"
	"net/http"
	"one-api/common"
	"one-api/common/config"
	"one-api/common/logger"
	"one-api/common/utils"
	"one-api/model"
	"one-api/types"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/datatypes"
)

type Quota struct {
	modelName         string
	promptTokens      int
	price             model.Price
	groupName         string
	isBackupGroup     bool // 新增字段记录是否使用备用分组
	backupGroupName   string
	groupRatio        float64
	inputRatio        float64
	outputRatio       float64
	preConsumedQuota  int
	cacheQuota        int
	userId            int
	channelId         int
	tokenId           int
	unlimitedQuota    bool
	fixedQuota        int
	imageModel        *model.GouoImageModel
	imageCharge       *model.GouoImageCharge
	imageUncertain    bool
	imageFailureKnown bool
	imageCompleted    bool
	HandelStatus      bool

	startTime         time.Time
	firstResponseTime time.Time
	extraBillingData  map[string]ExtraBillingData
}

func NewQuota(c *gin.Context, modelName string, promptTokens int) *Quota {
	isBackupGroup := c.GetBool("is_backupGroup")

	quota := &Quota{
		modelName:      modelName,
		promptTokens:   promptTokens,
		userId:         c.GetInt("id"),
		channelId:      c.GetInt("channel_id"),
		tokenId:        c.GetInt("token_id"),
		unlimitedQuota: c.GetBool("token_unlimited_quota"),
		HandelStatus:   false,
		isBackupGroup:  isBackupGroup, // 记录是否使用备用分组
	}

	quota.price = *model.PricingInstance.GetPrice(quota.modelName)
	quota.groupName = c.GetString("token_group")
	quota.backupGroupName = c.GetString("token_backup_group")
	quota.groupRatio = c.GetFloat64("group_ratio") // 这里的倍率已经在 common.go 中正确设置了
	quota.inputRatio = quota.price.GetInput() * quota.groupRatio
	quota.outputRatio = quota.price.GetOutput() * quota.groupRatio
	if entry, ok := c.Get("gouo_image_model"); ok {
		quota.imageModel = entry.(*model.GouoImageModel)
		quota.modelName = quota.imageModel.ID
		quota.fixedQuota = quota.imageModel.Quota
		quota.groupRatio = 1
		id := c.GetString(logger.RequestIdKey)
		if id == "" {
			id = utils.GetUUID()
		}
		if requestID := c.GetHeader("X-Gouo-Request-Id"); requestID != "" {
			id = model.GouoImageRequestID(quota.userId, requestID)
		}
		if _, exists := c.Get("gouo_image_quota"); !exists {
			c.Header("X-Gouo-Charge-Id", id)
		}
		quota.imageCharge = &model.GouoImageCharge{ID: id, UserID: quota.userId, TokenID: quota.tokenId, ModelName: quota.modelName, PriceCNY: quota.imageModel.PriceCNY, PriceVersion: quota.imageModel.PriceVersion, Quota: quota.fixedQuota}
	}

	return quota

}

func (q *Quota) PreQuotaConsumption() *types.OpenAIErrorWithStatusCode {
	if q.imageModel != nil {
		if q.HandelStatus || q.imageCompleted {
			return nil
		}
		err := model.ReserveGouoQuota(q.imageCharge)
		if err != nil {
			if errors.Is(err, model.ErrGouoImageRequestExists) {
				return common.ErrorWrapperLocal(err, "image_request_exists", http.StatusConflict)
			}
			return common.ErrorWrapperLocal(err, "insufficient_image_quota", http.StatusPaymentRequired)
		}
		q.preConsumedQuota = q.fixedQuota
		q.unlimitedQuota = q.imageCharge.UnlimitedQuota
		q.HandelStatus = true
		return nil
	}
	// 其他入口（recraft 工具、任务、搜索等）不经过光构图片结算，不能按通用计费免费调用光构图片模型
	if q.price.GouoEnabled {
		return common.StringErrorWrapperLocal("此模型只能通过图片生成接口调用", "image_model_endpoint", http.StatusBadRequest)
	}
	if q.fixedQuota > 0 {
		q.preConsumedQuota = q.fixedQuota
	} else if q.price.Type == model.TimesPriceType {
		q.preConsumedQuota = int(1000 * q.inputRatio)
	} else if q.price.Input != 0 || q.price.Output != 0 {
		q.preConsumedQuota = int(float64(q.promptTokens)*q.inputRatio) + config.PreConsumedQuota
	}

	if q.preConsumedQuota == 0 {
		return nil
	}

	userQuota, err := model.CacheGetUserQuota(q.userId)
	if err != nil {
		return common.ErrorWrapper(err, "get_user_quota_failed", http.StatusInternalServerError)
	}

	if userQuota < q.preConsumedQuota {
		return common.ErrorWrapper(errors.New("user quota is not enough"), "insufficient_user_quota", http.StatusPaymentRequired)
	}

	err = model.CacheDecreaseUserQuota(q.userId, q.preConsumedQuota)
	if err != nil {
		return common.ErrorWrapper(err, "decrease_user_quota_failed", http.StatusInternalServerError)
	}

	if userQuota > 100*q.preConsumedQuota {
		// in this case, we do not pre-consume quota
		// because the user has enough quota
		q.preConsumedQuota = 0
		// common.LogInfo(c.Request.Context(), fmt.Sprintf("user %d has enough quota %d, trusted and no need to pre-consume", userId, userQuota))
	}

	if q.preConsumedQuota > 0 {
		err := model.PreConsumeTokenQuota(q.tokenId, q.preConsumedQuota)
		if err != nil {
			return common.ErrorWrapper(err, "pre_consume_token_quota_failed", http.StatusForbidden)
		}
		q.HandelStatus = true
	}

	return nil
}

// 更新用户实时配额
func (q *Quota) UpdateUserRealtimeQuota(usage *types.UsageEvent, nowUsage *types.UsageEvent) error {
	usage.Merge(nowUsage)

	// 不开启Redis，则不更新实时配额
	if !config.RedisEnabled {
		return nil
	}

	promptTokens, completionTokens := q.getComputeTokensByUsageEvent(nowUsage)
	increaseQuota := q.GetTotalQuota(promptTokens, completionTokens, nil)

	cacheQuota, err := model.CacheIncreaseUserRealtimeQuota(q.userId, increaseQuota)
	if err != nil {
		return errors.New("error update user realtime quota cache: " + err.Error())
	}

	q.cacheQuota += increaseQuota
	userQuota, err := model.CacheGetUserQuota(q.userId)
	if err != nil {
		return errors.New("error get user quota cache: " + err.Error())
	}

	if cacheQuota >= int64(userQuota) {
		return errors.New("user quota is not enough")
	}

	return nil
}

func (q *Quota) completedQuotaConsumption(usage *types.Usage, tokenName string, isStream bool, sourceIp string, ctx context.Context) error {
	defer func() {
		if q.cacheQuota > 0 {
			model.CacheDecreaseUserRealtimeQuota(q.userId, q.cacheQuota)
		}
	}()

	quota := q.GetTotalQuotaByUsage(usage)

	if quota > 0 {
		quotaDelta := quota - q.preConsumedQuota
		err := model.PostConsumeTokenQuotaWithInfo(q.tokenId, q.userId, q.unlimitedQuota, quotaDelta)
		if err != nil {
			return errors.New("error consuming token remain quota: " + err.Error())
		}
		err = model.CacheUpdateUserQuota(q.userId)
		if err != nil {
			return errors.New("error consuming token remain quota: " + err.Error())
		}
		model.UpdateChannelUsedQuota(q.channelId, quota)
	}

	model.RecordConsumeLog(
		ctx,
		q.userId,
		q.channelId,
		usage.PromptTokens,
		usage.CompletionTokens,
		q.modelName,
		tokenName,
		quota,
		"",
		q.getRequestTime(),
		isStream,
		q.GetLogMeta(usage),
		sourceIp,
	)
	model.UpdateUserUsedQuotaAndRequestCount(q.userId, quota)

	return nil
}

func (q *Quota) Undo(c *gin.Context) {
	if q.imageModel != nil {
		if !q.HandelStatus || q.imageCompleted {
			return
		}
		if q.imageUncertain || (q.imageCharge.Status == model.GouoChargeDispatched && !q.imageFailureKnown) {
			q.MarkImageUnknown(c, "上游结果或结算未确认，请核对请求记录")
			return
		}
		if err := model.FinishGouoImageCharge(q.imageCharge.ID, q.imageCharge.Status, model.GouoChargeRefunded, nil, 0, "生成失败，恢复预扣额度"); err != nil {
			logger.LogError(c.Request.Context(), "图片预扣退款失败: "+err.Error())
			return
		}
		q.HandelStatus = false
		return
	}
	if q.HandelStatus {
		go func(ctx context.Context) {
			// return pre-consumed quota
			err := model.PostConsumeTokenQuotaWithInfo(q.tokenId, q.userId, q.unlimitedQuota, -q.preConsumedQuota)
			if err != nil {
				logger.LogError(ctx, "error return pre-consumed quota: "+err.Error())
			}
		}(c.Request.Context())
	}
}

func (q *Quota) Consume(c *gin.Context, usage *types.Usage, isStream bool) {
	if q.imageModel != nil {
		if err := q.CompleteImage(c, usage); err != nil {
			logger.LogError(c.Request.Context(), err.Error())
		}
		return
	}
	tokenName := c.GetString("token_name")
	q.startTime = c.GetTime("requestStartTime")
	// 如果没有报错，则消费配额
	go func(ctx context.Context) {
		err := q.completedQuotaConsumption(usage, tokenName, isStream, c.ClientIP(), ctx)
		if err != nil {
			logger.LogError(ctx, err.Error())
		}
	}(c.Request.Context())
}

func (q *Quota) DispatchImage(c *gin.Context) *types.OpenAIErrorWithStatusCode {
	if q.imageCharge == nil {
		return nil
	}
	if err := model.DispatchGouoImageCharge(q.imageCharge.ID, c.GetInt("channel_id")); err != nil {
		return common.ErrorWrapperLocal(err, "image_billing_state_changed", http.StatusConflict)
	}
	q.imageCharge.Status = model.GouoChargeDispatched
	q.imageFailureKnown = false
	return nil
}

func (q *Quota) MarkImageFailed() { q.imageFailureKnown = true }

func (q *Quota) SaveImageResult(c *gin.Context, response *types.ImageResponse) error {
	// 只有带客户端请求 ID 的结果能被取回；其余保存只会占用缓存。
	if c.GetHeader("X-Gouo-Request-Id") == "" {
		return nil
	}
	if err := model.SaveGouoImageResult(q.imageCharge.ID, response); err != nil {
		q.MarkImageUnknown(c, "上游已返回图片，但恢复结果保存失败，请管理员核对存储与渠道记录")
		logger.LogError(c.Request.Context(), "图片恢复结果保存失败: "+err.Error())
		return err
	}
	return nil
}

func (q *Quota) MarkImageUnknown(c *gin.Context, note string) {
	q.imageUncertain = true
	if err := model.ReviewGouoImageCharge(q.imageCharge.ID, note); err != nil {
		logger.LogError(c.Request.Context(), "图片待核对状态保存失败: "+err.Error())
	}
	c.Header("X-Gouo-Billing-Status", model.GouoChargeReview)
}

// 上游成功后先提交账务，再回传图片；浏览器断开不能把已经成功的生成误退。
func (q *Quota) CompleteImage(c *gin.Context, usage *types.Usage) error {
	if q.imageCompleted || !q.HandelStatus {
		return nil
	}
	q.startTime = c.GetTime("requestStartTime")
	entry := &model.Log{PromptTokens: usage.PromptTokens, CompletionTokens: usage.CompletionTokens, RequestTime: q.getRequestTime(), SourceIp: c.ClientIP(), Metadata: datatypes.NewJSONType(q.GetLogMeta(usage))}
	if err := model.FinishGouoImageCharge(q.imageCharge.ID, q.imageCharge.Status, model.GouoChargeSettled, entry, 0, "上游已返回有效图片"); err != nil {
		q.MarkImageUnknown(c, "上游已返回图片，但结算提交未确认，请核对数据库与渠道记录")
		return err
	}
	q.imageCompleted, q.HandelStatus = true, false
	c.Header("X-Gouo-Billing-Status", model.GouoChargeSettled)
	return nil
}

func (q *Quota) GetInputRatio() float64 {
	return q.inputRatio
}

func (q *Quota) GetLogMeta(usage *types.Usage) map[string]any {
	meta := map[string]any{
		"group_name":        q.groupName,
		"backup_group_name": q.backupGroupName,
		"is_backup_group":   q.isBackupGroup, // 添加是否使用备用分组的标识
		"price_type":        q.price.Type,
		"group_ratio":       q.groupRatio,
		"input_ratio":       q.price.GetInput(),
		"output_ratio":      q.price.GetOutput(),
	}
	if q.imageModel != nil {
		meta["price_type"] = model.TimesPriceType
		meta["price_cny"] = q.imageModel.PriceCNY
		meta["billing_unit"] = "successful_request"
		meta["price_version"] = q.imageModel.PriceVersion
		meta["charged_quota"] = q.fixedQuota
	}

	firstResponseTime := q.GetFirstResponseTime()
	if firstResponseTime > 0 {
		meta["first_response"] = firstResponseTime
	}

	if usage != nil {
		extraTokens := usage.GetExtraTokens()

		for key, value := range extraTokens {
			meta[key] = value
			extraRatio := q.price.GetExtraRatio(key)
			meta[key+"_ratio"] = extraRatio
		}
	}

	if q.extraBillingData != nil {
		meta["extra_billing"] = q.extraBillingData
	}

	return meta
}

func (q *Quota) getRequestTime() int {
	return int(time.Since(q.startTime).Milliseconds())
}

// 通过 token 数获取消费配额
func (q *Quota) GetTotalQuota(promptTokens, completionTokens int, extraBilling map[string]types.ExtraBilling) (quota int) {
	if q.fixedQuota > 0 {
		return q.fixedQuota
	}
	if q.price.Type == model.TimesPriceType {
		quota = int(1000 * q.inputRatio)
	} else {
		quota = int(math.Ceil((float64(promptTokens) * q.inputRatio) + (float64(completionTokens) * q.outputRatio)))
	}

	q.GetExtraBillingData(extraBilling)
	extraBillingQuota := 0
	if q.extraBillingData != nil {
		for _, value := range q.extraBillingData {
			extraBillingQuota += int(math.Ceil(
				float64(value.Price)*float64(config.QuotaPerUnit),
			)) * value.CallCount
		}
	}

	if extraBillingQuota > 0 {
		quota += int(math.Ceil(
			float64(extraBillingQuota) * q.groupRatio,
		))
	}

	if q.inputRatio != 0 && quota <= 0 {
		quota = 1
	}
	totalTokens := promptTokens + completionTokens
	if totalTokens == 0 {
		// in this case, must be some error happened
		// we cannot just return, because we may have to return the pre-consumed quota
		quota = 0
	}

	return quota
}

// 获取计算的 token 数
func (q *Quota) getComputeTokensByUsage(usage *types.Usage) (promptTokens, completionTokens int) {
	promptTokens = usage.PromptTokens
	completionTokens = usage.CompletionTokens

	extraTokens := usage.GetExtraTokens()

	for key, value := range extraTokens {
		extraRatio := q.price.GetExtraRatio(key)
		if model.GetExtraPriceIsPrompt(key) {
			promptTokens += model.GetIncreaseTokens(value, extraRatio)
		} else {
			completionTokens += model.GetIncreaseTokens(value, extraRatio)
		}
	}

	return
}

func (q *Quota) getComputeTokensByUsageEvent(usage *types.UsageEvent) (promptTokens, completionTokens int) {
	promptTokens = usage.InputTokens
	completionTokens = usage.OutputTokens
	extraTokens := usage.GetExtraTokens()

	for key, value := range extraTokens {
		extraRatio := q.price.GetExtraRatio(key)
		if model.GetExtraPriceIsPrompt(key) {
			promptTokens += model.GetIncreaseTokens(value, extraRatio)
		} else {
			completionTokens += model.GetIncreaseTokens(value, extraRatio)
		}
	}

	return
}

// 通过 usage 获取消费配额
func (q *Quota) GetTotalQuotaByUsage(usage *types.Usage) (quota int) {
	promptTokens, completionTokens := q.getComputeTokensByUsage(usage)
	return q.GetTotalQuota(promptTokens, completionTokens, usage.ExtraBilling)
}

func (q *Quota) GetFirstResponseTime() int64 {
	// 先判断 firstResponseTime 是否为0
	if q.firstResponseTime.IsZero() {
		return 0
	}

	return q.firstResponseTime.Sub(q.startTime).Milliseconds()
}

func (q *Quota) SetFirstResponseTime(firstResponseTime time.Time) {
	q.firstResponseTime = firstResponseTime
}

type ExtraBillingData struct {
	Type      string  `json:"type"`
	CallCount int     `json:"call_count"`
	Price     float64 `json:"price"`
}

func (q *Quota) GetExtraBillingData(extraBilling map[string]types.ExtraBilling) {
	if extraBilling == nil {
		return
	}

	extraBillingData := make(map[string]ExtraBillingData)
	for serviceType, value := range extraBilling {
		extraBillingData[serviceType] = ExtraBillingData{
			Type:      value.Type,
			CallCount: value.CallCount,
			Price:     getDefaultExtraServicePrice(serviceType, q.modelName, value.Type),
		}

	}

	if len(extraBillingData) == 0 {
		return
	}

	q.extraBillingData = extraBillingData
}
