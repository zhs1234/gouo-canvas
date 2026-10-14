package controller

import (
	"errors"
	"net/http"
	"regexp"
	"slices"
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay"
	"github.com/QuantumNous/new-api/setting/gouo_setting"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

var gouoClientRequestID = regexp.MustCompile(`^[a-zA-Z0-9_:-]{1,512}$`)

func gouoFail(c *gin.Context, status int, code, message string) {
	c.JSON(status, gin.H{"success": false, "message": message, "code": code})
}

// addGouoStatus 把光构客户端需要的运营设置并入 /api/status
func addGouoStatus(data gin.H) {
	s := gouo_setting.Get()
	data["gouo_cloud_library"] = s.CloudLibraryEnabled
	data["gouo_redemption_help"] = s.RedemptionHelp
	data["gouo_support_contact"] = s.SupportContact
	data["gouo_notice"] = s.Notice
	data["gouo_canvas_enabled"] = s.CanvasEnabled
	data["gouo_agent_enabled"] = s.AgentEnabled
	data["gouo_max_images"] = s.MaxImagesPerTask
	data["gouo_allow_low_moderation"] = s.AllowLowModeration
	data["gouo_trash_retention_days"] = s.TrashRetentionDays
	data["gouo_max_upload_bytes"] = s.AssetMaxFileBytes
}

// GetGouoModels 返回当前用户分组可用的图片模型目录，按后台顺序排列；默认模型不可用时用第一个
func GetGouoModels(c *gin.Context) {
	group, err := model.GetUserGroup(c.GetInt("id"), false)
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "group_unavailable", "读取账号分组失败")
		return
	}
	rows, err := model.ListGouoImageModels()
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "models_unavailable", "读取模型目录失败")
		return
	}
	available := model.GetGroupEnabledModels(group)
	data := make([]*model.GouoImageModel, 0)
	for _, row := range rows {
		if !row.Enabled || !slices.Contains(available, row.Model) {
			continue
		}
		if entry, err := row.Entry(); err == nil {
			data = append(data, entry)
		}
	}
	if len(data) > 0 {
		idx := slices.IndexFunc(data, func(entry *model.GouoImageModel) bool { return entry.ID == gouo_setting.Get().DefaultImageModel })
		data[max(idx, 0)].Default = true
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data, "message": "", "billing_unit": "successful_request", "currency": "CNY"})
}

func GetGouoImageResult(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	id := c.Query("client_request_id")
	if !gouoClientRequestID.MatchString(id) {
		gouoFail(c, http.StatusBadRequest, "invalid_request_id", "图片请求 ID 无效")
		return
	}
	result, err := model.GetGouoImageResult(c.GetInt("id"), id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		gouoFail(c, http.StatusNotFound, "image_request_not_found", "未找到本账号的图片请求，不会重新生成")
		return
	}
	if err != nil {
		logger.LogError(c, "读取图片恢复结果失败: "+err.Error())
		gouoFail(c, http.StatusInternalServerError, "image_result_read_failed", "读取图片结果失败，请稍后重试，不会重新生成")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": result})
}

// GetGouoPlaygroundToken 返回光构客户端调用模型用的平台令牌，没有时创建：不限额度、不过期，额度从账号余额扣
func GetGouoPlaygroundToken(c *gin.Context) {
	userID := c.GetInt("id")
	var token model.Token
	err := model.DB.Where("user_id = ? AND name = ?", userID, relay.GouoPlaygroundTokenName).First(&token).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		key, keyErr := common.GenerateKey()
		if keyErr != nil {
			gouoFail(c, http.StatusInternalServerError, "token_create_failed", "创建平台令牌失败")
			return
		}
		now := common.GetTimestamp()
		token = model.Token{UserId: userID, Name: relay.GouoPlaygroundTokenName, Key: key, Status: common.TokenStatusEnabled,
			CreatedTime: now, AccessedTime: now, ExpiredTime: -1, UnlimitedQuota: true}
		err = token.Insert()
	}
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "token_unavailable", "读取平台令牌失败")
		return
	}
	common.ApiSuccess(c, token.Key)
}

type gouoAdminModel struct {
	model.GouoImageModelConfig
	Sizes     []string `json:"sizes"`
	Qualities []string `json:"qualities"`
	// 有启用中的渠道支持此模型的分组，即客户端可能看到这个模型的分组
	Groups []string `json:"groups"`
	Error  string   `json:"error,omitempty"`
}

