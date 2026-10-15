// Package gouo_setting 保存光构客户端相关的运营设置，存于 options 表的 gouo_setting.* 键
package gouo_setting

import (
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

type GouoSetting struct {
	Notice              string `json:"notice"`
	RedemptionHelp      string `json:"redemption_help"`
	SupportContact      string `json:"support_contact"`
	DefaultImageModel   string `json:"default_image_model"`
	CanvasEnabled       bool   `json:"canvas_enabled"`
	AgentEnabled        bool   `json:"agent_enabled"`
	AgentDefaultModel   string `json:"agent_default_model"`
	AgentSystemPrompt   string `json:"agent_system_prompt"`
	MaxImagesPerTask    int    `json:"max_images_per_task"`
	AllowLowModeration  bool   `json:"allow_low_moderation"`
	AgentMaxRounds      int    `json:"agent_max_rounds"`
	AgentConfirmImages  int    `json:"agent_confirm_images"`
	CloudLibraryEnabled bool   `json:"cloud_library_enabled"`
	AssetUserQuotaBytes int64  `json:"asset_user_quota_bytes"`
	AssetMaxFileBytes   int64  `json:"asset_max_file_bytes"`
	TrashRetentionDays  int    `json:"trash_retention_days"`
	// 以下只能通过环境变量设置，不在后台开放
	AssetDir          string `json:"-"`
	AssetMaxTaskFiles int    `json:"-"`
}

var setting = GouoSetting{
	CanvasEnabled:       true,
	AgentEnabled:        true,
	MaxImagesPerTask:    10,
	AgentMaxRounds:      8,
	AgentConfirmImages:  4,
	CloudLibraryEnabled: true,
	AssetUserQuotaBytes: 2 << 30,
	AssetMaxFileBytes:   25 << 20,
	TrashRetentionDays:  3,
	AssetDir:            "./data/gouo-assets",
	AssetMaxTaskFiles:   32,
}

func init() {
	setting.AssetDir = common.GetEnvOrDefaultString("GOUO_ASSET_DIR", setting.AssetDir)
	setting.AssetMaxTaskFiles = common.GetEnvOrDefault("GOUO_ASSET_MAX_TASK_FILES", setting.AssetMaxTaskFiles)
	config.GlobalConfig.Register("gouo_setting", &setting)
}

func Get() *GouoSetting {
	return &setting
}

// Validate 在保存前校验整份设置；错误是 New API 的 message_key，后台界面按语言包翻译
func (s *GouoSetting) Validate() error {
	s.Notice = strings.Join(strings.Fields(s.Notice), " ")
	between := func(key string, min, max int) error {
		return common.NewMessage(key, map[string]any{"min": min, "max": max})
	}
	switch {
	case utf8.RuneCountInString(s.Notice) > 200:
		return common.NewMessage("Announcement must be at most {{max}} characters", map[string]any{"max": 200})
	case utf8.RuneCountInString(s.RedemptionHelp) > 2000 || utf8.RuneCountInString(s.SupportContact) > 2000:
		return common.NewMessage("Redemption help and support contact must each be at most {{max}} characters", map[string]any{"max": 2000})
	case len(s.DefaultImageModel) > 100 || len(s.AgentDefaultModel) > 100:
		return common.NewMessage("Invalid model name")
	case utf8.RuneCountInString(s.AgentSystemPrompt) > 4000:
		return common.NewMessage("Agent system prompt must be at most {{max}} characters", map[string]any{"max": 4000})
	case s.MaxImagesPerTask < 1 || s.MaxImagesPerTask > 10:
		return between("Images per task must be an integer from {{min}} to {{max}}", 1, 10)
	case s.AgentMaxRounds < 1 || s.AgentMaxRounds > 20:
		return between("Agent tool rounds per message must be an integer from {{min}} to {{max}}", 1, 20)
	case s.AgentConfirmImages < 1 || s.AgentConfirmImages > 10:
		return between("Agent image confirmation threshold must be an integer from {{min}} to {{max}}", 1, 10)
	case s.TrashRetentionDays < 1 || s.TrashRetentionDays > 30:
		return between("Trash retention must be from {{min}} to {{max}} days", 1, 30)
	case s.AssetUserQuotaBytes < 1<<20 || s.AssetUserQuotaBytes > 1<<40:
		return common.NewMessage("Default user storage must be between 1 MB and 1 TB")
	case s.AssetMaxFileBytes < 1<<20 || s.AssetMaxFileBytes > 100<<20:
		return common.NewMessage("Upload size limit must be between 1 MB and 100 MB")
	}
	return nil
}
