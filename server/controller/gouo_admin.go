package controller

import (
	"net/http"
	"regexp"
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

// ListGouoAdminModels 列出 New API 原生模型里会出现在客户端的图片模型和 Agent 模型，供设置默认模型
func ListGouoAdminModels(c *gin.Context) {
	images, agents := gouoCatalog(nil)
	common.ApiSuccess(c, gin.H{"image_models": images, "agent_models": agents})
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
