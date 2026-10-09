package relay

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"one-api/common/config"
	"one-api/common/logger"
	"one-api/model"
	"one-api/types"
)

func TestRecordGouoGenerationStoresOutputsAndReferences(t *testing.T) {
	oldDB, oldDir, oldLogger := model.DB, config.GouoAssetDir, logger.Logger
	t.Cleanup(func() { model.DB, config.GouoAssetDir, logger.Logger = oldDB, oldDir, oldLogger })
	logger.Logger = zap.NewNop()
	config.GouoAssetDir = t.TempDir()
	db, err := gorm.Open(sqlite.Open(t.TempDir()+"/capture.db"), &gorm.Config{})
	require.NoError(t, err)
	conn, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { conn.Close() })
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.GouoTask{}, &model.GouoAsset{}, &model.GouoTaskAsset{}, &model.GouoFavoriteItem{}, &model.GouoDocument{}, &model.GouoStorageQuota{}))
	model.DB = db
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "capture"}).Error)

	encode := func(shade uint8) []byte {
		img := image.NewRGBA(image.Rect(0, 0, 2, 2))
		img.Set(0, 0, color.RGBA{R: shade, A: 255})
		var buf bytes.Buffer
		require.NoError(t, png.Encode(&buf, img))
		return buf.Bytes()
	}
	remote := encode(3)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(remote) }))
	defer server.Close()
	// httptest 服务在回环地址，生产 client 会拒绝访问
	oldClient := gouoImageDownloadClient
	gouoImageDownloadClient = server.Client()
	t.Cleanup(func() { gouoImageDownloadClient = oldClient })

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", nil)
	c.Set("id", 1)
	capture := &gouoImageCapture{taskID: "task-1", index: 2, prompt: "一只猫", model: "image-a", operation: "generation", params: map[string]any{"size": "1024x1024"}}
	recordGouoGeneration(c, capture, &types.ImageResponse{Data: []types.ImageResponseDataInner{{B64JSON: base64.StdEncoding.EncodeToString(encode(1))}}})
	capture.index = 0
	recordGouoGeneration(c, capture, &types.ImageResponse{Data: []types.ImageResponseDataInner{{URL: "data:image/png;base64," + base64.StdEncoding.EncodeToString(encode(2))}}})
	capture.index = 1
	recordGouoGeneration(c, capture, &types.ImageResponse{Data: []types.ImageResponseDataInner{{URL: server.URL + "/image.png"}}})

	task, err := model.GetGouoTask(1, "task-1")
	require.NoError(t, err)
	require.NotNil(t, task)
	require.Equal(t, "一只猫", task.Prompt)
	positions := map[int]bool{}
	for _, link := range task.Assets {
		require.Equal(t, "output", link.Role)
		positions[link.Position] = true
		require.Equal(t, "image/png", link.Asset.MimeType)
	}
	require.Equal(t, map[int]bool{0: true, 1: true, 2: true}, positions)
	used, count, err := model.GetGouoStorageUsage(1)
	require.NoError(t, err)
	require.EqualValues(t, 3, count)
	require.Positive(t, used)

	// 空间已满：已付费的编辑结果照常入库，用户上传的参考图和遮罩不入库
	fileHeader := func(data []byte) *multipart.FileHeader {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		part, err := writer.CreateFormFile("image[]", "ref.png")
		require.NoError(t, err)
		_, err = part.Write(data)
		require.NoError(t, err)
		require.NoError(t, writer.Close())
		req := httptest.NewRequest(http.MethodPost, "/", &body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		require.NoError(t, req.ParseMultipartForm(1<<20))
		return req.MultipartForm.File["image[]"][0]
	}
	require.NoError(t, db.Create(&model.GouoStorageQuota{UserID: 1, QuotaBytes: used}).Error)
	edit := &gouoImageCapture{taskID: "edit-1", prompt: "改色", model: "image-a", operation: "edit", params: map[string]any{}, inputs: []*multipart.FileHeader{fileHeader(encode(10))}, mask: fileHeader(encode(11))}
	recordGouoGeneration(c, edit, &types.ImageResponse{Data: []types.ImageResponseDataInner{{B64JSON: base64.StdEncoding.EncodeToString(encode(12))}}})
	task, err = model.GetGouoTask(1, "edit-1")
	require.NoError(t, err)
	require.Len(t, task.Assets, 1)
	require.Equal(t, "output", task.Assets[0].Role)

	// 超过单文件上限的参考图直接跳过，不截断保存
	require.NoError(t, db.Model(&model.GouoStorageQuota{}).Where("user_id = ?", 1).Update("quota_bytes", 1<<30).Error)
	oldMax := config.GouoAssetMaxFileBytes
	config.GouoAssetMaxFileBytes = int64(len(encode(13)) - 1)
	t.Cleanup(func() { config.GouoAssetMaxFileBytes = oldMax })
	edit = &gouoImageCapture{taskID: "edit-2", prompt: "改色", model: "image-a", operation: "edit", params: map[string]any{}, inputs: []*multipart.FileHeader{fileHeader(encode(13))}}
	recordGouoGeneration(c, edit, &types.ImageResponse{Data: []types.ImageResponseDataInner{{B64JSON: base64.StdEncoding.EncodeToString(encode(14))}}})
	task, err = model.GetGouoTask(1, "edit-2")
	require.NoError(t, err)
	require.Len(t, task.Assets, 1)
	require.Equal(t, "output", task.Assets[0].Role)
}

func TestGouoImageBytesRejectsInternalURLsAndOversizedImages(t *testing.T) {
	var hits int
	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits++ }))
	defer internal.Close()
	_, err := gouoImageBytes(types.ImageResponseDataInner{URL: internal.URL + "/image.png"})
	require.Error(t, err)
	require.Zero(t, hits)

	_, err = readGouoImage(io.LimitReader(zeroReader{}, gouoGeneratedImageMaxBytes+1))
	require.ErrorContains(t, err, "超过")
	data, err := readGouoImage(bytes.NewReader([]byte("ok")))
	require.NoError(t, err)
	require.Equal(t, []byte("ok"), data)
}

type zeroReader struct{}

func (zeroReader) Read(p []byte) (int, error) {
	clear(p)
	return len(p), nil
}
