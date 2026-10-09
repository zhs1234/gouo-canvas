package controller

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"one-api/common/config"
	"one-api/common/utils"
	"one-api/model"

	"github.com/gin-gonic/gin"
	"gorm.io/datatypes"
)

const gouoDocumentMaxBytes = 4 * 1024 * 1024

// 与前端 documentAssets.ts 保持一致；工具结果中的 JSON 文本不作为图片引用解析。
var gouoDocumentImageKeys = map[string]bool{
	"references": true, "imageId": true, "imageIds": true, "referenceImageIds": true,
	"inputImageIds": true, "outputImages": true, "maskImageId": true, "maskTargetImageId": true,
	"storageKey": true, "transparentOriginalImages": true, "streamPartialImageIds": true,
}

func collectGouoDocumentImageIDs(value any, key string, ids map[string]bool) {
	switch value := value.(type) {
	case string:
		if !gouoDocumentImageKeys[key] || value == "" {
			return
		}
		lower := strings.ToLower(value)
		for _, prefix := range []string{"data:", "blob:", "http:", "https:"} {
			if strings.HasPrefix(lower, prefix) {
				return
			}
		}
		ids[value] = true
	case []any:
		for _, child := range value {
			collectGouoDocumentImageIDs(child, key, ids)
		}
	case map[string]any:
		for name, child := range value {
			collectGouoDocumentImageIDs(child, name, ids)
		}
	}
}

type gouoDocumentInput struct {
	ClientID         string                    `json:"client_id"`
	Title            string                    `json:"title"`
	Document         json.RawMessage           `json:"document"`
	AssetIDs         []string                  `json:"asset_ids"`
	Assets           []model.GouoDocumentAsset `json:"assets"`
	ExpectedRevision *int64                    `json:"expected_revision"`
}

type gouoDocumentResponse struct {
	model.GouoDocument
	Assets []gouoAssetResponse `json:"assets"`
}

func gouoDocumentsToResponse(userID int, docs []model.GouoDocument) ([]gouoDocumentResponse, error) {
	ids := make([]string, 0)
	for _, doc := range docs {
		ids = append(ids, doc.AssetIDs...)
	}
	assets, err := model.GetGouoDocumentAssets(userID, uniqueStrings(ids))
	if err != nil {
		return nil, err
	}
	byID := make(map[string]model.GouoAsset, len(assets))
	for _, asset := range assets {
		byID[asset.ID] = asset
	}
	result := make([]gouoDocumentResponse, 0, len(docs))
	for _, doc := range docs {
		item := gouoDocumentResponse{GouoDocument: doc, Assets: make([]gouoAssetResponse, 0, len(doc.AssetLinks))}
		for _, link := range doc.AssetLinks {
			if asset, ok := byID[link.AssetID]; ok {
				item.Assets = append(item.Assets, gouoAssetToResponse(asset, link.ClientImageID, false))
			}
		}
		result = append(result, item)
	}
	return result, nil
}

func writeGouoDocument(c *gin.Context, doc model.GouoDocument) {
	items, err := gouoDocumentsToResponse(c.GetInt("id"), []model.GouoDocument{doc})
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "document_read_failed", "读取文档图片失败")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": items[0]})
}

// 按字段校验，避免用户提示词中提到 API key 也无法保存。
func validateGouoDocument(value any, depth int) bool {
	if depth > 40 {
		return false
	}
	switch value := value.(type) {
	case map[string]any:
		for key, child := range value {
			key = strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(key, "_", ""), "-", ""))
			switch key {
			case "apikey", "authorization", "accesstoken", "refreshtoken", "password", "secret", "credentials", "rawresponsepayload":
				return false
			}
			if !validateGouoDocument(child, depth+1) {
				return false
			}
		}
	case []any:
		for _, child := range value {
			if !validateGouoDocument(child, depth+1) {
				return false
			}
		}
	case string:
		if strings.Contains(strings.ToLower(value), "data:image/") || strings.HasPrefix(value, "blob:") {
			return false
		}
	}
	return true
}

func gouoDocumentKind(c *gin.Context) string {
	if strings.Contains(c.FullPath(), "/canvases") {
		return "canvas"
	}
	return "conversation"
}

