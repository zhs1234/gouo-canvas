package model

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"one-api/common/config"
	"one-api/common/utils"

	_ "golang.org/x/image/webp"
	"gorm.io/gorm"
)

var (
	ErrGouoUnsupportedImage = errors.New("仅支持 PNG、JPEG、WebP、GIF 和 AVIF 图片")
	ErrGouoInvalidImage     = errors.New("图片内容无法识别")
	ErrGouoStorageQuota     = errors.New("云端空间不足")
)

var GouoAssetFormats = map[string]string{
	"image/png":  ".png",
	"image/jpeg": ".jpg",
	"image/webp": ".webp",
	"image/gif":  ".gif",
	"image/avif": ".avif",
}

// 同一用户按内容去重；上传、服务端保存生成结果与回收站清理按用户互斥，避免并发写入或删除同一文件。
// 不同用户互不阻塞，否则一个大账号的清理会卡住全站的出图响应。
var gouoAssetLocks sync.Map

func lockGouoAssets(userID int) func() {
	value, _ := gouoAssetLocks.LoadOrStore(userID, &sync.Mutex{})
	mu := value.(*sync.Mutex)
	mu.Lock()
	return mu.Unlock
}

// SaveGouoAssetBytes 把图片写入用户素材库，内容相同时直接返回已有素材。
// 服务端保存的生成结果已经扣费，不受空间配额限制，否则付费图片会丢失。
func SaveGouoAssetBytes(userID int, data []byte, originalName string, enforceQuota bool) (*GouoAsset, bool, error) {
	detected := http.DetectContentType(data)
	if len(data) >= 12 && string(data[4:8]) == "ftyp" && (string(data[8:12]) == "avif" || string(data[8:12]) == "avis") {
		detected = "image/avif"
	}
	extension, allowed := GouoAssetFormats[detected]
	if !allowed {
		return nil, false, ErrGouoUnsupportedImage
	}
	width, height := 0, 0
	if detected != "image/avif" {
		cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
		if err != nil || cfg.Width <= 0 || cfg.Height <= 0 {
			return nil, false, ErrGouoInvalidImage
		}
		width, height = cfg.Width, cfg.Height
	}
	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:])

	defer lockGouoAssets(userID)()
	existing, err := GetGouoAssetByHash(userID, hash)
	if err != nil {
		return nil, false, err
	}
	if existing == nil && enforceQuota {
		used, _, err := GetGouoStorageUsage(userID)
		if err != nil {
			return nil, false, err
		}
		quota, err := GetGouoUserQuota(userID, config.GouoAssetUserQuotaBytes)
		if err != nil {
			return nil, false, err
		}
		if used+int64(len(data)) > quota {
			return nil, false, ErrGouoStorageQuota
		}
	}

	root, err := filepath.Abs(config.GouoAssetDir)
	if err != nil {
		return nil, false, err
	}
	if len([]rune(originalName)) > 120 {
		originalName = string([]rune(originalName)[:120])
	}
	var asset GouoAsset
	deduplicated := false
	// 进程内锁只管本实例；查重、写文件和建记录都在锁住用户行的事务里完成，
	// 与回收站清理（同样先锁用户行、提交前删文件）在多实例共享素材目录时也互斥
	err = DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Unscoped().Model(&User{}).Where("id = ?", userID).UpdateColumn("quota", gorm.Expr("quota")).Error; err != nil {
			return err
		}
		err := tx.Where("user_id = ? AND sha256 = ?", userID, hash).First(&asset).Error
		if err == nil {
			deduplicated = true
			// 文件可能因清理事务提交失败等原因缺失，复用记录时补写，否则去重会一直返回坏图
			if err := writeGouoAssetFile(filepath.Join(root, filepath.Clean(asset.StoragePath)), data); err != nil {
				return err
			}
			// 回收站清理按 updated_at 保护近期上传的图片，复用旧记录时刷新，避免在关联到作品或文档之前被清除
			return tx.Model(&asset).UpdateColumn("updated_at", time.Now().UnixMilli()).Error
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		relativePath := filepath.Join(strconv.Itoa(userID), hash[:2], hash+extension)
		if err := writeGouoAssetFile(filepath.Join(root, relativePath), data); err != nil {
			return err
		}
		now := time.Now().UnixMilli()
		asset = GouoAsset{
			ID:           utils.GetUUID(),
			UserID:       userID,
			SHA256:       hash,
			StoragePath:  relativePath,
			MimeType:     detected,
			FileSize:     int64(len(data)),
			Width:        width,
			Height:       height,
			OriginalName: originalName,
			CreatedAt:    now,
			UpdatedAt:    now,
		}
		return tx.Create(&asset).Error
	})
	if err != nil {
		return nil, false, err
	}
	return &asset, deduplicated, nil
}

// writeGouoAssetFile 在文件不存在时原子写入；内容按哈希命名，已存在即视为相同内容。
func writeGouoAssetFile(target string, data []byte) error {
	if _, err := os.Stat(target); !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(target), ".gouo-upload-*")
	if err != nil {
		return err
	}
	defer os.Remove(temp.Name())
	if _, err := temp.Write(data); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(temp.Name(), target)
}
