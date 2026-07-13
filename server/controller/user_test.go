package controller

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"one-api/common/config"
	"one-api/model"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestDeleteUserResponse(t *testing.T) {
	gin.SetMode(gin.TestMode)
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
			db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
			require.NoError(t, err)
			require.NoError(t, db.AutoMigrate(&model.User{}))
			model.DB = db

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

			router := gin.New()
			router.DELETE("/users/:id", func(c *gin.Context) {
				c.Set("role", config.RoleRootUser)
				DeleteUser(c)
			})
			request := httptest.NewRequest(http.MethodDelete, "/users/"+strconv.Itoa(user.Id), nil)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)

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
