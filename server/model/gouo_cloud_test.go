package model

import (
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/stretchr/testify/require"
	"gorm.io/datatypes"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupGouoCloudTestDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&User{}, &GouoTask{}, &GouoAsset{}, &GouoTaskAsset{}, &GouoFavoriteCollection{}, &GouoFavoriteItem{}, &GouoStorageQuota{}, &GouoDocument{}))
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
		latest = task
	}
	for _, hide := range []bool{true, false} {
		require.NoError(t, SetGouoTaskHidden(1, old.ID, hide))
		changed, err := GetGouoTask(1, old.ID)
		require.NoError(t, err)
		require.Greater(t, changed.UpdatedAt, latest.UpdatedAt)
		require.Equal(t, hide, changed.HiddenAt > 0)
		latest = *changed
	}
}

func TestGouoGenerationRecordMergesBatchAndClientMeta(t *testing.T) {
	setupGouoCloudTestDB(t)
	assets := []*GouoAsset{}
	for _, id := range []string{"out-0", "out-1", "ref"} {
		asset := &GouoAsset{ID: id, UserID: 1, SHA256: id, StoragePath: id, MimeType: "image/png", FileSize: 1}
		require.NoError(t, InsertGouoAsset(asset))
		assets = append(assets, asset)
	}
	// 批量生成的两个子请求以任意顺序到达，都归入同一作品。
	for _, index := range []int{1, 0} {
		require.NoError(t, RecordGouoGeneration(GouoGenerationRecord{UserID: 1, ClientTaskID: "task", Index: index, Prompt: "请求提示词", Model: "image", Operation: "edit", Params: datatypes.JSON(`{"n":1}`), Outputs: []*GouoAsset{assets[index]}, Inputs: []*GouoAsset{assets[2]}}))
	}
	task, err := GetGouoTask(1, "task")
	require.NoError(t, err)
	require.Equal(t, "done", task.Status)
	require.Len(t, task.Assets, 3)
	collection := GouoFavoriteCollection{ID: "album", UserID: 1, Name: "收藏"}
	require.NoError(t, UpsertGouoCollection(&collection))
	updated, err := UpdateGouoTaskMeta(1, "task", GouoTaskMeta{Prompt: "原始提示词", ResultMeta: datatypes.JSON(`{"transparentOutput":true}`), ClientImageIDs: map[string][]string{"output": {"local-0", "local-1"}}, CollectionIDs: []string{"album"}})
	require.NoError(t, err)
	require.Equal(t, "原始提示词", updated.Prompt)
	byPosition := map[int]string{}
	for _, link := range updated.Assets {
		if link.Role == "output" {
			byPosition[link.Position] = link.ClientImageID
		}
	}
	require.Equal(t, map[int]string{0: "local-0", 1: "local-1"}, byPosition)
	favorites, err := ListGouoFavoriteItems(1)
	require.NoError(t, err)
	require.Len(t, favorites, 1)
	// 回收站中的作品被重试请求写入时保持删除状态。
	require.NoError(t, SetGouoTaskHidden(1, task.ID, true))
	require.NoError(t, RecordGouoGeneration(GouoGenerationRecord{UserID: 1, ClientTaskID: "task", Index: 0, Outputs: []*GouoAsset{assets[0]}}))
	task, err = GetGouoTask(1, "task")
	require.NoError(t, err)
	require.Positive(t, task.HiddenAt)
	_, err = UpdateGouoTaskMeta(1, "missing", GouoTaskMeta{})
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
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
	// 其他设备重新上传同一作品不能把回收站中的作品恢复。
	reupload := GouoTask{ID: "task-new", UserID: 1, ClientTaskID: "client-a", SchemaVersion: 1, Status: "error", Operation: "generation", Params: datatypes.JSON(`{}`), ResultMeta: datatypes.JSON(`{}`), CreatedAt: now, UpdatedAt: now}
	require.NoError(t, UpsertGouoTask(&reupload, nil, nil))
	hidden, err = ListGouoTasks(1, true, 0, "", 10)
	require.NoError(t, err)
	require.Len(t, hidden, 1)

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

func TestGouoFavoriteChangesAdvanceTaskCursor(t *testing.T) {
	setupGouoCloudTestDB(t)
	now := time.Now().UnixMilli()
	task := GouoTask{ID: "task-a", UserID: 1, ClientTaskID: "client-a", SchemaVersion: 1, Status: "done", Operation: "generation", Params: datatypes.JSON(`{}`), ResultMeta: datatypes.JSON(`{}`), CreatedAt: now, UpdatedAt: now}
	require.NoError(t, UpsertGouoTask(&task, nil, nil))
	require.NoError(t, UpsertGouoCollection(&GouoFavoriteCollection{ID: "collection-a", UserID: 1, Name: "收藏", CreatedAt: now, UpdatedAt: now}))
	latest := func() int64 {
		tasks, err := ListGouoTasks(1, false, 0, "", 10)
		require.NoError(t, err)
		require.Len(t, tasks, 1)
		return tasks[0].UpdatedAt
	}

	// 其他设备只拉取 updated_at 大于已见值的任务，收藏和取消收藏都必须推进它
	seen := latest()
	require.NoError(t, SetGouoFavoriteItem(1, "collection-a", task.ID, true))
	require.Greater(t, latest(), seen)
	items, err := ListGouoFavoriteItems(1)
	require.NoError(t, err)
	require.Len(t, items, 1)

	seen = latest()
	require.NoError(t, SetGouoFavoriteItem(1, "collection-a", task.ID, false))
	require.Greater(t, latest(), seen)
	items, err = ListGouoFavoriteItems(1)
	require.NoError(t, err)
	require.Empty(t, items)
}

func TestGouoTaskMetaBindsClientImagesByPosition(t *testing.T) {
	setupGouoCloudTestDB(t)
	// 3 张批量生成中第 0 个请求失败，服务端只在位置 1、2 保存了图片
	for _, index := range []int{1, 2} {
		id := "out-" + string(rune('0'+index))
		asset := &GouoAsset{ID: id, UserID: 1, SHA256: id, StoragePath: id, MimeType: "image/png", FileSize: 1}
		require.NoError(t, InsertGouoAsset(asset))
		require.NoError(t, RecordGouoGeneration(GouoGenerationRecord{UserID: 1, ClientTaskID: "task", Index: index, Outputs: []*GouoAsset{asset}}))
	}
	updated, err := UpdateGouoTaskMeta(1, "task", GouoTaskMeta{
		ClientImageIDs:       map[string][]string{"output": {"local-b", "local-c"}},
		ClientImagePositions: map[string][]int{"output": {1, 2}},
	})
	require.NoError(t, err)
	byAsset := map[string]string{}
	for _, link := range updated.Assets {
		byAsset[link.AssetID] = link.ClientImageID
	}
	require.Equal(t, map[string]string{"out-1": "local-b", "out-2": "local-c"}, byAsset)
}

func TestGouoCollectionHideAdvancesTaskCursorAndHidesFavorites(t *testing.T) {
	setupGouoCloudTestDB(t)
	now := time.Now().UnixMilli()
	inside := GouoTask{ID: "task-in", UserID: 1, ClientTaskID: "client-in", SchemaVersion: 1, Status: "done", Operation: "generation", Params: datatypes.JSON(`{}`), ResultMeta: datatypes.JSON(`{}`), CreatedAt: now, UpdatedAt: now}
	outside := GouoTask{ID: "task-out", UserID: 1, ClientTaskID: "client-out", SchemaVersion: 1, Status: "done", Operation: "generation", Params: datatypes.JSON(`{}`), ResultMeta: datatypes.JSON(`{}`), CreatedAt: now, UpdatedAt: now}
	require.NoError(t, UpsertGouoTask(&inside, nil, nil))
	require.NoError(t, UpsertGouoTask(&outside, nil, nil))
	require.NoError(t, UpsertGouoCollection(&GouoFavoriteCollection{ID: "album", UserID: 1, Name: "收藏", CreatedAt: now, UpdatedAt: now}))
	require.NoError(t, SetGouoFavoriteItem(1, "album", inside.ID, true))
	updatedAt := func(id string) int64 {
		var task GouoTask
		require.NoError(t, DB.First(&task, "id = ?", id).Error)
		return task.UpdatedAt
	}

	for _, hidden := range []bool{true, false} {
		seenIn, seenOut := updatedAt(inside.ID), updatedAt(outside.ID)
		require.NoError(t, SetGouoCollectionHidden(1, "album", hidden))
		require.Greater(t, updatedAt(inside.ID), seenIn)
		require.Equal(t, seenOut, updatedAt(outside.ID))
		items, err := ListGouoFavoriteItems(1)
		require.NoError(t, err)
		if hidden {
			require.Empty(t, items)
		} else {
			require.Len(t, items, 1)
		}
	}
}

func TestGouoDocumentsAndTasksCountTowardStorageQuota(t *testing.T) {
	setupGouoCloudTestDB(t)
	require.NoError(t, SetGouoUserQuota(1, 2000))
	doc := GouoDocument{ID: "doc-1", UserID: 1, Kind: "canvases", ClientID: "canvas-1", Title: "画布", Document: datatypes.JSON(`{"schemaVersion":1,"nodes":"` + strings.Repeat("a", 900) + `"}`)}
	require.NoError(t, SaveGouoDocument(&doc, 0, nil))
	task := GouoTask{ID: "task-1", UserID: 1, ClientTaskID: "client-1", SchemaVersion: 1, Status: "done", Operation: "generation", Prompt: strings.Repeat("猫", 200), Params: datatypes.JSON(`{}`), ResultMeta: datatypes.JSON(`{}`)}
	require.NoError(t, UpsertGouoTask(&task, nil, nil))
	used, _, err := GetGouoStorageUsage(1)
	require.NoError(t, err)
	require.EqualValues(t, doc.ContentBytes+task.ContentBytes, used)

	// 超出配额的新文档或作品记录被拒绝，已有数据不变
	big := GouoDocument{ID: "doc-2", UserID: 1, Kind: "canvases", ClientID: "canvas-2", Title: "大画布", Document: datatypes.JSON(`{"schemaVersion":1,"nodes":"` + strings.Repeat("b", 1500) + `"}`)}
	require.ErrorIs(t, SaveGouoDocument(&big, 0, nil), ErrGouoStorageQuota)
	bigTask := GouoTask{ID: "task-2", UserID: 1, ClientTaskID: "client-2", SchemaVersion: 1, Status: "done", Operation: "generation", Prompt: strings.Repeat("x", 1500), Params: datatypes.JSON(`{}`), ResultMeta: datatypes.JSON(`{}`)}
	require.ErrorIs(t, UpsertGouoTask(&bigTask, nil, nil), ErrGouoStorageQuota)
	// 缩小已有文档不受限制
	doc.Document = datatypes.JSON(`{"schemaVersion":1}`)
	require.NoError(t, SaveGouoDocument(&doc, 1, nil))
	// 服务端保存的付费生成结果不受配额限制
	require.NoError(t, RecordGouoGeneration(GouoGenerationRecord{UserID: 1, ClientTaskID: "paid", Prompt: strings.Repeat("y", 3000), Params: datatypes.JSON(`{}`)}))
	// 客户端补充的作品信息变大时受配额限制，原内容不变；缩小不受限制
	_, err = UpdateGouoTaskMeta(1, "client-1", GouoTaskMeta{Params: datatypes.JSON(`{"note":"` + strings.Repeat("z", 3000) + `"}`)})
	require.ErrorIs(t, err, ErrGouoStorageQuota)
	stored, err := GetGouoTask(1, "client-1")
	require.NoError(t, err)
	require.JSONEq(t, `{}`, string(stored.Params))
	_, err = UpdateGouoTaskMeta(1, "client-1", GouoTaskMeta{Prompt: "猫"})
	require.NoError(t, err)
}

func TestGouoContentBytesMigrationBackfillsExistingRows(t *testing.T) {
	setupGouoCloudTestDB(t)
	task := GouoTask{ID: "old-task", UserID: 1, ClientTaskID: "old", Prompt: "旧提示词", Params: datatypes.JSON(`{"n":1}`), ResultMeta: datatypes.JSON(`{}`)}
	require.NoError(t, DB.Create(&task).Error)
	doc := GouoDocument{ID: "old-doc", UserID: 1, Kind: "canvases", ClientID: "old", Title: "旧画布", Document: datatypes.JSON(`{"schemaVersion":1}`)}
	require.NoError(t, DB.Create(&doc).Error)
	require.NoError(t, DB.Model(&GouoTask{}).Where("id = ?", task.ID).UpdateColumn("content_bytes", 0).Error)
	require.NoError(t, gouoContentBytesMigration().Migrate(DB))
	used, _, err := GetGouoStorageUsage(1)
	require.NoError(t, err)
	require.EqualValues(t, task.contentBytes()+int64(len(doc.Document)+len(doc.Title)), used)
}

func TestUpsertGouoTaskRechecksAssetsAndTrimsText(t *testing.T) {
	setupGouoCloudTestDB(t)
	// 控制器检查归属之后，回收站清理删掉了这张图
	task := GouoTask{ID: "task", UserID: 1, ClientTaskID: "task", Status: "done", Params: datatypes.JSON(`{}`), ResultMeta: datatypes.JSON(`{}`)}
	err := UpsertGouoTask(&task, []GouoTaskAsset{{AssetID: strings.Repeat("b", 32), Role: "output"}}, nil)
	require.ErrorIs(t, err, ErrGouoTaskAssets)

	// MySQL 的 TEXT 最多 65535 字节，PostgreSQL 不能存 NUL
	prompt := "a\x00" + strings.Repeat("光", 30000)
	task = GouoTask{ID: "long", UserID: 1, ClientTaskID: "long", Status: "error", Prompt: prompt, ErrorMessage: strings.Repeat("错", 30000), Params: datatypes.JSON(`{}`), ResultMeta: datatypes.JSON(`{}`)}
	require.NoError(t, UpsertGouoTask(&task, nil, nil))
	var saved GouoTask
	require.NoError(t, DB.First(&saved, "id = ?", "long").Error)
	require.LessOrEqual(t, len(saved.Prompt), 60000)
	require.LessOrEqual(t, len(saved.ErrorMessage), 60000)
	require.True(t, utf8.ValidString(saved.Prompt))
	require.True(t, utf8.ValidString(saved.ErrorMessage))
	require.NotContains(t, saved.Prompt, "\x00")
	require.True(t, strings.HasPrefix(saved.Prompt, "a光"))
}
