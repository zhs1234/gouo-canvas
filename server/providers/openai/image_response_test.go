package openai

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"one-api/common/config"
	"one-api/common/requester"
	"one-api/model"
	"one-api/types"
)

const imageResponseFixture = `{"created":1,"data":[{"url":"https://example.invalid/final.png"}],"usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5}}`

func callImageTestProvider(t *testing.T, endpoint string, handler http.HandlerFunc) (*types.ImageResponse, *types.OpenAIErrorWithStatusCode, *types.Usage) {
	t.Helper()
	upstream := httptest.NewServer(handler)
	t.Cleanup(upstream.Close)
	oldClient := requester.HTTPClient
	requester.HTTPClient = upstream.Client()
	t.Cleanup(func() { requester.HTTPClient = oldClient })
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/"+endpoint, strings.NewReader(`{"model":"local-test","prompt":"test"}`))
	proxy := ""
	p := CreateOpenAIProvider(&model.Channel{Type: config.ChannelTypeOpenAI, Proxy: &proxy, Key: "local-test-only"}, upstream.URL)
	p.SetContext(c)
	p.SetUsage(&types.Usage{PromptTokens: 7})
	var response *types.ImageResponse
	var err *types.OpenAIErrorWithStatusCode
	switch endpoint {
	case "generations":
		response, err = p.CreateImageGenerations(&types.ImageRequest{Model: "local-test", Prompt: "test", N: 1})
	case "edits":
		response, err = p.CreateImageEdits(&types.ImageEditRequest{Model: "local-test", Prompt: "test", N: 1})
	case "variations":
		response, err = p.CreateImageVariations(&types.ImageEditRequest{Model: "local-test", Prompt: "test", N: 1})
	default:
		t.Fatalf("unknown test endpoint: %s", endpoint)
	}
	return response, err, p.Usage
}

func TestImageProviderWaitsPastKeepalive(t *testing.T) {
	for _, endpoint := range []string{"generations", "edits", "variations"} {
		t.Run(endpoint, func(t *testing.T) {
			start := time.Now()
			response, err, _ := callImageTestProvider(t, endpoint, func(w http.ResponseWriter, r *http.Request) {
				require.Equal(t, "/v1/images/"+endpoint, r.URL.Path)
				w.Header().Set("Content-Type", "application/json")
				time.Sleep(20 * time.Millisecond)
				fmt.Fprint(w, ": ping\n\n")
				w.(http.Flusher).Flush()
				time.Sleep(20 * time.Millisecond)
				fmt.Fprint(w, imageResponseFixture)
			})
			require.Nil(t, err)
			require.Equal(t, "https://example.invalid/final.png", response.Data[0].URL)
			require.GreaterOrEqual(t, time.Since(start), 40*time.Millisecond)
		})
	}
}

func TestImageProviderSSECompleteResponse(t *testing.T) {
	response, err, usage := callImageTestProvider(t, "generations", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, ": keepalive\r\n\r\nevent: ping\r\ndata: {}\r\n\r\n")
		w.(http.Flusher).Flush()
		fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", imageResponseFixture)
	})
	require.Nil(t, err)
	require.Len(t, response.Data, 1)
	require.Equal(t, 5, usage.TotalTokens)
}

// 默认不增加每次单测耗时；仅本地诊断时启用，仍只访问 httptest 的回环地址。
func TestImageProviderFifteenSecondKeepalive(t *testing.T) {
	if os.Getenv("GOUO_TEST_IMAGE_KEEPALIVE_15S") != "1" {
		t.Skip("set GOUO_TEST_IMAGE_KEEPALIVE_15S=1 for the local 15-second regression")
	}
	start := time.Now()
	response, err, _ := callImageTestProvider(t, "generations", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "event: started\ndata: {\"status\":\"started\"}\n\n")
		w.(http.Flusher).Flush()
		time.Sleep(15 * time.Second)
		fmt.Fprint(w, "event: heartbeat\ndata: {\"elapsed\":15}\n\n")
		w.(http.Flusher).Flush()
		time.Sleep(100 * time.Millisecond)
		fmt.Fprintf(w, "event: completed\ndata: %s\n\nevent: done\ndata: {}\n\n", imageResponseFixture)
	})
	require.Nil(t, err)
	require.Len(t, response.Data, 1)
	t.Logf("local keepalive regression completed after %s", time.Since(start).Round(time.Millisecond))
}

