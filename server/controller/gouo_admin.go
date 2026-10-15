package controller

import (
	"net/http"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/gouo_setting"

	"github.com/gin-gonic/gin"
)

// 光构后台接口，沿用 New API 后台的约定：业务失败返回 200 和 success=false，提示是英文 message_key，
// 由后台界面按语言包翻译；列表用 p / page_size 分页，返回 {items, total, page, page_size}

var gouoChargeIDPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

// gouoAdminBelowRole 返回普通管理员能管理的账号等级上限（不含），root 返回 0 表示不限，与用户管理接口的范围一致
func gouoAdminBelowRole(c *gin.Context) int {
	if role := c.GetInt("role"); role != common.RoleRootUser {
		return role
	}
	return 0
}

func gouoAdminCanAccess(c *gin.Context, userID int) bool {
	belowRole := gouoAdminBelowRole(c)
	if belowRole == 0 {
		return true
	}
	user, err := model.GetUserById(userID, false)
	return err == nil && user.Role < belowRole
}

// gouoAdminUserParam 读取路径里的用户 ID 并核对管理权限，失败时已写出响应
func gouoAdminUserParam(c *gin.Context) (int, bool) {
	userID, err := strconv.Atoi(c.Param("id"))
	if err != nil || userID < 1 {
		common.ApiErrorT(c, "Invalid user ID")
		return 0, false
	}
	if !gouoAdminCanAccess(c, userID) {
		common.ApiErrorT(c, "No permission to manage users of the same or higher role")
		return 0, false
	}
	return userID, true
}

func GetGouoAdminSettings(c *gin.Context) {
	common.ApiSuccess(c, gouo_setting.Get())
}

// UpdateGouoAdminSettings 只修改请求中出现的字段；整份校验通过后一次保存，避免部分保存。
// 系统设置接口只允许 root，这些设置普通管理员也要日常维护
func UpdateGouoAdminSettings(c *gin.Context) {
	next := *gouo_setting.Get()
	if err := common.UnmarshalBodyReusable(c, &next); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err := next.Validate(); err != nil {
		common.ApiError(c, err)
		return
	}
	data, err := common.Marshal(next)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var values map[string]any
	if err := common.Unmarshal(data, &values); err != nil {
		common.ApiError(c, err)
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
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gouo_setting.Get())
}

type gouoAdminModel struct {
	model.GouoImageModelConfig
	Sizes     []string `json:"sizes"`
	Qualities []string `json:"qualities"`
	// 有启用中的渠道支持此模型的分组，即客户端可能看到这个模型的分组
	Groups []string `json:"groups"`
	// 已启用但当前配置无法使用时的原因
	Error string `json:"error,omitempty"`
}

