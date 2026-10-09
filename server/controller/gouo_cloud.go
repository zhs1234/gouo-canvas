package controller

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"one-api/common/config"
	"one-api/common/utils"
	"one-api/model"

	"github.com/gin-gonic/gin"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

var gouoAssetRoles = map[string]bool{
	"input":                true,
	"mask_target":          true,
	"mask":                 true,
	"output":               true,
	"thumbnail":            true,
	"partial":              true,
	"transparent_original": true,
}

type gouoAssetResponse struct {
	ID            string `json:"id"`
	ClientImageID string `json:"client_image_id,omitempty"`
	SHA256        string `json:"sha256"`
	MimeType      string `json:"mime_type"`
	FileSize      int64  `json:"file_size"`
	Width         int    `json:"width"`
	Height        int    `json:"height"`
	OriginalName  string `json:"original_name"`
	ContentURL    string `json:"content_url"`
	Deduplicated  bool   `json:"deduplicated,omitempty"`
}

type gouoTaskAssetInput struct {
	AssetID       string `json:"asset_id"`
	Role          string `json:"role"`
	Position      int    `json:"position"`
	ClientImageID string `json:"client_image_id"`
}

type gouoTaskInput struct {
	SchemaVersion   int                  `json:"schema_version"`
	Status          string               `json:"status"`
	Prompt          string               `json:"prompt"`
	Model           string               `json:"model"`
	Operation       string               `json:"operation"`
	Params          json.RawMessage      `json:"params"`
	ResultMeta      json.RawMessage      `json:"result_meta"`
	ErrorMessage    string               `json:"error_message"`
	ClientCreatedAt int64                `json:"client_created_at"`
	FinishedAt      int64                `json:"finished_at"`
	Assets          []gouoTaskAssetInput `json:"assets"`
	CollectionIDs   []string             `json:"collection_ids"`
}

type gouoTaskAssetResponse struct {
	AssetID       string            `json:"asset_id"`
	Role          string            `json:"role"`
	Position      int               `json:"position"`
	ClientImageID string            `json:"client_image_id"`
	Asset         gouoAssetResponse `json:"asset"`
}

type gouoTaskResponse struct {
	ID                    string                  `json:"id"`
	ClientTaskID          string                  `json:"client_task_id"`
	SchemaVersion         int                     `json:"schema_version"`
	Status                string                  `json:"status"`
	Prompt                string                  `json:"prompt"`
	Model                 string                  `json:"model"`
	Operation             string                  `json:"operation"`
	Params                json.RawMessage         `json:"params"`
	ResultMeta            json.RawMessage         `json:"result_meta"`
	ErrorMessage          string                  `json:"error_message"`
	ClientCreatedAt       int64                   `json:"client_created_at"`
	FinishedAt            int64                   `json:"finished_at"`
	CreatedAt             int64                   `json:"created_at"`
	UpdatedAt             int64                   `json:"updated_at"`
	HiddenAt              int64                   `json:"hidden_at"`
	Assets                []gouoTaskAssetResponse `json:"assets"`
	FavoriteCollectionIDs []string                `json:"favorite_collection_ids"`
}

func gouoFail(c *gin.Context, status int, code, message string) {
	c.JSON(status, gin.H{"success": false, "message": message, "code": code})
}

func gouoAssetToResponse(asset model.GouoAsset, clientImageID string, deduplicated bool) gouoAssetResponse {
	return gouoAssetResponse{
		ID:            asset.ID,
		ClientImageID: clientImageID,
		SHA256:        asset.SHA256,
		MimeType:      asset.MimeType,
		FileSize:      asset.FileSize,
		Width:         asset.Width,
		Height:        asset.Height,
		OriginalName:  asset.OriginalName,
		ContentURL:    "/api/gouo/assets/" + asset.ID + "/content",
		Deduplicated:  deduplicated,
	}
}

