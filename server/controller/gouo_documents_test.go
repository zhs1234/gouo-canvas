package controller

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"one-api/common/config"
	"one-api/model"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestGouoDocumentAPIValidationConflictAndAssets(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.GouoDocument{}, &model.GouoAsset{}, &model.GouoTask{}, &model.GouoStorageQuota{}))
	oldDB, oldEnabled := model.DB, config.GouoCloudLibraryEnabled
	model.DB, config.GouoCloudLibraryEnabled = db, true
	t.Cleanup(func() { model.DB, config.GouoCloudLibraryEnabled = oldDB, oldEnabled })
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "document-user", AccessToken: "document-token", AffCode: "document-aff"}).Error)
	require.NoError(t, db.Create(&model.User{Id: 2, Username: "document-other", AccessToken: "document-token-other", AffCode: "document-aff-other"}).Error)
	assetID := strings.Repeat("a", 32)
	require.NoError(t, db.Create(&model.GouoAsset{ID: assetID, UserID: 1, SHA256: "test-hash", MimeType: "image/png"}).Error)
	router := gin.New()
	router.Use(func(c *gin.Context) { id, _ := strconv.Atoi(c.GetHeader("X-Test-User")); c.Set("id", id) })
	for _, path := range []string{"/canvases", "/conversations"} {
		router.PUT(path+"/:id", PutGouoDocument)
		router.GET(path+"/:id", GetGouoDocument)
		router.GET(path, ListGouoDocuments)
		router.POST(path+"/:id/hide", HideGouoDocument)
		router.POST(path+"/:id/restore", RestoreGouoDocument)
	}
	request := func(method, path string, userID int, value any) *httptest.ResponseRecorder {
		data, err := json.Marshal(value)
		require.NoError(t, err)
		req := httptest.NewRequest(method, path, bytes.NewReader(data))
		req.Header.Set("X-Test-User", strconv.Itoa(userID))
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	input := map[string]any{"client_id": "project", "title": "画布", "document": map[string]any{"schemaVersion": 1, "nodes": []any{}}, "expected_revision": 0, "asset_ids": []string{assetID}, "assets": []any{map[string]string{"asset_id": assetID, "client_image_id": "local-image"}}}
	res := request("PUT", "/canvases/project", 1, input)
	require.Equal(t, http.StatusOK, res.Code, res.Body.String())
	require.Contains(t, res.Body.String(), `"client_image_id":"local-image"`)
	require.Contains(t, res.Body.String(), `/api/gouo/assets/`+assetID+`/content`)
	res = request("PUT", "/canvases/project", 1, input)
	require.Equal(t, http.StatusConflict, res.Code)
	require.Contains(t, res.Body.String(), `"revision":1`)
	require.Equal(t, http.StatusNotFound, request("GET", "/canvases/project", 2, nil).Code)
	require.Equal(t, http.StatusNotFound, request("GET", "/conversations/project", 1, nil).Code)
	require.Equal(t, http.StatusForbidden, request("PUT", "/conversations/project", 2, input).Code)
	res = request("POST", "/canvases/project/hide", 1, map[string]int{"expected_revision": 1})
	require.Equal(t, http.StatusOK, res.Code)
	require.Contains(t, request("GET", "/canvases", 1, nil).Body.String(), `"items":[]`)
	require.Contains(t, request("GET", "/canvases?cursor=", 1, nil).Body.String(), `"revision":2`)
	require.Equal(t, http.StatusConflict, request("POST", "/canvases/project/restore", 1, map[string]int{"expected_revision": 1}).Code)
	require.Equal(t, http.StatusOK, request("POST", "/canvases/project/restore", 1, map[string]int{"expected_revision": 2}).Code)
	// 后台关闭画布或 Agent 后不能再写入或恢复对应文档，仍可读取和移入回收站
	oldCanvas, oldAgent := config.GouoCanvasEnabled, config.GouoAgentEnabled
	config.GouoCanvasEnabled, config.GouoAgentEnabled = false, false
	t.Cleanup(func() { config.GouoCanvasEnabled, config.GouoAgentEnabled = oldCanvas, oldAgent })
	require.Contains(t, request("PUT", "/canvases/project", 1, input).Body.String(), "canvas_disabled")
	require.Contains(t, request("PUT", "/conversations/project", 1, input).Body.String(), "agent_disabled")
	require.Equal(t, http.StatusOK, request("GET", "/canvases/project", 1, nil).Code)
	require.Equal(t, http.StatusOK, request("POST", "/canvases/project/hide", 1, map[string]int{"expected_revision": 3}).Code)
	require.Equal(t, http.StatusForbidden, request("POST", "/canvases/project/restore", 1, map[string]int{"expected_revision": 4}).Code)
	config.GouoCanvasEnabled, config.GouoAgentEnabled = true, true
	require.Equal(t, http.StatusOK, request("POST", "/canvases/project/restore", 1, map[string]int{"expected_revision": 4}).Code)
	for _, document := range []any{
		map[string]any{"schemaVersion": 2},
		map[string]any{"schemaVersion": 1, "nodes": []any{map[string]any{"metadata": map[string]string{"imageId": "missing-image"}}}},
		map[string]any{"schemaVersion": 1, "settings": map[string]string{"api_key": "secret"}},
		map[string]any{"schemaVersion": 1, "image": "data:image/png;base64,a"},
		map[string]any{"schemaVersion": 1, "text": strings.Repeat("a", gouoDocumentMaxBytes)},
	} {
		input["document"] = document
		require.Equal(t, http.StatusBadRequest, request("PUT", "/canvases/project", 1, input).Code)
	}
	require.True(t, validateGouoDocument(map[string]any{"prompt": "如何保护 api_key？"}, 0))
	// 聊天文字和工具参数里提到 data:image/ 不能让整份文档永远存不上；整个值就是内嵌图片才拒绝
	require.True(t, validateGouoDocument(map[string]any{"messages": []any{
		map[string]any{"role": "user", "content": "CSS 里怎么写 background: url(data:image/png;base64,...)？"},
		map[string]any{"role": "assistant", "toolCalls": []any{map[string]any{"arguments": `{"src":"data:image/png;base64,AAAA"}`}}},
	}}, 0))
	require.False(t, validateGouoDocument(map[string]any{"image": "  DATA:image/png;base64,a"}, 0))
	require.False(t, validateGouoDocument(map[string]any{"image": "blob:https://example.test/1"}, 0))
	// MySQL 比较不区分大小写，大写 ID 会通过归属检查，但清理时按原样比较，图片会被当作未引用删掉
	upper := strings.ToUpper(assetID)
	input["document"] = map[string]any{"schemaVersion": 1, "nodes": []any{}}
	input["asset_ids"] = []string{upper}
	input["assets"] = []any{map[string]string{"asset_id": upper, "client_image_id": "local-image"}}
	require.Equal(t, http.StatusBadRequest, request("PUT", "/canvases/project", 1, input).Code)
}

