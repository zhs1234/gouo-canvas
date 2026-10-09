package controller

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"one-api/common/config"
	"one-api/model"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestAdminTokenEndpointsRespectRoleScope(t *testing.T) {
	db := newAccountTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Token{}))
	for _, user := range []model.User{
		{Id: 1, Username: "root", Role: config.RoleRootUser},
		{Id: 2, Username: "admin", Role: config.RoleAdminUser},
		{Id: 3, Username: "admin2", Role: config.RoleAdminUser},
		{Id: 4, Username: "common", Role: config.RoleCommonUser},
	} {
		user.Password, user.Status, user.AccessToken, user.AffCode, user.Group = "password", config.UserStatusEnabled, user.Username+"-token", user.Username, "default"
		require.NoError(t, db.Create(&user).Error)
		require.NoError(t, db.Session(&gorm.Session{SkipHooks: true}).Create(&model.Token{Id: user.Id, UserId: user.Id, Name: user.Username, Key: fmt.Sprintf("key-%d", user.Id), Status: config.TokenStatusEnabled, ExpiredTime: -1, UnlimitedQuota: true}).Error)
	}
	call := func(role int, method, target string, handler gin.HandlerFunc, body string) map[string]any {
		router := gin.New()
		router.Handle(method, "/tokens", func(c *gin.Context) {
			c.Set("id", map[int]int{config.RoleRootUser: 1, config.RoleAdminUser: 2}[role])
			c.Set("role", role)
			handler(c)
		})
		res := httptest.NewRecorder()
		router.ServeHTTP(res, httptest.NewRequest(method, target, bytes.NewReader([]byte(body))))
		var out map[string]any
		require.NoError(t, json.Unmarshal(res.Body.Bytes(), &out))
		return out
	}
	owners := func(role int) []float64 {
		out := call(role, http.MethodGet, "/tokens?page=1&size=20", GetTokensListByAdmin, "")
		ids := []float64{}
		for _, row := range out["data"].(map[string]any)["data"].([]any) {
			ids = append(ids, row.(map[string]any)["user_id"].(float64))
		}
		return ids
	}
	// 普通管理员只能看到权限比自己低的账号的令牌（含明文 key）
	require.ElementsMatch(t, []float64{4}, owners(config.RoleAdminUser))
	require.ElementsMatch(t, []float64{1, 2, 3, 4}, owners(config.RoleRootUser))

	update := func(role, tokenID, userID int) bool {
		body := fmt.Sprintf(`{"id":%d,"user_id":%d,"name":"t","expired_time":-1,"unlimited_quota":true,"group":""}`, tokenID, userID)
		return call(role, http.MethodPut, "/tokens", UpdateTokenByAdmin, body)["success"] == true
	}
	ownerOf := func(id int) int {
		token, err := model.GetTokenById(id)
		require.NoError(t, err)
		return token.UserId
	}
	// 修改 root、同级管理员、自己的令牌被拒；把令牌转给 root 被拒
	require.False(t, update(config.RoleAdminUser, 1, 0))
	require.False(t, update(config.RoleAdminUser, 3, 0))
	require.False(t, update(config.RoleAdminUser, 2, 1))
	require.False(t, update(config.RoleAdminUser, 4, 1))
	require.Equal(t, 2, ownerOf(2))
	require.Equal(t, 4, ownerOf(4))
	// 普通用户的令牌可以正常修改；root 不受限制
	require.True(t, update(config.RoleAdminUser, 4, 0))
	require.True(t, update(config.RoleRootUser, 3, 0))
}
