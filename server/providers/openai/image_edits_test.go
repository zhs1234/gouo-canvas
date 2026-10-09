package openai

import (
	"bytes"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"one-api/common/requester"
	"one-api/types"

	"github.com/stretchr/testify/require"
)

func TestImagesEditsMultipartFormKeepsFieldsWhenModelIsMapped(t *testing.T) {
	fields := map[string]string{
		"model":              "public-image",
		"prompt":             "把背景换成海边",
		"size":               "1024x1024",
		"quality":            "high",
		"output_format":      "webp",
		"output_compression": "80",
		"moderation":         "low",
		"response_format":    "b64_json",
	}
	files := map[string][]byte{"image[]": []byte("first-image"), "mask": []byte("mask-bytes")}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for name, value := range fields {
		require.NoError(t, writer.WriteField(name, value))
	}
	for name, data := range files {
		part, err := writer.CreateFormFile(name, name+".png")
		require.NoError(t, err)
		_, err = part.Write(data)
		require.NoError(t, err)
	}
	require.NoError(t, writer.Close())
	incoming := httptest.NewRequest(http.MethodPost, "/v1/images/edits", &body)
	incoming.Header.Set("Content-Type", writer.FormDataContentType())
	require.NoError(t, incoming.ParseMultipartForm(32<<20))

	var out bytes.Buffer
	builder := requester.NewFormBuilder(&out)
	require.NoError(t, imagesEditsMultipartForm(&types.ImageEditRequest{Model: "upstream-image"}, incoming.MultipartForm, builder))

	rebuilt := httptest.NewRequest(http.MethodPost, "/upstream", &out)
	rebuilt.Header.Set("Content-Type", builder.FormDataContentType())
	require.NoError(t, rebuilt.ParseMultipartForm(32<<20))

	// 除 model 外，所有字段和文件内容都应与原请求一致
	fields["model"] = "upstream-image"
	require.Len(t, rebuilt.MultipartForm.Value, len(fields))
	for name, value := range fields {
		require.Equal(t, []string{value}, rebuilt.MultipartForm.Value[name], name)
	}
	require.Len(t, rebuilt.MultipartForm.File, len(files))
	for name, data := range files {
		require.Len(t, rebuilt.MultipartForm.File[name], 1, name)
		file, err := rebuilt.MultipartForm.File[name][0].Open()
		require.NoError(t, err)
		got, err := io.ReadAll(file)
		file.Close()
		require.NoError(t, err)
		require.Equal(t, data, got, name)
	}
}
