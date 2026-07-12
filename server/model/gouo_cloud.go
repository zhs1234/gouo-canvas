package model

import (
	"errors"
	"time"

	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type GouoTask struct {
	ID              string          `json:"id" gorm:"type:char(32);primaryKey"`
	UserID          int             `json:"-" gorm:"uniqueIndex:idx_gouo_task_user_client;index"`
	ClientTaskID    string          `json:"client_task_id" gorm:"type:varchar(128);uniqueIndex:idx_gouo_task_user_client"`
	SchemaVersion   int             `json:"schema_version" gorm:"default:1"`
	Status          string          `json:"status" gorm:"type:varchar(20);index"`
	Prompt          string          `json:"prompt" gorm:"type:text"`
	Model           string          `json:"model" gorm:"type:varchar(100);index"`
	Operation       string          `json:"operation" gorm:"type:varchar(20)"`
	Params          datatypes.JSON  `json:"params" gorm:"type:json"`
	ResultMeta      datatypes.JSON  `json:"result_meta" gorm:"type:json"`
	ErrorMessage    string          `json:"error_message" gorm:"type:text"`
	ClientCreatedAt int64           `json:"client_created_at" gorm:"index"`
	FinishedAt      int64           `json:"finished_at"`
	CreatedAt       int64           `json:"created_at" gorm:"index"`
	UpdatedAt       int64           `json:"updated_at" gorm:"index"`
	HiddenAt        int64           `json:"hidden_at" gorm:"default:0;index"`
	Assets          []GouoTaskAsset `json:"assets" gorm:"foreignKey:TaskID;references:ID"`
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
	CreatedAt    int64  `json:"created_at"`
	UpdatedAt    int64  `json:"updated_at"`
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
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at" gorm:"index"`
	HiddenAt  int64  `json:"hidden_at" gorm:"default:0;index"`
}

type GouoFavoriteItem struct {
	UserID       int    `json:"-" gorm:"index"`
	CollectionID string `json:"collection_id" gorm:"type:varchar(128);primaryKey"`
	TaskID       string `json:"task_id" gorm:"type:char(32);primaryKey;index"`
	CreatedAt    int64  `json:"created_at"`
	UpdatedAt    int64  `json:"updated_at" gorm:"index"`
}

type GouoStorageQuota struct {
	UserID     int   `json:"user_id" gorm:"primaryKey"`
	QuotaBytes int64 `json:"quota_bytes"`
	UpdatedAt  int64 `json:"updated_at"`
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

func GetGouoStorageUsage(userID int) (int64, int64, error) {
	var used int64
	var count int64
	if err := DB.Model(&GouoAsset{}).Where("user_id = ?", userID).Select("COALESCE(SUM(file_size), 0)").Scan(&used).Error; err != nil {
		return 0, 0, err
	}
	if err := DB.Model(&GouoAsset{}).Where("user_id = ?", userID).Count(&count).Error; err != nil {
		return 0, 0, err
	}
	return used, count, nil
}

func GetGouoUserQuota(userID int, defaultQuota int64) (int64, error) {
	var quota GouoStorageQuota
	err := DB.Where("user_id = ?", userID).First(&quota).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return defaultQuota, nil
	}
	return quota.QuotaBytes, err
}

func SetGouoUserQuota(userID int, quota int64) error {
	item := GouoStorageQuota{UserID: userID, QuotaBytes: quota, UpdatedAt: time.Now().UnixMilli()}
	return DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"quota_bytes", "updated_at"}),
	}).Create(&item).Error
}

func UpsertGouoTask(task *GouoTask, assets []GouoTaskAsset, collectionIDs []string) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var existing GouoTask
		err := tx.Where("user_id = ? AND client_task_id = ?", task.UserID, task.ClientTaskID).First(&existing).Error
		if err == nil {
			task.ID = existing.ID
			task.CreatedAt = existing.CreatedAt
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
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

func ListChangedGouoTasks(userID int, afterUpdatedAt int64, afterID string, limit int) ([]GouoTask, error) {
	var tasks []GouoTask
	tx := DB.Preload("Assets.Asset").Where("user_id = ?", userID)
	if afterUpdatedAt > 0 {
		tx = tx.Where("updated_at > ? OR (updated_at = ? AND id > ?)", afterUpdatedAt, afterUpdatedAt, afterID)
	}
	err := tx.Order("updated_at ASC, id ASC").Limit(limit).Find(&tasks).Error
	return tasks, err
}

func SetGouoTaskHidden(userID int, id string, hidden bool) error {
	now := time.Now().UnixMilli()
	hiddenAt := int64(0)
	if hidden {
		hiddenAt = now
	}
	return DB.Model(&GouoTask{}).Where("user_id = ? AND id = ?", userID, id).Updates(map[string]any{"hidden_at": hiddenAt, "updated_at": now}).Error
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
		DoUpdates: clause.AssignmentColumns([]string{"name", "updated_at", "hidden_at"}),
	}).Create(collection).Error
}

func SetGouoCollectionHidden(userID int, id string, hidden bool) error {
	now := time.Now().UnixMilli()
	hiddenAt := int64(0)
	if hidden {
		hiddenAt = now
	}
	return DB.Model(&GouoFavoriteCollection{}).Where("user_id = ? AND id = ?", userID, id).Updates(map[string]any{"hidden_at": hiddenAt, "updated_at": now}).Error
}

func SetGouoFavoriteItem(userID int, collectionID, taskID string, add bool) error {
	if !add {
		return DB.Where("user_id = ? AND collection_id = ? AND task_id = ?", userID, collectionID, taskID).Delete(&GouoFavoriteItem{}).Error
	}
	now := time.Now().UnixMilli()
	item := GouoFavoriteItem{UserID: userID, CollectionID: collectionID, TaskID: taskID, CreatedAt: now, UpdatedAt: now}
	return DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&item).Error
}

func ListGouoFavoriteItems(userID int) ([]GouoFavoriteItem, error) {
	var items []GouoFavoriteItem
	err := DB.Where("user_id = ?", userID).Order("updated_at, collection_id, task_id").Find(&items).Error
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

func ListGouoStorageUserUsage() ([]GouoStorageUserUsage, error) {
	var rows []GouoStorageUserUsage
	err := DB.Table("gouo_assets").
		Select("gouo_assets.user_id, users.username, COALESCE(SUM(gouo_assets.file_size), 0) AS used_bytes, COUNT(gouo_assets.id) AS asset_count").
		Joins("LEFT JOIN users ON users.id = gouo_assets.user_id").
		Group("gouo_assets.user_id, users.username").
		Order("used_bytes DESC").
		Scan(&rows).Error
	return rows, err
}
