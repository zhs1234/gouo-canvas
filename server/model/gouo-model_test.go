package model

import (
	"fmt"
	"math"
	"one-api/common/config"
	"one-api/common/logger"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestGouoModelQuotesFailClosed(t *testing.T) {
	oldRate, oldUnits := config.PaymentUSDRate, config.QuotaPerUnit
	t.Cleanup(func() { config.PaymentUSDRate, config.QuotaPerUnit = oldRate, oldUnits })
	config.PaymentUSDRate, config.QuotaPerUnit = 7.3, 500000
	price := &Price{Model: "image-a", GouoEnabled: true, GouoPriceCNY: 0.1, GouoMaxOutputs: 1}
	p := &Pricing{Prices: map[string]*Price{"image-a": price, "image-*": price}}
	quote, err := p.GetGouoModel("image-a")
	require.NoError(t, err)
	require.Equal(t, "image-a", quote.Name)
	require.Equal(t, 6850, quote.Quota)
	_, err = p.GetGouoModel("image-unknown")
	require.Error(t, err)
	price.GouoPriceCNY = 0.2
	updated, err := p.GetGouoModel("image-a")
	require.NoError(t, err)
	require.NotEqual(t, quote.PriceVersion, updated.PriceVersion)
	config.PaymentUSDRate = 6
	changedRate, err := p.GetGouoModel("image-a")
	require.NoError(t, err)
	require.NotEqual(t, updated.PriceVersion, changedRate.PriceVersion)
	for _, invalid := range []float64{0, -1, math.NaN(), math.Inf(1)} {
		config.QuotaPerUnit = invalid
		_, err = p.GetGouoModel("image-a")
		require.Error(t, err)
	}
	config.QuotaPerUnit = 500000
	price.GouoMask = true
	require.Error(t, ValidateGouoPrice(price))
	price.GouoReference = true
	require.NoError(t, ValidateGouoPrice(price))
	price.GouoPriceCNY = 0
	_, err = p.GetGouoModel("image-a")
	require.Error(t, err)
}

func TestGouoMigrationPricingSyncAndLastDelete(t *testing.T) {
	oldLogger := logger.Logger
	logger.Logger = zap.NewNop()
	t.Cleanup(func() { logger.Logger = oldLogger })
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Price{}, &Option{}, &ModelInfo{}, &ModelOwnedBy{}))
	oldDB := DB
	DB = db
	t.Cleanup(func() { DB = oldDB })
	require.NoError(t, migrateGouoImagePrice())
	p := &Pricing{Prices: map[string]*Price{}}
	require.NoError(t, p.Init())
	var migrated Price
	require.NoError(t, db.First(&migrated).Error)
	require.Equal(t, 1, migrated.GouoMaxOutputs)
	migrated.GouoPriceCNY = 0.42
	migrated.Locked = false
	require.NoError(t, migrated.Update(migrated.Model))
	require.NoError(t, migrateGouoImagePrice())
	require.NoError(t, p.Init())
	require.NoError(t, p.SyncPriceWithOverwrite([]*Price{{Model: migrated.Model, Type: TimesPriceType, Input: 999}}))
	require.NoError(t, p.SyncPriceOnlyUpdate([]*Price{{Model: migrated.Model, Type: TimesPriceType, Input: 999}}))
	quote, err := p.GetGouoModel(migrated.Model)
	require.NoError(t, err)
	require.Equal(t, 0.42, quote.PriceCNY)
	require.NoError(t, p.DeletePrice(migrated.Model))
	_, err = p.GetGouoModel(migrated.Model)
	require.Error(t, err)
	require.NoError(t, migrateGouoImagePrice())
	var count int64
	require.NoError(t, db.Model(&Price{}).Count(&count).Error)
	require.Zero(t, count)
}

