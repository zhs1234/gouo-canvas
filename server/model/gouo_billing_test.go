package model

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func setupGouoBilling(t *testing.T, userQuota, tokenQuota int, unlimited bool) (*User, *Token) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(gouoTables...))
	truncateTables(t)
	t.Cleanup(func() {
		DB.Exec("DELETE FROM gouo_image_charges")
		DB.Exec("DELETE FROM gouo_image_models")
	})
	user := &User{Username: "gouo", Password: "password123", Quota: userQuota, Status: common.UserStatusEnabled, AffCode: "gouo"}
	require.NoError(t, DB.Create(user).Error)
	token := &Token{UserId: user.Id, Key: "gouo-key", Name: "sys_playground", Status: common.TokenStatusEnabled, ExpiredTime: -1, RemainQuota: tokenQuota, UnlimitedQuota: unlimited}
	require.NoError(t, DB.Create(token).Error)
	return user, token
}

func gouoQuotas(t *testing.T, user *User, token *Token) (int, int, int) {
	t.Helper()
	var u User
	var tk Token
	require.NoError(t, DB.First(&u, user.Id).Error)
	require.NoError(t, DB.First(&tk, token.Id).Error)
	return u.Quota, tk.RemainQuota, tk.UsedQuota
}

func TestGouoImageChargeLifecycle(t *testing.T) {
	user, token := setupGouoBilling(t, 1000, 500, false)
	charge := &GouoImageCharge{ID: GouoImageRequestID(user.Id, "req-1"), UserID: user.Id, TokenID: token.Id, ModelName: "gpt-image-2", Quota: 300}
	require.NoError(t, ReserveGouoQuota(charge))
	userQuota, remain, used := gouoQuotas(t, user, token)
	assert.Equal(t, []int{700, 200, 300}, []int{userQuota, remain, used})

	// 同一请求 ID 重复提交不能再扣一次
	again := *charge
	assert.ErrorIs(t, ReserveGouoQuota(&again), ErrGouoImageRequestExists)
	// 令牌额度不足时整笔回滚
	short := &GouoImageCharge{ID: GouoImageRequestID(user.Id, "req-2"), UserID: user.Id, TokenID: token.Id, Quota: 300}
	assert.Error(t, ReserveGouoQuota(short))
	userQuota, remain, _ = gouoQuotas(t, user, token)
	assert.Equal(t, []int{700, 200}, []int{userQuota, remain})

	require.NoError(t, DispatchGouoImageCharge(charge.ID, 7))
	_, err := FinishGouoImageCharge(charge.ID, GouoChargeRefunded, "测试退款")
	require.NoError(t, err)
	userQuota, remain, used = gouoQuotas(t, user, token)
	assert.Equal(t, []int{1000, 500, 0}, []int{userQuota, remain, used})
	// 已退款的请求不能再结算或重复退款
	_, err = FinishGouoImageCharge(charge.ID, GouoChargeSettled, "")
	assert.ErrorIs(t, err, ErrGouoChargeState)
	_, err = FinishGouoImageCharge(charge.ID, GouoChargeRefunded, "")
	assert.ErrorIs(t, err, ErrGouoChargeState)
}

func TestGouoImageChargeSettleAndRecover(t *testing.T) {
	user, token := setupGouoBilling(t, 1000, 0, true)
	settled := &GouoImageCharge{ID: GouoImageRequestID(user.Id, "ok"), UserID: user.Id, TokenID: token.Id, Quota: 100}
	stale := &GouoImageCharge{ID: GouoImageRequestID(user.Id, "stale"), UserID: user.Id, TokenID: token.Id, Quota: 200}
	require.NoError(t, ReserveGouoQuota(settled))
	require.NoError(t, ReserveGouoQuota(stale))
	_, err := FinishGouoImageCharge(settled.ID, GouoChargeSettled, "")
	require.NoError(t, err)
	old := time.Now().Add(-GouoImageRecoveryDelay - time.Minute).Unix()
	require.NoError(t, DB.Model(&GouoImageCharge{}).Where("id IN ?", []string{settled.ID, stale.ID}).UpdateColumn("updated_at", old).Error)

	require.NoError(t, RecoverGouoImageCharges())
	var refundedRow, settledRow GouoImageCharge
	require.NoError(t, DB.First(&refundedRow, "id = ?", stale.ID).Error)
	assert.Equal(t, GouoChargeRefunded, refundedRow.Status)
	require.NoError(t, DB.First(&settledRow, "id = ?", settled.ID).Error)
	assert.Equal(t, GouoChargeSettled, settledRow.Status)
	var u User
	require.NoError(t, DB.First(&u, user.Id).Error)
	assert.Equal(t, 900, u.Quota)
	assert.Equal(t, 100, u.UsedQuota)
	assert.Equal(t, 1, u.RequestCount)
}

