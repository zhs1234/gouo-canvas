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
	"gorm.io/datatypes"
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
		tiers, qualities := datatypes.NewJSONType(map[string]float64{"2K": 2}), datatypes.NewJSONType(map[string]float64{"max": 30})
		require.NoError(t, db.Create(&Price{Model: "image-off", Type: TimesPriceType, Input: 1, GouoPriceCNY: 0.2, GouoReference: true, GouoMaxOutputs: 4, GouoSizes: "1K,2K", GouoQualities: "low,high", GouoMaxInputs: 3,
			GouoTierRatios: &tiers, GouoQualityRatios: &qualities, GouoTransparent: true}).Error)
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
		require.Equal(t, map[string]float64{"2K": 2}, GouoRatios(image.GouoTierRatios), mode)
		require.Equal(t, map[string]float64{"max": 30}, GouoRatios(image.GouoQualityRatios), mode)
		require.True(t, image.GouoTransparent, mode)
		// 价格管理的批量设置也不改光构配置
		require.NoError(t, p.BatchSetPrices(&BatchPrices{Models: []string{"image-off"}, Price: Price{Type: TimesPriceType, Input: 9}}, []string{"image-off"}))
		require.NoError(t, p.Init())
		image = p.GetPrice("image-off")
		require.InDelta(t, 9.0, image.Input, 1e-9, mode)
		require.Equal(t, map[string]float64{"2K": 2}, GouoRatios(image.GouoTierRatios), mode)
		require.Equal(t, map[string]float64{"max": 30}, GouoRatios(image.GouoQualityRatios), mode)
		require.True(t, image.GouoTransparent, mode)
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

func TestGouoImageRequestQuote(t *testing.T) {
	oldRate, oldUnits := config.PaymentUSDRate, config.QuotaPerUnit
	t.Cleanup(func() { config.PaymentUSDRate, config.QuotaPerUnit = oldRate, oldUnits })
	config.PaymentUSDRate, config.QuotaPerUnit = 7.3, 500000
	tiers := datatypes.NewJSONType(map[string]float64{"1K": 1, "2K": 2, "4K": 4})
	qualities := datatypes.NewJSONType(map[string]float64{"low": 0.5, "high": 1, "max": 30})
	p := &Pricing{Prices: map[string]*Price{
		"image-a": {Model: "image-a", GouoEnabled: true, GouoPriceCNY: 0.1, GouoMaxOutputs: 4, GouoSizes: "1K,2K,4K", GouoQualities: "low,medium,high,xhigh,max",
			GouoTierRatios: &tiers, GouoQualityRatios: &qualities, GouoTransparent: true},
	}}
	entry, err := p.GetGouoModel("image-a")
	require.NoError(t, err)
	// 系数为 1 的键不下发，缺省即按 1 计
	require.Equal(t, map[string]float64{"2K": 2, "4K": 4}, entry.TierRatios)
	require.Equal(t, map[string]float64{"low": 0.5, "max": 30}, entry.QualityRatios)
	require.True(t, entry.Transparent)
	require.Equal(t, []string{"low", "medium", "high", "xhigh", "max"}, entry.Qualities)
	quote := func(size, quality string, n int) (float64, int) {
		price, quota, err := GouoImageRequestQuote(entry, size, quality, n)
		require.NoError(t, err, size, quality, n)
		return price, quota
	}
	cases := []struct {
		size, quality string
		n             int
		price         float64
	}{
		// 自动尺寸按 1K、自动画质按 high
		{"", "", 0, 0.1},
		{"auto", "auto", 1, 0.1},
		{"1024x1024", "low", 1, 0.05},
		{"2048x2048", "high", 1, 0.2},
		{"3840x2160", "max", 1, 12},
		// 没有设置系数的画质按 1 计
		{"2048x2048", "medium", 1, 0.2},
		{"1536x1024", "xhigh", 1, 0.1},
		{" AUTO ", " Max ", 1, 3},
		// 按张数乘
		{"2048x2048", "low", 3, 0.3},
		{"auto", "", 2, 0.2},
	}
	for _, tc := range cases {
		price, quota := quote(tc.size, tc.quality, tc.n)
		require.InDelta(t, tc.price, price, 1e-9, tc)
		require.Equal(t, int(math.Ceil(price/7.3*500000)), quota, tc)
	}
	_, single := quote("2048x2048", "low", 1)
	_, triple := quote("2048x2048", "low", 3)
	require.Greater(t, triple, single*2)
	for _, size := range []string{"4096x4096", "big"} {
		_, _, err = GouoImageRequestQuote(entry, size, "low", 1)
		require.Error(t, err, size)
	}
	_, _, err = GouoImageRequestQuote(entry, "auto", "low", -1)
	require.Error(t, err)
	// 没有任何系数的模型和原来一样按基础价计
	plain := &GouoImageModel{PriceCNY: 0.1}
	price, quota, err := GouoImageRequestQuote(plain, "3840x2160", "max", 1)
	require.NoError(t, err)
	require.InDelta(t, 0.1, price, 1e-9)
	require.Equal(t, 6850, quota)
	// 溢出额度范围时拒绝
	_, _, err = GouoImageRequestQuote(&GouoImageModel{PriceCNY: 10000, TierRatios: map[string]float64{"4K": 100}, QualityRatios: map[string]float64{"max": 100}}, "3840x2160", "max", 10)
	require.Error(t, err)
}

