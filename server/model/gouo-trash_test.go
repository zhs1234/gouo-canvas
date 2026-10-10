package model

import (
	"bytes"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"

	"one-api/common/config"
	"one-api/common/logger"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

func TestPurgeGouoTrashAfterRetention(t *testing.T) {
	setupGouoCloudTestDB(t)
	oldDir := config.GouoAssetDir
	config.GouoAssetDir = t.TempDir()
	t.Cleanup(func() { config.GouoAssetDir = oldDir })
	now := time.Now()
	expired := now.Add(-GouoTrashRetention - time.Hour).UnixMilli()
	recent := now.Add(-time.Hour).UnixMilli()

	asset := func(userID int, id string, createdAt int64) {
		path := filepath.Join(config.GouoAssetDir, id+".png")
		require.NoError(t, os.WriteFile(path, []byte(id), 0o600))
		require.NoError(t, DB.Create(&GouoAsset{ID: id, UserID: userID, SHA256: id, StoragePath: id + ".png", MimeType: "image/png", FileSize: 1, CreatedAt: createdAt, UpdatedAt: createdAt}).Error)
	}
	task := func(userID int, id string, hiddenAt int64, assetID string) {
		require.NoError(t, DB.Create(&GouoTask{ID: id, UserID: userID, ClientTaskID: id, Status: "done", Params: datatypes.JSON(`{}`), ResultMeta: datatypes.JSON(`{}`), HiddenAt: hiddenAt}).Error)
		require.NoError(t, DB.Create(&GouoTaskAsset{TaskID: id, AssetID: assetID, Role: "output"}).Error)
	}
	asset(1, "old-only", expired)     // 只被过期作品引用：删除
	asset(1, "shared", expired)       // 同时被未删除作品引用：保留
	asset(1, "in-document", expired)  // 被未删除文档引用：保留
	asset(1, "recent-trash", expired) // 只被未过期回收站作品引用：保留
	asset(1, "fresh-upload", recent)  // 刚上传尚未关联：保留
	task(1, "expired-task", expired, "old-only")
	require.NoError(t, DB.Create(&GouoTaskAsset{TaskID: "expired-task", AssetID: "shared", Role: "input"}).Error)
	task(1, "visible-task", 0, "shared")
	task(1, "recent-task", recent, "recent-trash")
	require.NoError(t, DB.Create(&GouoDocument{ID: "doc-old", UserID: 1, Kind: "canvases", ClientID: "old", Document: datatypes.JSON(`{}`), HiddenAt: expired}).Error)
	require.NoError(t, DB.Create(&GouoDocument{ID: "doc-live", UserID: 1, Kind: "canvases", ClientID: "live", Document: datatypes.JSON(`{}`), AssetIDs: datatypes.NewJSONSlice([]string{"in-document"})}).Error)
	require.NoError(t, DB.Create(&GouoFavoriteCollection{ID: "old-album", UserID: 1, Name: "旧", HiddenAt: expired}).Error)
	require.NoError(t, DB.Create(&GouoFavoriteItem{UserID: 1, CollectionID: "old-album", TaskID: "visible-task"}).Error)

	// 用户 2 已删除超过保留期：全部云端数据清除
	asset(2, "deleted-user-asset", recent)
	task(2, "deleted-user-task", 0, "deleted-user-asset")
	require.NoError(t, DB.Model(&User{}).Where("id = ?", 2).Update("deleted_at", now.Add(-GouoTrashRetention-time.Hour)).Error)

	require.NoError(t, PurgeGouoTrash(now))

	var tasks []string
	require.NoError(t, DB.Model(&GouoTask{}).Order("id").Pluck("id", &tasks).Error)
	require.Equal(t, []string{"recent-task", "visible-task"}, tasks)
	var assets []string
	require.NoError(t, DB.Model(&GouoAsset{}).Order("id").Pluck("id", &assets).Error)
	require.Equal(t, []string{"fresh-upload", "in-document", "recent-trash", "shared"}, assets)
	for _, id := range []string{"old-only", "deleted-user-asset"} {
		_, err := os.Stat(filepath.Join(config.GouoAssetDir, id+".png"))
		require.ErrorIs(t, err, os.ErrNotExist, id)
	}
	_, err := os.Stat(filepath.Join(config.GouoAssetDir, "shared.png"))
	require.NoError(t, err)
	var docs, collections, favorites, links int64
	require.NoError(t, DB.Model(&GouoDocument{}).Count(&docs).Error)
	require.NoError(t, DB.Model(&GouoFavoriteCollection{}).Count(&collections).Error)
	require.NoError(t, DB.Model(&GouoFavoriteItem{}).Count(&favorites).Error)
	require.NoError(t, DB.Model(&GouoTaskAsset{}).Where("task_id = ?", "expired-task").Count(&links).Error)
	require.EqualValues(t, 1, docs)
	require.Zero(t, collections)
	require.Zero(t, favorites)
	require.Zero(t, links)

	// 再次运行不应出错，也不再删除任何内容
	require.NoError(t, PurgeGouoTrash(now))
	require.NoError(t, DB.Model(&GouoAsset{}).Count(&docs).Error)
	require.EqualValues(t, 4, docs)
}

func TestPurgeGouoTrashKeepsReuploadedAsset(t *testing.T) {
	setupGouoCloudTestDB(t)
	oldDir := config.GouoAssetDir
	config.GouoAssetDir = t.TempDir()
	t.Cleanup(func() { config.GouoAssetDir = oldDir })
	now := time.Now()
	expired := now.Add(-GouoTrashRetention - time.Hour).UnixMilli()
	var buf bytes.Buffer
	require.NoError(t, png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 2, 2))))
	asset, _, err := SaveGouoAssetBytes(1, buf.Bytes(), "a.png", false)
	require.NoError(t, err)
	// 很早以前上传、目前没有被引用的图片；该账号另有过期的回收站内容，会触发清理
	require.NoError(t, DB.Model(&GouoAsset{}).Where("id = ?", asset.ID).Updates(map[string]any{"created_at": expired, "updated_at": expired}).Error)
	require.NoError(t, DB.Create(&GouoTask{ID: "expired", UserID: 1, ClientTaskID: "expired", Status: "error", Params: datatypes.JSON(`{}`), ResultMeta: datatypes.JSON(`{}`), HiddenAt: expired}).Error)

	// 用户重新上传同一张图（命中去重），在关联到作品之前清理任务运行
	reused, deduplicated, err := SaveGouoAssetBytes(1, buf.Bytes(), "a.png", true)
	require.NoError(t, err)
	require.True(t, deduplicated)
	require.Equal(t, asset.ID, reused.ID)
	require.NoError(t, PurgeGouoTrash(now))

	var count int64
	require.NoError(t, DB.Model(&GouoAsset{}).Where("id = ?", asset.ID).Count(&count).Error)
	require.EqualValues(t, 1, count)
	_, err = os.Stat(filepath.Join(config.GouoAssetDir, asset.StoragePath))
	require.NoError(t, err)
}

