package controller

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"one-api/common/config"
)

func TestGouoSupportSettingsPublicAndBounded(t *testing.T) {
	oldHelp, oldContact := config.GouoRedemptionHelp, config.GouoSupportContact
	t.Cleanup(func() { config.GouoRedemptionHelp, config.GouoSupportContact = oldHelp, oldContact })
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/status", GetStatus)
	router.PUT("/option", UpdateOption)
	for _, contact := range []string{"", "support@example.test"} {
		config.GouoRedemptionHelp, config.GouoSupportContact = "", contact
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/status", nil))
		var body struct {
			Data map[string]interface{} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		require.Equal(t, "", body.Data["gouo_redemption_help"])
		require.Equal(t, contact, body.Data["gouo_support_contact"])
	}
	// 通用设置接口与光构设置接口使用同一套校验，后来新增的 Agent 设置也不能写入越界值
	for key, value := range map[string]string{"GouoAllowLowModeration": "maybe", "GouoAgentMaxRounds": "0", "GouoAgentConfirmImages": "99"} {
		body, err := json.Marshal(map[string]string{"key": key, "value": value})
		require.NoError(t, err)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest(http.MethodPut, "/option", strings.NewReader(string(body))))
		require.Equal(t, http.StatusBadRequest, w.Code, key)
	}
	for _, key := range []string{"GouoRedemptionHelp", "GouoSupportContact"} {
		body, err := json.Marshal(map[string]string{"key": key, "value": strings.Repeat("字", 2001)})
		require.NoError(t, err)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest(http.MethodPut, "/option", strings.NewReader(string(body))))
		require.Equal(t, http.StatusBadRequest, w.Code)
	}
}