func gouoTaskToResponse(task model.GouoTask, favoriteIDs []string) gouoTaskResponse {
	assets := make([]gouoTaskAssetResponse, 0, len(task.Assets))
	for _, item := range task.Assets {
		assets = append(assets, gouoTaskAssetResponse{
			AssetID:       item.AssetID,
			Role:          item.Role,
			Position:      item.Position,
			ClientImageID: item.ClientImageID,
			Asset:         gouoAssetToResponse(item.Asset, item.ClientImageID, false),
		})
	}
	sort.Slice(assets, func(i, j int) bool {
		if assets[i].Role == assets[j].Role {
			return assets[i].Position < assets[j].Position
		}
		return assets[i].Role < assets[j].Role
	})
	return gouoTaskResponse{
		ID:                    task.ID,
		ClientTaskID:          task.ClientTaskID,
		SchemaVersion:         task.SchemaVersion,
		Status:                task.Status,
		Prompt:                task.Prompt,
		Model:                 task.Model,
		Operation:             task.Operation,
		Params:                json.RawMessage(task.Params),
		ResultMeta:            json.RawMessage(task.ResultMeta),
		ErrorMessage:          task.ErrorMessage,
		ClientCreatedAt:       task.ClientCreatedAt,
		FinishedAt:            task.FinishedAt,
		CreatedAt:             task.CreatedAt,
		UpdatedAt:             task.UpdatedAt,
		HiddenAt:              task.HiddenAt,
		Assets:                assets,
		FavoriteCollectionIDs: favoriteIDs,
	}
}

func gouoAdminTaskToResponse(task model.GouoTask, userID int) gouoTaskResponse {
	response := gouoTaskToResponse(task, nil)
	for i := range response.Assets {
		response.Assets[i].Asset.ContentURL = fmt.Sprintf(
			"/api/gouo/admin/storage/users/%d/assets/%s/content",
			userID,
			response.Assets[i].Asset.ID,
		)
	}
	return response
}

func GetGouoStorage(c *gin.Context) {
	userID := c.GetInt("id")
	used, count, err := model.GetGouoStorageUsage(userID)
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "storage_query_failed", "读取云端空间失败")
		return
	}
	quota, err := model.GetGouoUserQuota(userID, config.GouoAssetUserQuotaBytes)
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "storage_query_failed", "读取云端空间失败")
		return
	}
	remaining := quota - used
	if remaining < 0 {
		remaining = 0
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"enabled":         config.GouoCloudLibraryEnabled,
		"used_bytes":      used,
		"quota_bytes":     quota,
		"remaining_bytes": remaining,
		"asset_count":     count,
	}})
}

func UploadGouoAsset(c *gin.Context) {
	if !config.GouoCloudLibraryEnabled {
		gouoFail(c, http.StatusServiceUnavailable, "cloud_library_disabled", "云端作品库暂未启用")
		return
	}
	fileHeader, err := c.FormFile("file")
	if err != nil {
		gouoFail(c, http.StatusBadRequest, "file_required", "请选择要同步的图片")
		return
	}
	if fileHeader.Size > config.GouoAssetMaxFileBytes {
		gouoFail(c, http.StatusRequestEntityTooLarge, "file_too_large", "单张图片不能超过 25 MB")
		return
	}
	file, err := fileHeader.Open()
	if err != nil {
		gouoFail(c, http.StatusBadRequest, "file_open_failed", "无法读取图片")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, config.GouoAssetMaxFileBytes+1))
	if err != nil || int64(len(data)) > config.GouoAssetMaxFileBytes {
		gouoFail(c, http.StatusRequestEntityTooLarge, "file_too_large", "单张图片不能超过 25 MB")
		return
	}

	clientImageID := strings.TrimSpace(c.PostForm("client_image_id"))
	originalName := filepath.Base(strings.ReplaceAll(fileHeader.Filename, "\\", "/"))
	asset, deduplicated, err := model.SaveGouoAssetBytes(c.GetInt("id"), data, originalName, true)
	switch {
	case errors.Is(err, model.ErrGouoUnsupportedImage):
		gouoFail(c, http.StatusUnsupportedMediaType, "unsupported_image", err.Error())
	case errors.Is(err, model.ErrGouoInvalidImage):
		gouoFail(c, http.StatusBadRequest, "invalid_image", err.Error())
	case errors.Is(err, model.ErrGouoStorageQuota):
		gouoFail(c, http.StatusInsufficientStorage, "storage_quota_exceeded", "云端空间不足，本地作品不会受到影响")
	case err != nil:
		gouoFail(c, http.StatusInternalServerError, "storage_write_failed", "保存云端图片失败")
	default:
		c.JSON(http.StatusOK, gin.H{"success": true, "data": gouoAssetToResponse(*asset, clientImageID, deduplicated)})
	}
}

