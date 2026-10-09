package controller

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"one-api/common"
	"one-api/common/config"
	"one-api/common/logger"
	"one-api/model"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newAccountTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	oldDB, oldRedis, oldLogger := model.DB, config.RedisEnabled, logger.Logger
	t.Cleanup(func() { model.DB, config.RedisEnabled, logger.Logger = oldDB, oldRedis, oldLogger })
	gin.SetMode(gin.TestMode)
	config.RedisEnabled, logger.Logger = false, zap.NewNop()
	db, err := gorm.Open(sqlite.Open(t.TempDir()+"/account.db"), &gorm.Config{})
	require.NoError(t, err)
	conn, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { conn.Close() })
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Log{}))
	model.DB = db
	return db
}

func TestRegisterVerificationCodeIsSingleUse(t *testing.T) {
	db := newAccountTestDB(t)
	oldVerify, oldRegister, oldPassword, oldQuota := config.EmailVerificationEnabled, config.RegisterEnabled, config.PasswordRegisterEnabled, config.QuotaForNewUser
	t.Cleanup(func() {
		config.EmailVerificationEnabled, config.RegisterEnabled, config.PasswordRegisterEnabled, config.QuotaForNewUser = oldVerify, oldRegister, oldPassword, oldQuota
	})
	config.EmailVerificationEnabled, config.RegisterEnabled, config.PasswordRegisterEnabled, config.QuotaForNewUser = true, true, true, 0
	common.RegisterVerificationCodeWithKey("trial@example.invalid", "abc123", common.EmailVerificationPurpose)

	register := func(username, code string) bool {
		body, _ := json.Marshal(map[string]string{"username": username, "password": "password123", "email": "trial@example.invalid", "verification_code": code})
		router := gin.New()
		router.POST("/register", Register)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/register", bytes.NewReader(body)))
		var result struct {
			Success bool `json:"success"`
		}
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &result))
		return result.Success
	}

	require.True(t, register("first", "abc123"))
	// 同一邮箱和验证码不能再注册第二个账号
	require.False(t, register("second", "abc123"))
	common.RegisterVerificationCodeWithKey("trial@example.invalid", "def456", common.EmailVerificationPurpose)
	require.False(t, register("third", "def456"))
	var count int64
	require.NoError(t, db.Model(&model.User{}).Where("email = ?", "trial@example.invalid").Count(&count).Error)
	require.EqualValues(t, 1, count)
}

func TestConsumeCodeWithKeyOnlyOnce(t *testing.T) {
	common.RegisterVerificationCodeWithKey("bind@example.invalid", "code01", common.EmailVerificationPurpose)
	require.False(t, common.ConsumeCodeWithKey("bind@example.invalid", "wrong", common.EmailVerificationPurpose))
	require.True(t, common.ConsumeCodeWithKey("bind@example.invalid", "code01", common.EmailVerificationPurpose))
	require.False(t, common.ConsumeCodeWithKey("bind@example.invalid", "code01", common.EmailVerificationPurpose))
}

