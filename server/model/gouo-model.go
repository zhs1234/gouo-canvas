package model

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"one-api/common/config"
	"slices"
	"strings"

	"github.com/spf13/viper"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type GouoImageModel struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	PriceCNY   float64 `json:"price_cny"`
	Reference  bool    `json:"reference"`
	Mask       bool    `json:"mask"`
	MaxOutputs int     `json:"max_outputs"`
	Quota      int     `json:"quota"`
	// 后台限定的分辨率档位、画质和参考图张数，参与价格版本；档位为空表示只能用自动尺寸，画质和张数不限时省略
	Sizes        []string `json:"sizes,omitempty"`
	Qualities    []string `json:"qualities,omitempty"`
	MaxInputs    int      `json:"max_inputs,omitempty"`
	PriceVersion string   `json:"price_version"`
	// 以下字段在价格版本算好后才设置，不参与版本计算：改名、改说明或调整顺序不会让用户重新确认价格
	Default     bool   `json:"default,omitempty"`
	Description string `json:"description,omitempty"`
	Sort        int    `json:"-"`
}

// 各分辨率档位允许的最大像素数，与客户端尺寸选择的档位一致；尺寸按像素数归入能容纳它的最小档位
var GouoSizeTierPixels = map[string]int{"1K": 1024 * 1536, "2K": 2048 * 2048, "4K": 3840 * 2160}
var GouoSizeTiers = []string{"1K", "2K", "4K"}

// GouoSizeTier 返回 WxH 尺寸所属的分辨率档位，超出 4K 或格式无效时返回空
func GouoSizeTier(width, height int) string {
	for _, tier := range GouoSizeTiers {
		if width*height <= GouoSizeTierPixels[tier] {
			return tier
		}
	}
	return ""
}

// GouoSizeList 返回后台开放的分辨率档位，空表示只能用自动尺寸
func GouoSizeList(price *Price) []string {
	var list []string
	for _, item := range strings.Split(price.GouoSizes, ",") {
		if item = strings.ToUpper(strings.TrimSpace(item)); item != "" {
			list = append(list, item)
		}
	}
	return list
}

var gouoQualityValues = []string{"low", "medium", "high"}

// GouoQualityList 返回后台限定的可选画质，空表示不限
func GouoQualityList(price *Price) []string {
	var list []string
	for _, item := range strings.Split(price.GouoQualities, ",") {
		if item = strings.ToLower(strings.TrimSpace(item)); item != "" {
			list = append(list, item)
		}
	}
	return list
}

// GouoToolTags 是模型资料里表示支持工具调用的标签，上架 Agent 时写入其中的 tools
var GouoToolTags = []string{"tools", "tool_calls", "function_calling", "function-calling"}

// GouoAgentListed 判断模型是否已上架为 Agent：模型资料声明能输出文本且支持工具调用
func GouoAgentListed(info *ModelInfoResponse) bool {
	if info == nil || !slices.Contains(info.OutputModalities, "text") {
		return false
	}
	return slices.ContainsFunc(info.Tags, func(tag string) bool {
		return slices.Contains(GouoToolTags, strings.ToLower(strings.TrimSpace(tag)))
	})
}

var ErrGouoAgentListed = errors.New("该模型已作为 Agent 模型上架，请先在 Agent 模型里下架")

// CheckGouoImageExclusive 在启用图片模型前核对它没有上架为 Agent，否则会从 Agent 目录里消失。
// 直接读数据库：多实例部署时本实例的价格缓存最多落后 1 分钟，可能还没看到别的实例刚上架的 Agent
func CheckGouoImageExclusive(id string) error {
	info, err := GetModelInfoByModel(id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if GouoAgentListed(info.ToResponse()) {
		return ErrGouoAgentListed
	}
	return nil
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
	for _, tier := range GouoSizeList(price) {
		if !slices.Contains(GouoSizeTiers, tier) {
			return errors.New("分辨率档位只能是 1K、2K、4K")
		}
	}
	for _, quality := range GouoQualityList(price) {
		if !slices.Contains(gouoQualityValues, quality) {
			return errors.New("画质只能是 low、medium、high")
		}
	}
	if strings.TrimSpace(price.GouoQualities) != "" && len(GouoQualityList(price)) == 0 {
		return errors.New("至少开放一种画质")
	}
	if price.GouoMaxInputs < 0 || price.GouoMaxInputs > 16 {
		return errors.New("最多参考图张数必须在 0 到 16 之间，0 表示不限")
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
		Reference: price.GouoReference, Mask: price.GouoMask, MaxOutputs: price.GouoMaxOutputs, Quota: int(quota),
		Sizes: GouoSizeList(price), Qualities: GouoQualityList(price), MaxInputs: price.GouoMaxInputs}
	data, _ := json.Marshal(result)
	hash := sha256.Sum256(data)
	result.PriceVersion = hex.EncodeToString(hash[:])
	result.Sort = price.GouoSort
	if info := price.ModelInfo; info != nil {
		if name := strings.TrimSpace(info.Name); name != "" {
			result.Name = name
		}
		result.Description = strings.TrimSpace(info.Description)
	}
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
