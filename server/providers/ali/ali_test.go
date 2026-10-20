package ali_test

import (
	"net/http"
	"one-api/common/config"
	"one-api/common/requester"
	"one-api/common/test"
	"one-api/model"
)

func setupAliTestServer() (baseUrl string, server *test.ServerTest, teardown func()) {
	// main 会初始化全局 client，测试进程不会，不补上 SendRequest 会空指针
	requester.InitHttpClient()
	server = test.NewTestServer()
	ts := server.TestServer(func(w http.ResponseWriter, r *http.Request) bool {
		return test.OpenAICheck(w, r)
	})
	ts.Start()
	teardown = ts.Close

	baseUrl = ts.URL
	return
}

func getAliChannel(baseUrl string) model.Channel {
	return test.GetChannel(config.ChannelTypeAli, baseUrl, "", "", "")
}
