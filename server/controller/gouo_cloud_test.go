package controller

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"one-api/common/config"
	"one-api/model"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestGouoCursorRoundTrip(t *testing.T) {
	cursor := encodeGouoCursor(123456789, "0123456789abcdef0123456789abcdef")
	timestamp, id, err := decodeGouoCursor(cursor)
	require.NoError(t, err)
	require.Equal(t, int64(123456789), timestamp)
	require.Equal(t, "0123456789abcdef0123456789abcdef", id)
}

func TestGouoCursorRejectsInvalidInput(t *testing.T) {
	_, _, err := decodeGouoCursor("not-a-cursor")
	require.Error(t, err)
}

func TestGouoLegacyCursorRestartsFullSync(t *testing.T) {
	for _, value := range []string{"1791000000:0123456789abcdef0123456789abcdef", "1791000000123:0123456789abcdef0123456789abcdef"} {
		timestamp, id, err := decodeGouoCursor(base64.RawURLEncoding.EncodeToString([]byte(value)))
		require.NoError(t, err)
		require.Zero(t, timestamp)
		require.Empty(t, id)
	}
}

func TestUniqueStrings(t *testing.T) {
	require.Equal(t, []string{"a", "b"}, uniqueStrings([]string{" a ", "b", "a", ""}))
}

func TestGouoAssetUploadDeduplicatesAndEnforcesOwnership(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.GouoAsset{}, &model.GouoStorageQuota{}, &model.GouoTask{}, &model.GouoDocument{}))
	model.DB = db

	oldDir := config.GouoAssetDir
	oldEnabled := config.GouoCloudLibraryEnabled
	oldQuota := config.GouoAssetUserQuotaBytes
	oldMaxFile := config.GouoAssetMaxFileBytes
	config.GouoAssetDir = t.TempDir()
	config.GouoCloudLibraryEnabled = true
	config.GouoAssetUserQuotaBytes = 1024 * 1024
	config.GouoAssetMaxFileBytes = 1024 * 1024
	t.Cleanup(func() {
		config.GouoAssetDir = oldDir
		config.GouoCloudLibraryEnabled = oldEnabled
		config.GouoAssetUserQuotaBytes = oldQuota
		config.GouoAssetMaxFileBytes = oldMaxFile
	})

	router := gin.New()
	router.Use(func(c *gin.Context) {
		userID, _ := strconv.Atoi(c.GetHeader("X-Test-User"))
		c.Set("id", userID)
	})
	router.POST("/assets", UploadGouoAsset)
	router.GET("/assets/:id/content", GetGouoAssetContent)

	imageData := newTestPNG(t)
	first := performAssetUpload(t, router, 1, imageData)
	require.Equal(t, http.StatusOK, first.Code)
	var firstBody struct {
		Success bool `json:"success"`
		Data    struct {
			ID           string `json:"id"`
			Deduplicated bool   `json:"deduplicated"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(first.Body.Bytes(), &firstBody))
	require.True(t, firstBody.Success)
	require.NotEmpty(t, firstBody.Data.ID)
	require.False(t, firstBody.Data.Deduplicated)

	second := performAssetUpload(t, router, 1, imageData)
	require.Equal(t, http.StatusOK, second.Code)
	var secondBody struct {
		Data struct {
			ID           string `json:"id"`
			Deduplicated bool   `json:"deduplicated"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(second.Body.Bytes(), &secondBody))
	require.Equal(t, firstBody.Data.ID, secondBody.Data.ID)
	require.True(t, secondBody.Data.Deduplicated)

	ownerRequest := httptest.NewRequest(http.MethodGet, "/assets/"+firstBody.Data.ID+"/content", nil)
	ownerRequest.Header.Set("X-Test-User", "1")
	ownerResponse := httptest.NewRecorder()
	router.ServeHTTP(ownerResponse, ownerRequest)
	require.Equal(t, http.StatusOK, ownerResponse.Code)
	require.Equal(t, "image/png", ownerResponse.Header().Get("Content-Type"))

	otherRequest := httptest.NewRequest(http.MethodGet, "/assets/"+firstBody.Data.ID+"/content", nil)
	otherRequest.Header.Set("X-Test-User", "2")
	otherResponse := httptest.NewRecorder()
	router.ServeHTTP(otherResponse, otherRequest)
	require.Equal(t, http.StatusNotFound, otherResponse.Code)
}

func newTestPNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	img.Set(0, 0, color.RGBA{R: 37, G: 99, B: 235, A: 255})
	var data bytes.Buffer
	require.NoError(t, png.Encode(&data, img))
	return data.Bytes()
}

func performAssetUpload(t *testing.T, router http.Handler, userID int, data []byte) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	file, err := writer.CreateFormFile("file", "image.png")
	require.NoError(t, err)
	_, err = file.Write(data)
	require.NoError(t, err)
	require.NoError(t, writer.WriteField("client_image_id", "image-a"))
	require.NoError(t, writer.Close())
	request := httptest.NewRequest(http.MethodPost, "/assets", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("X-Test-User", strconv.Itoa(userID))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}

func TestGouoCollectionCountLimit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.GouoFavoriteCollection{}))
	oldDB := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = oldDB })
	rows := make([]model.GouoFavoriteCollection, 0, gouoMaxCollections)
	for i := 0; i < gouoMaxCollections; i++ {
		rows = append(rows, model.GouoFavoriteCollection{ID: fmt.Sprintf("c%d", i), UserID: 1, Name: "收藏"})
	}
	require.NoError(t, db.CreateInBatches(rows, 100).Error)
	put := func(id string) int {
		router := gin.New()
		router.PUT("/collections/:id", func(c *gin.Context) {
			c.Set("id", 1)
			PutGouoCollection(c)
		})
		res := httptest.NewRecorder()
		router.ServeHTTP(res, httptest.NewRequest(http.MethodPut, "/collections/"+id, strings.NewReader(`{"name":"新名字"}`)))
		return res.Code
	}
	// 达到上限后不能再新建，已有收藏夹仍可改名
	require.Equal(t, http.StatusBadRequest, put("new-one"))
	require.Equal(t, http.StatusOK, put("c1"))
}
