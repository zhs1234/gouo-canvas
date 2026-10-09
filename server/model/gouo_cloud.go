package model

import (
	"errors"
	"sort"
	"time"

	"one-api/common/config"
	"one-api/common/utils"

	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrGouoOriginalAssetConflict = errors.New("原图不能被预览图覆盖，请刷新后重新同步")

type GouoTask struct {
	ID              string         `json:"id" gorm:"type:char(32);primaryKey"`
	UserID          int            `json:"-" gorm:"uniqueIndex:idx_gouo_task_user_client;index;index:idx_gouo_task_user_updated,priority:1"`
	ClientTaskID    string         `json:"client_task_id" gorm:"type:varchar(128);uniqueIndex:idx_gouo_task_user_client"`
	SchemaVersion   int            `json:"schema_version" gorm:"default:1"`
	Status          string         `json:"status" gorm:"type:varchar(20);index"`
	Prompt          string         `json:"prompt" gorm:"type:text"`
	Model           string         `json:"model" gorm:"type:varchar(100);index"`
	Operation       string         `json:"operation" gorm:"type:varchar(20)"`
	Params          datatypes.JSON `json:"params" gorm:"type:json"`
	ResultMeta      datatypes.JSON `json:"result_meta" gorm:"type:json"`
	ErrorMessage    string         `json:"error_message" gorm:"type:text"`
	ClientCreatedAt int64          `json:"client_created_at" gorm:"index"`
	FinishedAt      int64          `json:"finished_at"`
	CreatedAt       int64          `json:"created_at" gorm:"index;autoCreateTime:milli"`
	UpdatedAt       int64          `json:"updated_at" gorm:"index;index:idx_gouo_task_user_updated,priority:2;autoUpdateTime:false"`
	HiddenAt        int64          `json:"hidden_at" gorm:"default:0;index"`
	// 文本与参数的字节数，计入云端空间
	ContentBytes int64           `json:"-" gorm:"default:0"`
	Assets       []GouoTaskAsset `json:"assets" gorm:"foreignKey:TaskID;references:ID"`
}

func (t *GouoTask) contentBytes() int64 {
	return int64(len(t.Prompt) + len(t.Model) + len(t.Params) + len(t.ResultMeta) + len(t.ErrorMessage))
}

type GouoAsset struct {
	ID           string `json:"id" gorm:"type:char(32);primaryKey"`
	UserID       int    `json:"-" gorm:"uniqueIndex:idx_gouo_asset_user_hash;index"`
	SHA256       string `json:"sha256" gorm:"type:char(64);uniqueIndex:idx_gouo_asset_user_hash"`
	StoragePath  string `json:"-" gorm:"type:varchar(500)"`
	MimeType     string `json:"mime_type" gorm:"type:varchar(50)"`
	FileSize     int64  `json:"file_size"`
	Width        int    `json:"width"`
	Height       int    `json:"height"`
	OriginalName string `json:"original_name" gorm:"type:varchar(255)"`
	CreatedAt    int64  `json:"created_at" gorm:"autoCreateTime:milli"`
	UpdatedAt    int64  `json:"updated_at" gorm:"autoUpdateTime:milli"`
}

type GouoTaskAsset struct {
	TaskID        string    `json:"-" gorm:"type:char(32);primaryKey"`
	AssetID       string    `json:"asset_id" gorm:"type:char(32);index"`
	Role          string    `json:"role" gorm:"type:varchar(32);primaryKey"`
	Position      int       `json:"position" gorm:"primaryKey"`
	ClientImageID string    `json:"client_image_id" gorm:"type:varchar(128)"`
	Asset         GouoAsset `json:"asset" gorm:"foreignKey:AssetID;references:ID"`
}

type GouoFavoriteCollection struct {
	ID        string `json:"id" gorm:"type:varchar(128);primaryKey"`
	UserID    int    `json:"-" gorm:"primaryKey;index"`
	Name      string `json:"name" gorm:"type:varchar(100)"`
	CreatedAt int64  `json:"created_at" gorm:"autoCreateTime:milli"`
	UpdatedAt int64  `json:"updated_at" gorm:"index;autoUpdateTime:milli"`
	HiddenAt  int64  `json:"hidden_at" gorm:"default:0;index"`
}

type GouoFavoriteItem struct {
	UserID       int    `json:"-" gorm:"index"`
	CollectionID string `json:"collection_id" gorm:"type:varchar(128);primaryKey"`
	TaskID       string `json:"task_id" gorm:"type:char(32);primaryKey;index"`
	CreatedAt    int64  `json:"created_at" gorm:"autoCreateTime:milli"`
	UpdatedAt    int64  `json:"updated_at" gorm:"index;autoUpdateTime:milli"`
}

type GouoStorageQuota struct {
	UserID     int   `json:"user_id" gorm:"primaryKey"`
	QuotaBytes int64 `json:"quota_bytes"`
	UpdatedAt  int64 `json:"updated_at" gorm:"autoUpdateTime:milli"`
}

func GetGouoAssetByHash(userID int, hash string) (*GouoAsset, error) {
	var asset GouoAsset
	err := DB.Where("user_id = ? AND sha256 = ?", userID, hash).First(&asset).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &asset, err
}

func GetGouoAsset(userID int, id string) (*GouoAsset, error) {
	var asset GouoAsset
	err := DB.Where("user_id = ? AND id = ?", userID, id).First(&asset).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &asset, err
}

func InsertGouoAsset(asset *GouoAsset) error {
	return DB.Create(asset).Error
}

func CountOwnedGouoAssets(userID int, ids []string) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	var count int64
	err := DB.Model(&GouoAsset{}).Where("user_id = ? AND id IN ?", userID, ids).Count(&count).Error
	return count, err
}