func GetGouoAssetContent(c *gin.Context) {
	asset, err := model.GetGouoAsset(c.GetInt("id"), c.Param("id"))
	if err != nil || asset == nil {
		gouoFail(c, http.StatusNotFound, "asset_not_found", "图片不存在")
		return
	}
	serveGouoAssetContent(c, asset)
}

func serveGouoAssetContent(c *gin.Context, asset *model.GouoAsset) {
	if c.GetHeader("If-None-Match") == `"`+asset.SHA256+`"` {
		c.Status(http.StatusNotModified)
		return
	}
	root, err := filepath.Abs(config.GouoAssetDir)
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "storage_path_invalid", "云端存储目录不可用")
		return
	}
	path := filepath.Join(root, filepath.Clean(asset.StoragePath))
	relative, err := filepath.Rel(root, path)
	if err != nil || strings.HasPrefix(relative, "..") || filepath.IsAbs(relative) {
		gouoFail(c, http.StatusInternalServerError, "storage_path_invalid", "图片存储路径无效")
		return
	}
	name := asset.OriginalName
	if name == "" {
		name = asset.ID + model.GouoAssetFormats[asset.MimeType]
	}
	c.Header("Cache-Control", "private, max-age=86400")
	c.Header("ETag", `"`+asset.SHA256+`"`)
	c.Header("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": name}))
	c.Header("Content-Type", asset.MimeType)
	c.Header("X-Content-Type-Options", "nosniff")
	c.File(path)
}

