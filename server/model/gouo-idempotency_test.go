package model

import (
	"sync"
	"sync/atomic"
	"testing"

	"one-api/common/config"

	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestGouoImageRequestIdempotencyAcrossStatesAndUsers(t *testing.T) {
	setupGouoCloudTestDB(t)
	require.NoError(t, DB.AutoMigrate(&Token{}, &GouoImageCharge{}))
	oldRedis := config.RedisEnabled
	config.RedisEnabled = false
	t.Cleanup(func() { config.RedisEnabled = oldRedis })
	conn, err := DB.DB()
	require.NoError(t, err)
	conn.SetMaxOpenConns(1)
	for _, userID := range []int{1, 2} {
		require.NoError(t, DB.Model(&User{}).Where("id = ?", userID).Update("quota", 100).Error)
		require.NoError(t, DB.Session(&gorm.Session{SkipHooks: true}).Create(&Token{Id: userID, UserId: userID, Key: GouoImageRequestID(userID, "token"), RemainQuota: 100, ExpiredTime: -1}).Error)
	}
	request := func(userID int) *GouoImageCharge {
		return &GouoImageCharge{ID: GouoImageRequestID(userID, "same-client-id"), UserID: userID, TokenID: userID, Quota: 10, ModelName: "image"}
	}
	var success atomic.Int32
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := ReserveGouoQuota(request(1)); err == nil {
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
		require.ErrorIs(t, err, ErrGouoImageRequestExists)
	}
	for _, status := range []string{GouoChargeReserved, GouoChargeDispatched, GouoChargeReview, GouoChargeSettled, GouoChargeRefunded} {
		require.NoError(t, DB.Model(&GouoImageCharge{}).Where("id = ?", request(1).ID).UpdateColumn("status", status).Error)
		require.ErrorIs(t, ReserveGouoQuota(request(1)), ErrGouoImageRequestExists)
	}
	quota, err := GetUserQuota(1)
	require.NoError(t, err)
	require.Equal(t, 90, quota)
	token, err := GetTokenById(1)
	require.NoError(t, err)
	require.Equal(t, 90, token.RemainQuota)
	require.NotEqual(t, request(1).ID, request(2).ID)
	require.NoError(t, ReserveGouoQuota(request(2)))
}