// ListGouoAdminModels 列出已配置的图片模型和渠道上的全部模型，便于在一处看到哪些模型会出现在客户端
func ListGouoAdminModels(c *gin.Context) {
	rows, err := model.ListGouoImageModels()
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "models_unavailable", "读取模型目录失败")
		return
	}
	byModel := map[string]*gouoAdminModel{}
	for _, row := range rows {
		item := &gouoAdminModel{GouoImageModelConfig: *row, Groups: []string{}}
		if entry, err := row.Entry(); err == nil {
			item.Sizes, item.Qualities = entry.Sizes, entry.Qualities
		} else if row.Enabled {
			item.Error = err.Error()
		}
		byModel[row.Model] = item
	}
	for _, ability := range model.GetAllEnableAbilities() {
		item := byModel[ability.Model]
		if item == nil {
			item = &gouoAdminModel{GouoImageModelConfig: model.GouoImageModelConfig{Model: ability.Model, MaxOutputs: 1}, Groups: []string{}}
			byModel[ability.Model] = item
		}
		if !slices.Contains(item.Groups, ability.Group) {
			item.Groups = append(item.Groups, ability.Group)
		}
	}
	models := make([]*gouoAdminModel, 0, len(byModel))
	for _, item := range byModel {
		sort.Strings(item.Groups)
		models = append(models, item)
	}
	// 已启用的按客户端顺序排在前面，其余按名称
	sort.Slice(models, func(i, j int) bool {
		if models[i].Enabled != models[j].Enabled {
			return models[i].Enabled
		}
		if models[i].Enabled && models[i].Sort != models[j].Sort {
			return models[i].Sort < models[j].Sort
		}
		return models[i].Model < models[j].Model
	})
	common.ApiSuccess(c, gin.H{"default_model": gouo_setting.Get().DefaultImageModel, "models": models})
}

func UpdateGouoAdminModel(c *gin.Context) {
	var input gouoAdminModel
	if err := common.UnmarshalBodyReusable(c, &input); err != nil {
		gouoFail(c, http.StatusBadRequest, "invalid_model", "模型配置无效")
		return
	}
	row := input.GouoImageModelConfig
	row.Model, row.Name, row.Description = strings.TrimSpace(row.Model), strings.TrimSpace(row.Name), strings.TrimSpace(row.Description)
	row.Sizes, row.Qualities = strings.Join(input.Sizes, ","), strings.Join(input.Qualities, ",")
	if err := model.SaveGouoImageModel(&row); err != nil {
		gouoFail(c, http.StatusBadRequest, "invalid_gouo_model", err.Error())
		return
	}
	common.ApiSuccess(c, nil)
}

func GetGouoAdminSettings(c *gin.Context) {
	common.ApiSuccess(c, gouo_setting.Get())
}

// UpdateGouoAdminSettings 整份校验后再逐项保存，避免部分保存；系统设置接口只允许 root，这些设置普通管理员也要日常维护
func UpdateGouoAdminSettings(c *gin.Context) {
	next := *gouo_setting.Get()
	if err := common.UnmarshalBodyReusable(c, &next); err != nil {
		gouoFail(c, http.StatusBadRequest, "invalid_settings", "设置内容无效")
		return
	}
	if err := next.Validate(); err != nil {
		gouoFail(c, http.StatusBadRequest, "invalid_settings", err.Error())
		return
	}
	data, err := common.Marshal(next)
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "settings_save_failed", "保存设置失败")
		return
	}
	var values map[string]any
	if err := common.Unmarshal(data, &values); err != nil {
		gouoFail(c, http.StatusInternalServerError, "settings_save_failed", "保存设置失败")
		return
	}
	options := map[string]string{}
	for key, value := range values {
		text, ok := value.(string)
		if !ok {
			raw, _ := common.Marshal(value)
			text = string(raw)
		}
		options["gouo_setting."+key] = text
	}
	if err := model.UpdateOptionsBulk(options); err != nil {
		gouoFail(c, http.StatusInternalServerError, "settings_save_failed", "保存设置失败")
		return
	}
	common.ApiSuccess(c, gouo_setting.Get())
}
