package model

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"one-api/common/config"

	"github.com/stretchr/testify/require"
	"gorm.io/datatypes"
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
		require.NoError(t, DB.Create(&GouoAsset{ID: id, UserID: userID, SHA256: id, StoragePath: id + ".png", MimeType: "image/png", FileSize: 1, CreatedAt: createdAt}).Error)
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