func gouoDocumentEnabled(c *gin.Context) bool {
	if config.GouoCloudLibraryEnabled {
		return true
	}
	gouoFail(c, http.StatusServiceUnavailable, "cloud_library_disabled", "云端作品库暂未启用")
	return false
}

func PutGouoDocument(c *gin.Context) {
	if !gouoDocumentEnabled(c) {
		return
	}
	clientID := strings.TrimSpace(c.Param("id"))
	var input gouoDocumentInput
	decoder := json.NewDecoder(http.MaxBytesReader(c.Writer, c.Request.Body, gouoDocumentMaxBytes))
	if err := decoder.Decode(&input); err != nil {
		gouoFail(c, http.StatusBadRequest, "invalid_document", "文档无法识别或超过 4 MB")
		return
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF || clientID == "" || len(clientID) > 128 || (input.ClientID != "" && input.ClientID != clientID) || len([]rune(input.Title)) > 200 || input.ExpectedRevision == nil || *input.ExpectedRevision < 0 {
		gouoFail(c, http.StatusBadRequest, "invalid_document", "文档 ID、标题或版本无效")
		return
	}
	var document map[string]any
	if err := json.Unmarshal(input.Document, &document); err != nil || document["schemaVersion"] != float64(1) {
		gouoFail(c, http.StatusBadRequest, "unsupported_schema", "不支持的文档数据版本")
		return
	}
	if !validateGouoDocument(document, 0) {
		gouoFail(c, http.StatusBadRequest, "sensitive_document", "文档包含敏感字段、内嵌图片或过深嵌套；请先上传图片")
		return
	}
	assetIDs := uniqueStrings(input.AssetIDs)
	if len(input.AssetIDs) > 2000 || len(assetIDs) != len(input.AssetIDs) {
		gouoFail(c, http.StatusBadRequest, "invalid_document_assets", "文档图片关系重复或超过 2000 项")
		return
	}
	assetSet := make(map[string]bool, len(assetIDs))
	for _, id := range assetIDs {
		if len(id) != 32 {
			gouoFail(c, http.StatusBadRequest, "invalid_document_assets", "文档图片 ID 无效")
			return
		}
		assetSet[id] = true
	}
	links := make(map[string]bool, len(input.Assets))
	linkedIDs := make([]string, 0, len(input.Assets))
	for _, link := range input.Assets {
		if link.ClientImageID == "" || len(link.ClientImageID) > 128 || links[link.ClientImageID] {
			gouoFail(c, http.StatusBadRequest, "invalid_document_assets", "图片本地 ID 无效或重复")
			return
		}
		links[link.ClientImageID] = true
		linkedIDs = append(linkedIDs, link.AssetID)
	}
	if len(input.Assets) > 2000 || (len(input.Assets) > 0 && len(uniqueStrings(linkedIDs)) != len(assetIDs)) {
		gouoFail(c, http.StatusBadRequest, "invalid_document_assets", "图片映射与图片列表不一致")
		return
	}
	for _, id := range linkedIDs {
		if !assetSet[id] {
			gouoFail(c, http.StatusBadRequest, "invalid_document_assets", "图片映射与图片列表不一致")
			return
		}
	}
	references := make(map[string]bool)
	collectGouoDocumentImageIDs(document, "", references)
	for id := range references {
		if !links[id] {
			gouoFail(c, http.StatusBadRequest, "missing_document_asset", "文档图片引用缺少完整的云端素材映射")
			return
		}
	}
	doc := model.GouoDocument{ID: utils.GetUUID(), UserID: c.GetInt("id"), Kind: gouoDocumentKind(c), ClientID: clientID, Title: strings.TrimSpace(input.Title), Document: datatypes.JSON(input.Document), AssetIDs: datatypes.NewJSONSlice(assetIDs), AssetLinks: datatypes.NewJSONSlice(input.Assets)}
	if err := model.SaveGouoDocument(&doc, *input.ExpectedRevision, nil); err != nil {
		gouoDocumentWriteError(c, doc.Kind, doc.ClientID, err)
		return
	}
	writeGouoDocument(c, doc)
}

func gouoDocumentWriteError(c *gin.Context, kind, clientID string, err error) {
	if errors.Is(err, model.ErrGouoDocumentConflict) {
		current, readErr := model.GetGouoDocument(c.GetInt("id"), kind, clientID)
		if readErr == nil {
			var data any
			if current != nil {
				items, readErr := gouoDocumentsToResponse(c.GetInt("id"), []model.GouoDocument{*current})
				if readErr != nil {
					gouoFail(c, http.StatusInternalServerError, "document_read_failed", "读取冲突文档失败")
					return
				}
				data = items[0]
			}
			c.JSON(http.StatusConflict, gin.H{"success": false, "code": "document_conflict", "message": err.Error(), "data": data})
			return
		}
	}
	if errors.Is(err, model.ErrGouoDocumentAssets) {
		gouoFail(c, http.StatusForbidden, "asset_not_owned", err.Error())
		return
	}
	gouoFail(c, http.StatusInternalServerError, "document_save_failed", "同步文档失败")
}

func GetGouoDocument(c *gin.Context) {
	if !gouoDocumentEnabled(c) {
		return
	}
	doc, err := model.GetGouoDocument(c.GetInt("id"), gouoDocumentKind(c), c.Param("id"))
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "document_read_failed", "读取文档失败")
		return
	}
	if doc == nil {
		gouoFail(c, http.StatusNotFound, "document_not_found", "文档不存在")
		return
	}
	writeGouoDocument(c, *doc)
}