func PutGouoTask(c *gin.Context) {
	if !config.GouoCloudLibraryEnabled {
		gouoFail(c, http.StatusServiceUnavailable, "cloud_library_disabled", "云端作品库暂未启用")
		return
	}
	clientTaskID := strings.TrimSpace(c.Param("clientTaskId"))
	if clientTaskID == "" || len(clientTaskID) > 128 {
		gouoFail(c, http.StatusBadRequest, "invalid_task_id", "任务 ID 无效")
		return
	}
	var input gouoTaskInput
	decoder := json.NewDecoder(io.LimitReader(c.Request.Body, 512*1024))
	if err := decoder.Decode(&input); err != nil {
		gouoFail(c, http.StatusBadRequest, "invalid_task", "任务数据无法识别")
		return
	}
	if input.SchemaVersion != 1 {
		gouoFail(c, http.StatusBadRequest, "unsupported_schema", "不支持的任务数据版本")
		return
	}
	if input.Status == "running" {
		input.Status = "error"
		if input.ErrorMessage == "" {
			input.ErrorMessage = "页面关闭前任务尚未完成"
		}
	}
	if input.Status != "done" && input.Status != "error" {
		gouoFail(c, http.StatusBadRequest, "invalid_status", "任务状态无效")
		return
	}
	if input.Operation != "generation" && input.Operation != "edit" && input.Operation != "variation" {
		gouoFail(c, http.StatusBadRequest, "invalid_operation", "任务类型无效")
		return
	}
	if !json.Valid(input.Params) || !json.Valid(input.ResultMeta) {
		gouoFail(c, http.StatusBadRequest, "invalid_metadata", "任务参数不是有效 JSON")
		return
	}
	metadata := strings.ToLower(string(input.Params) + string(input.ResultMeta))
	for _, forbidden := range []string{"api_key", "apikey", "authorization", "rawresponsepayload", "raw_response_payload", "data:image/"} {
		if strings.Contains(metadata, forbidden) {
			gouoFail(c, http.StatusBadRequest, "sensitive_metadata", "任务数据包含禁止同步的敏感或大体积字段")
			return
		}
	}
	if len(input.Assets) > config.GouoAssetMaxTaskFiles {
		gouoFail(c, http.StatusBadRequest, "too_many_assets", "单个任务关联的图片过多")
		return
	}
	assetIDs := make([]string, 0, len(input.Assets))
	assetIDSet := map[string]bool{}
	assetSlotSet := map[string]bool{}
	outputCount := 0
	assets := make([]model.GouoTaskAsset, 0, len(input.Assets))
	for _, item := range input.Assets {
		if !gouoAssetRoles[item.Role] || item.AssetID == "" || item.Position < 0 {
			gouoFail(c, http.StatusBadRequest, "invalid_asset_link", "任务图片关系无效")
			return
		}
		if item.Role == "output" {
			outputCount++
		}
		slot := fmt.Sprintf("%s:%d", item.Role, item.Position)
		if assetSlotSet[slot] {
			gouoFail(c, http.StatusBadRequest, "duplicate_asset_slot", "任务图片位置重复")
			return
		}
		assetSlotSet[slot] = true
		if !assetIDSet[item.AssetID] {
			assetIDSet[item.AssetID] = true
			assetIDs = append(assetIDs, item.AssetID)
		}
		assets = append(assets, model.GouoTaskAsset{AssetID: item.AssetID, Role: item.Role, Position: item.Position, ClientImageID: item.ClientImageID})
	}
	if input.Status == "done" && outputCount == 0 {
		gouoFail(c, http.StatusBadRequest, "output_required", "成功任务至少需要一张输出图片")
		return
	}
	ownedAssets, err := model.CountOwnedGouoAssets(c.GetInt("id"), assetIDs)
	if err != nil || ownedAssets != int64(len(assetIDs)) {
		gouoFail(c, http.StatusForbidden, "asset_not_owned", "任务引用了不属于当前用户的图片")
		return
	}
	collectionIDs := uniqueStrings(input.CollectionIDs)
	ownedCollections, err := model.CountOwnedGouoCollections(c.GetInt("id"), collectionIDs)
	if err != nil || ownedCollections != int64(len(collectionIDs)) {
		gouoFail(c, http.StatusForbidden, "collection_not_owned", "任务引用了无效收藏夹")
		return
	}
	now := time.Now().UnixMilli()
	task := model.GouoTask{
		ID:              utils.GetUUID(),
		UserID:          c.GetInt("id"),
		ClientTaskID:    clientTaskID,
		SchemaVersion:   1,
		Status:          input.Status,
		Prompt:          input.Prompt,
		Model:           input.Model,
		Operation:       input.Operation,
		Params:          datatypes.JSON(input.Params),
		ResultMeta:      datatypes.JSON(input.ResultMeta),
		ErrorMessage:    input.ErrorMessage,
		ClientCreatedAt: input.ClientCreatedAt,
		FinishedAt:      input.FinishedAt,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if err := model.UpsertGouoTask(&task, assets, collectionIDs); err != nil {
		if errors.Is(err, model.ErrGouoOriginalAssetConflict) {
			gouoFail(c, http.StatusConflict, "original_asset_conflict", err.Error())
			return
		}
		if errors.Is(err, model.ErrGouoStorageQuota) {
			gouoFail(c, http.StatusInsufficientStorage, "storage_quota_exceeded", "云端空间不足，本地作品不会受到影响")
			return
		}
		gouoFail(c, http.StatusInternalServerError, "task_save_failed", "同步任务失败")
		return
	}
	saved, err := model.GetGouoTask(c.GetInt("id"), task.ID)
	if err != nil || saved == nil {
		gouoFail(c, http.StatusInternalServerError, "task_read_failed", "读取同步任务失败")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gouoTaskToResponse(*saved, collectionIDs)})
}

