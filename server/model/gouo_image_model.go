package model

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"math"
	"slices"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"gorm.io/gorm"
)

// GouoImageModelConfig 是后台为光构客户端开放的图片模型。图片按次计价，不走 New API 的模型定价，
// 由光构账本（gouo_billing.go）预扣和结算
type GouoImageModelConfig struct {
	Model      string  `json:"model" gorm:"type:varchar(191);primaryKey"`
	Enabled    bool    `json:"enabled"`
	PriceCNY   float64 `json:"price_cny"`
	Reference  bool    `json:"reference"`
	Mask       bool    `json:"mask"`
	MaxOutputs int     `json:"max_outputs" gorm:"default:1"`
	// 支持的分辨率档位（1K/2K/4K，逗号分隔，留空表示只能用自动尺寸）、可选画质（逗号分隔，留空不限）、最多参考图张数（0 不限）
	Sizes       string `json:"sizes" gorm:"type:varchar(20);default:''"`
	Qualities   string `json:"qualities" gorm:"type:varchar(64);default:''"`
	MaxInputs   int    `json:"max_inputs"`
	Sort        int    `json:"sort"`
	Name        string `json:"name" gorm:"type:varchar(100);default:''"`
	Description string `json:"description" gorm:"type:varchar(400);default:''"`
	UpdatedAt   int64  `json:"updated_at" gorm:"autoUpdateTime"`
}

func (GouoImageModelConfig) TableName() string {
	return "gouo_image_models"
}

// GouoImageModel 是客户端看到的图片模型目录项
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
var gouoQualityValues = []string{"low", "medium", "high"}

// GouoSizeTier 返回 WxH 尺寸所属的分辨率档位，超出 4K 时返回空
func GouoSizeTier(width, height int) string {
	for _, tier := range GouoSizeTiers {
		if width*height <= GouoSizeTierPixels[tier] {
			return tier
		}
	}
	return ""
}

func gouoSplitList(value string, upper bool) []string {
	var list []string
	for _, item := range strings.Split(value, ",") {
		if item = strings.TrimSpace(item); item == "" {
			continue
		}
		if upper {
			list = append(list, strings.ToUpper(item))
		} else {
			list = append(list, strings.ToLower(item))
		}
	}
	return list
}

func (m *GouoImageModelConfig) Validate() error {
	if strings.TrimSpace(m.Model) == "" || len(m.Model) > 100 || strings.ContainsAny(m.Model, "*#,") {
		return errors.New("光构图片模型必须使用明确的公开模型 ID")
	}
	if utf8.RuneCountInString(m.Name) > 40 || utf8.RuneCountInString(m.Description) > 100 {
		return errors.New("显示名称不能超过 40 个字，说明不能超过 100 个字")
	}
	if math.IsNaN(m.PriceCNY) || math.IsInf(m.PriceCNY, 0) || m.PriceCNY <= 0 || m.PriceCNY > 10000 {
		return errors.New("光构单次价格必须大于 0 且不超过 10000 元")
	}
	if m.MaxOutputs < 1 || m.MaxOutputs > 10 || (m.Mask && !m.Reference) {
		return errors.New("光构单次输出上限必须在 1 到 10 之间；遮罩编辑需要支持参考图")
	}
	for _, tier := range gouoSplitList(m.Sizes, true) {
		if !slices.Contains(GouoSizeTiers, tier) {
			return errors.New("分辨率档位只能是 1K、2K、4K")
		}
	}
	for _, quality := range gouoSplitList(m.Qualities, false) {
		if !slices.Contains(gouoQualityValues, quality) {
			return errors.New("画质只能是 low、medium、high")
		}
	}
	if m.MaxInputs < 0 || m.MaxInputs > 16 {
		return errors.New("最多参考图张数必须在 0 到 16 之间，0 表示不限")
	}
	return nil
}

// Entry 换算成客户端目录项，额度按支付汇率从人民币单价换算并向上取整
func (m *GouoImageModelConfig) Entry() (*GouoImageModel, error) {
	if err := m.Validate(); err != nil {
		return nil, err
	}
	rate := operation_setting.USDExchangeRate
	if rate <= 0 || math.IsNaN(rate) || math.IsInf(rate, 0) || common.QuotaPerUnit <= 0 {
		return nil, errors.New("图片计费汇率配置无效")
	}
	quota, err := common.QuotaFromFloatStrict(math.Ceil(m.PriceCNY / rate * common.QuotaPerUnit))
	if err != nil || quota < 1 {
		return nil, errors.New("图片计费额度超出范围")
	}
	entry := &GouoImageModel{ID: m.Model, Name: m.Model, PriceCNY: m.PriceCNY, Reference: m.Reference, Mask: m.Mask,
		MaxOutputs: m.MaxOutputs, Quota: quota, Sizes: gouoSplitList(m.Sizes, true), Qualities: gouoSplitList(m.Qualities, false), MaxInputs: m.MaxInputs}
	data, err := common.Marshal(entry)
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256(data)
	entry.PriceVersion = hex.EncodeToString(hash[:])
	entry.Sort, entry.Description = m.Sort, m.Description
	if name := strings.TrimSpace(m.Name); name != "" {
		entry.Name = name
	}
	return entry, nil
}

// GetGouoImageModel 返回已启用的图片模型；未启用时 ok 为 false。每次直接读库，后台改价立即对所有实例生效
func GetGouoImageModel(id string) (*GouoImageModelConfig, bool, error) {
	var row GouoImageModelConfig
	err := DB.Where("model = ? AND enabled = ?", id, true).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, nil
	}
	return &row, err == nil, err
}

// 已启用图片模型的内存副本，供不便查库的定价路径拦截；后台保存时立即刷新，其他实例每分钟同步一次
var gouoImageModelIDs sync.Map

func IsGouoImageModel(id string) bool {
	_, ok := gouoImageModelIDs.Load(id)
	return ok
}

func RefreshGouoImageModelIDs() error {
	var ids []string
	if err := DB.Model(&GouoImageModelConfig{}).Where("enabled = ?", true).Pluck("model", &ids).Error; err != nil {
		return err
	}
	gouoImageModelIDs.Range(func(key, _ any) bool {
		if !slices.Contains(ids, key.(string)) {
			gouoImageModelIDs.Delete(key)
		}
		return true
	})
	for _, id := range ids {
		gouoImageModelIDs.Store(id, true)
	}
	return nil
}

func ListGouoImageModels() ([]*GouoImageModelConfig, error) {
	var rows []*GouoImageModelConfig
	err := DB.Order("sort, model").Find(&rows).Error
	return rows, err
}

func SaveGouoImageModel(row *GouoImageModelConfig) error {
	if err := row.Validate(); err != nil {
		return err
	}
	if err := DB.Save(row).Error; err != nil {
		return err
	}
	return RefreshGouoImageModelIDs()
}