// GetGouoStorageUsage 返回已用空间（图片、作品记录和画布会话文档）与图片数量。
func GetGouoStorageUsage(userID int) (int64, int64, error) {
	return gouoStorageUsage(DB, userID)
}

func gouoStorageUsage(db *gorm.DB, userID int) (int64, int64, error) {
	var used, count int64
	if err := db.Model(&GouoAsset{}).Where("user_id = ?", userID).Count(&count).Error; err != nil {
		return 0, 0, err
	}
	for _, entry := range []struct {
		model  any
		column string
	}{{&GouoAsset{}, "file_size"}, {&GouoTask{}, "content_bytes"}, {&GouoDocument{}, "content_bytes"}} {
		var part int64
		if err := db.Model(entry.model).Where("user_id = ?", userID).Select("COALESCE(SUM(" + entry.column + "), 0)").Scan(&part).Error; err != nil {
			return 0, 0, err
		}
		used += part
	}
	return used, count, nil
}

func GetGouoUserQuota(userID int, defaultQuota int64) (int64, error) {
	return gouoUserQuota(DB, userID, defaultQuota)
}

func gouoUserQuota(db *gorm.DB, userID int, defaultQuota int64) (int64, error) {
	var quota GouoStorageQuota
	err := db.Where("user_id = ?", userID).First(&quota).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return defaultQuota, nil
	}
	return quota.QuotaBytes, err
}

// checkGouoStorageQuota 用户主动写入作品记录或文档时检查空间；服务端保存的付费生成结果不受限制。
func checkGouoStorageQuota(tx *gorm.DB, userID int, added int64) error {
	if added <= 0 {
		return nil
	}
	used, _, err := gouoStorageUsage(tx, userID)
	if err != nil {
		return err
	}
	quota, err := gouoUserQuota(tx, userID, config.GouoAssetUserQuotaBytes)
	if err != nil {
		return err
	}
	if used+added > quota {
		return ErrGouoStorageQuota
	}
	return nil
}

func SetGouoUserQuota(userID int, quota int64) error {
	item := GouoStorageQuota{UserID: userID, QuotaBytes: quota, UpdatedAt: time.Now().UnixMilli()}
	return DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"quota_bytes", "updated_at"}),
	}).Create(&item).Error
}

func nextGouoTaskTimestamp(tx *gorm.DB, userID int) (int64, error) {
	// 同账号写入先锁用户行；空更新也能让 SQLite 在读取游标前取得写锁。
	// 取已有最大值再递增，避免同毫秒写入或系统时钟回退使变更落在游标后方。
	if err := tx.Model(&User{}).Where("id = ?", userID).UpdateColumn("quota", gorm.Expr("quota")).Error; err != nil {
		return 0, err
	}
	var user User
	if err := tx.Select("id").First(&user, userID).Error; err != nil {
		return 0, err
	}
	var latest int64
	if err := tx.Model(&GouoTask{}).Where("user_id = ?", userID).Select("COALESCE(MAX(updated_at), 0)").Scan(&latest).Error; err != nil {
		return 0, err
	}
	now := time.Now().UnixMilli()
	if latest >= now {
		return latest + 1, nil
	}
	return now, nil
}