func uniqueStrings(items []string) []string {
	result := make([]string, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		item = strings.TrimSpace(item)
		if item != "" && !seen[item] {
			seen[item] = true
			result = append(result, item)
		}
	}
	return result
}

func encodeGouoCursor(updatedAt int64, id string) string {
	if updatedAt == 0 || id == "" {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf("v2:%d:%s", updatedAt, id)))
}

func decodeGouoCursor(value string) (int64, string, error) {
	if value == "" {
		return 0, "", nil
	}
	data, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return 0, "", err
	}
	parts := strings.Split(string(data), ":")
	if len(parts) == 2 && len(parts[1]) == 32 {
		// 旧游标混合了秒和毫秒，不能用于迁移后的增量拉取。
		if timestamp, err := strconv.ParseInt(parts[0], 10, 64); err == nil && timestamp > 0 {
			return 0, "", nil
		}
	}
	if len(parts) != 3 || parts[0] != "v2" || len(parts[2]) != 32 {
		return 0, "", fmt.Errorf("invalid cursor")
	}
	timestamp, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || timestamp <= 0 {
		return 0, "", fmt.Errorf("invalid cursor")
	}
	return timestamp, parts[2], nil
}

func gouoFavoriteMap(userID int) (map[string][]string, error) {
	items, err := model.ListGouoFavoriteItems(userID)
	if err != nil {
		return nil, err
	}
	result := map[string][]string{}
	for _, item := range items {
		result[item.TaskID] = append(result[item.TaskID], item.CollectionID)
	}
	return result, nil
}

func ListGouoTasks(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit < 1 || limit > 100 {
		gouoFail(c, http.StatusBadRequest, "invalid_limit", "limit 必须在 1 到 100 之间")
		return
	}
	updatedAt, id, err := decodeGouoCursor(c.Query("cursor"))
	if err != nil {
		gouoFail(c, http.StatusBadRequest, "invalid_cursor", "同步游标无效")
		return
	}
	tasks, err := model.ListGouoTasks(c.GetInt("id"), c.Query("hidden") == "true", updatedAt, id, limit)
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "task_query_failed", "读取云端画廊失败")
		return
	}
	favorites, err := gouoFavoriteMap(c.GetInt("id"))
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "favorite_query_failed", "读取云端收藏失败")
		return
	}
	data := make([]gouoTaskResponse, 0, len(tasks))
	for _, task := range tasks {
		data = append(data, gouoTaskToResponse(task, favorites[task.ID]))
	}
	nextCursor := ""
	if len(tasks) == limit {
		last := tasks[len(tasks)-1]
		nextCursor = encodeGouoCursor(last.UpdatedAt, last.ID)
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"data": data, "next_cursor": nextCursor}})
}

func GetGouoTask(c *gin.Context) {
	task, err := model.GetGouoTask(c.GetInt("id"), c.Param("id"))
	if err != nil || task == nil {
		gouoFail(c, http.StatusNotFound, "task_not_found", "云端任务不存在")
		return
	}
	favorites, err := gouoFavoriteMap(c.GetInt("id"))
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "favorite_query_failed", "读取云端收藏失败")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gouoTaskToResponse(*task, favorites[task.ID])})
}

func HideGouoTask(c *gin.Context) {
	setGouoTaskHidden(c, true)
}

func RestoreGouoTask(c *gin.Context) {
	setGouoTaskHidden(c, false)
}