func TestImageProviderResponseFormats(t *testing.T) {
	var pngData bytes.Buffer
	require.NoError(t, png.Encode(&pngData, image.NewRGBA(image.Rect(0, 0, 1, 1))))
	encoded := base64.StdEncoding.EncodeToString(pngData.Bytes())
	for _, tc := range []struct {
		name, contentType, body, endpoint string
		wantBase64                        bool
	}{
		{"json", "application/json", imageResponseFixture, "generations", false},
		{"json-whitespace", "application/json", " \n\r\n\t" + imageResponseFixture, "generations", false},
		{"json-carriage-return", "application/json", "\r" + imageResponseFixture, "generations", false},
		{"json-comments", "application/json", ": ping\r\n\r\n: keepalive\n\n" + imageResponseFixture, "generations", false},
		{"heyroute", "text/event-stream", "event: started\ndata: {}\n\nevent: heartbeat\ndata: {\"elapsed\":15}\n\nevent: completed\ndata: " + imageResponseFixture + "\n\nevent: done\ndata: {}\n\n", "generations", false},
		{"heartbeat-metadata", "text/event-stream", "event: heartbeat\ndata: keepalive\n\nevent: heartbeat\ndata: 15\n\nevent: completed\ndata: " + imageResponseFixture + "\n\n", "generations", false},
		{"sse-bom", "text/event-stream", "\xef\xbb\xbfevent: completed\ndata: " + imageResponseFixture + "\n\n", "generations", false},
		{"mislabeled-sse", "application/json", "event: completed\ndata: " + imageResponseFixture + "\n\n", "generations", false},
		{"multiline-sse", "text/event-stream", "id: image-1\nretry: 1000\nevent: completed\ndata: {\"data\":\ndata: [{\"url\":\"https://example.invalid/final.png\"}]}\n\n", "generations", false},
		{"official-generation", "text/event-stream", "data: {\"type\":\"image_generation.partial_image\",\"b64_json\":\"preview\"}\n\ndata: {\"type\":\"image_generation.completed\",\"b64_json\":\"" + encoded + "\",\"usage\":{\"input_tokens\":2,\"output_tokens\":3,\"total_tokens\":5}}\n\n", "generations", true},
		{"official-edit", "text/event-stream", "event: image_edit.completed\ndata: {\"type\":\"image_edit.completed\",\"b64_json\":\"" + encoded + "\"}\n\n", "edits", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response, err, _ := callImageTestProvider(t, tc.endpoint, func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", tc.contentType)
				fmt.Fprint(w, tc.body)
			})
			require.Nil(t, err)
			require.Len(t, response.Data, 1)
			if tc.wantBase64 {
				require.Equal(t, encoded, response.Data[0].B64JSON)
			} else {
				require.Equal(t, "https://example.invalid/final.png", response.Data[0].URL)
			}
		})
	}
}

func TestImageProviderRejectsUnconfirmedResponses(t *testing.T) {
	for _, tc := range []struct{ name, body string }{
		{"empty", ""},
		{"heartbeat-only", "event: heartbeat\ndata: {}\n\n"},
		{"comment-only", ": ping\n\n"},
		{"partial-only", "data: {\"type\":\"image_generation.partial_image\",\"b64_json\":\"preview\"}\n\n"},
		{"partial-with-data-is-not-final", "data: {\"type\":\"image_generation.partial_image\",\"data\":[{\"url\":\"https://example.invalid/preview.png\"}]}\n\n"},
		{"done-before-completed", "event: done\ndata: {}\n\n"},
		{"done-marker-before-completed", "data: [DONE]\n\n"},
		{"truncated-json", "{\"data\":["},
		{"truncated-sse-frame", "event: completed\ndata: " + imageResponseFixture},
		{"malformed-sse-json", "event: completed\ndata: {\n\n"},
		{"unknown-event", "event: something_else\ndata: " + imageResponseFixture + "\n\n"},
		{"unknown-field", "not-an-sse-field: value\n\n"},
		{"html", "<html>gateway error</html>\n"},
		{"garbage-before-json", "not-a-heartbeat\n" + imageResponseFixture},
		{"completed-without-image", "event: completed\ndata: {\"status\":\"ok\"}\n\n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response, err, _ := callImageTestProvider(t, "generations", func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				fmt.Fprint(w, tc.body)
			})
			require.Nil(t, response)
			require.NotNil(t, err)
			require.Equal(t, "decode_response_failed", err.Code)
			require.Contains(t, []string{"image_response_empty", "image_response_incomplete", "image_sse_invalid", "image_json_invalid"}, err.Param)
			require.Equal(t, "图片上游响应未能解析为最终结果", err.Message)
		})
	}
}

