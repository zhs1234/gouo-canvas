package model

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"gorm.io/datatypes"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupGouoCloudTestDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&User{}, &GouoTask{}, &GouoAsset{}, &GouoTaskAsset{}, &GouoFavoriteCollection{}, &GouoFavoriteItem{}, &GouoStorageQuota{}))
	oldDB := DB
	DB = db
	t.Cleanup(func() { DB = oldDB })
	require.NoError(t, db.Create(&User{Id: 1, Username: "cloud-a", AccessToken: "cloud-token-a", AffCode: "cloud-aff-a"}).Error)
	require.NoError(t, db.Create(&User{Id: 2, Username: "cloud-b", AccessToken: "cloud-token-b", AffCode: "cloud-aff-b"}).Error)
}

func TestGouoCloudTimestampMigrationAndCursor(t *testing.T) {
	setupGouoCloudTestDB(t)
	old := GouoTask{ID: "old", UserID: 1, ClientTaskID: "old", Status: "error", Params: datatypes.JSON(`{}`), ResultMeta: datatypes.JSON(`{}`)}
	require.NoError(t, DB.Create(&old).Error)
	require.NoError(t, DB.Model(&old).UpdateColumns(map[string]any{"created_at": int64(1_791_000_000), "updated_at": int64(1_791_000_000), "hidden_at": int64(1_791_000_000_123)}).Error)
	require.NoError(t, gouoCloudMillisecondMigration().Migrate(DB))
	require.NoError(t, DB.First(&old, "id = ?", old.ID).Error)
	require.Equal(t, int64(1_791_000_000_000), old.CreatedAt)
	require.Equal(t, int64(1_791_000_000_000), old.UpdatedAt)
	require.Equal(t, int64(1_791_000_000_123), old.HiddenAt)
	require.NoError(t, gouoCloudMillisecondMigration().Migrate(DB))
	// 模拟时钟回退以及多次写入落在同一毫秒，后写入的较小 ID 也必须可见。
	future := time.Now().Add(time.Hour).UnixMilli()
	require.NoError(t, DB.Model(&old).UpdateColumn("updated_at", future).Error)
	latest := old
	latest.UpdatedAt = future
	for _, id := range []string{"z", "b", "a"} {
		task := GouoTask{ID: id, UserID: 1, ClientTaskID: id, Status: "error", Params: datatypes.JSON(`{}`), ResultMeta: datatypes.JSON(`{}`)}
		require.NoError(t, UpsertGouoTask(&task, nil, nil))
		require.Greater(t, task.UpdatedAt, latest.UpdatedAt)
		changed, err := ListChangedGouoTasks(1, latest.UpdatedAt, latest.ID, 100)
		require.NoError(t, err)
		require.Len(t, changed, 1)
		require.Equal(t, id, changed[0].ID)
		latest = task
	}
	for _, hide := range []bool{true, false} {
		require.NoError(t, SetGouoTaskHidden(1, old.ID, hide))
		changed, err := ListChangedGouoTasks(1, latest.UpdatedAt, latest.ID, 100)
		require.NoError(t, err)
		require.Len(t, changed, 1)
		require.Equal(t, old.ID, changed[0].ID)
		require.Equal(t, hide, changed[0].HiddenAt > 0)
		latest = changed[0]
	}
}

func TestGouoCollectionStaleUpdateDoesNotRestoreDeletedCollection(t *testing.T) {
	setupGouoCloudTestDB(t)
	collection := GouoFavoriteCollection{ID: "album", UserID: 1, Name: "原名", CreatedAt: 1, UpdatedAt: 1}
	require.NoError(t, UpsertGouoCollection(&collection))
	stale := collection
	require.NoError(t, SetGouoCollectionHidden(1, collection.ID, true))
	stale.Name = "离线旧设备"
	require.NoError(t, UpsertGouoCollection(&stale))
	saved, err := GetGouoCollection(1, collection.ID)
	require.NoError(t, err)
	require.Greater(t, saved.HiddenAt, int64(0))
	require.NoError(t, SetGouoCollectionHidden(2, collection.ID, false))
	saved, err = GetGouoCollection(1, collection.ID)
	require.NoError(t, err)
	require.Greater(t, saved.HiddenAt, int64(0))
	require.NoError(t, SetGouoCollectionHidden(1, collection.ID, false))
	saved, err = GetGouoCollection(1, collection.ID)
	require.NoError(t, err)
	require.Zero(t, saved.HiddenAt)
}