func TestPurgeGouoTrashContinuesAfterOneUserFails(t *testing.T) {
	setupGouoCloudTestDB(t)
	oldLogger := logger.Logger
	logger.Logger = zap.NewNop()
	t.Cleanup(func() { logger.Logger = oldLogger })
	oldDir := config.GouoAssetDir
	config.GouoAssetDir = t.TempDir()
	t.Cleanup(func() { config.GouoAssetDir = oldDir })
	expired := time.Now().Add(-GouoTrashRetention - time.Hour).UnixMilli()
	for _, userID := range []int{1, 2} {
		id := fmt.Sprintf("asset-%d", userID)
		path := filepath.Join(config.GouoAssetDir, id)
		require.NoError(t, DB.Create(&GouoAsset{ID: id, UserID: userID, SHA256: id, StoragePath: id, MimeType: "image/png", FileSize: 1, CreatedAt: expired, UpdatedAt: expired}).Error)
		require.NoError(t, DB.Create(&GouoTask{ID: id, UserID: userID, ClientTaskID: id, Status: "done", Params: datatypes.JSON(`{}`), ResultMeta: datatypes.JSON(`{}`), HiddenAt: expired}).Error)
		require.NoError(t, DB.Create(&GouoTaskAsset{TaskID: id, AssetID: id, Role: "output"}).Error)
		if userID == 1 {
			// 用户 1 的文件删不掉（非空目录），模拟单个账号清理失败
			require.NoError(t, os.MkdirAll(filepath.Join(path, "child"), 0o750))
		} else {
			require.NoError(t, os.WriteFile(path, []byte(id), 0o600))
		}
	}
	require.Error(t, PurgeGouoTrash(time.Now()))
	_, err := os.Stat(filepath.Join(config.GouoAssetDir, "asset-2"))
	require.ErrorIs(t, err, os.ErrNotExist)
	var count int64
	require.NoError(t, DB.Model(&GouoTask{}).Where("user_id = ?", 2).Count(&count).Error)
	require.Zero(t, count)
}

