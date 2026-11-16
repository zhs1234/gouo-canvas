package model

import (
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"one-api/common/config"

	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// 包内其他测试也会把余额扣到 0；测试环境没有初始化日志和邮件，统一不真的发提醒
func init() {
	quotaWarningSender = func(int, int, bool) {}
}

func TestGouoImageReserveSendsBalanceReminder(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "remind.db")+"?_busy_timeout=5000"), &gorm.Config{})
	require.NoError(t, err)
	oldDB, oldRedis := DB, config.RedisEnabled
	oldPoints, oldRate, oldUnit, oldSender := config.GouoBalanceRemindPoints, config.PaymentUSDRate, config.QuotaPerUnit, quotaWarningSender
	DB, config.RedisEnabled = db, false
	config.GouoBalanceRemindPoints, config.PaymentUSDRate, config.QuotaPerUnit = 100, 7.3, 500000
	type sent struct {
		quota  int
		noMore bool
	}
	calls := make(chan sent, 10)
	quotaWarningSender = func(userId int, quota int, noMore bool) { calls <- sent{quota, noMore} }
	t.Cleanup(func() {
		conn, _ := DB.DB()
		conn.Close()
		DB, config.RedisEnabled = oldDB, oldRedis
		config.GouoBalanceRemindPoints, config.PaymentUSDRate, config.QuotaPerUnit, quotaWarningSender = oldPoints, oldRate, oldUnit, oldSender
	})
	for _, entry := range []any{&Token{}, &User{}, &GouoImageCharge{}} {
		require.NoError(t, db.AutoMigrate(entry))
	}
	// 100 积分 = 100/100/7.3×500000 ≈ 68493 额度
	require.Equal(t, 68493, gouoRemindQuota())
	user := User{Username: fmt.Sprint("remind-", time.Now().UnixNano()), Quota: 70000}
	require.NoError(t, db.Create(&user).Error)
	token := Token{UserId: user.Id, Key: user.Username, UnlimitedQuota: true, ExpiredTime: -1}
	require.NoError(t, db.Session(&gorm.Session{SkipHooks: true}).Create(&token).Error)
	n := 0
	reserve := func(quota int) {
		n++
		require.NoError(t, ReserveGouoQuota(&GouoImageCharge{ID: fmt.Sprint(user.Username, "-", n), UserID: user.Id, TokenID: token.Id, ModelName: "image-test", PriceCNY: 0.1, PriceVersion: "v", Quota: quota}))
	}
	expect := func(want *sent) {
		select {
		case got := <-calls:
			require.NotNil(t, want, "不该发提醒，却发了 %+v", got)
			require.Equal(t, *want, got)
		case <-time.After(300 * time.Millisecond):
			require.Nil(t, want, "应该发提醒却没有发")
		}
	}

	reserve(1000) // 70000 → 69000，仍在阈值之上
	expect(nil)
	reserve(1000) // 69000 → 68000，跨过阈值：提醒一次，金额为扣费后的余额
	expect(&sent{68000, false})
	reserve(1000) // 已在阈值之下，不重复提醒
	expect(nil)
	reserve(67000) // 用尽
	expect(&sent{0, true})

	// 阈值设为 0 时不做即将用尽提醒
	config.GouoBalanceRemindPoints = 0
	require.NoError(t, db.Model(&User{}).Where("id = ?", user.Id).Update("quota", 70000).Error)
	reserve(5000)
	expect(nil)
}