func TestGouoDocumentReferencesIgnoreTextAndKeepNestedImages(t *testing.T) {
	ids := map[string]bool{}
	collectGouoDocumentImageIDs(map[string]any{
		"referenceImageIds": []any{"input", "HTTPS://example.test/image", "data:image/png,a"},
		"nodes":             []any{map[string]any{"metadata": map[string]any{"images": []any{map[string]any{"storageKey": "output"}}, "content": "imageId: not-an-image"}}},
		"toolCalls":         []any{map[string]any{"result": `{"imageId":"unrelated"}`}},
	}, "", ids)
	require.Equal(t, map[string]bool{"input": true, "output": true}, ids)
}

func TestGouoAgentDirectoryRequiresExplicitCapabilities(t *testing.T) {
	price := &model.Price{Model: "agent", Type: model.TokensPriceType}
	require.Nil(t, gouoAgentCapabilities(price))
	price.ModelInfo = &model.ModelInfoResponse{OutputModalities: []string{"text"}, InputModalities: []string{"text", "image"}}
	require.Nil(t, gouoAgentCapabilities(price))
	price.ModelInfo.Tags = []string{"tools"}
	entry := gouoAgentCapabilities(price)
	require.NotNil(t, entry)
	require.True(t, entry.Vision)
	require.True(t, entry.ToolCalls)
	price.GouoEnabled = true
	require.Nil(t, gouoAgentCapabilities(price))
}