func TestGouoPriceVersionStableForOldModels(t *testing.T) {
	oldRate, oldUnits := config.PaymentUSDRate, config.QuotaPerUnit
	t.Cleanup(func() { config.PaymentUSDRate, config.QuotaPerUnit = oldRate, oldUnits })
	config.PaymentUSDRate, config.QuotaPerUnit = 7.3, 500000
	full := func() *Price {
		return &Price{Model: "gpt-image-2", GouoEnabled: true, GouoPriceCNY: 0.3, GouoReference: true, GouoMask: true, GouoMaxOutputs: 4, GouoSizes: "1K,2K", GouoQualities: "low,medium,high", GouoMaxInputs: 16}
	}
	plain := &Price{Model: "image-b", GouoEnabled: true, GouoPriceCNY: 0.1, GouoMaxOutputs: 1}
	p := &Pricing{Prices: map[string]*Price{"gpt-image-2": full(), "image-b": plain}}
	// 期望值由加入系数和透明背景字段之前的版本算出：没有设置这些字段的模型，客户端不必重新确认价格
	want := map[string]string{
		"gpt-image-2": "7331364d95bfef54bff1905b55fae5ec6d8a073066516555d491a3d12a056b5d",
		"image-b":     "5493bbf9f2bac0e45e4f539443ec4472ae295876a09886790fe88ed312fdc25e",
	}
	for id, version := range want {
		entry, err := p.GetGouoModel(id)
		require.NoError(t, err)
		require.Equal(t, version, entry.PriceVersion, id)
	}
	// 系数全为 1 与没有设置等价
	tierOnes, qualityOnes := datatypes.NewJSONType(map[string]float64{"1K": 1, "2K": 1}), datatypes.NewJSONType(map[string]float64{"high": 1})
	price := full()
	price.GouoTierRatios, price.GouoQualityRatios = &tierOnes, &qualityOnes
	p.Prices["gpt-image-2"] = price
	entry, err := p.GetGouoModel("gpt-image-2")
	require.NoError(t, err)
	require.Equal(t, want["gpt-image-2"], entry.PriceVersion)
	// 系数、透明背景和超高画质都参与价格版本
	tiers, qualities := datatypes.NewJSONType(map[string]float64{"2K": 2}), datatypes.NewJSONType(map[string]float64{"max": 30})
	for _, edit := range []func(price *Price){
		func(price *Price) { price.GouoTierRatios = &tiers },
		func(price *Price) { price.GouoQualityRatios = &qualities },
		func(price *Price) { price.GouoTransparent = true },
		func(price *Price) { price.GouoQualities = "low,medium,high,xhigh" },
	} {
		price := full()
		edit(price)
		p.Prices["gpt-image-2"] = price
		changed, err := p.GetGouoModel("gpt-image-2")
		require.NoError(t, err)
		require.NotEqual(t, want["gpt-image-2"], changed.PriceVersion)
	}
}

func TestValidateGouoPriceRatios(t *testing.T) {
	ratios := func(values map[string]float64) *datatypes.JSONType[map[string]float64] {
		value := datatypes.NewJSONType(values)
		return &value
	}
	base := func() *Price {
		return &Price{Model: "image-a", GouoEnabled: true, GouoPriceCNY: 0.1, GouoMaxOutputs: 1}
	}
	valid := base()
	valid.GouoTierRatios, valid.GouoQualityRatios = ratios(map[string]float64{"1K": 0.5, "2K": 1, "4K": 100}), ratios(map[string]float64{"low": 0.01, "medium": 1, "high": 2, "xhigh": 8, "max": 30})
	valid.GouoQualities = "low,medium,high,xhigh,max"
	require.NoError(t, ValidateGouoPrice(valid))
	for name, edit := range map[string]func(price *Price){
		"档位键非法":    func(price *Price) { price.GouoTierRatios = ratios(map[string]float64{"8K": 2}) },
		"档位键大小写":   func(price *Price) { price.GouoTierRatios = ratios(map[string]float64{"2k": 2}) },
		"画质键非法":    func(price *Price) { price.GouoQualityRatios = ratios(map[string]float64{"ultra": 2}) },
		"系数为 0":    func(price *Price) { price.GouoTierRatios = ratios(map[string]float64{"1K": 0}) },
		"系数为负":     func(price *Price) { price.GouoQualityRatios = ratios(map[string]float64{"low": -1}) },
		"系数超过 100": func(price *Price) { price.GouoQualityRatios = ratios(map[string]float64{"max": 100.5}) },
		"系数 NaN":   func(price *Price) { price.GouoTierRatios = ratios(map[string]float64{"4K": math.NaN()}) },
		"系数 Inf":   func(price *Price) { price.GouoQualityRatios = ratios(map[string]float64{"max": math.Inf(1)}) },
		"画质非法":     func(price *Price) { price.GouoQualities = "low,ultra" },
	} {
		price := base()
		edit(price)
		require.Error(t, ValidateGouoPrice(price), name)
	}
	// 未启用的价格记录不校验光构字段
	disabled := base()
	disabled.GouoEnabled = false
	disabled.GouoTierRatios = ratios(map[string]float64{"8K": 0})
	require.NoError(t, ValidateGouoPrice(disabled))
}