func setGouoTaskHidden(c *gin.Context, hidden bool) {
	task, err := model.GetGouoTask(c.GetInt("id"), c.Param("id"))
	if err != nil || task == nil {
		gouoFail(c, http.StatusNotFound, "task_not_found", "云端任务不存在")
		return
	}
	if err := model.SetGouoTaskHidden(c.GetInt("id"), task.ID, hidden); err != nil {
		gouoFail(c, http.StatusInternalServerError, "task_update_failed", "更新云端任务失败")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func ListGouoCollections(c *gin.Context) {
	collections, err := model.ListGouoCollections(c.GetInt("id"), c.Query("hidden") == "true")
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "collection_query_failed", "读取云端收藏夹失败")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": collections})
}

func PutGouoCollection(c *gin.Context) {
	var input struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		gouoFail(c, http.StatusBadRequest, "invalid_collection", "收藏夹数据无效")
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || len([]rune(input.Name)) > 50 || len(c.Param("id")) > 128 {
		gouoFail(c, http.StatusBadRequest, "invalid_collection", "收藏夹名称必须为 1 到 50 个字符")
		return
	}
	now := time.Now().UnixMilli()
	collection := model.GouoFavoriteCollection{ID: c.Param("id"), UserID: c.GetInt("id"), Name: input.Name, CreatedAt: now, UpdatedAt: now}
	if existing, _ := model.GetGouoCollection(c.GetInt("id"), c.Param("id")); existing != nil {
		collection.CreatedAt = existing.CreatedAt
		collection.HiddenAt = existing.HiddenAt
	}
	if err := model.UpsertGouoCollection(&collection); err != nil {
		gouoFail(c, http.StatusInternalServerError, "collection_save_failed", "保存云端收藏夹失败")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": collection})
}

func HideGouoCollection(c *gin.Context) {
	setGouoCollectionHidden(c, true)
}

func RestoreGouoCollection(c *gin.Context) {
	setGouoCollectionHidden(c, false)
}

func setGouoCollectionHidden(c *gin.Context, hidden bool) {
	collection, err := model.GetGouoCollection(c.GetInt("id"), c.Param("id"))
	if err != nil || collection == nil {
		gouoFail(c, http.StatusNotFound, "collection_not_found", "收藏夹不存在")
		return
	}
	if err := model.SetGouoCollectionHidden(c.GetInt("id"), collection.ID, hidden); err != nil {
		gouoFail(c, http.StatusInternalServerError, "collection_update_failed", "更新收藏夹失败")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func AddGouoFavoriteItem(c *gin.Context) {
	setGouoFavoriteItem(c, true)
}

func RemoveGouoFavoriteItem(c *gin.Context) {
	setGouoFavoriteItem(c, false)
}

func setGouoFavoriteItem(c *gin.Context, add bool) {
	collection, err := model.GetGouoCollection(c.GetInt("id"), c.Param("id"))
	if err != nil || collection == nil || collection.HiddenAt > 0 {
		gouoFail(c, http.StatusNotFound, "collection_not_found", "收藏夹不存在")
		return
	}
	task, err := model.GetGouoTask(c.GetInt("id"), c.Param("taskId"))
	if err != nil || task == nil {
		gouoFail(c, http.StatusNotFound, "task_not_found", "云端任务不存在")
		return
	}
	if err := model.SetGouoFavoriteItem(c.GetInt("id"), collection.ID, task.ID, add); err != nil {
		gouoFail(c, http.StatusInternalServerError, "favorite_update_failed", "更新收藏失败")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

type gouoTaskMetaInput struct {
	Prompt          string              `json:"prompt"`
	Params          json.RawMessage     `json:"params"`
	ResultMeta      json.RawMessage     `json:"result_meta"`
	ClientCreatedAt int64               `json:"client_created_at"`
	ClientImageIDs  map[string][]string `json:"client_image_ids"`
	// 批量任务部分失败时，client_image_ids 各项对应的原始请求位置
	ClientImagePositions map[string][]int `json:"client_image_positions"`
	CollectionIDs        []string         `json:"collection_ids"`
}

// PatchGouoTaskMeta 补充服务端无法从请求里得知的作品信息；图片本身已在生成时由服务端保存。
func PatchGouoTaskMeta(c *gin.Context) {
	var input gouoTaskMetaInput
	if err := json.NewDecoder(io.LimitReader(c.Request.Body, 512*1024)).Decode(&input); err != nil {
		gouoFail(c, http.StatusBadRequest, "invalid_task_meta", "作品信息无法识别")
		return
	}
	if (len(input.Params) > 0 && !json.Valid(input.Params)) || (len(input.ResultMeta) > 0 && !json.Valid(input.ResultMeta)) {
		gouoFail(c, http.StatusBadRequest, "invalid_metadata", "作品参数不是有效 JSON")
		return
	}
	metadata := strings.ToLower(string(input.Params) + string(input.ResultMeta))
	for _, forbidden := range []string{"api_key", "apikey", "authorization", "rawresponsepayload", "raw_response_payload", "data:image/"} {
		if strings.Contains(metadata, forbidden) {
			gouoFail(c, http.StatusBadRequest, "sensitive_metadata", "作品信息包含禁止保存的敏感或大体积字段")
			return
		}
	}
	for role, ids := range input.ClientImageIDs {
		if !gouoAssetRoles[role] || len(ids) > config.GouoAssetMaxTaskFiles {
			gouoFail(c, http.StatusBadRequest, "invalid_asset_link", "作品图片关系无效")
			return
		}
		for _, id := range ids {
			if len(id) > 128 {
				gouoFail(c, http.StatusBadRequest, "invalid_asset_link", "作品图片关系无效")
				return
			}
		}
	}
	for role, positions := range input.ClientImagePositions {
		if len(positions) != len(input.ClientImageIDs[role]) {
			gouoFail(c, http.StatusBadRequest, "invalid_asset_link", "作品图片关系无效")
			return
		}
		for _, position := range positions {
			if position < 0 || position >= config.GouoAssetMaxTaskFiles {
				gouoFail(c, http.StatusBadRequest, "invalid_asset_link", "作品图片关系无效")
				return
			}
		}
	}
	var collectionIDs []string
	if input.CollectionIDs != nil {
		// 其他设备已删除的收藏夹直接忽略，不能让整条作品信息保存失败。
		collections, err := model.ListGouoCollections(c.GetInt("id"), false)
		if err != nil {
			gouoFail(c, http.StatusInternalServerError, "collection_query_failed", "读取收藏夹失败")
			return
		}
		visible := map[string]bool{}
		for _, collection := range collections {
			visible[collection.ID] = collection.HiddenAt == 0
		}
		collectionIDs = []string{}
		for _, id := range uniqueStrings(input.CollectionIDs) {
			if visible[id] {
				collectionIDs = append(collectionIDs, id)
			}
		}
	}
	task, err := model.UpdateGouoTaskMeta(c.GetInt("id"), c.Param("clientTaskId"), model.GouoTaskMeta{
		Prompt:               input.Prompt,
		Params:               datatypes.JSON(input.Params),
		ResultMeta:           datatypes.JSON(input.ResultMeta),
		ClientCreatedAt:      input.ClientCreatedAt,
		ClientImageIDs:       input.ClientImageIDs,
		ClientImagePositions: input.ClientImagePositions,
		CollectionIDs:        collectionIDs,
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		gouoFail(c, http.StatusNotFound, "task_not_found", "作品不存在")
		return
	}
	if err != nil || task == nil {
		gouoFail(c, http.StatusInternalServerError, "task_update_failed", "保存作品信息失败")
		return
	}
	favorites, err := gouoFavoriteMap(c.GetInt("id"))
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "favorite_query_failed", "读取收藏失败")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gouoTaskToResponse(*task, favorites[task.ID])})
}

func GetGouoAdminStorage(c *gin.Context) {
	summary, err := model.GetGouoStorageAdminSummary()
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "storage_query_failed", "读取光构存储统计失败")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"summary":             summary,
		"default_quota_bytes": config.GouoAssetUserQuotaBytes,
		"asset_dir":           config.GouoAssetDir,
	}})
}

