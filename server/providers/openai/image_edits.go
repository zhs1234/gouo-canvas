package openai

import (
	"bytes"
	"fmt"
	"mime/multipart"
	"net/http"
	"one-api/common"
	"one-api/common/config"
	"one-api/common/requester"
	"one-api/types"
)

func (p *OpenAIProvider) CreateImageEdits(request *types.ImageEditRequest) (*types.ImageResponse, *types.OpenAIErrorWithStatusCode) {
	req, errWithCode := p.getRequestImageBody(config.RelayModeImagesEdits, request.Model, request)
	if errWithCode != nil {
		return nil, errWithCode
	}
	defer req.Body.Close()

	response, errWithCode := p.requestImageResponse(req)
	if errWithCode != nil {
		return nil, errWithCode
	}

	openaiErr := ErrorHandle(&response.OpenAIErrorResponse)
	if openaiErr != nil {
		errWithCode = &types.OpenAIErrorWithStatusCode{
			OpenAIError: *openaiErr,
			StatusCode:  http.StatusBadRequest,
		}
		return nil, errWithCode
	}

	if response.Usage != nil && response.Usage.TotalTokens > 0 {
		*p.Usage = *response.Usage.ToOpenAIUsage()
	} else {
		p.Usage.TotalTokens = p.Usage.PromptTokens
	}

	return &response.ImageResponse, nil
}

func (p *OpenAIProvider) getRequestImageBody(relayMode int, ModelName string, request *types.ImageEditRequest) (*http.Request, *types.OpenAIErrorWithStatusCode) {
	url, errWithCode := p.GetSupportedAPIUri(relayMode)
	if errWithCode != nil {
		return nil, errWithCode
	}
	// 获取请求地址
	fullRequestURL := p.GetFullRequestURL(url, ModelName)

	// 获取请求头
	headers := p.GetRequestHeaders()
	// 创建请求
	var req *http.Request
	var err error
	if p.OriginalModel != request.Model {
		var formBody bytes.Buffer
		builder := p.Requester.CreateFormBuilder(&formBody)
		if err := imagesEditsMultipartForm(request, p.Context.Request.MultipartForm, builder); err != nil {
			return nil, common.ErrorWrapper(err, "create_form_builder_failed", http.StatusInternalServerError)
		}
		req, err = p.Requester.NewRequest(
			http.MethodPost,
			fullRequestURL,
			p.Requester.WithBody(&formBody),
			p.Requester.WithHeader(headers),
			p.Requester.WithContentType(builder.FormDataContentType()))
		if err == nil {
			req.ContentLength = int64(formBody.Len())
		}
	} else {
		body, exists := p.GetRawBody()
		if !exists {
			return nil, common.StringErrorWrapperLocal("request body not found", "request_body_not_found", http.StatusInternalServerError)
		}
		req, err = p.Requester.NewRequest(
			http.MethodPost,
			fullRequestURL,
			p.Requester.WithBody(body),
			p.Requester.WithHeader(headers),
			p.Requester.WithContentType(p.Context.Request.Header.Get("Content-Type")))
		if err == nil {
			req.ContentLength = p.Context.Request.ContentLength
		}
	}

	if err != nil {
		return nil, common.ErrorWrapper(err, "new_request_failed", http.StatusInternalServerError)
	}

	return req, nil
}

func imagesEditsMultipartForm(request *types.ImageEditRequest, form *multipart.Form, b requester.FormBuilder) (err error) {
	// 原始表单可用时原样转发，只替换映射后的 model，避免字段白名单漏掉 quality、output_format 等参数
	if form != nil {
		for name, values := range form.Value {
			if name == "model" {
				continue
			}
			for _, value := range values {
				if err = b.WriteField(name, value); err != nil {
					return fmt.Errorf("writing %s: %w", name, err)
				}
			}
		}
		for name, files := range form.File {
			for _, file := range files {
				if err = b.CreateFormFile(name, file); err != nil {
					return fmt.Errorf("creating form %s: %w", name, err)
				}
			}
		}
		if err = b.WriteField("model", request.Model); err != nil {
			return fmt.Errorf("writing model name: %w", err)
		}
		return b.Close()
	}

	if request.Image != nil {
		err = b.CreateFormFile("image", request.Image)
		if err != nil {
			return fmt.Errorf("creating form image: %w", err)
		}
	}

	if request.Images != nil {
		for _, image := range request.Images {
			err = b.CreateFormFile("image[]", image)
			if err != nil {
				return fmt.Errorf("creating form images: %w", err)
			}
		}
	}

	err = b.WriteField("prompt", request.Prompt)
	if err != nil {
		return fmt.Errorf("writing prompt: %w", err)
	}

	err = b.WriteField("model", request.Model)
	if err != nil {
		return fmt.Errorf("writing model name: %w", err)
	}

	if request.Mask != nil {
		err = b.CreateFormFile("mask", request.Mask)
		if err != nil {
			return fmt.Errorf("writing mask: %w", err)
		}
	}

	if request.ResponseFormat != "" {
		err = b.WriteField("response_format", request.ResponseFormat)
		if err != nil {
			return fmt.Errorf("writing format: %w", err)
		}
	}

	if request.N != 0 {
		err = b.WriteField("n", fmt.Sprintf("%d", request.N))
		if err != nil {
			return fmt.Errorf("writing n: %w", err)
		}
	}

	if request.Size != "" {
		err = b.WriteField("size", request.Size)
		if err != nil {
			return fmt.Errorf("writing size: %w", err)
		}
	}

	if request.User != "" {
		err = b.WriteField("user", request.User)
		if err != nil {
			return fmt.Errorf("writing user: %w", err)
		}
	}

	return b.Close()
}
