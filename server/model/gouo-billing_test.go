package model

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"one-api/common/config"

	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestGouoBillingDurableRecoveryAndAtomicFinalization(t *testing.T) {
	path := filepath.Join(t.TempDir(), "billing.db")
	dialector := gorm.Dialector(sqlite.Open(path + "?_busy_timeout=5000&_journal_mode=WAL"))
	if dsn := os.Getenv("GOUO_BILLING_TEST_MYSQL_DSN"); dsn != "" {
		dialector = mysql.Open(dsn)
	}
	db, err := gorm.Open(dialector, &gorm.Config{})
	require.NoError(t, err)
	oldDB, oldRedis := DB, config.RedisEnabled
	DB, config.RedisEnabled = db, false
	t.Cleanup(func() { conn, _ := DB.DB(); conn.Close(); DB, config.RedisEnabled = oldDB, oldRedis })
	for _, entry := range []any{&Channel{}, &Token{}, &User{}, &Log{}, &GouoImageCharge{}} {
		require.NoError(t, db.AutoMigrate(entry))
	}
	user := User{Username: "billing-" + fmt.Sprint(time.Now().UnixNano()), Quota: 1000}
	require.NoError(t, db.Create(&user).Error)
	token := Token{UserId: user.Id, Key: user.Username, RemainQuota: 1000, ExpiredTime: -1}
	require.NoError(t, db.Session(&gorm.Session{SkipHooks: true}).Create(&token).Error)
	channel := Channel{Name: "billing-test"}
	require.NoError(t, db.Create(&channel).Error)
	newCharge := func(name string) *GouoImageCharge {
		return &GouoImageCharge{ID: user.Username + "-" + name, UserID: user.Id, TokenID: token.Id, ModelName: "image-test", PriceCNY: 0.1, PriceVersion: "frozen-price", Quota: 10}
	}
	assertBalance := func(want int) {
		quota, err := GetUserQuota(user.Id)
		require.NoError(t, err)
		require.Equal(t, want, quota)
	}
	read := func(id string) GouoImageCharge {
		var row GouoImageCharge
		require.NoError(t, DB.Where("id = ?", id).First(&row).Error)
		return row
	}

	// 请求账本写失败，预扣也必须回滚。
	require.NoError(t, db.Callback().Create().Before("gorm:create").Register("billing_fail_charge", func(tx *gorm.DB) {
		if tx.Statement.Table == "gouo_image_charges" {
			tx.AddError(errors.New("simulated charge write failure"))
		}
	}))
	require.Error(t, ReserveGouoQuota(newCharge("rollback")))
	assertBalance(1000)
	require.NoError(t, db.Callback().Create().Remove("billing_fail_charge"))

	reserved, dispatched, recent := newCharge("reserved"), newCharge("dispatched"), newCharge("recent")
	for _, charge := range []*GouoImageCharge{reserved, dispatched, recent} {
		require.NoError(t, ReserveGouoQuota(charge))
	}
	require.NoError(t, DispatchGouoImageCharge(dispatched.ID, channel.Id))
	old := time.Now().Add(-GouoImageRecoveryDelay - time.Minute).Unix()
	require.NoError(t, db.Model(&GouoImageCharge{}).Where("id IN ?", []string{reserved.ID, dispatched.ID}).UpdateColumn("updated_at", old).Error)
	assertBalance(970)

	// 关闭并重新打开数据库，不保留 Quota 对象或进程内记录。
	conn, err := db.DB()
	require.NoError(t, err)
	require.NoError(t, conn.Close())
	db, err = gorm.Open(dialector, &gorm.Config{})
	require.NoError(t, err)
	DB = db
	conn, err = db.DB()
	require.NoError(t, err)
	if os.Getenv("GOUO_BILLING_TEST_MYSQL_DSN") == "" {
		conn.SetMaxOpenConns(1)
	}
	require.NoError(t, RecoverGouoImageCharges())
	require.NoError(t, RecoverGouoImageCharges())
	assertBalance(980)
	require.Equal(t, GouoChargeRefunded, read(reserved.ID).Status)
	require.Equal(t, GouoChargeReview, read(dispatched.ID).Status)
	require.Equal(t, GouoChargeReserved, read(recent.ID).Status)
	require.ErrorIs(t, DispatchGouoImageCharge(reserved.ID, channel.Id), ErrGouoChargeState)
	require.ErrorIs(t, ResolveGouoImageCharge(recent.ID, GouoChargeRefunded, 1, "仍在处理"), ErrGouoChargeState)
	require.Error(t, ResolveGouoImageCharge(dispatched.ID, GouoChargeRefunded, 1, ""))

	// 结算日志失败时，状态、消费统计和额度都不能部分提交。
	require.NoError(t, db.Callback().Create().Before("gorm:create").Register("billing_fail_log", func(tx *gorm.DB) {
		if tx.Statement.Table == "logs" {
			tx.AddError(errors.New("simulated log failure"))
		}
	}))
	require.Error(t, ResolveGouoImageCharge(dispatched.ID, GouoChargeSettled, 1, "已确认上游成功"))
	require.Equal(t, GouoChargeReview, read(dispatched.ID).Status)
	var current User
	require.NoError(t, db.First(&current, user.Id).Error)
	require.Zero(t, current.UsedQuota)
	require.NoError(t, db.Callback().Create().Remove("billing_fail_log"))

	// 多个管理员同时点结算/退款，只有一个终态和一份实际账务。
	var wg sync.WaitGroup
	errCh := make(chan error, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			status := GouoChargeSettled
			if i%2 == 0 {
				status = GouoChargeRefunded
			}
			errCh <- ResolveGouoImageCharge(dispatched.ID, status, 1, "模拟渠道核对依据")
		}(i)
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		if err != nil {
			require.ErrorIs(t, err, ErrGouoChargeState)
		}
	}
	final := read(dispatched.ID)
	require.Contains(t, []string{GouoChargeSettled, GouoChargeRefunded}, final.Status)
	require.Positive(t, final.LogID)
	require.Equal(t, 1, final.ResolvedBy)
	require.NoError(t, ResolveGouoImageCharge(dispatched.ID, final.Status, 1, "重复提交"))
	var log Log
	require.NoError(t, db.First(&log, final.LogID).Error)
	require.Equal(t, dispatched.ID, log.Metadata.Data()["request_id"])
	require.Equal(t, "frozen-price", log.Metadata.Data()["price_version"])
	var count int64
	require.NoError(t, db.Model(&Log{}).Where("user_id = ?", user.Id).Count(&count).Error)
	require.EqualValues(t, 2, count)
	if final.Status == GouoChargeRefunded {
		assertBalance(990)
	} else {
		assertBalance(980)
	}
	page, err := ListGouoImageCharges(user.Id+1, dispatched.ID, "", &PaginationParams{Page: 1, Size: 20})
	require.NoError(t, err)
	require.Zero(t, page.TotalCount)
	page, err = ListGouoImageCharges(user.Id, dispatched.ID, "", &PaginationParams{Page: 1, Size: 20})
	require.NoError(t, err)
	require.EqualValues(t, 1, page.TotalCount)
}