func TestGouoTaskUpsertIsIdempotent(t *testing.T) {
	setupGouoCloudTestDB(t)
	now := time.Now().UnixMilli()
	asset := GouoAsset{ID: "asset-a", UserID: 1, SHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", StoragePath: "1/aa/a.png", MimeType: "image/png", FileSize: 10, CreatedAt: now, UpdatedAt: now}
	require.NoError(t, InsertGouoAsset(&asset))
	collection := GouoFavoriteCollection{ID: "default", UserID: 1, Name: "默认", CreatedAt: now, UpdatedAt: now}
	require.NoError(t, UpsertGouoCollection(&collection))

	task := GouoTask{ID: "task-a", UserID: 1, ClientTaskID: "client-a", SchemaVersion: 1, Status: "done", Operation: "generation", Params: datatypes.JSON(`{}`), ResultMeta: datatypes.JSON(`{}`), CreatedAt: now, UpdatedAt: now}
	links := []GouoTaskAsset{{AssetID: asset.ID, Role: "output", Position: 0, ClientImageID: "image-a"}}
	require.NoError(t, UpsertGouoTask(&task, links, []string{collection.ID}))
	task.Prompt = "updated"
	task.UpdatedAt++
	require.NoError(t, UpsertGouoTask(&task, links, []string{collection.ID}))

	var taskCount int64
	var linkCount int64
	var favoriteCount int64
	require.NoError(t, DB.Model(&GouoTask{}).Count(&taskCount).Error)
	require.NoError(t, DB.Model(&GouoTaskAsset{}).Count(&linkCount).Error)
	require.NoError(t, DB.Model(&GouoFavoriteItem{}).Count(&favoriteCount).Error)
	require.Equal(t, int64(1), taskCount)
	require.Equal(t, int64(1), linkCount)
	require.Equal(t, int64(1), favoriteCount)

	loaded, err := GetGouoTask(1, "client-a")
	require.NoError(t, err)
	require.Equal(t, "updated", loaded.Prompt)
	require.Len(t, loaded.Assets, 1)
	require.Equal(t, asset.ID, loaded.Assets[0].Asset.ID)
	preview := GouoAsset{ID: "preview", UserID: 1, SHA256: "preview-sha", StoragePath: "preview.webp", MimeType: "image/webp", FileSize: 5}
	require.NoError(t, InsertGouoAsset(&preview))
	err = UpsertGouoTask(&task, []GouoTaskAsset{
		{AssetID: preview.ID, Role: "output", Position: 0, ClientImageID: "image-a"},
		{AssetID: preview.ID, Role: "thumbnail", Position: 0, ClientImageID: "image-a"},
	}, nil)
	require.ErrorIs(t, err, ErrGouoOriginalAssetConflict)
	loaded, err = GetGouoTask(1, "client-a")
	require.NoError(t, err)
	require.Equal(t, asset.ID, loaded.Assets[0].AssetID)
}

func TestGouoStorageQuotaAndOwnership(t *testing.T) {
	setupGouoCloudTestDB(t)
	now := time.Now().UnixMilli()
	require.NoError(t, InsertGouoAsset(&GouoAsset{ID: "asset-a", UserID: 1, SHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", StoragePath: "a", MimeType: "image/png", FileSize: 15, CreatedAt: now, UpdatedAt: now}))
	require.NoError(t, InsertGouoAsset(&GouoAsset{ID: "asset-b", UserID: 2, SHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", StoragePath: "b", MimeType: "image/png", FileSize: 20, CreatedAt: now, UpdatedAt: now}))

	used, count, err := GetGouoStorageUsage(1)
	require.NoError(t, err)
	require.Equal(t, int64(15), used)
	require.Equal(t, int64(1), count)
	owned, err := CountOwnedGouoAssets(1, []string{"asset-a", "asset-b"})
	require.NoError(t, err)
	require.Equal(t, int64(1), owned)

	require.NoError(t, SetGouoUserQuota(1, 100))
	quota, err := GetGouoUserQuota(1, 50)
	require.NoError(t, err)
	require.Equal(t, int64(100), quota)
}

func TestGouoTaskHideAndRestore(t *testing.T) {
	setupGouoCloudTestDB(t)
	now := time.Now().UnixMilli()
	task := GouoTask{ID: "task-a", UserID: 1, ClientTaskID: "client-a", SchemaVersion: 1, Status: "error", Operation: "generation", Params: datatypes.JSON(`{}`), ResultMeta: datatypes.JSON(`{}`), CreatedAt: now, UpdatedAt: now}
	require.NoError(t, UpsertGouoTask(&task, nil, nil))
	require.NoError(t, SetGouoTaskHidden(1, task.ID, true))
	hidden, err := ListGouoTasks(1, true, 0, "", 10)
	require.NoError(t, err)
	require.Len(t, hidden, 1)
	require.Greater(t, hidden[0].HiddenAt, int64(0))

	require.NoError(t, SetGouoTaskHidden(1, task.ID, false))
	visible, err := ListGouoTasks(1, false, 0, "", 10)
	require.NoError(t, err)
	require.Len(t, visible, 1)
	require.Zero(t, visible[0].HiddenAt)
}

func TestGouoAdminTasksOnlyExposeUserOutputs(t *testing.T) {
	setupGouoCloudTestDB(t)
	now := time.Now().UnixMilli()
	output := GouoAsset{ID: "output-a", UserID: 1, SHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", StoragePath: "output.png", MimeType: "image/png", FileSize: 10, CreatedAt: now, UpdatedAt: now}
	input := GouoAsset{ID: "input-a", UserID: 1, SHA256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", StoragePath: "input.png", MimeType: "image/png", FileSize: 10, CreatedAt: now, UpdatedAt: now}
	otherOutput := GouoAsset{ID: "output-b", UserID: 2, SHA256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", StoragePath: "other.png", MimeType: "image/png", FileSize: 10, CreatedAt: now, UpdatedAt: now}
	require.NoError(t, InsertGouoAsset(&output))
	require.NoError(t, InsertGouoAsset(&input))
	require.NoError(t, InsertGouoAsset(&otherOutput))

	task := GouoTask{ID: "task-a", UserID: 1, ClientTaskID: "client-a", SchemaVersion: 1, Status: "done", Operation: "generation", Params: datatypes.JSON(`{}`), ResultMeta: datatypes.JSON(`{}`), ClientCreatedAt: now, CreatedAt: now, UpdatedAt: now}
	require.NoError(t, UpsertGouoTask(&task, []GouoTaskAsset{
		{AssetID: output.ID, Role: "output", Position: 0},
		{AssetID: input.ID, Role: "input", Position: 0},
	}, nil))
	otherTask := GouoTask{ID: "task-b", UserID: 2, ClientTaskID: "client-b", SchemaVersion: 1, Status: "done", Operation: "generation", Params: datatypes.JSON(`{}`), ResultMeta: datatypes.JSON(`{}`), ClientCreatedAt: now, CreatedAt: now, UpdatedAt: now}
	require.NoError(t, UpsertGouoTask(&otherTask, []GouoTaskAsset{{AssetID: otherOutput.ID, Role: "output", Position: 0}}, nil))

	tasks, count, err := ListGouoAdminTasks(1, 1, 20)
	require.NoError(t, err)
	require.Equal(t, int64(1), count)
	require.Len(t, tasks, 1)
	require.Len(t, tasks[0].Assets, 1)
	require.Equal(t, output.ID, tasks[0].Assets[0].AssetID)

	loadedOutput, err := GetGouoAdminOutputAsset(1, output.ID)
	require.NoError(t, err)
	require.Equal(t, output.ID, loadedOutput.ID)
	loadedInput, err := GetGouoAdminOutputAsset(1, input.ID)
	require.NoError(t, err)
	require.Nil(t, loadedInput)
	loadedOther, err := GetGouoAdminOutputAsset(1, otherOutput.ID)
	require.NoError(t, err)
	require.Nil(t, loadedOther)
}
