package model

import (
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"gorm.io/driver/mysql"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"

	"one-api/common/config"
	"one-api/common/logger"
)

func TestRedemptionAtomicCredit(t *testing.T) {
	dialect := gorm.Dialector(sqlite.Open(filepath.Join(t.TempDir(), "redemption.db") + "?_busy_timeout=5000&_journal_mode=WAL"))
	if dsn := os.Getenv("GOUO_TEST_MYSQL_DSN"); dsn != "" {
		dialect = mysql.Open(dsn)
	}
	// 每次使用独立表前缀，MySQL 回归不触碰同库既有表。
	db, err := gorm.Open(dialect, &gorm.Config{NamingStrategy: schema.NamingStrategy{TablePrefix: fmt.Sprintf("redeem_test_%d_", time.Now().UnixNano())}})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	if dialect.Name() == "sqlite" {
		sqlDB.SetMaxOpenConns(1)
	}
	models := []any{&Redemption{}, &User{}, &Log{}, &UserGroup{}}
	require.NoError(t, db.AutoMigrate(models...))
	oldDB, oldLogger, oldRedis := DB, logger.Logger, config.RedisEnabled
	DB, logger.Logger, config.RedisEnabled = db, zap.NewNop(), false
	t.Cleanup(func() {
		DB, logger.Logger, config.RedisEnabled = oldDB, oldLogger, oldRedis
		require.NoError(t, db.Migrator().DropTable(models...))
		require.NoError(t, sqlDB.Close())
	})
	for id := 1; id <= 2; id++ {
		require.NoError(t, db.Create(&User{Id: id, Username: fmt.Sprintf("redeemer%d", id), AccessToken: fmt.Sprintf("redeemer-token-%d", id), AffCode: fmt.Sprintf("aff-%d", id), Status: config.UserStatusEnabled}).Error)
	}
	for round := 0; round < 3; round++ {
		code := Redemption{UserId: 99, Key: fmt.Sprintf("concurrent-%d", round), Name: "并发兑换", Quota: 10000}
		require.NoError(t, code.Insert())
		var successes atomic.Int32
		var wg sync.WaitGroup
		start := make(chan struct{})
		for i := 0; i < 12; i++ {
			wg.Add(1)
			go func(id int) {
				defer wg.Done()
				<-start
				if quota, err := Redeem(code.Key, id, "127.0.0.1"); err == nil && quota == 10000 {
					successes.Add(1)
				}
			}(i%2 + 1)
		}
		close(start)
		wg.Wait()
		require.Equal(t, int32(1), successes.Load())
		var users []User
		require.NoError(t, db.Find(&users).Error)
		require.Equal(t, (round+1)*10000, users[0].Quota+users[1].Quota)
		require.NoError(t, db.First(&code, code.Id).Error)
		require.Equal(t, 99, code.UserId)
		require.Contains(t, []int{1, 2}, code.RedeemedUserId)
		var log Log
		require.NoError(t, db.First(&log, code.RedeemedLogId).Error)
		require.Equal(t, code.RedeemedUserId, log.UserId)
		require.Contains(t, log.Content, fmt.Sprintf("#%d", code.Id))
		code.Status = config.RedemptionCodeStatusEnabled
		require.Error(t, code.Update(true))
		code.Quota = 20000
		require.Error(t, code.Update(false))
		require.Error(t, code.Delete())
	}
	var count int64
	require.NoError(t, db.Model(&Log{}).Count(&count).Error)
	require.EqualValues(t, 3, count)
	for _, quota := range []int{0, -1, math.MaxInt64} {
		code := Redemption{Key: fmt.Sprintf("invalid-%d", quota), Quota: quota}
		require.Error(t, code.Insert())
		// 模拟旧库异常码，兑换和重新启用仍须拒绝。
		require.NoError(t, db.Create(&code).Error)
		require.NoError(t, db.Model(&code).Update("quota", quota).Error)
		_, err = Redeem(code.Key, 1, "127.0.0.1")
		require.Error(t, err)
		code.Quota = quota
		require.Error(t, code.Update(false))
		code.Status = config.RedemptionCodeStatusDisabled
		require.NoError(t, code.Update(true))
		code.Status = config.RedemptionCodeStatusEnabled
		require.Error(t, code.Update(true))
	}
	code := Redemption{Key: "rollback", Quota: 10000}
	require.NoError(t, code.Insert())
	before, err := GetUserQuota(1)
	require.NoError(t, err)
	require.NoError(t, db.Callback().Create().Before("gorm:create").Register("fail_redemption_log", func(tx *gorm.DB) {
		if tx.Statement.Schema != nil && tx.Statement.Schema.Name == "Log" {
			tx.AddError(errors.New("模拟日志写入失败"))
		}
	}))
	_, err = Redeem(code.Key, 1, "127.0.0.1")
	require.Error(t, err)
	require.NoError(t, db.Callback().Create().Remove("fail_redemption_log"))
	after, err := GetUserQuota(1)
	require.NoError(t, err)
	require.Equal(t, before, after)
	require.NoError(t, db.First(&code, code.Id).Error)
	require.Equal(t, config.RedemptionCodeStatusEnabled, code.Status)
	require.Zero(t, code.RedeemedTime)
	require.Zero(t, code.RedeemedUserId)
	_, err = Redeem(code.Key, 999, "127.0.0.1")
	require.Error(t, err)
	_, err = Redeem(code.Key, 1, "127.0.0.1")
	require.NoError(t, err)

	code = Redemption{Key: "disabled-or-edited", Name: "配置变更", Quota: 100}
	require.NoError(t, code.Insert())
	code.Status = config.RedemptionCodeStatusDisabled
	require.NoError(t, code.Update(true))
	_, err = Redeem(code.Key, 1, "127.0.0.1")
	require.ErrorContains(t, err, "已停用")
	code.Quota = 150
	require.NoError(t, code.Update(false))
	code.Status = config.RedemptionCodeStatusEnabled
	require.NoError(t, code.Update(true))
	before, err = GetUserQuota(1)
	require.NoError(t, err)
	var wg sync.WaitGroup
	wg.Add(2)
	var redeemed int
	var redeemErr error
	go func() { defer wg.Done(); redeemed, redeemErr = Redeem(code.Key, 1, "127.0.0.1") }()
	go func() { defer wg.Done(); code.Quota = 200; _ = code.Update(false) }()
	wg.Wait()
	require.NoError(t, redeemErr)
	require.Contains(t, []int{150, 200}, redeemed)
	after, err = GetUserQuota(1)
	require.NoError(t, err)
	require.Equal(t, redeemed, after-before)
	require.NoError(t, db.First(&code, code.Id).Error)
	require.Equal(t, redeemed, code.Quota)
	var matched Log
	require.NoError(t, db.First(&matched, code.RedeemedLogId).Error)
	require.Equal(t, redeemed, matched.Quota)

	code = Redemption{Key: "balance-overflow", Quota: 100}
	require.NoError(t, code.Insert())
	require.NoError(t, db.Model(&User{}).Where("id = 2").Update("quota", math.MaxInt32-99).Error)
	_, err = Redeem(code.Key, 2, "127.0.0.1")
	require.Error(t, err)
	require.NoError(t, db.First(&code, code.Id).Error)
	require.Equal(t, config.RedemptionCodeStatusEnabled, code.Status)
	var user User
	require.NoError(t, db.First(&user, 2).Error)
	require.Equal(t, math.MaxInt32-99, user.Quota)
}
