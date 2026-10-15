package config

const (
	GinRequestBodyKey = "cached_request_body"
	// 光构图片请求发往上游时使用的 context：带截止时间，但不随客户端断开而取消
	GinGouoUpstreamContextKey = "gouo_upstream_context"
)
