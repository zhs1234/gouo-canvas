package controller

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"one-api/common/config"
	"one-api/model"
	"one-api/types"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestGouoImageResultEndpointIsOwnedReadOnlyAndExplicit(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(t.TempDir()+"/results.db"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.GouoImageCharge{}))
	conn, err := db.DB()
	require.NoError(t, err)
	oldDB, oldDir := model.DB, config.GouoAssetDir
	model.DB, config.GouoAssetDir = db, t.TempDir()
	t.Cleanup(func() { model.DB, config.GouoAssetDir = oldDB, oldDir; conn.Close() })
	for _, status := range []string{model.GouoChargeSettled, model.GouoChargeReview, model.GouoChargeDispatched} {
		id := model.GouoImageRequestID(1, status)
		require.NoError(t, db.Create(&model.GouoImageCharge{ID: id, UserID: 1, Status: status, Attempts: 1, Quota: 10}).Error)
		if status != model.GouoChargeDispatched {
			require.NoError(t, model.SaveGouoImageResult(id, &types.ImageResponse{Data: []types.ImageResponseDataInner{{URL: "https://example.invalid/original.png"}}}))
		}
	}
	require.NoError(t, db.Create(&model.GouoImageCharge{ID: model.GouoImageRequestID(1, "legacy"), UserID: 1, Status: model.GouoChargeSettled}).Error)
	router := gin.New()
	router.Use(func(c *gin.Context) { id, _ := strconv.Atoi(c.GetHeader("X-Test-User")); c.Set("id", id) })
	router.GET("/image-results", GetGouoImageResult)
	for _, tc := range []struct {
		user, request string
		status        int
		recoverable   bool
		reason        string
	}{
		{"1", "settled", 200, true, ""},
		{"1", "settled", 200, true, ""},
		{"1", "needs_review", 200, true, ""},
		{"1", "dispatched", 200, false, "not_ready"},
		{"1", "legacy", 200, false, "result_unavailable"},
		{"2", "settled", 404, false, ""},
		{"1", "unknown", 404, false, ""},
		{"1", "../settled", 400, false, ""},
	} {
		req := httptest.NewRequest(http.MethodGet, "/image-results?client_request_id="+tc.request, nil)
		req.Header.Set("X-Test-User", tc.user)
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		require.Equal(t, tc.status, res.Code)
		require.Equal(t, "no-store", res.Header().Get("Cache-Control"))
		if tc.status != 200 {
			require.NotContains(t, res.Body.String(), "original.png")
			continue
		}
		var body struct {
			Data model.GouoImageResult `json:"data"`
		}
		require.NoError(t, json.Unmarshal(res.Body.Bytes(), &body))
		require.Equal(t, tc.recoverable, body.Data.Recoverable)
		require.Equal(t, tc.reason, body.Data.Reason)
	}
	var charge model.GouoImageCharge
	require.NoError(t, db.First(&charge, "id = ?", model.GouoImageRequestID(1, "settled")).Error)
	require.Equal(t, 1, charge.Attempts)
	require.Equal(t, 10, charge.Quota)
	require.Equal(t, model.GouoChargeSettled, charge.Status)
}