// ListGouoAdminModels 列出已配置的图片模型和渠道上的全部模型，便于在一处看到哪些模型会出现在客户端
func ListGouoAdminModels(c *gin.Context) {
	rows, err := model.ListGouoImageModels()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	byModel := map[string]*gouoAdminModel{}
	for _, row := range rows {
		item := &gouoAdminModel{GouoImageModelConfig: *row, Sizes: []string{}, Qualities: []string{}, Groups: []string{}}
		if entry, err := row.Entry(); err == nil {
			item.Sizes, item.Qualities = append(item.Sizes, entry.Sizes...), append(item.Qualities, entry.Qualities...)
		} else if row.Enabled {
			item.Error = err.Error()
		}
		byModel[row.Model] = item
	}
	for _, ability := range model.GetAllEnableAbilities() {
		item := byModel[ability.Model]
		if item == nil {
			item = &gouoAdminModel{GouoImageModelConfig: model.GouoImageModelConfig{Model: ability.Model, MaxOutputs: 1}, Sizes: []string{}, Qualities: []string{}, Groups: []string{}}
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
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	row := input.GouoImageModelConfig
	row.Model, row.Name, row.Description = strings.TrimSpace(row.Model), strings.TrimSpace(row.Name), strings.TrimSpace(row.Description)
	row.Sizes, row.Qualities = strings.Join(input.Sizes, ","), strings.Join(input.Qualities, ",")
	if err := model.SaveGouoImageModel(&row); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

type gouoAdminAgentModel struct {
	model.GouoAgentModelConfig
	InputPriceCNY  float64  `json:"input_price_cny"`
	OutputPriceCNY float64  `json:"output_price_cny"`
	Groups         []string `json:"groups"`
	// 客户端看不到它的第一个原因（message_key），空表示可见
	Reason string `json:"reason"`
}

// ListGouoAdminAgentModels 列出已上架的和渠道上的全部文本模型（已启用为图片模型的除外），以及客户端能否看到
func ListGouoAdminAgentModels(c *gin.Context) {
	rows, err := model.ListGouoAgentModels()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	byModel := map[string]*gouoAdminAgentModel{}
	for _, row := range rows {
		byModel[row.Model] = &gouoAdminAgentModel{GouoAgentModelConfig: *row, Groups: []string{}}
	}
	for _, ability := range model.GetAllEnableAbilities() {
		if model.IsGouoImageModel(ability.Model) {
			continue
		}
		item := byModel[ability.Model]
		if item == nil {
			item = &gouoAdminAgentModel{GouoAgentModelConfig: model.GouoAgentModelConfig{Model: ability.Model}, Groups: []string{}}
			byModel[ability.Model] = item
		}
		if !slices.Contains(item.Groups, ability.Group) {
			item.Groups = append(item.Groups, ability.Group)
		}
	}
	models := make([]*gouoAdminAgentModel, 0, len(byModel))
	for _, item := range byModel {
		sort.Strings(item.Groups)
		item.InputPriceCNY, item.OutputPriceCNY, item.Reason = gouoAgentPrice(item.Model)
		switch {
		case !item.Listed:
			item.Reason = "Not listed"
		case len(item.Groups) == 0:
			item.Reason = "No enabled channel supports this model"
		}
		models = append(models, item)
	}
	sort.Slice(models, func(i, j int) bool {
		if models[i].Listed != models[j].Listed {
			return models[i].Listed
		}
		if models[i].Listed && models[i].Sort != models[j].Sort {
			return models[i].Sort < models[j].Sort
		}
		return models[i].Model < models[j].Model
	})
	common.ApiSuccess(c, gin.H{"default_model": gouo_setting.Get().AgentDefaultModel, "models": models})
}

// UpdateGouoAdminAgentModel 上架、下架或编辑一个 Agent 文本模型；价格在 New API 的模型定价里设置
func UpdateGouoAdminAgentModel(c *gin.Context) {
	var row model.GouoAgentModelConfig
	if err := common.UnmarshalBodyReusable(c, &row); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	row.Model, row.Name, row.Description = strings.TrimSpace(row.Model), strings.TrimSpace(row.Name), strings.TrimSpace(row.Description)
	if err := model.SaveGouoAgentModel(&row); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func GetGouoAdminStorage(c *gin.Context) {
	summary, err := model.GetGouoStorageAdminSummary()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"summary": summary, "default_quota_bytes": gouo_setting.Get().AssetUserQuotaBytes, "asset_dir": gouo_setting.Get().AssetDir})
}

// ListGouoAdminStorageUsers 按已用空间从大到小列出账号；普通管理员只能看到权限比自己低的账号
func ListGouoAdminStorageUsers(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	rows, err := model.ListGouoStorageUserUsage(gouoAdminBelowRole(c))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	start := min(pageInfo.GetStartIdx(), len(rows))
	end := min(start+pageInfo.GetPageSize(), len(rows))
	items := make([]gin.H, 0, end-start)
	for _, row := range rows[start:end] {
		quota, err := model.GetGouoUserQuota(row.UserID, gouo_setting.Get().AssetUserQuotaBytes)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		items = append(items, gin.H{"user_id": row.UserID, "username": row.Username, "used_bytes": row.UsedBytes, "quota_bytes": quota, "asset_count": row.AssetCount})
	}
	pageInfo.SetTotal(len(rows))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

func ListGouoAdminUserTasks(c *gin.Context) {
	userID, ok := gouoAdminUserParam(c)
	if !ok {
		return
	}
	pageInfo := common.GetPageQuery(c)
	tasks, total, err := model.ListGouoAdminTasks(userID, pageInfo.GetPage(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]gouoTaskResponse, 0, len(tasks))
	for _, task := range tasks {
		items = append(items, gouoAdminTaskToResponse(task, userID))
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

// GetGouoAdminUserAssetContent 返回图片内容；失败时用 HTTP 状态码，后台按图片加载失败处理
func GetGouoAdminUserAssetContent(c *gin.Context) {
	userID, err := strconv.Atoi(c.Param("id"))
	if err != nil || userID < 1 || !gouoAdminCanAccess(c, userID) {
		c.Status(http.StatusForbidden)
		return
	}
	asset, err := model.GetGouoAdminOutputAsset(userID, c.Param("assetId"))
	if err != nil || asset == nil {
		c.Status(http.StatusNotFound)
		return
	}
	serveGouoAssetContent(c, asset)
}

func UpdateGouoAdminStorageQuota(c *gin.Context) {
	userID, ok := gouoAdminUserParam(c)
	if !ok {
		return
	}
	var input struct {
		QuotaBytes int64 `json:"quota_bytes"`
	}
	if err := common.UnmarshalBodyReusable(c, &input); err != nil || input.QuotaBytes < 0 || input.QuotaBytes > 1<<40 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	used, _, err := model.GetGouoStorageUsage(userID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if input.QuotaBytes < used {
		common.ApiErrorT(c, "Storage quota cannot be lower than the space the user already uses")
		return
	}
	if err := model.SetGouoUserQuota(userID, input.QuotaBytes); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// ListGouoAdminImageCharges 列出图片预扣账本，可按用户、客户端请求号和状态筛选
func ListGouoAdminImageCharges(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	filter := model.GouoImageChargeFilter{Status: c.Query("status"), BelowRole: gouoAdminBelowRole(c)}
	if value := c.Query("user_id"); value != "" {
		userID, err := strconv.Atoi(value)
		if err != nil || userID < 1 {
			common.ApiErrorT(c, "Invalid user ID")
			return
		}
		filter.UserID = userID
	}
	if requestID := strings.TrimSpace(c.Query("request_id")); requestID != "" {
		// 客户端请求号按用户换算成账本 ID；不指定用户时按账本 ID 原样查
		filter.ID = requestID
		if filter.UserID > 0 && !gouoChargeIDPattern.MatchString(requestID) && len(requestID) <= 512 {
			filter.ID = model.GouoImageRequestID(filter.UserID, requestID)
		}
	}
	rows, total, err := model.ListGouoImageCharges(filter, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(rows)
	common.ApiSuccess(c, pageInfo)
}
