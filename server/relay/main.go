package relay

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"one-api/common"
	"one-api/common/config"
	"one-api/common/logger"
	"one-api/common/utils"
	"one-api/metrics"
	"one-api/model"
	"one-api/relay/relay_util"
	"one-api/types"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func Relay(c *gin.Context) {
	relay := Path2Relay(c, c.Request.URL.Path)
	if relay == nil {
		common.AbortWithMessage(c, http.StatusNotFound, "Not Found")
		return
	}

	// Apply pre-mapping before setRequest to ensure request body modifications take effect
	applyPreMappingBeforeRequest(c)

	if err := relay.setRequest(); err != nil {
		openaiErr := common.StringErrorWrapperLocal(err.Error(), "one_hub_error", http.StatusBadRequest)
		relay.HandleJsonError(openaiErr)
		return
	}

	c.Set("is_stream", relay.IsStream())
	if err := prepareGouoImage(c, relay); err != nil {
		relay.HandleJsonError(err)
		return
	}
	if _, image := c.Get("gouo_image_model"); image {
		ctx, cancel := context.WithTimeout(c.Request.Context(), model.GouoImageRequestTimeout)
		defer cancel()
		c.Request = c.Request.WithContext(ctx)
	}
	defer func() {
		if value, ok := c.Get("gouo_image_quota"); ok {
			value.(*relay_util.Quota).Undo(c)
		}
	}()
	if err := relay.setProvider(relay.getOriginalModel()); err != nil {
		openaiErr := common.StringErrorWrapperLocal(err.Error(), "one_hub_error", http.StatusServiceUnavailable)
		relay.HandleJsonError(openaiErr)
		return
	}

	heartbeat := relay.SetHeartbeat(relay.IsStream())
	if heartbeat != nil {
		defer heartbeat.Close()
	}

	apiErr, done := RelayHandler(relay)
	if apiErr == nil {
		metrics.RecordProvider(c, 200)
		return
	}

	channel := relay.getProvider().GetChannel()
	go processChannelRelayError(c.Request.Context(), channel.Id, channel.Name, apiErr, channel.Type)

	retryTimes := config.RetryTimes
	if done || !shouldRetry(c, apiErr, channel.Type) {
		logger.LogError(c.Request.Context(), fmt.Sprintf("relay error happen, status code is %d, won't retry in this case", apiErr.StatusCode))
		retryTimes = 0
	}

	startTime := c.GetTime("requestStartTime")
	timeout := time.Duration(config.RetryTimeOut) * time.Second

	for i := retryTimes; i > 0; i-- {
		// 冻结通道
		shouldCooldowns(c, channel, apiErr)

		if time.Since(startTime) > timeout {
			apiErr = common.StringErrorWrapperLocal("重试超时，上游负载已饱和，请稍后再试", "system_error", http.StatusTooManyRequests)
			break
		}

		if err := relay.setProvider(relay.getOriginalModel()); err != nil {
			break
		}

		channel = relay.getProvider().GetChannel()
		logger.LogError(c.Request.Context(), fmt.Sprintf("using channel #%d(%s) to retry (remain times %d)", channel.Id, channel.Name, i))
		apiErr, done = RelayHandler(relay)
		if apiErr == nil {
			metrics.RecordProvider(c, 200)
			return
		}
		go processChannelRelayError(c.Request.Context(), channel.Id, channel.Name, apiErr, channel.Type)
		if done || !shouldRetry(c, apiErr, channel.Type) {
			break
		}
	}

	if apiErr != nil {
		if heartbeat != nil && heartbeat.IsSafeWriteStream() {
			relay.HandleStreamError(apiErr)
			return
		}

		relay.HandleJsonError(apiErr)
	}
}

func RelayHandler(relay RelayBaseInterface) (err *types.OpenAIErrorWithStatusCode, done bool) {
	promptTokens, tonkeErr := relay.getPromptTokens()
	if tonkeErr != nil {
		err = common.ErrorWrapperLocal(tonkeErr, "token_error", http.StatusBadRequest)
		done = true
		return
	}

	usage := &types.Usage{
		PromptTokens: promptTokens,
	}

	relay.getProvider().SetUsage(usage)

	quota := relay_util.NewQuota(relay.getContext(), relay.getModelName(), promptTokens)
	if _, image := relay.getContext().Get("gouo_image_model"); image {
		if value, ok := relay.getContext().Get("gouo_image_quota"); ok {
			quota = value.(*relay_util.Quota)
		} else {
			relay.getContext().Set("gouo_image_quota", quota)
		}
	}
	if err = quota.PreQuotaConsumption(); err != nil {
		done = true
		return
	}
	if err = quota.DispatchImage(relay.getContext()); err != nil {
		done = true
		return
	}

	err, done = relay.send()
	// 最后处理流式中断时计算tokens
	if usage.CompletionTokens == 0 && usage.TextBuilder.Len() > 0 {
		usage.CompletionTokens = common.CountTokenText(usage.TextBuilder.String(), relay.getModelName())
		usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
	}
	if err != nil {
		if _, image := relay.getContext().Get("gouo_image_model"); image {
			code := fmt.Sprint(err.Code)
			if code == "http_request_failed" || code == "decode_response_failed" || code == "read_response_body_failed" || code == "image_result_persist_failed" || err.StatusCode == http.StatusRequestTimeout || err.StatusCode == http.StatusGatewayTimeout || err.StatusCode == 524 {
				diagnostic := imageUnknownDiagnostic(relay.getContext(), err)
				logger.LogError(relay.getContext().Request.Context(), fmt.Sprintf("image result uncertain: channel_id=%d %s", relay.getContext().GetInt("channel_id"), diagnostic))
				quota.MarkImageUnknown(relay.getContext(), "请求已发送但响应未确认，请先核对渠道记录；"+diagnostic)
				err = common.StringErrorWrapperLocal("生成结果未确认，预扣额度待核对。请在使用记录中查看请求状态，避免直接重复提交", "image_result_unknown", http.StatusBadGateway)
				done = true
			} else {
				quota.MarkImageFailed()
			}
		} else {
			quota.Undo(relay.getContext())
		}
		return
	}

	quota.SetFirstResponseTime(relay.GetFirstResponseTime())

	quota.Consume(relay.getContext(), usage, relay.IsStream())

	return
}

