package channel_test

import (
	"context"
	"fmt"
	"testing"

	"one-api/common/notify/channel"
	"one-api/common/requester"

	"github.com/spf13/viper"
	"github.com/stretchr/testify/assert"
)

func InitConfig(t *testing.T) {
	t.Helper()
	viper.AddConfigPath("/one-api")
	viper.SetConfigName("config")
	if err := viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); ok {
			t.Skip("未找到 /one-api/config，跳过依赖外部通知服务的测试")
		}
		t.Fatal(err)
	}
	requester.InitHttpClient()
}

func TestDingTalkSend(t *testing.T) {
	InitConfig(t)
	access_token := viper.GetString("notify.dingtalk.token")
	secret := viper.GetString("notify.dingtalk.secret")
	dingTalk := channel.NewDingTalk(access_token, secret)

	err := dingTalk.Send(context.Background(), "Test Title", "*Test Message*")
	fmt.Println(err)
	assert.Nil(t, err)
}

func TestDingTalkSendWithKeyWord(t *testing.T) {
	InitConfig(t)
	access_token := viper.GetString("notify.dingtalk.token")
	keyWord := viper.GetString("notify.dingtalk.keyWord")

	dingTalk := channel.NewDingTalkWithKeyWord(access_token, keyWord)

	err := dingTalk.Send(context.Background(), "Test Title", "Test Message")
	assert.Nil(t, err)
}

func TestDingTalkSendError(t *testing.T) {
	InitConfig(t)
	access_token := viper.GetString("notify.dingtalk.token")
	secret := "test"
	dingTalk := channel.NewDingTalk(access_token, secret)

	err := dingTalk.Send(context.Background(), "Test Title", "*Test Message*")
	fmt.Println(err)
	assert.Error(t, err)
}

func TestLarkSend(t *testing.T) {
	InitConfig(t)
	access_token := viper.GetString("notify.lark.token")
	secret := viper.GetString("notify.lark.secret")
	dingTalk := channel.NewLark(access_token, secret)

	err := dingTalk.Send(context.Background(), "Test Title", "*Test Message*")
	fmt.Println(err)
	assert.Nil(t, err)
}

func TestLarkSendWithKeyWord(t *testing.T) {
	InitConfig(t)
	access_token := viper.GetString("notify.lark.token")
	keyWord := viper.GetString("notify.lark.keyWord")

	dingTalk := channel.NewLarkWithKeyWord(access_token, keyWord)

	err := dingTalk.Send(context.Background(), "Test Title", "Test Message\n\n- 111\n- 222")
	assert.Nil(t, err)
}

func TestLarkSendError(t *testing.T) {
	InitConfig(t)
	access_token := viper.GetString("notify.lark.token")
	secret := "test"
	dingTalk := channel.NewLark(access_token, secret)

	err := dingTalk.Send(context.Background(), "Title", "*Message*")
	fmt.Println(err)
	assert.Error(t, err)
}

func TestPushdeerSend(t *testing.T) {
	InitConfig(t)
	pushkey := viper.GetString("notify.pushdeer.pushkey")
	dingTalk := channel.NewPushdeer(pushkey, "")

	err := dingTalk.Send(context.Background(), "Test Title", "*Test Message*")
	fmt.Println(err)
	assert.Nil(t, err)
}

func TestPushdeerSendError(t *testing.T) {
	InitConfig(t)
	pushkey := "test"
	dingTalk := channel.NewPushdeer(pushkey, "")

	err := dingTalk.Send(context.Background(), "Test Title", "*Test Message*")
	fmt.Println(err)
	assert.Error(t, err)
}

func TestTelegramSend(t *testing.T) {
	InitConfig(t)
	secret := viper.GetString("notify.telegram.bot_api_key")
	chatID := viper.GetString("notify.telegram.chat_id")
	httpProxy := viper.GetString("notify.telegram.http_proxy")
	dingTalk := channel.NewTelegram(secret, chatID, httpProxy)

	err := dingTalk.Send(context.Background(), "Test Title", "*Test Message*")
	fmt.Println(err)
	assert.Nil(t, err)
}

func TestTelegramSendError(t *testing.T) {
	InitConfig(t)
	secret := "test"
	chatID := viper.GetString("notify.telegram.chat_id")
	dingTalk := channel.NewTelegram(secret, chatID, "")

	err := dingTalk.Send(context.Background(), "Test Title", "*Test Message*")
	fmt.Println(err)
	assert.Error(t, err)
}
