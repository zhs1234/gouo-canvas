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
	DB = db
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
