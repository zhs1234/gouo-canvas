package model

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"one-api/common/config"
	"strings"

	"github.com/spf13/viper"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type GouoImageModel struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	PriceCNY     float64 `json:"price_cny"`
	Reference    bool    `json:"reference"`
	Mask         bool    `json:"mask"`
	MaxOutputs   int     `json:"max_outputs"`
	Quota        int     `json:"quota"`
	PriceVersion string  `json:"price_version"`
}

func ValidateGouoPrice(price *Price) error {
	if !price.GouoEnabled {
		return nil
	}
	if strings.TrimSpace(price.Model) == "" || strings.ContainsAny(price.Model, "*#") {
		return errors.New("光构图片模型必须使用明确的公开模型 ID")
	}
	if math.IsNaN(price.GouoPriceCNY) || math.IsInf(price.GouoPriceCNY, 0) || price.GouoPriceCNY <= 0 || price.GouoPriceCNY > 10000 {
		return errors.New("光构单次价格必须大于 0 且不超过 10000 元")
	}
	if price.GouoMaxOutputs < 1 || price.GouoMaxOutputs > 10 || (price.GouoMask && !price.GouoReference) {
		return errors.New("光构单次输出上限必须在 1 到 10 之间；遮罩编辑需要支持参考图")
	}
	return nil
}

func (p *Pricing) GetGouoModel(id string) (*GouoImageModel, error) {
	p.RLock()
	price, ok := p.Prices[id]
	if ok {
		copy := *price
		price = &copy
	}
	p.RUnlock()
	if !ok || !price.GouoEnabled {
		return nil, errors.New("模型未启用，请重新选择图片模型")
	}
	if err := ValidateGouoPrice(price); err != nil {
		return nil, err
	}
	if config.PaymentUSDRate <= 0 || math.IsNaN(config.PaymentUSDRate) || math.IsInf(config.PaymentUSDRate, 0) || config.QuotaPerUnit <= 0 || math.IsNaN(config.QuotaPerUnit) || math.IsInf(config.QuotaPerUnit, 0) {
		return nil, errors.New("图片计费汇率配置无效")
	}
	quota := math.Ceil(price.GouoPriceCNY / config.PaymentUSDRate * config.QuotaPerUnit)
	if math.IsNaN(quota) || math.IsInf(quota, 0) || quota > float64(math.MaxInt32) || quota < 1 {
		return nil, errors.New("图片计费额度超出范围")
	}
	result := &GouoImageModel{ID: id, Name: id, PriceCNY: price.GouoPriceCNY,
		Reference: price.GouoReference, Mask: price.GouoMask, MaxOutputs: price.GouoMaxOutputs, Quota: int(quota)}
	data, _ := json.Marshal(result)
	hash := sha256.Sum256(data)
	result.PriceVersion = hex.EncodeToString(hash[:])
	return result, nil
}

// 只迁移一次，管理员后续下架或删除默认模型不会在重启后被重新开放。
func migrateGouoImagePrice() error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var marker Option
		err := tx.Where(clause.Eq{Column: "key", Value: "GouoImagePriceMigrated"}).First(&marker).Error
		if err == nil {
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		id := strings.TrimSpace(viper.GetString("gouo_image_model"))
		if id == "" {
			id = "gpt-image-2"
		}
		price := Price{Model: id, Type: TimesPriceType, ChannelType: config.ChannelTypeOpenAI, Locked: true,
			GouoEnabled: true, GouoPriceCNY: config.GouoImagePriceCNY, GouoReference: true, GouoMask: true, GouoMaxOutputs: 1}
		if err := ValidateGouoPrice(&price); err != nil {
			return err
		}
		var existing Price
		err = tx.Where("model = ?", id).First(&existing).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			err = tx.Create(&price).Error
		} else if err == nil && !existing.GouoEnabled {
			err = tx.Model(&Price{}).Where("model = ?", id).Updates(map[string]any{"gouo_enabled": true, "gouo_price_cny": price.GouoPriceCNY, "gouo_reference": true, "gouo_mask": true, "gouo_max_outputs": 1, "locked": true}).Error
		}
		if err != nil {
			return err
		}
		return tx.Create(&Option{Key: "GouoImagePriceMigrated", Value: "true"}).Error
	})
}
