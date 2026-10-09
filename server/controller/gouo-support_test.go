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
	for _, key := range []string{"GouoRedemptionHelp", "GouoSupportContact"} {
		body, err := json.Marshal(map[string]string{"key": key, "value": strings.Repeat("字", 2001)})
		require.NoError(t, err)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest(http.MethodPut, "/option", strings.NewReader(string(body))))
		require.Equal(t, http.StatusBadRequest, w.Code)
	}
}