func imageUnknownDiagnostic(c *gin.Context, err *types.OpenAIErrorWithStatusCode) string {
	// 错误码、Param 也可能来自上游；只允许有限分类，绝不复制响应正文、URL 或原始消息。
	code, stage, reason := "unrecognized", "upstream_response", "unclassified"
	switch err.Code {
	case "http_request_failed":
		code, stage, reason = "http_request_failed", "request", "transport_failure"
	case "decode_response_failed":
		code, stage, reason = "decode_response_failed", "response_decode", "invalid_or_incomplete_response"
	case "read_response_body_failed":
		code, stage, reason = "read_response_body_failed", "response_read", "body_read_failure"
	case "image_result_persist_failed":
		code, stage, reason = "image_result_persist_failed", "result_storage", "result_save_failure"
	case "timeout", "request_timeout", "gateway_timeout", "upstream_timeout":
		code = err.Code.(string)
	}
	if err.StatusCode == http.StatusRequestTimeout || err.StatusCode == http.StatusGatewayTimeout || err.StatusCode == 524 {
		reason = "upstream_timeout"
	}
	switch err.Param {
	case "image_json_invalid", "image_sse_invalid", "image_response_incomplete", "image_response_empty", "image_response_unsupported_content_type", "image_response_too_large", "network_timeout", "request_timeout", "request_canceled":
		reason = err.Param
	}
	if c.Request.Context().Err() == context.DeadlineExceeded {
		reason = "request_deadline_exceeded"
	} else if c.Request.Context().Err() == context.Canceled {
		reason = "request_canceled"
	}
	return fmt.Sprintf("stage=%s; code=%s; status=%d; reason=%s", stage, code, err.StatusCode, reason)
}

func shouldCooldowns(c *gin.Context, channel *model.Channel, apiErr *types.OpenAIErrorWithStatusCode) {
	modelName := c.GetString("new_model")
	channelId := channel.Id

	// 如果是频率限制，冻结通道
	if apiErr.StatusCode == http.StatusTooManyRequests {
		model.ChannelGroup.SetCooldowns(channelId, modelName)
	}

	skipChannelIds, ok := utils.GetGinValue[[]int](c, "skip_channel_ids")
	if !ok {
		skipChannelIds = make([]int, 0)
	}

	skipChannelIds = append(skipChannelIds, channelId)

	c.Set("skip_channel_ids", skipChannelIds)
}

// applies pre-mapping before setRequest to ensure modifications take effect
func applyPreMappingBeforeRequest(c *gin.Context) {
	// check if this is a chat completion request that needs pre-mapping
	path := c.Request.URL.Path
	if !(strings.HasPrefix(path, "/v1/chat/completions") || strings.HasPrefix(path, "/v1/completions")) {
		return
	}

	bodyBytes, err := io.ReadAll(c.Request.Body)
	if err != nil {
		return
	}
	c.Request.Body.Close()

	// Use defer to ensure request body is always restored
	var finalBodyBytes []byte = bodyBytes // default to original body
	defer func() {
		c.Request.Body = io.NopCloser(bytes.NewBuffer(finalBodyBytes))
	}()

	var requestBody struct {
		Model string `json:"model"`
	}
	if err := json.Unmarshal(bodyBytes, &requestBody); err != nil || requestBody.Model == "" {
		return
	}

	provider, _, err := GetProvider(c, requestBody.Model)
	if err != nil {
		return
	}

	customParams, err := provider.CustomParameterHandler()
	if err != nil || customParams == nil {
		return
	}

	preAdd, exists := customParams["pre_add"]
	if !exists || preAdd != true {
		return
	}

	var requestMap map[string]interface{}
	if err := json.Unmarshal(bodyBytes, &requestMap); err != nil {
		return
	}

	// Apply custom parameter merging
	modifiedRequestMap := mergeCustomParamsForPreMapping(requestMap, customParams)

	// Convert back to JSON - if successful, use modified body; otherwise use original
	if modifiedBodyBytes, err := json.Marshal(modifiedRequestMap); err == nil {
		finalBodyBytes = modifiedBodyBytes
	}
}
