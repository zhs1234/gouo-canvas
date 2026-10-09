package model

import (
	"errors"
	"time"

	"gorm.io/datatypes"
	"gorm.io/gorm"
)

var ErrGouoDocumentConflict = errors.New("文档已在其他设备修改，请先处理冲突")
var ErrGouoDocumentAssets = errors.New("文档引用了不属于当前用户的图片")

type GouoDocumentAsset struct {
	AssetID       string `json:"asset_id"`
	ClientImageID string `json:"client_image_id"`
}

type GouoDocument struct {
	ID         string                                 `json:"id" gorm:"type:char(32);primaryKey"`
	UserID     int                                    `json:"-" gorm:"uniqueIndex:idx_gouo_document_owner;index:idx_gouo_document_cursor,priority:1"`
	Kind       string                                 `json:"kind" gorm:"type:varchar(20);uniqueIndex:idx_gouo_document_owner;index:idx_gouo_document_cursor,priority:2"`
	ClientID   string                                 `json:"client_id" gorm:"type:varchar(128);uniqueIndex:idx_gouo_document_owner"`
	Title      string                                 `json:"title" gorm:"type:varchar(200)"`
	Document   datatypes.JSON                         `json:"document" gorm:"type:json"`
	AssetIDs   datatypes.JSONSlice[string]            `json:"asset_ids" gorm:"type:json"`
	AssetLinks datatypes.JSONSlice[GouoDocumentAsset] `json:"-" gorm:"type:json"`
	Revision   int64                                  `json:"revision"`
	CreatedAt  int64                                  `json:"created_at" gorm:"autoCreateTime:milli"`
	UpdatedAt  int64                                  `json:"updated_at" gorm:"autoUpdateTime:false;index:idx_gouo_document_cursor,priority:3"`
	HiddenAt   int64                                  `json:"hidden_at"`
}

func GetGouoDocumentAssets(userID int, ids []string) ([]GouoAsset, error) {
	assets := make([]GouoAsset, 0)
	for start := 0; start < len(ids); start += 500 {
		var batch []GouoAsset
		if err := DB.Where("user_id = ? AND id IN ?", userID, ids[start:min(start+500, len(ids))]).Find(&batch).Error; err != nil {
			return nil, err
		}
		assets = append(assets, batch...)
	}
	return assets, nil
}

func GetGouoDocument(userID int, kind, clientID string) (*GouoDocument, error) {
	var doc GouoDocument
	err := DB.Where("user_id = ? AND kind = ? AND client_id = ?", userID, kind, clientID).First(&doc).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &doc, err
}

// 用户行锁串行化同账号写入，保证冲突检测及毫秒游标在 SQLite/MySQL/Postgres 一致。
func SaveGouoDocument(doc *GouoDocument, expected int64, hidden *bool) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		res := tx.Model(&User{}).Where("id = ?", doc.UserID).UpdateColumn("quota", gorm.Expr("quota"))
		if res.Error != nil {
			return res.Error
		}
		var user User
		if err := tx.Select("id").First(&user, doc.UserID).Error; err != nil {
			return err
		}
		var old GouoDocument
		err := tx.Where("user_id = ? AND kind = ? AND client_id = ?", doc.UserID, doc.Kind, doc.ClientID).First(&old).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if old.Revision != expected || (hidden != nil && old.ID == "") {
			return ErrGouoDocumentConflict
		}
		if hidden != nil {
			*doc = old
		} else {
			var owned int64
			if len(doc.AssetIDs) > 0 {
				for start := 0; start < len(doc.AssetIDs); start += 500 {
					var count int64
					if err := tx.Model(&GouoAsset{}).Where("user_id = ? AND id IN ?", doc.UserID, []string(doc.AssetIDs[start:min(start+500, len(doc.AssetIDs))])).Count(&count).Error; err != nil {
						return err
					}
					owned += count
				}
				if owned != int64(len(doc.AssetIDs)) {
					return ErrGouoDocumentAssets
				}
			}
			if old.ID != "" {
				doc.ID, doc.CreatedAt, doc.HiddenAt = old.ID, old.CreatedAt, old.HiddenAt
			}
		}
		var latest int64
		if err := tx.Model(&GouoDocument{}).Where("user_id = ?", doc.UserID).Select("COALESCE(MAX(updated_at), 0)").Scan(&latest).Error; err != nil {
			return err
		}
		doc.UpdatedAt = max(time.Now().UnixMilli(), latest+1)
		doc.Revision = expected + 1
		if hidden != nil {
			doc.HiddenAt = 0
			if *hidden {
				doc.HiddenAt = doc.UpdatedAt
			}
		}
		return tx.Save(doc).Error
	})
}

func ListGouoDocuments(userID int, kind string, changed, hidden bool, after int64, afterID string, limit int) ([]GouoDocument, error) {
	docs := make([]GouoDocument, 0)
	query := DB.Where("user_id = ? AND kind = ?", userID, kind)
	// 游标对所有列表生效，否则隐藏列表超过一页后无法翻页。
	query = query.Where("updated_at > ? OR (updated_at = ? AND id > ?)", after, after, afterID)
	if !changed && hidden {
		query = query.Where("hidden_at > 0")
	} else if !changed {
		query = query.Where("hidden_at = 0")
	}
	err := query.Order("updated_at ASC, id ASC").Limit(limit).Find(&docs).Error
	return docs, err
}
