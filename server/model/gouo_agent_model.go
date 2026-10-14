package model

import (
	"errors"
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
		return errors.New("模型 ID 无效")
	}
	if utf8.RuneCountInString(m.Name) > 40 || utf8.RuneCountInString(m.Description) > 100 {
		return errors.New("显示名称不能超过 40 个字，说明不能超过 100 个字")
	}
	if m.MaxTokens < 0 || m.MaxTokens > 1000000 {
		return errors.New("单次回复最多输出 token 必须在 0 到 100 万之间，0 表示不限")
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
		return errors.New("该模型已作为图片模型启用，请先在图片模型里下架")
	}
	return DB.Save(row).Error
}
