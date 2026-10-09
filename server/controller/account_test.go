package controller

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
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

func TestPasswordResetLinkEncodesEmail(t *testing.T) {
	oldAddress := config.ServerAddress
	t.Cleanup(func() { config.ServerAddress = oldAddress })
	config.ServerAddress = "https://canvas.example.com"
	link := passwordResetLink("name+tag@example.com", "token&1")
	parsed, err := url.Parse(link)
	require.NoError(t, err)
	require.Equal(t, "/user/reset", parsed.Path)
	// 浏览器按查询参数解析后必须得到原邮箱，"+" 不能变成空格
	require.Equal(t, "name+tag@example.com", parsed.Query().Get("email"))
	require.Equal(t, "token&1", parsed.Query().Get("token"))
}

func TestAdminQuotaAndBillingActionsRespectRoleScope(t *testing.T) {
	db := newAccountTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Token{}, &model.GouoImageCharge{}))
	for _, user := range []model.User{
		{Id: 1, Username: "root", Role: config.RoleRootUser},
		{Id: 2, Username: "admin", Role: config.RoleAdminUser},
		{Id: 3, Username: "admin2", Role: config.RoleAdminUser},
		{Id: 4, Username: "common", Role: config.RoleCommonUser},
	} {
		user.Password, user.Status, user.AccessToken, user.AffCode, user.Quota = "password", config.UserStatusEnabled, user.Username+"-token", user.Username, 1000
		require.NoError(t, db.Create(&user).Error)
		require.NoError(t, db.Create(&model.Token{Id: user.Id, UserId: user.Id, Name: "t", Key: user.Username + "-key", UnlimitedQuota: true}).Error)
		require.NoError(t, db.Create(&model.GouoImageCharge{ID: user.Username + "-charge", UserID: user.Id, TokenID: user.Id, Quota: 10, UnlimitedQuota: true, Status: model.GouoChargeReview}).Error)
	}
	call := func(role, actor int, method, path, target string, handler gin.HandlerFunc, body string) bool {
		router := gin.New()
		router.Handle(method, path, func(c *gin.Context) {
			c.Set("role", role)
			c.Set("id", actor)
			handler(c)
		})
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(method, target, bytes.NewReader([]byte(body))))
		var result struct {
			Success bool `json:"success"`
		}
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &result))
		return result.Success
	}
	changeQuota := func(role, actor int, userID string) bool {
		return call(role, actor, http.MethodPost, "/quota/:id", "/quota/"+userID, ChangeUserQuota, `{"quota":500}`)
	}
	resolve := func(role, actor int, chargeID string) bool {
		return call(role, actor, http.MethodPost, "/charges/:id/resolve", "/charges/"+chargeID+"/resolve", ResolveGouoImageCharge, `{"status":"refunded","note":"核对后退款"}`)
	}
	quota := func(id int) int {
		var user model.User
		require.NoError(t, db.First(&user, id).Error)
		return user.Quota
	}

	// 普通管理员不能调整 root、同级管理员或自己的额度
	require.False(t, changeQuota(config.RoleAdminUser, 2, "1"))
	require.False(t, changeQuota(config.RoleAdminUser, 2, "3"))
	require.False(t, changeQuota(config.RoleAdminUser, 2, "2"))
	require.Equal(t, 1000, quota(1))
	require.Equal(t, 1000, quota(2))
	require.True(t, changeQuota(config.RoleAdminUser, 2, "4"))
	require.Equal(t, 1500, quota(4))
	require.True(t, changeQuota(config.RoleRootUser, 1, "2"))

	// 普通管理员不能核对 root、同级管理员或自己的请求
	require.False(t, resolve(config.RoleAdminUser, 2, "root-charge"))
	require.False(t, resolve(config.RoleAdminUser, 2, "admin2-charge"))
	require.False(t, resolve(config.RoleAdminUser, 2, "admin-charge"))
	require.True(t, resolve(config.RoleAdminUser, 2, "common-charge"))
	require.True(t, resolve(config.RoleRootUser, 1, "admin-charge"))
	charge, err := model.GetGouoImageCharge("root-charge")
	require.NoError(t, err)
	require.Equal(t, model.GouoChargeReview, charge.Status)
}