func ListGouoAdminStorageUsers(c *gin.Context) {
	rows, err := model.ListGouoStorageUserUsage()
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "storage_query_failed", "读取用户存储统计失败")
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 100 {
		size = 20
	}
	start := (page - 1) * size
	if start > len(rows) {
		start = len(rows)
	}
	end := start + size
	if end > len(rows) {
		end = len(rows)
	}
	data := make([]gin.H, 0, end-start)
	for _, row := range rows[start:end] {
		quota, quotaErr := model.GetGouoUserQuota(row.UserID, config.GouoAssetUserQuotaBytes)
		if quotaErr != nil {
			gouoFail(c, http.StatusInternalServerError, "storage_query_failed", "读取用户存储配额失败")
			return
		}
		data = append(data, gin.H{"user_id": row.UserID, "username": row.Username, "used_bytes": row.UsedBytes, "quota_bytes": quota, "asset_count": row.AssetCount})
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"data": data, "page": page, "size": size, "total_count": len(rows)}})
}

// gouoAdminCanAccess 普通管理员只能管理权限比自己低的账号，与用户管理接口的范围一致。
func gouoAdminCanAccess(c *gin.Context, userID int) bool {
	myRole := c.GetInt("role")
	if myRole == config.RoleRootUser {
		return true
	}
	user, err := model.GetUserById(userID, false)
	return err == nil && user.Role < myRole
}