func UpsertGouoTask(task *GouoTask, assets []GouoTaskAsset, collectionIDs []string) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		now, err := nextGouoTaskTimestamp(tx, task.UserID)
		if err != nil {
			return err
		}
		task.UpdatedAt = now
		var existing GouoTask
		err = tx.Where("user_id = ? AND client_task_id = ?", task.UserID, task.ClientTaskID).First(&existing).Error
		if err == nil {
			task.ID = existing.ID
			task.CreatedAt = existing.CreatedAt
			// 回收站状态只由 hide/restore 接口修改，其他设备重新上传不能把已删除作品恢复。
			task.HiddenAt = existing.HiddenAt
			var previous []GouoTaskAsset
			if err := tx.Where("task_id = ?", existing.ID).Find(&previous).Error; err != nil {
				return err
			}
			// ponytail: 关联数最多 32，直接扫描；提高上限时改为按角色和位置索引。
			for _, link := range assets {
				if link.Role == "thumbnail" || link.ClientImageID == "" {
					continue
				}
				for _, old := range previous {
					if old.Role != link.Role || old.Position != link.Position || old.ClientImageID != link.ClientImageID || old.AssetID == link.AssetID {
						continue
					}
					for _, preview := range assets {
						if preview.Role == "thumbnail" && preview.ClientImageID == link.ClientImageID && preview.AssetID == link.AssetID {
							return ErrGouoOriginalAssetConflict
						}
					}
				}
			}
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		task.ContentBytes = task.contentBytes()
		if err := checkGouoStorageQuota(tx, task.UserID, task.ContentBytes-existing.ContentBytes); err != nil {
			return err
		}

		if err := tx.Save(task).Error; err != nil {
			return err
		}
		if err := tx.Where("task_id = ?", task.ID).Delete(&GouoTaskAsset{}).Error; err != nil {
			return err
		}
		for i := range assets {
			assets[i].TaskID = task.ID
		}
		if len(assets) > 0 {
			if err := tx.Create(&assets).Error; err != nil {
				return err
			}
		}
		if err := tx.Where("user_id = ? AND task_id = ?", task.UserID, task.ID).Delete(&GouoFavoriteItem{}).Error; err != nil {
			return err
		}
		items := make([]GouoFavoriteItem, 0, len(collectionIDs))
		for _, collectionID := range collectionIDs {
			items = append(items, GouoFavoriteItem{UserID: task.UserID, CollectionID: collectionID, TaskID: task.ID, CreatedAt: task.UpdatedAt, UpdatedAt: task.UpdatedAt})
		}
		if len(items) > 0 {
			return tx.Create(&items).Error
		}
		return nil
	})
}

func GetGouoTask(userID int, id string) (*GouoTask, error) {
	var task GouoTask
	err := DB.Preload("Assets.Asset").Where("user_id = ? AND (id = ? OR client_task_id = ?)", userID, id, id).First(&task).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &task, err
}

func ListGouoTasks(userID int, hidden bool, beforeUpdatedAt int64, beforeID string, limit int) ([]GouoTask, error) {
	var tasks []GouoTask
	tx := DB.Preload("Assets.Asset").Where("user_id = ?", userID)
	if hidden {
		tx = tx.Where("hidden_at > 0")
	} else {
		tx = tx.Where("hidden_at = 0")
	}
	if beforeUpdatedAt > 0 {
		tx = tx.Where("updated_at < ? OR (updated_at = ? AND id < ?)", beforeUpdatedAt, beforeUpdatedAt, beforeID)
	}
	err := tx.Order("updated_at DESC, id DESC").Limit(limit).Find(&tasks).Error
	return tasks, err
}

func ListGouoAdminTasks(userID, page, size int) ([]GouoTask, int64, error) {
	var tasks []GouoTask
	var count int64
	query := DB.Model(&GouoTask{}).Where("user_id = ?", userID)
	if err := query.Count(&count).Error; err != nil {
		return nil, 0, err
	}
	err := query.
		Preload("Assets", "role = ?", "output").
		Preload("Assets.Asset").
		Order("client_created_at DESC, id DESC").
		Offset((page - 1) * size).
		Limit(size).
		Find(&tasks).Error
	return tasks, count, err
}

