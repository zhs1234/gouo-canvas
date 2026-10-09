package openai

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"

	"one-api/common"
	"one-api/common/requester"
	"one-api/types"
)

// 只用于图片接口：部分兼容渠道即使未请求 stream，也固定返回 SSE。
func (p *OpenAIProvider) requestImageResponse(req *http.Request) (*OpenAIProviderImageResponse, *types.OpenAIErrorWithStatusCode) {
	resp, err := requester.HTTPClient.Do(req)
	if err != nil {
		if resp != nil && resp.Body != nil {
			resp.Body.Close()
		}
		// 网络错误可能包含带凭据的 URL，禁止传入会记录原文的通用包装器。
		failure := common.StringErrorWrapper("图片上游连接失败，结果尚未确认", "http_request_failed", http.StatusInternalServerError)
		failure.Param = "transport_failure"
		var networkError net.Error
		if errors.Is(err, context.Canceled) {
			failure.Param = "request_canceled"
		} else if errors.As(err, &networkError) && networkError.Timeout() {
			failure.Param = "network_timeout"
		}
		return nil, failure
	}
	defer resp.Body.Close()
	if p.Requester.IsFailureStatusCode(resp) {
		return nil, requester.HandleErrorResp(resp, p.Requester.ErrorHandler, p.Requester.IsOpenAI)
	}
	// 图片 base64 可能超过 Scanner 的默认行长；同时为异常上游保留总读取上限。
	response, reason := decodeImageResponse(resp.Body, 256*1024*1024)
	if reason != "" {
		failure := common.StringErrorWrapper("图片上游响应未能解析为最终结果", "decode_response_failed", http.StatusInternalServerError)
		failure.Param = reason
		return nil, failure
	}
	return response, nil
}

func decodeImageResponse(body io.Reader, maxBytes int64) (*OpenAIProviderImageResponse, string) {
	limited := &io.LimitedReader{R: body, N: maxBytes + 1}
	reader := bufio.NewReader(limited)
	var event string
	var data []string
	seenInput, seenSSE := false, false
	for {
		first, err := reader.Peek(1)
		if err != nil {
			if limited.N == 0 {
				return nil, "image_response_too_large"
			}
			if err == io.EOF && !seenInput {
				return nil, "image_response_empty"
			}
			return nil, imageResponseReadError(err, "image_response_incomplete")
		}
		if !seenInput && first[0] == 0xef {
			bom, err := reader.Peek(3)
			if err != nil || string(bom) != "\xef\xbb\xbf" {
				return nil, "image_json_invalid"
			}
			reader.Discard(3)
			seenInput = true
			continue
		}
		if first[0] == ' ' || first[0] == '\t' || (first[0] == '\r' && !seenSSE) {
			reader.ReadByte()
			continue
		}
		// 允许 JSON 前置空白或标准 SSE 注释，不跳过 HTML 和任意文本。
		if first[0] == '{' && !seenSSE {
			response := &OpenAIProviderImageResponse{}
			err := json.NewDecoder(reader).Decode(response)
			if limited.N == 0 {
				return nil, "image_response_too_large"
			}
			if err != nil {
				if errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, io.EOF) {
					return nil, "image_response_incomplete"
				}
				return nil, imageResponseReadError(err, "image_json_invalid")
			}
			return response, ""
		}
		line, err := reader.ReadString('\n')
		if limited.N == 0 {
			return nil, "image_response_too_large"
		}
		if err != nil {
			return nil, imageResponseReadError(err, "image_response_incomplete")
		}
		line = strings.TrimSuffix(strings.TrimSuffix(line, "\n"), "\r")
		if line == "" {
			if event != "" || len(data) > 0 {
				response, reason := decodeImageEvent(event, strings.Join(data, "\n"))
				if response != nil || reason != "" {
					return response, reason
				}
			}
			event, data = "", nil
			continue
		}
		seenInput = true
		if strings.HasPrefix(line, ":") {
			continue
		}
		field, value, _ := strings.Cut(line, ":")
		value = strings.TrimPrefix(value, " ")
		switch field {
		case "event":
			event = value
		case "data":
			data = append(data, value)
		case "id", "retry":
			// 标准 SSE 元数据不参与图片结果。
		default:
			return nil, "image_sse_invalid"
		}
		seenSSE = true
	}
}

func imageResponseReadError(err error, fallback string) string {
	var networkError net.Error
	if errors.Is(err, context.Canceled) {
		return "request_canceled"
	}
	if errors.As(err, &networkError) && networkError.Timeout() {
		return "network_timeout"
	}
	return fallback
}

func decodeImageEvent(event, data string) (*OpenAIProviderImageResponse, string) {
	if data == "[DONE]" || event == "done" {
		return nil, "image_response_incomplete"
	}
	if event == "started" || event == "heartbeat" || event == "ping" || event == "keepalive" {
		return nil, ""
	}
	var payload struct {
		OpenAIProviderImageResponse
		Type    string `json:"type"`
		B64JSON string `json:"b64_json"`
		Message string `json:"message"`
		Code    any    `json:"code"`
	}
	if json.Unmarshal([]byte(data), &payload) != nil {
		return nil, "image_sse_invalid"
	}
	if payload.Error.Message != "" {
		return &payload.OpenAIProviderImageResponse, ""
	}
	if payload.Type != "" && event != "error" {
		if event != "" && event != "message" && event != payload.Type && !(event == "completed" && (payload.Type == "image_generation.completed" || payload.Type == "image_edit.completed")) {
			return nil, "image_sse_invalid"
		}
		event = payload.Type
	}
	switch event {
	case "started", "heartbeat", "ping", "keepalive", "image_generation.partial_image", "image_edit.partial_image":
		// 中间预览和心跳都不是完成依据；必须继续等终态。
		return nil, ""
	case "error", "image_generation.failed", "image_edit.failed":
		if payload.Message == "" {
			payload.Message = "图片上游报告生成失败"
		}
		payload.Error = types.OpenAIError{Message: payload.Message, Type: "upstream_error", Code: payload.Code}
		return &payload.OpenAIProviderImageResponse, ""
	case "completed", "image_generation.completed", "image_edit.completed":
		if len(payload.Data) == 0 && strings.TrimSpace(payload.B64JSON) != "" {
			payload.Data = []types.ImageResponseDataInner{{B64JSON: payload.B64JSON}}
		}
	case "", "message":
		// 兼容无 event/type、直接在 data 帧中返回普通 Images API 结果的渠道。
	default:
		return nil, "image_sse_invalid"
	}
	if payload.Data == nil {
		return nil, "image_sse_invalid"
	}
	return &payload.OpenAIProviderImageResponse, ""
}