func TestGouoQuotaConcurrentReservationAndTokenRollback(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "quota.db")+"?_busy_timeout=5000&_journal_mode=WAL"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Channel{}, &User{}, &Token{}, &Log{}, &GouoImageCharge{}))
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	oldDB, oldRedis, oldBatch := DB, config.RedisEnabled, config.BatchUpdateEnabled
	DB, config.RedisEnabled, config.BatchUpdateEnabled = db, false, true
	t.Cleanup(func() { DB, config.RedisEnabled, config.BatchUpdateEnabled = oldDB, oldRedis, oldBatch; sqlDB.Close() })
	require.NoError(t, db.Create(&User{Id: 1, Username: "test", Quota: 10}).Error)
	require.NoError(t, db.Session(&gorm.Session{SkipHooks: true}).Create(&Token{Id: 1, UserId: 1, Key: "test-key", RemainQuota: 5, ExpiredTime: -1}).Error)
	err = ReserveGouoQuota(&GouoImageCharge{ID: "insufficient-token", UserID: 1, TokenID: 1, Quota: 10})
	require.Error(t, err)
	quota, err := GetUserQuota(1)
	require.NoError(t, err)
	require.Equal(t, 10, quota)
	require.NoError(t, db.Model(&Token{}).Where("id = 1").Update("remain_quota", 10).Error)
	var success atomic.Int32
	var wg sync.WaitGroup
	winners := make(chan string, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			id := fmt.Sprintf("concurrent-%d", i)
			if err := ReserveGouoQuota(&GouoImageCharge{ID: id, UserID: 1, TokenID: 1, Quota: 10}); err == nil {
				success.Add(1)
				winners <- id
			}
		}(i)
	}
	wg.Wait()
	require.Equal(t, int32(1), success.Load())
	quota, err = GetUserQuota(1)
	require.NoError(t, err)
	require.Zero(t, quota)
	require.NoError(t, db.Model(&Token{}).Where("id = 1").Update("status", config.TokenStatusExhausted).Error)
	require.NoError(t, FinishGouoImageCharge(<-winners, GouoChargeReserved, GouoChargeRefunded, nil, 0, "失败退款"))
	quota, err = GetUserQuota(1)
	require.NoError(t, err)
	require.Equal(t, 10, quota)
	token, err := GetTokenById(1)
	require.NoError(t, err)
	require.Equal(t, 10, token.RemainQuota)
	require.Zero(t, token.UsedQuota)
	require.Equal(t, config.TokenStatusEnabled, token.Status)
	for _, status := range []int{config.TokenStatusDisabled, config.TokenStatusExpired} {
		id := fmt.Sprintf("status-%d", status)
		require.NoError(t, db.Model(&Token{}).Where("id = 1").Update("status", config.TokenStatusEnabled).Error)
		require.NoError(t, ReserveGouoQuota(&GouoImageCharge{ID: id, UserID: 1, TokenID: 1, Quota: 10}))
		require.NoError(t, db.Model(&Token{}).Where("id = 1").Update("status", status).Error)
		require.NoError(t, FinishGouoImageCharge(id, GouoChargeReserved, GouoChargeRefunded, nil, 0, "失败退款"))
		token, err := GetTokenById(1)
		require.NoError(t, err)
		require.Equal(t, status, token.Status)
	}
}

func TestGouoRefundBeforeExhaustedStatusWrite(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&User{}, &Token{}))
	oldDB, oldRedis := DB, config.RedisEnabled
	DB, config.RedisEnabled = db, false
	t.Cleanup(func() { DB, config.RedisEnabled = oldDB, oldRedis })
	require.NoError(t, db.Create(&User{Id: 1, Username: "test", Quota: 10}).Error)
	key := strings.Repeat("x", 48)
	require.NoError(t, db.Session(&gorm.Session{SkipHooks: true}).Create(&Token{Id: 1, UserId: 1, Key: key, ExpiredTime: -1}).Error)
	refunded := false
	var refundErr error
	require.NoError(t, db.Callback().Query().After("gorm:query").Register("refund_before_exhaustion", func(tx *gorm.DB) {
		if tx.Statement.Table == "tokens" && !refunded {
			refunded = true
			refundErr = db.Session(&gorm.Session{NewDB: true}).Model(&Token{}).Where("id = 1").UpdateColumn("remain_quota", 10).Error
		}
	}))
	_, err = ValidateUserToken(key)
	require.ErrorIs(t, err, ErrTokenQuotaExhausted)
	require.NoError(t, refundErr)
	token, err := ValidateUserToken(key)
	require.NoError(t, err)
	require.Equal(t, config.TokenStatusEnabled, token.Status)
	require.Equal(t, 10, token.RemainQuota)
}

