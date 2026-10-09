package model

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"one-api/common/config"
	"one-api/types"
)

const (
	GouoImageResultRetention  = 24 * time.Hour
	gouoImageResultMaxBytes   = 256 * 1024 * 1024
	gouoImageResultCacheBytes = 4 * 1024 * 1024 * 1024
)

var gouoImageResultMutex sync.Mutex
var gouoImageResultID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

type GouoImageResult struct {
	Status      string               `json:"status"`
	Recoverable bool                 `json:"recoverable"`
	Result      *types.ImageResponse `json:"result,omitempty"`
	Reason      string               `json:"reason,omitempty"`
}

// 结果缓存独立于用户可编辑的作品同步，避免失败任务覆盖已付费结果。
func SaveGouoImageResult(id string, response *types.ImageResponse) error {
	if !gouoImageResultID.MatchString(id) || response == nil || len(response.Data) == 0 {
		return errors.New("图片恢复结果无效")
	}
	data, err := json.Marshal(response)
	if err != nil {
		return err
	}
	if len(data) > gouoImageResultMaxBytes {
		return errors.New("图片恢复结果超过 256 MB 上限")
	}
	gouoImageResultMutex.Lock()
	defer gouoImageResultMutex.Unlock()
	root := filepath.Join(config.GouoAssetDir, "image-results")
	if err := os.MkdirAll(root, 0o700); err != nil {
		return err
	}
	used, err := cleanupGouoImageResults(root)
	if err != nil {
		return err
	}
	if used+int64(len(data)) > gouoImageResultCacheBytes {
		return errors.New("图片恢复缓存已满，请管理员检查存储")
	}
	target := filepath.Join(root, id+".json")
	if _, err := os.Stat(target); err == nil {
		return errors.New("图片恢复结果已存在，不能覆盖")
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	file, err := os.CreateTemp(root, ".result-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err := file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), target)
}

func GetGouoImageResult(userID int, clientRequestID string) (*GouoImageResult, error) {
	id := GouoImageRequestID(userID, clientRequestID)
	var charge GouoImageCharge
	if err := DB.Where("id = ? AND user_id = ?", id, userID).First(&charge).Error; err != nil {
		return nil, err
	}
	result := &GouoImageResult{Status: charge.Status, Reason: "result_unavailable"}
	if charge.Status == GouoChargeReserved || charge.Status == GouoChargeDispatched {
		result.Reason = "not_ready"
		return result, nil
	}
	if charge.Status != GouoChargeSettled && charge.Status != GouoChargeReview {
		return result, nil
	}
	if time.Since(time.Unix(charge.UpdatedAt, 0)) >= GouoImageResultRetention {
		result.Reason = "result_expired"
		return result, nil
	}
	file, err := os.Open(filepath.Join(config.GouoAssetDir, "image-results", id+".json"))
	if errors.Is(err, os.ErrNotExist) {
		return result, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > gouoImageResultMaxBytes {
		return nil, errors.New("图片恢复结果文件无效")
	}
	if time.Since(info.ModTime()) >= GouoImageResultRetention {
		result.Reason = "result_expired"
		return result, nil
	}
	data, err := io.ReadAll(io.LimitReader(file, gouoImageResultMaxBytes+1))
	if err != nil {
		return nil, err
	}
	var response types.ImageResponse
	if len(data) > gouoImageResultMaxBytes || json.Unmarshal(data, &response) != nil || len(response.Data) == 0 {
		return nil, errors.New("图片恢复结果文件损坏")
	}
	result.Result, result.Recoverable, result.Reason = &response, true, ""
	return result, nil
}

func CleanupGouoImageResults() error {
	gouoImageResultMutex.Lock()
	defer gouoImageResultMutex.Unlock()
	_, err := cleanupGouoImageResults(filepath.Join(config.GouoAssetDir, "image-results"))
	return err
}

func cleanupGouoImageResults(root string) (int64, error) {
	entries, err := os.ReadDir(root)
	if errors.Is(err, os.ErrNotExist) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	var used int64
	for _, entry := range entries {
		if !entry.Type().IsRegular() || !(strings.HasPrefix(entry.Name(), ".result-") || gouoImageResultID.MatchString(strings.TrimSuffix(entry.Name(), ".json")) && strings.HasSuffix(entry.Name(), ".json")) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return used, err
		}
		if time.Since(info.ModTime()) >= GouoImageResultRetention {
			if err := os.Remove(filepath.Join(root, entry.Name())); err != nil && !errors.Is(err, os.ErrNotExist) {
				return used, err
			}
			continue
		}
		used += info.Size()
	}
	return used, nil
}
