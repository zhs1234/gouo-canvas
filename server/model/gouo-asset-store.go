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
	if existing != nil {
		// 回收站清理按 updated_at 保护近期上传的图片，复用旧记录时刷新，避免在关联到作品或文档之前被清除
		if err := DB.Model(existing).UpdateColumn("updated_at", time.Now().UnixMilli()).Error; err != nil {
			return nil, false, err
		}
		return existing, true, nil
	}
	if enforceQuota {
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

	relativePath := filepath.Join(strconv.Itoa(userID), hash[:2], hash+extension)
	root, err := filepath.Abs(config.GouoAssetDir)
	if err != nil {
		return nil, false, err
	}
	target := filepath.Join(root, relativePath)
	if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
		return nil, false, err
	}
	if _, err := os.Stat(target); errors.Is(err, os.ErrNotExist) {
		temp, err := os.CreateTemp(filepath.Dir(target), ".gouo-upload-*")
		if err != nil {
			return nil, false, err
		}
		defer os.Remove(temp.Name())
		if _, err := temp.Write(data); err != nil {
			temp.Close()
			return nil, false, err
		}
		if err := temp.Sync(); err != nil {
			temp.Close()
			return nil, false, err
		}
		if err := temp.Close(); err != nil {
			return nil, false, err
		}
		if err := os.Rename(temp.Name(), target); err != nil {
			return nil, false, err
		}
	} else if err != nil {
		return nil, false, err
	}

	if len([]rune(originalName)) > 120 {
		originalName = string([]rune(originalName)[:120])
	}
	now := time.Now().UnixMilli()
	asset := GouoAsset{
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
	if err := InsertGouoAsset(&asset); err != nil {
		return nil, false, err
	}
	return &asset, false, nil
}