func ListGouoAdminUserTasks(c *gin.Context) {
	userID, err := strconv.Atoi(c.Param("id"))
	if err != nil || userID < 1 {
		gouoFail(c, http.StatusBadRequest, "invalid_user", "用户 ID 无效")
		return
	}
	if !gouoAdminCanAccess(c, userID) {
		gouoFail(c, http.StatusForbidden, "user_forbidden", "无权管理同级或更高等级用户的作品")
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 50 {
		size = 20
	}
	tasks, count, err := model.ListGouoAdminTasks(userID, page, size)
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "task_query_failed", "读取用户作品失败")
		return
	}
	data := make([]gouoTaskResponse, 0, len(tasks))
	for _, task := range tasks {
		data = append(data, gouoAdminTaskToResponse(task, userID))
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"data":        data,
		"page":        page,
		"size":        size,
		"total_count": count,
	}})
}

func GetGouoAdminUserAssetContent(c *gin.Context) {
	userID, err := strconv.Atoi(c.Param("id"))
	if err != nil || userID < 1 {
		gouoFail(c, http.StatusBadRequest, "invalid_user", "用户 ID 无效")
		return
	}
	if !gouoAdminCanAccess(c, userID) {
		gouoFail(c, http.StatusForbidden, "user_forbidden", "无权管理同级或更高等级用户的作品")
		return
	}
	asset, err := model.GetGouoAdminOutputAsset(userID, c.Param("assetId"))
	if err != nil || asset == nil {
		gouoFail(c, http.StatusNotFound, "asset_not_found", "生成图片不存在")
		return
	}
	serveGouoAssetContent(c, asset)
}

func UpdateGouoAdminStorageQuota(c *gin.Context) {
	userID, err := strconv.Atoi(c.Param("id"))
	if err != nil || userID < 1 {
		gouoFail(c, http.StatusBadRequest, "invalid_user", "用户 ID 无效")
		return
	}
	if !gouoAdminCanAccess(c, userID) {
		gouoFail(c, http.StatusForbidden, "user_forbidden", "无权管理同级或更高等级用户的作品")
		return
	}
	var input struct {
		QuotaBytes int64 `json:"quota_bytes"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || input.QuotaBytes < 0 {
		gouoFail(c, http.StatusBadRequest, "invalid_quota", "存储配额无效")
		return
	}
	used, _, err := model.GetGouoStorageUsage(userID)
	if err != nil || input.QuotaBytes < used {
		gouoFail(c, http.StatusBadRequest, "quota_below_usage", "存储配额不能低于用户当前已使用空间")
		return
	}
	if err := model.SetGouoUserQuota(userID, input.QuotaBytes); err != nil {
		gouoFail(c, http.StatusInternalServerError, "quota_update_failed", "更新用户存储配额失败")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
