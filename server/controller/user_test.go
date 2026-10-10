package controller

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"one-api/common/config"
	"one-api/common/logger"
	"one-api/model"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupUserTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	oldDB, oldRedis, oldLogger := model.DB, config.RedisEnabled, logger.Logger
	t.Cleanup(func() {
		model.DB, config.RedisEnabled, logger.Logger = oldDB, oldRedis, oldLogger
	})
	gin.SetMode(gin.TestMode)
	config.RedisEnabled, logger.Logger = false, zap.NewNop()
	db, err := gorm.Open(sqlite.Open(t.TempDir()+"/user.db"), &gorm.Config{})
	require.NoError(t, err)
	conn, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { conn.Close() })
	require.NoError(t, db.AutoMigrate(&model.User{}))
	model.DB = db
	return db
}

func serveAs(role int, method, path string, handler gin.HandlerFunc, target string) *httptest.ResponseRecorder {
	router := gin.New()
	router.Handle(method, path, func(c *gin.Context) {
		c.Set("role", role)
		handler(c)
	})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(method, target, nil))
	return response
}

func TestDeleteUserResponse(t *testing.T) {
	tests := []struct {
		name        string
		deleteError error
		success     bool
		message     string
		remaining   int64
	}{
		{name: "success", success: true, remaining: 0},
		{name: "failure", deleteError: errors.New("delete failed"), message: "delete failed", remaining: 1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := setupUserTestDB(t)

			if tt.deleteError != nil {
				require.NoError(t, db.Callback().Delete().Before("gorm:delete").Register("test:delete_error", func(db *gorm.DB) {
					db.AddError(tt.deleteError)
				}))
			}

			user := model.User{
				Username:    "delete-" + tt.name,
				Password:    "password",
				Role:        config.RoleCommonUser,
				Status:      config.UserStatusEnabled,
				AccessToken: fmt.Sprintf("delete-user-%s", tt.name),
			}
			require.NoError(t, db.Create(&user).Error)

			response := serveAs(config.RoleRootUser, http.MethodDelete, "/users/:id", DeleteUser, "/users/"+strconv.Itoa(user.Id))

			require.Equal(t, http.StatusOK, response.Code)
			var body struct {
				Success bool   `json:"success"`
				Message string `json:"message"`
			}
			require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
			require.Equal(t, tt.success, body.Success)
			require.Equal(t, tt.message, body.Message)

			var count int64
			require.NoError(t, db.Model(&model.User{}).Where("id = ?", user.Id).Count(&count).Error)
			require.Equal(t, tt.remaining, count)
		})
	}
}

