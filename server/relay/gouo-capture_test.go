package relay

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"one-api/common/config"
	"one-api/model"
	"one-api/types"
)

func TestRecordGouoGenerationStoresOutputsAndReferences(t *testing.T) {
	oldDB, oldDir := model.DB, config.GouoAssetDir
	t.Cleanup(func() { model.DB, config.GouoAssetDir = oldDB, oldDir })
	config.GouoAssetDir = t.TempDir()
	db, err := gorm.Open(sqlite.Open(t.TempDir()+"/capture.db"), &gorm.Config{})
	require.NoError(t, err)
	conn, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { conn.Close() })
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.GouoTask{}, &model.GouoAsset{}, &model.GouoTaskAsset{}, &model.GouoFavoriteItem{}))
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
}