func TestPurgeGouoTrashKeepsAssetTouchedDuringPurge(t *testing.T) {
	setupGouoCloudTestDB(t)
	oldDir := config.GouoAssetDir
	config.GouoAssetDir = t.TempDir()
	t.Cleanup(func() { config.GouoAssetDir = oldDir })
	now := time.Now()
	expired := now.Add(-GouoTrashRetention - time.Hour).UnixMilli()
	var buf bytes.Buffer
	require.NoError(t, png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 3, 3))))
	asset, _, err := SaveGouoAssetBytes(1, buf.Bytes(), "a.png", false)
	require.NoError(t, err)
	require.NoError(t, DB.Model(&GouoAsset{}).Where("id = ?", asset.ID).Updates(map[string]any{"created_at": expired, "updated_at": expired}).Error)
	require.NoError(t, DB.Create(&GouoTask{ID: "expired", UserID: 1, ClientTaskID: "expired", Status: "error", Params: datatypes.JSON(`{}`), ResultMeta: datatypes.JSON(`{}`), HiddenAt: expired}).Error)
	// 挑出候选图片之后、删除之前，另一个实例上的去重上传刷新了这张图的时间
	name := "test:touch_asset_before_delete"
	require.NoError(t, DB.Callback().Delete().Before("gorm:delete").Register(name, func(tx *gorm.DB) {
		if tx.Statement.Table == "gouo_assets" {
			tx.Session(&gorm.Session{NewDB: true}).Exec("UPDATE gouo_assets SET updated_at = ? WHERE id = ?", now.UnixMilli(), asset.ID)
		}
	}))
	t.Cleanup(func() { _ = DB.Callback().Delete().Remove(name) })
	require.NoError(t, PurgeGouoTrash(now))

	var count int64
	require.NoError(t, DB.Model(&GouoAsset{}).Where("id = ?", asset.ID).Count(&count).Error)
	require.EqualValues(t, 1, count)
	// 记录保留时文件也要保留，否则这张图一直读不到
	_, err = os.Stat(filepath.Join(config.GouoAssetDir, asset.StoragePath))
	require.NoError(t, err)
}

func TestSaveGouoAssetRestoresMissingFileOnDeduplicate(t *testing.T) {
	setupGouoCloudTestDB(t)
	oldDir := config.GouoAssetDir
	config.GouoAssetDir = t.TempDir()
	t.Cleanup(func() { config.GouoAssetDir = oldDir })
	var buf bytes.Buffer
	require.NoError(t, png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 4, 4))))
	asset, _, err := SaveGouoAssetBytes(1, buf.Bytes(), "a.png", false)
	require.NoError(t, err)
	// 文件丢失（如清理删文件后事务提交失败）但记录还在，重新上传同一张图时补写文件
	path := filepath.Join(config.GouoAssetDir, asset.StoragePath)
	require.NoError(t, os.Remove(path))
	again, deduplicated, err := SaveGouoAssetBytes(1, buf.Bytes(), "a.png", false)
	require.NoError(t, err)
	require.True(t, deduplicated)
	require.Equal(t, asset.ID, again.ID)
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	require.Equal(t, buf.Bytes(), data)
}
