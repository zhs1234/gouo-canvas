package image

import (
	"encoding/json"
	"errors"
	"net/http"
	"one-api/common/config"
	"one-api/common/utils"
	"time"
)

var ImageHttpClients = &http.Client{
	Transport: &http.Transport{
		DialContext: utils.Socks5ProxyFunc,
		Proxy:       utils.ProxyFunc,
	},
	Timeout: 15 * time.Second,
	// 经管理员配置的代理下载用户图片时，每一跳重定向都要重新检查目标
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("重定向次数过多")
		}
		return utils.CheckPublicHost(req.Context(), req.URL.Hostname())
	},
}

// 图片 URL 由用户提供，直连下载时在建立连接时校验目标地址；测试中可替换
var publicImageClient = utils.NewPublicHTTPClient(15 * time.Second)

var maxFileSize int64 = 20 * 1024 * 1024 // 20MB

type CFRequest struct {
	Action string `json:"action"`
	APIKey string `json:"api_key"`
	URL    string `json:"url"`
}

type CFResponse struct {
	Status   bool   `json:"status"`
	Message  string `json:"message,omitempty"`
	Data     string `json:"data,omitempty"`
	MimeType string `json:"mimeType,omitempty"`
}

func RequestFile(url, action string) (*http.Response, error) {
	reqUrl := url
	method := http.MethodGet
	var requestBody any

	if config.CFWorkerImageUrl != "" {
		requestBody = &CFRequest{
			Action: action,
			APIKey: config.CFWorkerImageKey,
			URL:    url,
		}
		reqUrl = config.CFWorkerImageUrl
		method = http.MethodPost
	}

	res, err := utils.RequestBuilder(utils.SetProxy(config.ChatImageRequestProxy, nil), method, reqUrl, requestBody, nil)

	if err != nil {
		return nil, err
	}

	client := ImageHttpClients
	if config.CFWorkerImageUrl == "" {
		if config.ChatImageRequestProxy == "" {
			client = publicImageClient
		} else if err := utils.CheckPublicHost(res.Context(), res.URL.Hostname()); err != nil {
			return nil, err
		}
	}
	response, err := client.Do(res)
	if err != nil {
		return nil, err
	}

	response.Body = http.MaxBytesReader(nil, response.Body, maxFileSize)

	if response.StatusCode != http.StatusOK && config.CFWorkerImageUrl != "" {
		var cfResp *CFResponse
		err = json.NewDecoder(response.Body).Decode(&cfResp)
		if err != nil {
			return nil, err
		}
		return nil, errors.New(cfResp.Message)
	}

	return response, err
}
