package model

import (
	"errors"
	"os"
	"path/filepath"
	"time"

	"one-api/common/config"

	"gorm.io/gorm"
)

// GouoTrashRetention 回收站保留期：作品、画布、会话和收藏夹删除后保留 3 天再彻底清除；已删除账号的云端数据同样保留 3 天。
const GouoTrashRetention = 3 * 24 * time.Hour

// PurgeGouoTrash 清除超过保留期的回收站内容，以及因此不再被引用的图片文件。
func PurgeGouoTrash(now time.Time) error {
	cutoff := now.Add(-GouoTrashRetention).UnixMilli()
	var deletedUsers []int
	if err := DB.Unscoped().Model(&User{}).Where("deleted_at IS NOT NULL AND deleted_at < ?", now.Add(-GouoTrashRetention)).Pluck("id", &deletedUsers).Error; err != nil {
		return err
	}
	deleted := map[int]bool{}
	for _, id := range deletedUsers {
		deleted[id] = true
	}
	users := map[int]bool{}
	for _, model := range []any{&GouoTask{}, &GouoDocument{}, &GouoFavoriteCollection{}} {
		var ids []int
		if err := DB.Model(model).Where("hidden_at > 0 AND hidden_at < ?", cutoff).Distinct("user_id").Pluck("user_id", &ids).Error; err != nil {
			return err
		}
		for _, id := range ids {
			users[id] = true
		}
	}
	for _, id := range deletedUsers {
		for _, model := range []any{&GouoTask{}, &GouoAsset{}, &GouoDocument{}, &GouoFavoriteCollection{}} {
			var count int64
			if err := DB.Model(model).Where("user_id = ?", id).Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				users[id] = true
				break
			}
		}
	}
	root, err := filepath.Abs(config.GouoAssetDir)
	if err != nil {
		return err
	}
	for userID := range users {
		paths, err := purgeGouoUserTrash(userID, cutoff, deleted[userID])
		if err != nil {
			return err
		}
		// 记录删除提交后再删文件；文件删除失败只会残留文件，不会留下指向缺失文件的记录。
		for _, path := range paths {
			if err := os.Remove(filepath.Join(root, filepath.Clean(path))); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
		}
	}
	return nil
}

// purgeGouoUserTrash 删除一个账号过期的回收站记录，返回已删除图片的存储路径；all 表示账号已删除，清除全部云端数据。
func purgeGouoUserTrash(userID int, cutoff int64, all bool) ([]string, error) {
	// 与上传共用锁，避免上传按哈希复用一张正在被清除的图片
	gouoAssetMutex.Lock()
	defer gouoAssetMutex.Unlock()
	var paths []string
	err := DB.Transaction(func(tx *gorm.DB) error {
		expired := func(model any) *gorm.DB {
			query := tx.Model(model).Where("user_id = ?", userID)
			if !all {
				query = query.Where("hidden_at > 0 AND hidden_at < ?", cutoff)
			}
			return query
		}
		var taskIDs []string
		if err := expired(&GouoTask{}).Pluck("id", &taskIDs).Error; err != nil {
			return err
		}
		for start := 0; start < len(taskIDs); start += 500 {
			batch := taskIDs[start:min(start+500, len(taskIDs))]
			if err := tx.Where("task_id IN ?", batch).Delete(&GouoTaskAsset{}).Error; err != nil {
				return err
			}
			if err := tx.Where("user_id = ? AND task_id IN ?", userID, batch).Delete(&GouoFavoriteItem{}).Error; err != nil {
				return err
			}
			if err := tx.Where("id IN ?", batch).Delete(&GouoTask{}).Error; err != nil {
				return err
			}
		}
		if err := expired(&GouoDocument{}).Delete(&GouoDocument{}).Error; err != nil {
			return err
		}
		var collectionIDs []string
		if err := expired(&GouoFavoriteCollection{}).Pluck("id", &collectionIDs).Error; err != nil {
			return err
		}
		if len(collectionIDs) > 0 {
			if err := tx.Where("user_id = ? AND collection_id IN ?", userID, collectionIDs).Delete(&GouoFavoriteItem{}).Error; err != nil {
				return err
			}
			if err := tx.Where("user_id = ? AND id IN ?", userID, collectionIDs).Delete(&GouoFavoriteCollection{}).Error; err != nil {
				return err
			}
		}
		if all {
			if err := tx.Where("user_id = ?", userID).Delete(&GouoStorageQuota{}).Error; err != nil {
				return err
			}
		}

		// 剩余作品和文档仍引用的图片保留；刚上传或刚被去重复用、尚未关联的图片在保留期内也保留。
		referenced := map[string]bool{}
		var linked []string
		if err := tx.Model(&GouoTaskAsset{}).Joins("JOIN gouo_tasks ON gouo_tasks.id = gouo_task_assets.task_id").Where("gouo_tasks.user_id = ?", userID).Distinct("gouo_task_assets.asset_id").Pluck("gouo_task_assets.asset_id", &linked).Error; err != nil {
			return err
		}
		for _, id := range linked {
			referenced[id] = true
		}
		var docs []GouoDocument
		if err := tx.Select("asset_ids").Where("user_id = ?", userID).Find(&docs).Error; err != nil {
			return err
		}
		for _, doc := range docs {
			for _, id := range doc.AssetIDs {
				referenced[id] = true
			}
		}
		assets := tx.Where("user_id = ?", userID)
		if !all {
			assets = assets.Where("updated_at < ?", cutoff)
		}
		var candidates []GouoAsset
		if err := assets.Select("id", "storage_path").Find(&candidates).Error; err != nil {
			return err
		}
		var assetIDs []string
		for _, asset := range candidates {
			if referenced[asset.ID] {
				continue
			}
			assetIDs = append(assetIDs, asset.ID)
			paths = append(paths, asset.StoragePath)
		}
		for start := 0; start < len(assetIDs); start += 500 {
			if err := tx.Where("user_id = ? AND id IN ?", userID, assetIDs[start:min(start+500, len(assetIDs))]).Delete(&GouoAsset{}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return paths, nil
}
