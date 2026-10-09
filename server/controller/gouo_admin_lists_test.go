package controller

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"one-api/common/config"
	"one-api/model"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

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