func ListGouoDocuments(c *gin.Context) {
	if !gouoDocumentEnabled(c) {
		return
	}
	limit, err := strconv.Atoi(c.DefaultQuery("limit", "100"))
	if err != nil || limit < 1 || limit > 100 {
		gouoFail(c, http.StatusBadRequest, "invalid_limit", "limit 必须在 1 到 100 之间")
		return
	}
	cursor := c.Query("cursor")
	// 带 hidden 参数时游标只用于翻页，不切换到增量同步模式。
	_, changed := c.Request.URL.Query()["cursor"]
	changed = changed && c.Query("hidden") == ""
	after, afterID, err := decodeGouoCursor(cursor)
	if err != nil {
		gouoFail(c, http.StatusBadRequest, "invalid_cursor", "同步游标无效")
		return
	}
	docs, err := model.ListGouoDocuments(c.GetInt("id"), gouoDocumentKind(c), changed, c.Query("hidden") == "true", after, afterID, limit+1)
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "document_read_failed", "读取云端文档失败")
		return
	}
	more := len(docs) > limit
	if more {
		docs = docs[:limit]
	}
	if len(docs) > 0 {
		last := docs[len(docs)-1]
		cursor = encodeGouoCursor(last.UpdatedAt, last.ID)
	}
	items, err := gouoDocumentsToResponse(c.GetInt("id"), docs)
	if err != nil {
		gouoFail(c, http.StatusInternalServerError, "document_read_failed", "读取文档图片失败")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"items": items, "next_cursor": cursor, "has_more": more}})
}

func HideGouoDocument(c *gin.Context)    { setGouoDocumentHidden(c, true) }
func RestoreGouoDocument(c *gin.Context) { setGouoDocumentHidden(c, false) }

func setGouoDocumentHidden(c *gin.Context, hidden bool) {
	if !gouoDocumentEnabled(c) {
		return
	}
	var input struct {
		ExpectedRevision *int64 `json:"expected_revision"`
	}
	if json.NewDecoder(http.MaxBytesReader(c.Writer, c.Request.Body, 1024)).Decode(&input) != nil || input.ExpectedRevision == nil || *input.ExpectedRevision < 1 {
		gouoFail(c, http.StatusBadRequest, "invalid_revision", "请提交文档当前版本")
		return
	}
	doc := model.GouoDocument{UserID: c.GetInt("id"), Kind: gouoDocumentKind(c), ClientID: c.Param("id")}
	if err := model.SaveGouoDocument(&doc, *input.ExpectedRevision, &hidden); err != nil {
		gouoDocumentWriteError(c, doc.Kind, doc.ClientID, err)
		return
	}
	writeGouoDocument(c, doc)
}
