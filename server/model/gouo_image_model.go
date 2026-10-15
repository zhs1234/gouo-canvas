package model

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"slices"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"gorm.io/gorm"
)

// GouoImageModelConfig 只管理客户端可见性与能力；PriceCNY 保留旧数据，实际价格由 New API 管理。
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

// GouoBillingMode 区分原生表达式、旧按次价格和 token 倍率，客户端据此展示计费单位。
func GouoBillingMode(id string) string {
	if billing_setting.GetBillingMode(id) == billing_setting.BillingModeTieredExpr {
		return billing_setting.BillingModeTieredExpr
	}
	if _, fixed := ratio_setting.GetModelPrice(id, false); fixed {
		return "per_request"
	}
	return billing_setting.BillingModeRatio
}

// GouoImageModel 是客户端看到的图片模型目录项
type GouoImageModel struct {
	BillingMode string  `json:"billing_mode"`
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	PriceCNY    float64 `json:"price_cny"`
	Reference   bool    `json:"reference"`
	Mask        bool    `json:"mask"`
	MaxOutputs  int     `json:"max_outputs"`
	Quota       int     `json:"quota"`
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

func gouoTextLengthError() error {
	return common.NewMessage("Display name must be at most {{name}} characters and description at most {{description}} characters", map[string]any{"name": 40, "description": 100})
}

func (m *GouoImageModelConfig) Validate() error {
	if strings.TrimSpace(m.Model) == "" || len(m.Model) > 100 || strings.ContainsAny(m.Model, "*#,") {
		return common.NewMessage("Image models must use an explicit public model ID")
	}
	if utf8.RuneCountInString(m.Name) > 40 || utf8.RuneCountInString(m.Description) > 100 {
		return gouoTextLengthError()
	}
	if m.MaxOutputs < 1 || m.MaxOutputs > 10 {
		return common.NewMessage("Max outputs per request must be an integer from {{min}} to {{max}}", map[string]any{"min": 1, "max": 10})
	}
	if m.Mask && !m.Reference {
		return common.NewMessage("Mask editing requires reference image support")
	}
	for _, tier := range gouoSplitList(m.Sizes, true) {
		if !slices.Contains(GouoSizeTiers, tier) {
			return common.NewMessage("Resolution tiers can only be 1K, 2K or 4K")
		}
	}
	for _, quality := range gouoSplitList(m.Qualities, false) {
		if !slices.Contains(gouoQualityValues, quality) {
			return common.NewMessage("Quality can only be low, medium or high")
		}
	}
	if m.MaxInputs < 0 || m.MaxInputs > 16 {
		return common.NewMessage("Max reference images must be from {{min}} to {{max}}; 0 means unlimited", map[string]any{"min": 0, "max": 16})
	}
	return nil
}

// Entry 不再生成独立的按张价格，版本包含 New API 生效定价和客户端能力。
func (m *GouoImageModelConfig) Entry() (*GouoImageModel, error) {
	if err := m.Validate(); err != nil {
		return nil, err
	}
	entry := &GouoImageModel{ID: m.Model, Name: m.Model, BillingMode: GouoBillingMode(m.Model), Reference: m.Reference, Mask: m.Mask,
		MaxOutputs: m.MaxOutputs, Sizes: gouoSplitList(m.Sizes, true), Qualities: gouoSplitList(m.Qualities, false), MaxInputs: m.MaxInputs}
	expression, _ := billing_setting.GetBillingExpr(m.Model)
	price, _ := ratio_setting.GetModelPrice(m.Model, false)
	ratio, _, _ := ratio_setting.GetModelRatio(m.Model)
	data, err := common.Marshal([]any{entry, expression, price, ratio, ratio_setting.GetCompletionRatio(m.Model)})
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
	if agent, err := GetGouoAgentModel(row.Model); err != nil {
		return err
	} else if agent != nil && row.Enabled {
		return common.NewMessage("This model is listed as an Agent model; unlist it there first")
	}
	if err := DB.Save(row).Error; err != nil {
		return err
	}
	return RefreshGouoImageModelIDs()
}
