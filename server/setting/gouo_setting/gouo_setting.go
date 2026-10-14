// Package gouo_setting 保存光构客户端相关的运营设置，存于 options 表的 gouo_setting.* 键
package gouo_setting

import (
	"errors"
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

// Validate 在保存前校验整份设置，后台和环境变量都走这里
func (s *GouoSetting) Validate() error {
	s.Notice = strings.Join(strings.Fields(s.Notice), " ")
	switch {
	case utf8.RuneCountInString(s.Notice) > 200:
		return errors.New("公告不能超过 200 个字符")
	case utf8.RuneCountInString(s.RedemptionHelp) > 2000 || utf8.RuneCountInString(s.SupportContact) > 2000:
		return errors.New("兑换码说明和客服信息不能超过 2000 个字符")
	case len(s.DefaultImageModel) > 100 || len(s.AgentDefaultModel) > 100:
		return errors.New("模型名称无效")
	case utf8.RuneCountInString(s.AgentSystemPrompt) > 4000:
		return errors.New("Agent 附加提示词不能超过 4000 个字符")
	case s.MaxImagesPerTask < 1 || s.MaxImagesPerTask > 10:
		return errors.New("一次最多生成张数必须是 1 到 10 的整数")
	case s.AgentMaxRounds < 1 || s.AgentMaxRounds > 20:
		return errors.New("Agent 每条消息最多工具轮数必须是 1 到 20 的整数")
	case s.AgentConfirmImages < 1 || s.AgentConfirmImages > 10:
		return errors.New("Agent 需确认的图片张数必须是 1 到 10 的整数")
	case s.TrashRetentionDays < 1 || s.TrashRetentionDays > 30:
		return errors.New("回收站保留天数必须是 1 到 30 的整数")
	case s.AssetUserQuotaBytes < 1<<20 || s.AssetUserQuotaBytes > 1<<40:
		return errors.New("默认用户空间必须在 1 MB 到 1 TB 之间")
	case s.AssetMaxFileBytes < 1<<20 || s.AssetMaxFileBytes > 100<<20:
		return errors.New("单文件上传上限必须在 1 MB 到 100 MB 之间")
	}
	return nil
}