func TestImageProviderPreservesUpstreamErrorsAndUsage(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		status     int
	}{
		{"json-error", `{"error":{"message":"rejected","type":"invalid_request_error","code":"policy_rejected"}}`, 200},
		{"sse-error", "event: error\ndata: {\"error\":{\"message\":\"rejected\",\"type\":\"invalid_request_error\",\"code\":\"policy_rejected\"}}\n\n", 200},
		{"sse-top-level-error", "event: error\ndata: {\"message\":\"rejected\",\"type\":\"server_error\",\"code\":\"policy_rejected\"}\n\n", 200},
		{"http-error", `{"error":{"message":"rejected","type":"invalid_request_error","code":"policy_rejected"}}`, 429},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response, err, usage := callImageTestProvider(t, "generations", func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tc.status)
				fmt.Fprint(w, tc.body)
			})
			require.Nil(t, response)
			require.Equal(t, "policy_rejected", err.Code)
			require.Contains(t, err.Message, "rejected")
			require.Zero(t, usage.TotalTokens)
			if tc.status == 429 {
				require.Equal(t, 429, err.StatusCode)
			} else {
				require.Equal(t, 400, err.StatusCode)
			}
		})
	}
	response, err, usage := callImageTestProvider(t, "edits", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, "event: completed\ndata: %s\n\n", imageResponseFixture)
	})
	require.Nil(t, err)
	require.Equal(t, 5, response.Usage.TotalTokens)
	require.Equal(t, 2, usage.PromptTokens)
	require.Equal(t, 3, usage.CompletionTokens)
}

func TestImageProviderReturnsAtCompletedWithoutWaitingForEOF(t *testing.T) {
	start := time.Now()
	response, err, _ := callImageTestProvider(t, "generations", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintf(w, "event: completed\ndata: %s\n\n", imageResponseFixture)
		w.(http.Flusher).Flush()
		select {
		case <-r.Context().Done():
		case <-time.After(2 * time.Second):
		}
	})
	require.Nil(t, err)
	require.Len(t, response.Data, 1)
	require.Less(t, time.Since(start), time.Second)
}

func TestImageResponseLargeFramesAndReadLimits(t *testing.T) {
	encoded := strings.Repeat("A", 100_000)
	response, reason := decodeImageResponse(strings.NewReader("data: {\"type\":\"image_generation.completed\",\"b64_json\":\""+encoded+"\"}\n\n"), 200_000)
	require.Empty(t, reason)
	require.Equal(t, encoded, response.Data[0].B64JSON)
	_, reason = decodeImageResponse(strings.NewReader(imageResponseFixture), 8)
	require.Equal(t, "image_response_too_large", reason)
	_, reason = decodeImageResponse(io.MultiReader(strings.NewReader(": ping\n\n"), errorImageReader{context.DeadlineExceeded}), 100)
	require.Equal(t, "network_timeout", reason)
	_, reason = decodeImageResponse(errorImageReader{context.Canceled}, 100)
	require.Equal(t, "request_canceled", reason)
}

type errorImageReader struct{ err error }

func (r errorImageReader) Read([]byte) (int, error) { return 0, r.err }

type imageTestTransport func(*http.Request) (*http.Response, error)

func (f imageTestTransport) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }

func TestImageProviderTransportErrorIsSafe(t *testing.T) {
	oldClient := requester.HTTPClient
	t.Cleanup(func() { requester.HTTPClient = oldClient })
	requester.HTTPClient = &http.Client{Transport: imageTestTransport(func(req *http.Request) (*http.Response, error) {
		return nil, &url.Error{Op: "Post", URL: "https://private.invalid/token-secret", Err: context.DeadlineExceeded}
	})}
	p := &OpenAIProvider{}
	req, requestErr := http.NewRequest(http.MethodPost, "https://example.invalid/image", nil)
	require.NoError(t, requestErr)
	response, err := p.requestImageResponse(req)
	require.Nil(t, response)
	require.Equal(t, "http_request_failed", err.Code)
	require.Equal(t, "network_timeout", err.Param)
	require.NotContains(t, err.Message, "token-secret")
	require.NotContains(t, err.Message, "private.invalid")
}