func TestGouoAdminWorkEndpointsRespectRoleScope(t *testing.T) {
	db := newAccountTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.GouoTask{}, &model.GouoTaskAsset{}, &model.GouoAsset{}, &model.GouoStorageQuota{}))
	for _, user := range []model.User{
		{Id: 1, Username: "root", Role: config.RoleRootUser},
		{Id: 2, Username: "admin", Role: config.RoleAdminUser},
		{Id: 3, Username: "admin2", Role: config.RoleAdminUser},
		{Id: 4, Username: "common", Role: config.RoleCommonUser},
	} {
		user.Password, user.Status, user.AccessToken, user.AffCode = "password", config.UserStatusEnabled, user.Username+"-token", user.Username
		require.NoError(t, db.Create(&user).Error)
	}
	call := func(role int, method, path, target string, handler gin.HandlerFunc, body string) int {
		router := gin.New()
		router.Handle(method, path, func(c *gin.Context) {
			c.Set("role", role)
			handler(c)
		})
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(method, target, bytes.NewReader([]byte(body))))
		return response.Code
	}
	tasks := func(role int, userID string) int {
		return call(role, http.MethodGet, "/users/:id/tasks", "/users/"+userID+"/tasks", ListGouoAdminUserTasks, "")
	}

	require.Equal(t, http.StatusForbidden, tasks(config.RoleAdminUser, "1"))
	require.Equal(t, http.StatusForbidden, tasks(config.RoleAdminUser, "3"))
	require.Equal(t, http.StatusOK, tasks(config.RoleAdminUser, "4"))
	require.Equal(t, http.StatusOK, tasks(config.RoleRootUser, "2"))
	require.Equal(t, http.StatusForbidden, call(config.RoleAdminUser, http.MethodGet, "/users/:id/assets/:assetId/content", "/users/1/assets/x/content", GetGouoAdminUserAssetContent, ""))
	require.Equal(t, http.StatusForbidden, call(config.RoleAdminUser, http.MethodPut, "/users/:id/quota", "/users/1/quota", UpdateGouoAdminStorageQuota, `{"quota_bytes":1}`))
}

func TestGouoAdminListsRespectRoleScope(t *testing.T) {
	db := newAccountTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.GouoTask{}, &model.GouoAsset{}, &model.GouoDocument{}, &model.GouoStorageQuota{}, &model.GouoImageCharge{}))
	for _, user := range []model.User{
		{Id: 1, Username: "root", Role: config.RoleRootUser},
		{Id: 2, Username: "admin", Role: config.RoleAdminUser},
		{Id: 3, Username: "admin2", Role: config.RoleAdminUser},
		{Id: 4, Username: "common", Role: config.RoleCommonUser},
	} {
		user.Password, user.Status, user.AccessToken, user.AffCode = "password", config.UserStatusEnabled, user.Username+"-token", user.Username
		require.NoError(t, db.Create(&user).Error)
		id := user.Username
		require.NoError(t, db.Create(&model.GouoAsset{ID: id, UserID: user.Id, SHA256: id, FileSize: 100}).Error)
		require.NoError(t, db.Create(&model.GouoImageCharge{ID: id, UserID: user.Id, Quota: 1, Status: model.GouoChargeReview}).Error)
	}
	call := func(role int, path, target string, handler gin.HandlerFunc) (int, []int) {
		router := gin.New()
		router.GET(path, func(c *gin.Context) {
			c.Set("role", role)
			handler(c)
		})
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, target, nil))
		var body struct {
			Data struct {
				Data []struct {
					UserID int `json:"user_id"`
				} `json:"data"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
		ids := []int{}
		for _, row := range body.Data.Data {
			ids = append(ids, row.UserID)
		}
		return response.Code, ids
	}

	// 普通管理员只能看到权限比自己低的账号；root 看到全部
	_, ids := call(config.RoleAdminUser, "/storage/users", "/storage/users", ListGouoAdminStorageUsers)
	require.ElementsMatch(t, []int{4}, ids)
	_, ids = call(config.RoleRootUser, "/storage/users", "/storage/users", ListGouoAdminStorageUsers)
	require.ElementsMatch(t, []int{1, 2, 3, 4}, ids)
	_, ids = call(config.RoleAdminUser, "/charges", "/charges?page=1&size=20", ListGouoAdminImageCharges)
	require.ElementsMatch(t, []int{4}, ids)
	_, ids = call(config.RoleRootUser, "/charges", "/charges?page=1&size=20", ListGouoAdminImageCharges)
	require.ElementsMatch(t, []int{1, 2, 3, 4}, ids)
	for _, target := range []string{"1", "2", "3"} {
		code, _ := call(config.RoleAdminUser, "/charges", "/charges?page=1&size=20&user_id="+target, ListGouoAdminImageCharges)
		require.Equal(t, http.StatusForbidden, code)
	}
	code, ids := call(config.RoleAdminUser, "/charges", "/charges?page=1&size=20&user_id=4", ListGouoAdminImageCharges)
	require.Equal(t, http.StatusOK, code)
	require.Equal(t, []int{4}, ids)
}