func TestUserListAndDetailHideAccessTokens(t *testing.T) {
	db := setupUserTestDB(t)
	users := []model.User{
		{Id: 1, Username: "root", Role: config.RoleRootUser, AccessToken: "root-management-token"},
		{Id: 2, Username: "admin", Role: config.RoleAdminUser, AccessToken: "admin-management-token"},
		{Id: 3, Username: "admin2", Role: config.RoleAdminUser, AccessToken: "admin2-management-token"},
		{Id: 4, Username: "common", Role: config.RoleCommonUser, AccessToken: "common-management-token"},
	}
	for i := range users {
		users[i].Password = "password"
		users[i].AffCode = users[i].Username
		users[i].Status = config.UserStatusEnabled
		require.NoError(t, db.Create(&users[i]).Error)
	}

	listIDs := func(role int) []int {
		response := serveAs(role, http.MethodGet, "/users", GetUsersList, "/users?page=1&size=10")
		require.Equal(t, http.StatusOK, response.Code)
		require.NotContains(t, response.Body.String(), "management-token")
		var body struct {
			Success bool `json:"success"`
			Data    struct {
				Data []model.User `json:"data"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
		require.True(t, body.Success)
		ids := []int{}
		for _, user := range body.Data.Data {
			ids = append(ids, user.Id)
		}
		return ids
	}

	// 普通管理员只能看到比自己权限低的账号；root 能看到所有账号
	require.ElementsMatch(t, []int{4}, listIDs(config.RoleAdminUser))
	require.ElementsMatch(t, []int{1, 2, 3, 4}, listIDs(config.RoleRootUser))

	for _, id := range []int{1, 2, 4} {
		response := serveAs(config.RoleRootUser, http.MethodGet, "/users/:id", GetUser, "/users/"+strconv.Itoa(id))
		require.Equal(t, http.StatusOK, response.Code)
		require.Contains(t, response.Body.String(), `"success":true`)
		require.NotContains(t, response.Body.String(), "management-token")
	}
	response := serveAs(config.RoleAdminUser, http.MethodGet, "/users/:id", GetUser, "/users/1")
	require.Contains(t, response.Body.String(), `"success":false`)
	require.NotContains(t, response.Body.String(), "management-token")
}

func TestGitHubLoginIgnoresEmptyEmailAndZeroID(t *testing.T) {
	db := setupUserTestDB(t)
	// 默认 root 没有邮箱，也从未绑定 GitHub
	root := model.User{Id: 1, Username: "root", Password: "password", Role: config.RoleRootUser, Status: config.UserStatusEnabled, AccessToken: "root-token", AffCode: "root"}
	require.NoError(t, db.Create(&root).Error)
	bound := model.User{Id: 2, Username: "bound", Password: "password", Email: "bound@example.invalid", Role: config.RoleCommonUser, Status: config.UserStatusEnabled, AccessToken: "bound-token", AffCode: "bound"}
	require.NoError(t, db.Create(&bound).Error)

	user, err := getUserByGitHub(&GitHubUser{Id: 987654, Login: "stranger", Email: ""})
	require.NoError(t, err)
	require.Nil(t, user)

	user, err = getUserByGitHub(&GitHubUser{Id: 0, Login: "zero", Email: ""})
	require.NoError(t, err)
	require.Nil(t, user)

	// 已验证邮箱的自动绑定行为保持不变
	user, err = getUserByGitHub(&GitHubUser{Id: 123, Login: "bound-gh", Email: "bound@example.invalid"})
	require.NoError(t, err)
	require.NotNil(t, user)
	require.Equal(t, bound.Id, user.Id)
}

func TestOIDCLoginDoesNotTakeOverAccountsByUsername(t *testing.T) {
	db := setupUserTestDB(t)
	root := model.User{Id: 1, Username: "root", Password: "password", Role: config.RoleRootUser, Status: config.UserStatusEnabled, AccessToken: "root-token", AffCode: "root"}
	require.NoError(t, db.Create(&root).Error)
	bound := model.User{Id: 2, Username: "bound", Password: "password", OidcId: "subject-bound", Role: config.RoleCommonUser, Status: config.UserStatusEnabled, AccessToken: "bound-token", AffCode: "bound"}
	require.NoError(t, db.Create(&bound).Error)

	// 身份提供方把用户名声明设成 root，不能因此登录 root
	user, err := getUserByOIDC("subject-attacker", "root")
	require.ErrorIs(t, err, errOIDCUsernameTaken)
	require.Nil(t, user)
	var stored model.User
	require.NoError(t, db.First(&stored, root.Id).Error)
	require.Empty(t, stored.OidcId)

	user, err = getUserByOIDC("subject-bound", "renamed-at-idp")
	require.NoError(t, err)
	require.Equal(t, bound.Id, user.Id)

	user, err = getUserByOIDC("subject-new", "newcomer")
	require.NoError(t, err)
	require.Nil(t, user)
}

func TestGitHubLoginDoesNotMatchRenamedUsername(t *testing.T) {
	db := setupUserTestDB(t)
	// 受害者绑定时 GitHub 用户名为 alice（数字 ID 100），之后改名，alice 被他人注册（数字 ID 200）
	victim := model.User{Id: 1, Username: "victim", Password: "password", GitHubId: "alice", GitHubIdNew: 100, Status: config.UserStatusEnabled, AccessToken: "victim-token", AffCode: "victim"}
	require.NoError(t, db.Create(&victim).Error)
	legacy := model.User{Id: 2, Username: "legacy", Password: "password", GitHubId: "old-login", Status: config.UserStatusEnabled, AccessToken: "legacy-token", AffCode: "legacy"}
	require.NoError(t, db.Create(&legacy).Error)

	user, err := getUserByGitHub(&GitHubUser{Id: 200, Login: "alice"})
	require.NoError(t, err)
	require.Nil(t, user)

	// 尚未记录数字 ID 的旧绑定仍按用户名登录
	user, err = getUserByGitHub(&GitHubUser{Id: 300, Login: "old-login"})
	require.NoError(t, err)
	require.NotNil(t, user)
	require.Equal(t, legacy.Id, user.Id)
}

func TestChangePasswordCountsCharacters(t *testing.T) {
	setupUserTestDB(t)
	router := gin.New()
	router.POST("/password", func(c *gin.Context) {
		c.Set("id", 1)
		ChangePassword(c)
	})
	res := httptest.NewRecorder()
	// 4 个字符、8 个字节，不能绕过 8 位下限
	router.ServeHTTP(res, httptest.NewRequest(http.MethodPost, "/password", strings.NewReader(`{"current_password":"whatever","new_password":"密码12"}`)))
	require.Equal(t, http.StatusBadRequest, res.Code)
	require.Contains(t, res.Body.String(), "8 到 20 个字符")
}
