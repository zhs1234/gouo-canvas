package middleware_test

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"one-api/common"
	"one-api/common/config"
	"one-api/common/logger"
	"one-api/controller"
	"one-api/middleware"
	"one-api/model"
)

func TestCredentialsRevokedAfterAccountChanges(t *testing.T) {
	oldDB, oldRedis, oldLogin, oldLogger := model.DB, config.RedisEnabled, config.PasswordLoginEnabled, logger.Logger
	oldMode := gin.Mode()
	t.Cleanup(func() {
		model.DB, config.RedisEnabled, config.PasswordLoginEnabled, logger.Logger = oldDB, oldRedis, oldLogin, oldLogger
		gin.SetMode(oldMode)
	})
	gin.SetMode(gin.TestMode)
	config.RedisEnabled, config.PasswordLoginEnabled, logger.Logger = false, true, zap.NewNop()
	db, err := gorm.Open(sqlite.Open(t.TempDir()+"/auth.db"), &gorm.Config{})
	require.NoError(t, err)
	conn, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { conn.Close() })
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Token{}))
	model.DB = db
	hash, err := common.Password2Hash("old-password")
	require.NoError(t, err)
	user := model.User{Id: 1, Username: "audit", Password: hash, Email: "audit@example.invalid", Role: config.RoleAdminUser, Status: config.UserStatusEnabled, AccessToken: "old-management-token"}
	require.NoError(t, db.Create(&user).Error)

	// 旧版签名令牌应兼容，但在密码变更后必须失效。
	oldSecret := viper.Get("user_token_secret")
	viper.Set("user_token_secret", "test-only-token-signing-secret")
	require.NoError(t, common.InitUserToken())
	t.Cleanup(func() { viper.Set("user_token_secret", oldSecret) })
	key, err := common.GenerateToken(1, user.Id)
	require.NoError(t, err)
	token := model.Token{Id: 1, UserId: user.Id, Name: "sys_playground", Key: key, UnlimitedQuota: true, ExpiredTime: -1}
	require.NoError(t, db.Session(&gorm.Session{SkipHooks: true}).Create(&token).Error)
	_, err = model.ValidateUserToken(key)
	require.NoError(t, err)

	r := gin.New()
	s := cookie.NewStore([]byte("test-only-cookie-signing-secret"))
	r.Use(sessions.Sessions("session", s))
	r.POST("/login", controller.Login)
	r.PUT("/password", middleware.UserAuth(), controller.ChangePassword)
	r.POST("/reset", controller.ResetPassword)
	r.GET("/admin", middleware.AdminAuth(), func(c *gin.Context) { c.String(200, "allowed") })
	r.GET("/user", middleware.UserAuth(), func(c *gin.Context) { c.String(200, "allowed") })
	r.GET("/optional", middleware.TrySetUserBySession(), func(c *gin.Context) { c.JSON(200, c.GetInt("id")) })
	r.GET("/token", middleware.UserAuth(), controller.GetPlaygroundToken)
	r.GET("/github-bind", controller.GitHubBind)
	r.GET("/lark-bind", controller.LarkBind)
	r.GET("/legacy", func(c *gin.Context) {
		session := sessions.Default(c)
		session.Set("id", 1)
		session.Set("username", "audit")
		require.NoError(t, session.Save())
	})
	request := func(method, path, body string, saved *http.Cookie) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if saved != nil {
			req.AddCookie(saved)
		}
		res := httptest.NewRecorder()
		r.ServeHTTP(res, req)
		return res
	}
	require.Equal(t, http.StatusUnauthorized, request("GET", "/admin", "", nil).Code)
	login := request("POST", "/login", `{"username":"audit","password":"old-password"}`, nil)
	require.Contains(t, login.Body.String(), `"success":true`)
	require.NotEmpty(t, login.Result().Cookies())
	saved := login.Result().Cookies()[0]
	require.Equal(t, "allowed", request("GET", "/admin", "", saved).Body.String())

	t.Run("demotion", func(t *testing.T) {
		require.NoError(t, db.Model(&model.User{}).Where("id = ?", user.Id).Update("role", config.RoleCommonUser).Error)
		require.Contains(t, request("GET", "/admin", "", saved).Body.String(), `"success":false`)
		require.Equal(t, "allowed", request("GET", "/user", "", saved).Body.String())
	})
	t.Run("ban", func(t *testing.T) {
		require.NoError(t, db.Model(&model.User{}).Where("id = ?", user.Id).Update("status", config.UserStatusDisabled).Error)
		for _, path := range []string{"/user", "/admin", "/github-bind", "/lark-bind"} {
			require.Equal(t, http.StatusUnauthorized, request("GET", path, "", saved).Code)
		}
		require.Equal(t, "0", request("GET", "/optional", "", saved).Body.String())
		_, err := model.ValidateUserToken(key)
		require.Error(t, err)
		require.NoError(t, db.Model(&model.User{}).Where("id = ?", user.Id).Update("status", config.UserStatusEnabled).Error)
	})
	t.Run("legacy-cookie", func(t *testing.T) {
		legacy := request("GET", "/legacy", "", nil).Result().Cookies()[0]
		require.Equal(t, http.StatusUnauthorized, request("GET", "/user", "", legacy).Code)
	})

	t.Run("password-and-token-rollback", func(t *testing.T) {
		require.NoError(t, db.Callback().Update().Before("gorm:update").Register("fail-token-rotation", func(tx *gorm.DB) {
			if tx.Statement.Table == "tokens" {
				tx.AddError(errors.New("simulated token write failure"))
			}
		}))
		res := request("PUT", "/password", `{"current_password":"old-password","new_password":"new-password"}`, saved)
		require.Equal(t, http.StatusInternalServerError, res.Code)
		require.NoError(t, db.Callback().Update().Remove("fail-token-rotation"))
		current, err := model.GetUserById(user.Id, true)
		require.NoError(t, err)
		require.Equal(t, hash, current.Password)
		require.Equal(t, user.AccessToken, current.AccessToken)
		_, err = model.ValidateUserToken(key)
		require.NoError(t, err)
		require.Equal(t, "allowed", request("GET", "/user", "", saved).Body.String())
	})

	changed := request("PUT", "/password", `{"current_password":"old-password","new_password":"new-password"}`, saved)
	require.Contains(t, changed.Body.String(), `"success":true`)
	require.NotEmpty(t, changed.Result().Cookies())
	renewed := changed.Result().Cookies()[0]
	require.Equal(t, http.StatusUnauthorized, request("GET", "/user", "", saved).Code)
	require.Equal(t, "allowed", request("GET", "/user", "", renewed).Body.String())
	require.Nil(t, model.ValidateAccessToken(user.AccessToken))
	// 改密前读取的资料对象不能在稍后更新时恢复旧管理令牌。
	user.Role = config.RoleCommonUser
	user.DisplayName = "updated"
	require.NoError(t, user.Update(false))
	require.Nil(t, model.ValidateAccessToken(user.AccessToken))
	_, err = model.ValidateUserToken(key)
	require.Error(t, err)
	rotated, err := model.GetTokenByName("sys_playground", user.Id)
	require.NoError(t, err)
	require.NotEqual(t, key, rotated.Key)
	require.Len(t, rotated.Key, 59)
	_, err = model.ValidateUserToken(rotated.Key)
	require.NoError(t, err)
	for i := 0; i < 2; i++ {
		require.Contains(t, request("GET", "/token", "", renewed).Body.String(), rotated.Key)
	}

	common.RegisterVerificationCodeWithKey(user.Email, "reset-code", common.PasswordResetPurpose)
	reset := request("POST", "/reset", `{"email":"audit@example.invalid","token":"reset-code","new_password":"reset-password"}`, nil)
	require.Contains(t, reset.Body.String(), `"success":true`)
	require.False(t, common.VerifyCodeWithKey(user.Email, "reset-code", common.PasswordResetPurpose))
	require.Equal(t, http.StatusUnauthorized, request("GET", "/user", "", renewed).Code)
	_, err = model.ValidateUserToken(rotated.Key)
	require.Error(t, err)
	newLogin := request("POST", "/login", `{"username":"audit","password":"reset-password"}`, nil)
	require.Contains(t, newLogin.Body.String(), `"success":true`)
	newCookie := newLogin.Result().Cookies()[0]
	tokenAfterReset, err := model.GetTokenByName("sys_playground", user.Id)
	require.NoError(t, err)
	_, err = model.ValidateUserToken(tokenAfterReset.Key)
	require.NoError(t, err)
	// 管理员改密也走同一事务，不能只修复用户自助入口。
	adminUpdate := model.User{Id: user.Id, Password: "admin-password"}
	require.NoError(t, adminUpdate.Update(true))
	require.Equal(t, http.StatusUnauthorized, request("GET", "/user", "", newCookie).Code)
	_, err = model.ValidateUserToken(tokenAfterReset.Key)
	require.Error(t, err)
	created := model.Token{UserId: user.Id, Name: "new-token", UnlimitedQuota: true, ExpiredTime: -1}
	require.NoError(t, created.Insert())
	require.Len(t, created.Key, 59)
	_, err = model.ValidateUserToken(created.Key)
	require.NoError(t, err)
	require.NoError(t, created.RegenerateKey())
	require.NoError(t, created.RegenerateKey())
	require.NoError(t, db.Delete(&model.User{}, user.Id).Error)
	require.Equal(t, http.StatusUnauthorized, request("GET", "/user", "", newCookie).Code)
	_, err = model.ValidateUserToken(created.Key)
	require.Error(t, err)
}