func TestGouoSkillDocumentsFollowSkillSwitch(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.GouoDocument{}, &model.GouoAsset{}, &model.GouoTask{}, &model.GouoStorageQuota{}))
	oldDB, oldEnabled, oldAgent, oldSkills, oldImport := model.DB, config.GouoCloudLibraryEnabled, config.GouoAgentEnabled, config.GouoSkillsEnabled, config.GouoSkillImportEnabled
	model.DB, config.GouoCloudLibraryEnabled = db, true
	t.Cleanup(func() {
		model.DB, config.GouoCloudLibraryEnabled, config.GouoAgentEnabled, config.GouoSkillsEnabled, config.GouoSkillImportEnabled = oldDB, oldEnabled, oldAgent, oldSkills, oldImport
	})
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "skill-user", AccessToken: "skill-token", AffCode: "skill-aff"}).Error)
	router := gin.New()
	router.Use(func(c *gin.Context) { c.Set("id", 1) })
	for _, path := range []string{"/conversations", "/skills"} {
		router.PUT(path+"/:id", PutGouoDocument)
		router.GET(path+"/:id", GetGouoDocument)
		router.POST(path+"/:id/hide", HideGouoDocument)
	}
	request := func(method, path string, value any) *httptest.ResponseRecorder {
		data, err := json.Marshal(value)
		require.NoError(t, err)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(method, path, bytes.NewReader(data)))
		return rec
	}
	// 技能是独立的文档类型，正文里写到 password、data:image/ 这类字样也能保存
	input := map[string]any{"client_id": "skill", "title": "海报", "expected_revision": 0, "document": map[string]any{"schemaVersion": 1, "name": "poster", "body": "不要在提示词里写 password，也不要用 data:image/ 内嵌图片", "files": []any{map[string]string{"path": "references/a.md", "content": "资料"}}}}
	require.Equal(t, http.StatusOK, request("PUT", "/skills/skill", input).Code)
	require.Equal(t, http.StatusNotFound, request("GET", "/conversations/skill", nil).Code)
	require.Equal(t, http.StatusOK, request("GET", "/skills/skill", nil).Code)
	// 关闭导入后不能新建技能，已有技能仍可修改
	config.GouoSkillImportEnabled = false
	other := map[string]any{"client_id": "other", "title": "新技能", "expected_revision": 0, "document": map[string]any{"schemaVersion": 1, "name": "other", "body": "正文"}}
	require.Contains(t, request("PUT", "/skills/other", other).Body.String(), "skill_import_disabled")
	input["expected_revision"] = 1
	require.Equal(t, http.StatusOK, request("PUT", "/skills/skill", input).Code)
	config.GouoSkillImportEnabled = true
	config.GouoSkillsEnabled = false
	input["expected_revision"] = 2
	require.Contains(t, request("PUT", "/skills/skill", input).Body.String(), "skills_disabled")
	require.Equal(t, http.StatusOK, request("POST", "/skills/skill/hide", map[string]int{"expected_revision": 2}).Code)
	config.GouoSkillsEnabled, config.GouoAgentEnabled = true, false
	input["expected_revision"] = 3
	require.Contains(t, request("PUT", "/skills/skill", input).Body.String(), "agent_disabled")
}