func GetGouoAdminOutputAsset(userID int, assetID string) (*GouoAsset, error) {
	var asset GouoAsset
	err := DB.Table("gouo_assets").
		Joins("JOIN gouo_task_assets ON gouo_task_assets.asset_id = gouo_assets.id AND gouo_task_assets.role = ?", "output").
		Joins("JOIN gouo_tasks ON gouo_tasks.id = gouo_task_assets.task_id AND gouo_tasks.user_id = ?", userID).
		Where("gouo_assets.id = ? AND gouo_assets.user_id = ?", assetID, userID).
		First(&asset).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &asset, err
}

func SetGouoTaskHidden(userID int, id string, hidden bool) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		now, err := nextGouoTaskTimestamp(tx, userID)
		if err != nil {
			return err
		}
		hiddenAt := int64(0)
		if hidden {
			hiddenAt = now
		}
		return tx.Model(&GouoTask{}).Where("user_id = ? AND id = ?", userID, id).Updates(map[string]any{"hidden_at": hiddenAt, "updated_at": now}).Error
	})
}

func ListGouoCollections(userID int, includeHidden bool) ([]GouoFavoriteCollection, error) {
	var collections []GouoFavoriteCollection
	tx := DB.Where("user_id = ?", userID)
	if !includeHidden {
		tx = tx.Where("hidden_at = 0")
	}
	err := tx.Order("updated_at DESC, id").Find(&collections).Error
	return collections, err
}

func CountOwnedGouoCollections(userID int, ids []string) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	var count int64
	err := DB.Model(&GouoFavoriteCollection{}).Where("user_id = ? AND id IN ? AND hidden_at = 0", userID, ids).Count(&count).Error
	return count, err
}

func GetGouoCollection(userID int, id string) (*GouoFavoriteCollection, error) {
	var collection GouoFavoriteCollection
	err := DB.Where("user_id = ? AND id = ?", userID, id).First(&collection).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &collection, err
}

func UpsertGouoCollection(collection *GouoFavoriteCollection) error {
	return DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "id"}, {Name: "user_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"name", "updated_at"}),
	}).Create(collection).Error
}

// 隐藏或恢复收藏夹会改变夹内任务下发的收藏关系，同时推进这些任务的 updated_at，其他设备才能增量拉到。
func SetGouoCollectionHidden(userID int, id string, hidden bool) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		now, err := nextGouoTaskTimestamp(tx, userID)
		if err != nil {
			return err
		}
		hiddenAt := int64(0)
		if hidden {
			hiddenAt = now
		}
		if err := tx.Model(&GouoFavoriteCollection{}).Where("user_id = ? AND id = ?", userID, id).Updates(map[string]any{"hidden_at": hiddenAt, "updated_at": now}).Error; err != nil {
			return err
		}
		taskIDs := tx.Model(&GouoFavoriteItem{}).Select("task_id").Where("user_id = ? AND collection_id = ?", userID, id)
		return tx.Model(&GouoTask{}).Where("user_id = ? AND id IN (?)", userID, taskIDs).Update("updated_at", now).Error
	})
}

// 收藏关系随任务一起增量同步，变更时同步推进任务的 updated_at，其他设备才能拉到。
func SetGouoFavoriteItem(userID int, collectionID, taskID string, add bool) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		now, err := nextGouoTaskTimestamp(tx, userID)
		if err != nil {
			return err
		}
		if add {
			item := GouoFavoriteItem{UserID: userID, CollectionID: collectionID, TaskID: taskID, CreatedAt: now, UpdatedAt: now}
			err = tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&item).Error
		} else {
			err = tx.Where("user_id = ? AND collection_id = ? AND task_id = ?", userID, collectionID, taskID).Delete(&GouoFavoriteItem{}).Error
		}
		if err != nil {
			return err
		}
		return tx.Model(&GouoTask{}).Where("user_id = ? AND id = ?", userID, taskID).Update("updated_at", now).Error
	})
}

// ListGouoFavoriteItems 只返回未隐藏收藏夹中的收藏；恢复收藏夹后原有收藏随之恢复。
func ListGouoFavoriteItems(userID int) ([]GouoFavoriteItem, error) {
	var items []GouoFavoriteItem
	visible := DB.Model(&GouoFavoriteCollection{}).Select("id").Where("user_id = ? AND hidden_at = 0", userID)
	err := DB.Where("user_id = ? AND collection_id IN (?)", userID, visible).Order("updated_at, collection_id, task_id").Find(&items).Error
	return items, err
}

