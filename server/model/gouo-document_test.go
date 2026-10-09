package model

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"gorm.io/datatypes"
)

func TestGouoDocumentRevisionOwnershipAndCursor(t *testing.T) {
	setupGouoCloudTestDB(t)
	require.NoError(t, DB.AutoMigrate(&GouoDocument{}))
	conn, err := DB.DB()
	require.NoError(t, err)
	conn.SetMaxOpenConns(1)
	doc := GouoDocument{ID: "document-a", UserID: 1, Kind: "canvas", ClientID: "project-a", Title: "原稿", Document: datatypes.JSON(`{"schemaVersion":1}`), AssetIDs: datatypes.NewJSONSlice([]string{})}
	require.NoError(t, SaveGouoDocument(&doc, 0, nil))
	require.Equal(t, int64(1), doc.Revision)
	require.ErrorIs(t, SaveGouoDocument(&doc, 0, nil), ErrGouoDocumentConflict)
	other, err := GetGouoDocument(2, "canvas", "project-a")
	require.NoError(t, err)
	require.Nil(t, other)
	other, err = GetGouoDocument(1, "conversation", "project-a")
	require.NoError(t, err)
	require.Nil(t, other)
	asset := GouoAsset{ID: "other", UserID: 2, SHA256: "other"}
	require.NoError(t, DB.Create(&asset).Error)
	doc.AssetIDs = datatypes.NewJSONSlice([]string{asset.ID})
	require.ErrorIs(t, SaveGouoDocument(&doc, 1, nil), ErrGouoDocumentAssets)
	doc.AssetIDs = datatypes.NewJSONSlice([]string{})
	future := time.Now().Add(time.Hour).UnixMilli()
	require.NoError(t, DB.Model(&doc).UpdateColumn("updated_at", future).Error)
	hidden := true
	require.NoError(t, SaveGouoDocument(&doc, 1, &hidden))
	require.Greater(t, doc.UpdatedAt, future)
	require.Equal(t, int64(2), doc.Revision)
	visible, err := ListGouoDocuments(1, "canvas", false, false, 0, "", 10)
	require.NoError(t, err)
	require.Empty(t, visible)
	changes, err := ListGouoDocuments(1, "canvas", true, false, future, doc.ID, 10)
	require.NoError(t, err)
	require.Len(t, changes, 1)
	require.Positive(t, changes[0].HiddenAt)
	hiddenDocs, err := ListGouoDocuments(1, "canvas", false, true, 0, "", 10)
	require.NoError(t, err)
	require.Len(t, hiddenDocs, 1)
	hiddenDocs, err = ListGouoDocuments(1, "canvas", false, true, doc.UpdatedAt, doc.ID, 10)
	require.NoError(t, err)
	require.Empty(t, hiddenDocs)

	// 两个设备基于同一版本提交，只允许一个写入成功。
	var success atomic.Int32
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			copy := doc
			err := SaveGouoDocument(&copy, 2, nil)
			if err == nil {
				success.Add(1)
			} else {
				errs <- err
			}
		}()
	}
	wg.Wait()
	close(errs)
	require.Equal(t, int32(1), success.Load())
	for err := range errs {
		require.ErrorIs(t, err, ErrGouoDocumentConflict)
	}
	current, err := GetGouoDocument(1, "canvas", "project-a")
	require.NoError(t, err)
	hidden = false
	require.NoError(t, SaveGouoDocument(current, 3, &hidden))
	require.Zero(t, current.HiddenAt)
}