func TestGouoImageModelEntry(t *testing.T) {
	prices, err := common.Marshal(ratio_setting.GetModelPriceCopy())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(string(prices))) })

	p := Pricing{ModelName: "gpt-image-2", Tags: " Edit ,mask", Description: "原生说明"}
	entry, err := GouoImageModelEntry(p)
	require.NoError(t, err)
	assert.True(t, entry.Reference)
	assert.True(t, entry.Mask)
	assert.Equal(t, "原生说明", entry.Description)
	// 遮罩需要同时支持参考图
	maskOnly, err := GouoImageModelEntry(Pricing{ModelName: "gpt-image-2", Tags: "mask"})
	require.NoError(t, err)
	assert.False(t, maskOnly.Reference)
	assert.False(t, maskOnly.Mask)
	// 改说明不影响版本；能力标签和 New API 原生定价变化才更新版本
	version := entry.PriceVersion
	p.Description = "新说明"
	described, err := GouoImageModelEntry(p)
	require.NoError(t, err)
	assert.Equal(t, version, described.PriceVersion)
	assert.NotEqual(t, version, maskOnly.PriceVersion)
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"gpt-image-2":0.02}`))
	repriced, err := GouoImageModelEntry(p)
	require.NoError(t, err)
	assert.NotEqual(t, version, repriced.PriceVersion)

	assert.Equal(t, "1K", GouoSizeTier(1024, 1536))
	assert.Equal(t, "2K", GouoSizeTier(1536, 1536))
	assert.Equal(t, "", GouoSizeTier(4096, 4096))
}

// 预扣依赖行锁和主键冲突保证幂等，必须在三种数据库上验证
func TestGouoImageChargeDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(filepath.Join(t.TempDir(), "gouo.db") + "?_pragma=busy_timeout(5000)")
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN is not configured")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN is not configured")
				}
				driver = postgres.Open(dsn)
			}
			db, err := gorm.Open(driver, &gorm.Config{Logger: logger.Discard})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			oldDB, oldLogDB := DB, LOG_DB
			DB, LOG_DB = db, db
			t.Cleanup(func() {
				DB, LOG_DB = oldDB, oldLogDB
				require.NoError(t, db.Migrator().DropTable(append([]any{&User{}, &Token{}, &Log{}, &Channel{}}, gouoTables...)...))
				require.NoError(t, sqlDB.Close())
			})
			require.NoError(t, db.Migrator().DropTable(append([]any{&User{}, &Token{}, &Log{}, &Channel{}}, gouoTables...)...))
			require.NoError(t, db.AutoMigrate(append([]any{&User{}, &Token{}, &Log{}, &Channel{}}, gouoTables...)...))
			// 迁移可重复执行
			require.NoError(t, db.AutoMigrate(gouoTables...))

			user := &User{Username: "gouo", Password: "password123", Quota: 1000, Status: common.UserStatusEnabled, AffCode: "gouo"}
			require.NoError(t, db.Create(user).Error)
			token := &Token{UserId: user.Id, Key: "gouo-key", Name: "sys_playground", Status: common.TokenStatusEnabled, ExpiredTime: -1, UnlimitedQuota: true}
			require.NoError(t, db.Create(token).Error)

			// 同一请求 ID 并发提交只扣一次
			var wg sync.WaitGroup
			var ok, exists atomic.Int32
			id := GouoImageRequestID(user.Id, "same")
			for range 8 {
				wg.Add(1)
				go func() {
					defer wg.Done()
					err := ReserveGouoQuota(&GouoImageCharge{ID: id, UserID: user.Id, TokenID: token.Id, Quota: 100})
					if err == nil {
						ok.Add(1)
					} else if errors.Is(err, ErrGouoImageRequestExists) {
						exists.Add(1)
					} else {
						t.Log(err)
					}
				}()
			}
			wg.Wait()
			assert.Equal(t, int32(1), ok.Load())
			assert.Equal(t, int32(7), exists.Load())

			// 余额只够 9 次时，并发 12 个不同请求最多成功 9 个，余额不会扣成负数
			ok.Store(0)
			for i := range 12 {
				wg.Add(1)
				go func() {
					defer wg.Done()
					if ReserveGouoQuota(&GouoImageCharge{ID: GouoImageRequestID(user.Id, fmt.Sprint("many-", i)), UserID: user.Id, TokenID: token.Id, Quota: 100}) == nil {
						ok.Add(1)
					}
				}()
			}
			wg.Wait()
			assert.Equal(t, int32(9), ok.Load())
			var loaded User
			require.NoError(t, db.First(&loaded, user.Id).Error)
			assert.Equal(t, 0, loaded.Quota)

			_, err = FinishGouoImageCharge(id, GouoChargeSettled, "")
			require.NoError(t, err)
			var reserved GouoImageCharge
			require.NoError(t, db.Where("status = ?", GouoChargeReserved).First(&reserved).Error)
			_, err = FinishGouoImageCharge(reserved.ID, GouoChargeRefunded, "测试")
			require.NoError(t, err)
			require.NoError(t, db.First(&loaded, user.Id).Error)
			assert.Equal(t, 100, loaded.Quota)
			assert.Equal(t, 100, loaded.UsedQuota)
			// 新请求只登记状态，不重复扣费、退款或累计使用量；旧预扣仍按原流程恢复。
			for _, status := range []string{GouoChargeSettled, GouoChargeRefunded} {
				native := &GouoImageCharge{ID: GouoImageRequestID(user.Id, "native-"+status), UserID: user.Id, TokenID: token.Id}
				require.NoError(t, CreateGouoImageRequest(native))
				duplicate := *native
				assert.ErrorIs(t, CreateGouoImageRequest(&duplicate), ErrGouoImageRequestExists)
				require.NoError(t, DispatchGouoImageCharge(native.ID, 1))
				_, err := FinishGouoImageCharge(native.ID, status, "native billing")
				require.NoError(t, err)
			}
			require.NoError(t, db.First(&loaded, user.Id).Error)
			assert.Equal(t, 100, loaded.Quota)
			assert.Equal(t, 100, loaded.UsedQuota)
		})
	}
}