type GouoStorageAdminSummary struct {
	TotalBytes  int64 `json:"total_bytes"`
	AssetCount  int64 `json:"asset_count"`
	TaskCount   int64 `json:"task_count"`
	HiddenCount int64 `json:"hidden_count"`
	UserCount   int64 `json:"user_count"`
}

func GetGouoStorageAdminSummary() (*GouoStorageAdminSummary, error) {
	var summary GouoStorageAdminSummary
	if err := DB.Model(&GouoAsset{}).Select("COALESCE(SUM(file_size), 0)").Scan(&summary.TotalBytes).Error; err != nil {
		return nil, err
	}
	if err := DB.Model(&GouoAsset{}).Count(&summary.AssetCount).Error; err != nil {
		return nil, err
	}
	if err := DB.Model(&GouoTask{}).Count(&summary.TaskCount).Error; err != nil {
		return nil, err
	}
	if err := DB.Model(&GouoTask{}).Where("hidden_at > 0").Count(&summary.HiddenCount).Error; err != nil {
		return nil, err
	}
	if err := DB.Model(&GouoAsset{}).Distinct("user_id").Count(&summary.UserCount).Error; err != nil {
		return nil, err
	}
	return &summary, nil
}

type GouoStorageUserUsage struct {
	UserID     int    `json:"user_id"`
	Username   string `json:"username"`
	UsedBytes  int64  `json:"used_bytes"`
	AssetCount int64  `json:"asset_count"`
}

// ListGouoStorageUserUsage 按账号汇总已用空间；belowRole 大于 0 时只返回权限低于该等级的账号。
func ListGouoStorageUserUsage(belowRole int) ([]GouoStorageUserUsage, error) {
	scope := func(tx *gorm.DB) *gorm.DB {
		if belowRole > 0 {
			return tx.Where("users.role < ?", belowRole)
		}
		return tx
	}
	var rows []GouoStorageUserUsage
	err := DB.Table("gouo_assets").
		Select("gouo_assets.user_id, users.username, COALESCE(SUM(gouo_assets.file_size), 0) AS used_bytes, COUNT(gouo_assets.id) AS asset_count").
		Joins("LEFT JOIN users ON users.id = gouo_assets.user_id").
		Scopes(scope).
		Group("gouo_assets.user_id, users.username").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	// 作品记录和文档同样计入已用空间
	byUser := map[int]int{}
	for i := range rows {
		byUser[rows[i].UserID] = i
	}
	for _, table := range []string{"gouo_tasks", "gouo_documents"} {
		var parts []GouoStorageUserUsage
		if err := DB.Table(table).Select(table + ".user_id, users.username, COALESCE(SUM(" + table + ".content_bytes), 0) AS used_bytes").
			Joins("LEFT JOIN users ON users.id = " + table + ".user_id").
			Scopes(scope).
			Group(table + ".user_id, users.username").Scan(&parts).Error; err != nil {
			return nil, err
		}
		for _, part := range parts {
			if i, ok := byUser[part.UserID]; ok {
				rows[i].UsedBytes += part.UsedBytes
				continue
			}
			byUser[part.UserID] = len(rows)
			rows = append(rows, part)
		}
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].UsedBytes > rows[j].UsedBytes })
	return rows, nil
}

type GouoGenerationRecord struct {
	UserID       int
	ClientTaskID string
	Index        int
	Prompt       string
	Model        string
	Operation    string
	Params       datatypes.JSON
	Outputs      []*GouoAsset
	Inputs       []*GouoAsset
	Mask         *GouoAsset
}

