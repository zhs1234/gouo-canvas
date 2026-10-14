package model

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/setting/gouo_setting"

	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestGouoImageResultDurabilityOwnershipAndExpiry(t *testing.T) {
	setupGouoCloudTestDB(t)
	require.NoError(t, DB.AutoMigrate(&GouoImageCharge{}))
	oldDir := gouo_setting.Get().AssetDir
	gouo_setting.Get().AssetDir = t.TempDir()
	t.Cleanup(func() { gouo_setting.Get().AssetDir = oldDir })
	id := GouoImageRequestID(1, "client-1")
	charge := GouoImageCharge{ID: id, UserID: 1, Status: GouoChargeSettled}
	require.NoError(t, DB.Create(&charge).Error)
	response := []byte(`{"data":[{"b64_json":"original-image","revised_prompt":"prompt"},{"url":"https://example.invalid/result.png"}]}`)
	require.NoError(t, SaveGouoImageResult(id, response))
	for i := 0; i < 2; i++ {
		result, err := GetGouoImageResult(1, "client-1")
		require.NoError(t, err)
		require.True(t, result.Recoverable)
		require.JSONEq(t, string(response), string(result.Result))
	}
	_, err := GetGouoImageResult(2, "client-1")
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	require.Error(t, SaveGouoImageResult(id, []byte(`{"data":[{"url":"https://example.invalid/replaced.png"}]}`)))
	result, err := GetGouoImageResult(1, "client-1")
	require.NoError(t, err)
	require.JSONEq(t, string(response), string(result.Result))
	var unchanged GouoImageCharge
	require.NoError(t, DB.First(&unchanged, "id = ?", id).Error)
	require.Equal(t, charge, unchanged)

	path := filepath.Join(gouo_setting.Get().AssetDir, "image-results", id+".json")
	expired := time.Now().Add(-GouoImageResultRetention - time.Minute)
	require.NoError(t, os.Chtimes(path, expired, expired))
	result, err = GetGouoImageResult(1, "client-1")
	require.NoError(t, err)
	require.False(t, result.Recoverable)
	require.Equal(t, "result_expired", result.Reason)
	require.NoError(t, CleanupGouoImageResults())
	_, err = os.Stat(path)
	require.ErrorIs(t, err, os.ErrNotExist)
}

func TestGouoImageResultRejectsInvalidStorageAndPartialFiles(t *testing.T) {
	setupGouoCloudTestDB(t)
	require.NoError(t, DB.AutoMigrate(&GouoImageCharge{}))
	oldDir := gouo_setting.Get().AssetDir
	gouo_setting.Get().AssetDir = t.TempDir()
	t.Cleanup(func() { gouo_setting.Get().AssetDir = oldDir })
	response := []byte(`{"data":[{"url":"https://example.invalid/result.png"}]}`)
	require.Error(t, SaveGouoImageResult("../outside", response))
	require.Error(t, SaveGouoImageResult("valid", nil))
	id := GouoImageRequestID(1, "partial")
	require.NoError(t, DB.Create(&GouoImageCharge{ID: id, UserID: 1, Status: GouoChargeSettled}).Error)
	root := filepath.Join(gouo_setting.Get().AssetDir, "image-results")
	require.NoError(t, os.MkdirAll(root, 0o700))
	require.NoError(t, os.WriteFile(filepath.Join(root, ".result-partial"), []byte(`{"data":[`), 0o600))
	result, err := GetGouoImageResult(1, "partial")
	require.NoError(t, err)
	require.False(t, result.Recoverable)
	require.Equal(t, "result_unavailable", result.Reason)
	require.NoError(t, os.WriteFile(filepath.Join(root, id+".json"), []byte(`{"data":[`), 0o600))
	_, err = GetGouoImageResult(1, "partial")
	require.Error(t, err)
	gouo_setting.Get().AssetDir = filepath.Join(gouo_setting.Get().AssetDir, "not-a-directory")
	require.NoError(t, os.WriteFile(gouo_setting.Get().AssetDir, []byte("occupied"), 0o600))
	require.Error(t, SaveGouoImageResult("cannot-save", response))
}

func TestCleanupGouoImageResultsIgnoresVanishingTempFiles(t *testing.T) {
	root := t.TempDir()
	stop := make(chan struct{})
	done := make(chan struct{})
	// 模拟共享目录的另一实例：不断创建又改名或删除临时文件
	go func() {
		defer close(done)
		for i := 0; ; i++ {
			select {
			case <-stop:
				return
			default:
			}
			path := filepath.Join(root, fmt.Sprintf(".result-%d", i))
			_ = os.WriteFile(path, []byte("x"), 0o600)
			_ = os.Remove(path)
		}
	}()
	deadline := time.Now().Add(300 * time.Millisecond)
	for time.Now().Before(deadline) {
		if _, err := cleanupGouoImageResults(root); err != nil {
			close(stop)
			<-done
			t.Fatal(err)
		}
	}
	close(stop)
	<-done
}
