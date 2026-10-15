package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"strings"
	"unicode/utf8"

	"gorm.io/gorm"
)

// GouoAgentModelConfig 是后台为光构 Agent 上架的文本模型。按 token 计费，价格沿用 New API 的模型倍率
type GouoAgentModelConfig struct {
	Model       string `json:"model" gorm:"type:varchar(191);primaryKey"`
	Listed      bool   `json:"listed"`
	Vision      bool   `json:"vision"`
	Sort        int    `json:"sort"`
	Name        string `json:"name" gorm:"type:varchar(100);default:''"`
	Description string `json:"description" gorm:"type:varchar(400);default:''"`
	// 单次回复最多输出 token，0 不限；光构客户端的请求一律按此截断
	MaxTokens int   `json:"max_tokens"`
	UpdatedAt int64 `json:"updated_at" gorm:"autoUpdateTime"`
}

func (GouoAgentModelConfig) TableName() string {
	return "gouo_agent_models"
}

func (m *GouoAgentModelConfig) Validate() error {
	if strings.TrimSpace(m.Model) == "" || len(m.Model) > 100 || strings.ContainsAny(m.Model, "*#,") {
		return common.NewMessage("Invalid model ID")
	}
	if utf8.RuneCountInString(m.Name) > 40 || utf8.RuneCountInString(m.Description) > 100 {
		return gouoTextLengthError()
	}
	if m.MaxTokens < 0 || m.MaxTokens > 1000000 {
		return common.NewMessage("Max output tokens per reply must be from {{min}} to {{max}}; 0 means unlimited", map[string]any{"min": 0, "max": 1000000})
	}
	return nil
}

// GetGouoAgentModel 返回已上架的 Agent 模型，未上架时返回 nil
func GetGouoAgentModel(id string) (*GouoAgentModelConfig, error) {
	var row GouoAgentModelConfig
	err := DB.Where("model = ? AND listed = ?", id, true).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &row, err
}

func ListGouoAgentModels() ([]*GouoAgentModelConfig, error) {
	var rows []*GouoAgentModelConfig
	err := DB.Order("sort, model").Find(&rows).Error
	return rows, err
}

// SaveGouoAgentModel 保存 Agent 模型；同一模型不能同时作为图片模型启用，否则两边目录都会出现它
func SaveGouoAgentModel(row *GouoAgentModelConfig) error {
	if err := row.Validate(); err != nil {
		return err
	}
	if _, enabled, err := GetGouoImageModel(row.Model); err != nil {
		return err
	} else if enabled && row.Listed {
		return common.NewMessage("This model is enabled as an image model; disable it there first")
	}
	return DB.Save(row).Error
}