// RecordGouoGeneration 在服务端拿到图片时直接写入作品记录；批量生成的每个子请求按序号合并到同一作品。
func RecordGouoGeneration(record GouoGenerationRecord) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		// 时间戳函数会锁定用户行，并发子请求在这里串行，不会重复创建作品。
		now, err := nextGouoTaskTimestamp(tx, record.UserID)
		if err != nil {
			return err
		}
		var task GouoTask
		err = tx.Preload("Assets").Where("user_id = ? AND client_task_id = ?", record.UserID, record.ClientTaskID).First(&task).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			task = GouoTask{
				ID: utils.GetUUID(), UserID: record.UserID, ClientTaskID: record.ClientTaskID, SchemaVersion: 1,
				Prompt: record.Prompt, Model: record.Model, Operation: record.Operation, Params: record.Params,
				ResultMeta: datatypes.JSON(`{}`), ClientCreatedAt: now, CreatedAt: now,
			}
		} else if err != nil {
			return err
		}
		task.Status, task.FinishedAt, task.UpdatedAt, task.ErrorMessage = "done", now, now, ""
		task.ContentBytes = task.contentBytes()
		if err := tx.Omit("Assets").Save(&task).Error; err != nil {
			return err
		}
		hasRole := map[string]bool{}
		for _, link := range task.Assets {
			hasRole[link.Role] = true
		}
		links := make([]GouoTaskAsset, 0, len(record.Outputs)+len(record.Inputs)+1)
		for i, asset := range record.Outputs {
			links = append(links, GouoTaskAsset{TaskID: task.ID, AssetID: asset.ID, Role: "output", Position: record.Index + i})
		}
		// 批量请求的参考图相同，只在首次写入时保存。
		if !hasRole["input"] {
			for i, asset := range record.Inputs {
				links = append(links, GouoTaskAsset{TaskID: task.ID, AssetID: asset.ID, Role: "input", Position: i})
			}
		}
		if record.Mask != nil && !hasRole["mask"] {
			links = append(links, GouoTaskAsset{TaskID: task.ID, AssetID: record.Mask.ID, Role: "mask", Position: 0})
		}
		if len(links) == 0 {
			return nil
		}
		return tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "task_id"}, {Name: "role"}, {Name: "position"}},
			DoUpdates: clause.AssignmentColumns([]string{"asset_id"}),
		}).Create(&links).Error
	})
}

type GouoTaskMeta struct {
	Prompt          string
	Params          datatypes.JSON
	ResultMeta      datatypes.JSON
	ClientCreatedAt int64
	ClientImageIDs  map[string][]string
	// 与 ClientImageIDs 一一对应的服务端位置；批量任务部分失败时下标与位置不再相同。缺省时按下标绑定。
	ClientImagePositions map[string][]int
	CollectionIDs        []string
}

// UpdateGouoTaskMeta 补充只有客户端知道的信息（原始提示词、来源、本地图片编号、收藏），不改动服务端保存的图片。
func UpdateGouoTaskMeta(userID int, clientTaskID string, meta GouoTaskMeta) (*GouoTask, error) {
	var task GouoTask
	err := DB.Transaction(func(tx *gorm.DB) error {
		now, err := nextGouoTaskTimestamp(tx, userID)
		if err != nil {
			return err
		}
		if err := tx.Where("user_id = ? AND client_task_id = ?", userID, clientTaskID).First(&task).Error; err != nil {
			return err
		}
		updates := map[string]any{"updated_at": now}
		if meta.Prompt != "" {
			updates["prompt"] = meta.Prompt
		}
		if len(meta.Params) > 0 {
			updates["params"] = meta.Params
		}
		if len(meta.ResultMeta) > 0 {
			updates["result_meta"] = meta.ResultMeta
		}
		if meta.ClientCreatedAt > 0 {
			updates["client_created_at"] = meta.ClientCreatedAt
		}
		if err := tx.Model(&task).Updates(updates).Error; err != nil {
			return err
		}
		if err := tx.First(&task, "id = ?", task.ID).Error; err != nil {
			return err
		}
		if err := tx.Model(&task).UpdateColumn("content_bytes", task.contentBytes()).Error; err != nil {
			return err
		}
		for role, ids := range meta.ClientImageIDs {
			positions := meta.ClientImagePositions[role]
			for index, id := range ids {
				if id == "" {
					continue
				}
				position := index
				if len(positions) == len(ids) {
					position = positions[index]
				}
				if err := tx.Model(&GouoTaskAsset{}).Where("task_id = ? AND role = ? AND position = ?", task.ID, role, position).Update("client_image_id", id).Error; err != nil {
					return err
				}
			}
		}
		if meta.CollectionIDs == nil {
			return nil
		}
		if err := tx.Where("user_id = ? AND task_id = ?", userID, task.ID).Delete(&GouoFavoriteItem{}).Error; err != nil {
			return err
		}
		items := make([]GouoFavoriteItem, 0, len(meta.CollectionIDs))
		for _, id := range meta.CollectionIDs {
			items = append(items, GouoFavoriteItem{UserID: userID, CollectionID: id, TaskID: task.ID, CreatedAt: now, UpdatedAt: now})
		}
		if len(items) == 0 {
			return nil
		}
		return tx.Create(&items).Error
	})
	if err != nil {
		return nil, err
	}
	return GetGouoTask(userID, task.ID)
}