func TestGouoImageExclusiveOnPriceWrites(t *testing.T) {
	oldLogger := logger.Logger
	logger.Logger = zap.NewNop()
	t.Cleanup(func() { logger.Logger = oldLogger })
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Price{}, &ModelInfo{}, &ModelOwnedBy{}))
	oldDB := DB
	DB = db
	t.Cleanup(func() { DB = oldDB })
	require.NoError(t, db.Create(&Price{Model: "chat-agent", Type: TokensPriceType, Input: 1, Output: 1}).Error)
	require.NoError(t, db.Create(&ModelInfo{Model: "chat-agent", OutputModalities: `["text"]`, Tags: `["tools"]`}).Error)
	require.NoError(t, db.Create(&ModelInfo{Model: "chat-new", OutputModalities: `["text"]`, Tags: `["function_calling"]`}).Error)
	p := &Pricing{Prices: map[string]*Price{}}
	require.NoError(t, p.Init())
	image := func(id string) *Price {
		return &Price{Model: id, Type: TimesPriceType, GouoEnabled: true, GouoPriceCNY: 0.1, GouoMaxOutputs: 1}
	}
	// 价格管理的单个、批量接口也不能把已上架的 Agent 模型启用为图片模型
	require.ErrorIs(t, p.UpdatePrice("chat-agent", image("chat-agent")), ErrGouoAgentListed)
	require.ErrorIs(t, p.AddPrice(image("chat-new")), ErrGouoAgentListed)
	require.ErrorIs(t, p.BatchSetPrices(&BatchPrices{Models: []string{"chat-agent"}, Price: *image("")}, []string{"chat-agent"}), ErrGouoAgentListed)
	require.False(t, p.GetPrice("chat-agent").GouoEnabled)
	// 没有上架的模型照常启用
	require.NoError(t, p.AddPrice(image("image-a")))
	require.True(t, p.GetPrice("image-a").GouoEnabled)
	// 已启用的图片模型改名为已上架的 Agent 模型也要拒绝
	require.ErrorIs(t, p.UpdatePrice("image-a", image("chat-new")), ErrGouoAgentListed)
	require.True(t, p.GetPrice("image-a").GouoEnabled)
	require.NoError(t, p.UpdatePrice("image-a", image("image-a")))
}

func TestPriceSyncKeepsGouoFields(t *testing.T) {
	oldLogger := logger.Logger
	logger.Logger = zap.NewNop()
	t.Cleanup(func() { logger.Logger = oldLogger })
	for _, mode := range []string{string(PriceUpdateModeUpdate), string(PriceUpdateModeOverwrite)} {
		db, err := gorm.Open(sqlite.Open("file:"+t.Name()+mode+"?mode=memory&cache=shared"), &gorm.Config{})
		require.NoError(t, err)
		require.NoError(t, db.AutoMigrate(&Price{}, &ModelInfo{}, &ModelOwnedBy{}))
		oldDB := DB
		DB = db
		require.NoError(t, db.Create(&Price{Model: "chat-a", Type: TokensPriceType, Input: 1, Output: 2, GouoSort: 3, GouoMaxTokens: 4000}).Error)
		// 暂时停用的图片模型，单价和画质等配置留着以后重新启用
		require.NoError(t, db.Create(&Price{Model: "image-off", Type: TimesPriceType, Input: 1, GouoPriceCNY: 0.2, GouoReference: true, GouoMaxOutputs: 4, GouoSizes: "1K,2K", GouoQualities: "low,high", GouoMaxInputs: 3}).Error)
		p := &Pricing{Prices: map[string]*Price{}}
		require.NoError(t, p.Init())
		// 未锁定的价格随上游更新，但本地的光构配置保留
		require.NoError(t, p.SyncPricing([]*Price{{Model: "chat-a", Type: TokensPriceType, Input: 5, Output: 6}, {Model: "image-off", Type: TimesPriceType, Input: 7}}, mode))
		price := p.GetPrice("chat-a")
		require.InDelta(t, 5.0, price.Input, 1e-9, mode)
		require.Equal(t, 3, price.GouoSort, mode)
		require.Equal(t, 4000, price.GouoMaxTokens, mode)
		image := p.GetPrice("image-off")
		require.InDelta(t, 7.0, image.Input, 1e-9, mode)
		require.InDelta(t, 0.2, image.GouoPriceCNY, 1e-9, mode)
		require.True(t, image.GouoReference, mode)
		require.Equal(t, 4, image.GouoMaxOutputs, mode)
		require.Equal(t, "1K,2K", image.GouoSizes, mode)
		require.Equal(t, "low,high", image.GouoQualities, mode)
		require.Equal(t, 3, image.GouoMaxInputs, mode)
		DB = oldDB
	}
}

func TestGouoSizeTiersMigration(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "sizes.db")), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Price{}))
	// 旧版的“最大尺寸”列，新版结构体已不再读写
	require.NoError(t, db.Exec("ALTER TABLE prices ADD COLUMN gouo_max_size varchar(10)").Error)
	for model, old := range map[string]any{"open": "", "null": nil, "small": "1K", "mid": "2K", "big": "4K"} {
		require.NoError(t, db.Create(&Price{Model: model, Type: TimesPriceType}).Error)
		require.NoError(t, db.Table("prices").Where("model = ?", model).Update("gouo_max_size", old).Error)
	}
	require.NoError(t, gouoSizeTiersMigration().Migrate(db))
	want := map[string]string{"open": "1K,2K,4K", "null": "1K,2K,4K", "small": "1K", "mid": "1K,2K", "big": "1K,2K,4K"}
	for model, sizes := range want {
		var price Price
		require.NoError(t, db.First(&price, "model = ?", model).Error)
		require.Equal(t, sizes, price.GouoSizes, model)
	}
}
