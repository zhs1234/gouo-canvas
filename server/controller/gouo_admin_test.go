package controller

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/gouo_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type gouoAdminResponse struct {
	Success    bool   `json:"success"`
	MessageKey string `json:"message_key"`
	Data       struct {
		Items []map[string]any `json:"items"`
		Total int              `json:"total"`
	} `json:"data"`
}

// callGouoAdmin 以指定管理员身份直接调用后台接口（鉴权中间件由 New API 自己的测试覆盖）
func callGouoAdmin(t *testing.T, handler gin.HandlerFunc, role int, method, target, body string, params gin.Params) gouoAdminResponse {
	t.Helper()
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(method, target, bytes.NewBufferString(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Params = params
	c.Set("id", 1)
	c.Set("role", role)
	handler(c)
	require.Equal(t, http.StatusOK, recorder.Code)
	var result gouoAdminResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &result))
	return result
}

func TestGouoAdminAPIs(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			driver := sqlite.Open(":memory:")
			switch dialect {
			case "mysql":
				if os.Getenv("TEST_MYSQL_DSN") == "" {
					t.Skip("TEST_MYSQL_DSN is not configured")
				}
				driver = mysql.Open(os.Getenv("TEST_MYSQL_DSN"))
			case "postgres":
				if os.Getenv("TEST_POSTGRES_DSN") == "" {
					t.Skip("TEST_POSTGRES_DSN is not configured")
				}
				driver = postgres.Open(os.Getenv("TEST_POSTGRES_DSN"))
			}
			db, err := gorm.Open(driver, &gorm.Config{Logger: logger.Discard})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			tables := []any{&model.User{}, &model.Option{}, &model.GouoImageCharge{}, &model.GouoAsset{}, &model.GouoTask{}, &model.GouoDocument{}, &model.GouoStorageQuota{}}
			require.NoError(t, db.Migrator().DropTable(tables...))
			require.NoError(t, db.AutoMigrate(tables...))
			previousDB, previousRedis, previousSetting, previousOptions := model.DB, common.RedisEnabled, *gouo_setting.Get(), common.OptionMap
			model.DB, common.RedisEnabled, common.OptionMap = db, false, map[string]string{}
			t.Cleanup(func() {
				model.DB, common.RedisEnabled, *gouo_setting.Get(), common.OptionMap = previousDB, previousRedis, previousSetting, previousOptions
				require.NoError(t, db.Migrator().DropTable(tables...))
				require.NoError(t, sqlDB.Close())
			})

			users := []model.User{
				{Username: "gouo-admin", Role: common.RoleAdminUser, AffCode: "a1"},
				{Username: "gouo-user", Role: common.RoleCommonUser, AffCode: "a2"},
				{Username: "gouo-peer", Role: common.RoleAdminUser, AffCode: "a3"},
			}
			for i := range users {
				users[i].Password, users[i].Status = "password123", common.UserStatusEnabled
				require.NoError(t, db.Create(&users[i]).Error)
			}
			common := users[1]
			for _, charge := range []model.GouoImageCharge{
				{ID: model.GouoImageRequestID(common.Id, "req-1"), UserID: common.Id, Quota: 100, Status: model.GouoChargeSettled, CreatedAt: 3},
				{ID: model.GouoImageRequestID(common.Id, "req-2"), UserID: common.Id, Quota: 100, Status: model.GouoChargeRefunded, CreatedAt: 2},
				{ID: model.GouoImageRequestID(users[2].Id, "req-3"), UserID: users[2].Id, Quota: 100, Status: model.GouoChargeSettled, CreatedAt: 1},
			} {
				require.NoError(t, db.Create(&charge).Error)
			}

			// 普通管理员只看得到权限比自己低的账号；root 看得到全部
			result := callGouoAdmin(t, ListGouoAdminImageCharges, 10, http.MethodGet, "/?p=1&page_size=10", "", nil)
			require.True(t, result.Success)
			assert.Equal(t, 2, result.Data.Total)
			assert.Equal(t, "gouo-user", result.Data.Items[0]["username"])
			assert.Equal(t, 3, callGouoAdmin(t, ListGouoAdminImageCharges, 100, http.MethodGet, "/", "", nil).Data.Total)
			// 分页、状态筛选、按客户端请求号筛选
			page := callGouoAdmin(t, ListGouoAdminImageCharges, 100, http.MethodGet, "/?p=2&page_size=1", "", nil)
			assert.Equal(t, 3, page.Data.Total)
			require.Len(t, page.Data.Items, 1)
			assert.Equal(t, model.GouoChargeRefunded, page.Data.Items[0]["status"])
			assert.Equal(t, 2, callGouoAdmin(t, ListGouoAdminImageCharges, 100, http.MethodGet, "/?status=settled", "", nil).Data.Total)
			byRequest := callGouoAdmin(t, ListGouoAdminImageCharges, 100, http.MethodGet, "/?request_id=req-2&user_id="+itoa(common.Id), "", nil)
			require.Equal(t, 1, byRequest.Data.Total)
			assert.Equal(t, model.GouoImageRequestID(common.Id, "req-2"), byRequest.Data.Items[0]["id"])

			// 设置：校验失败返回 message_key，部分更新只改出现的字段
			invalid := callGouoAdmin(t, UpdateGouoAdminSettings, 10, http.MethodPut, "/", `{"max_images_per_task":30}`, nil)
			assert.False(t, invalid.Success)
			assert.Equal(t, "Images per task must be an integer from {{min}} to {{max}}", invalid.MessageKey)
			notice := gouo_setting.Get().Notice
			require.True(t, callGouoAdmin(t, UpdateGouoAdminSettings, 10, http.MethodPut, "/", `{"max_images_per_task":3}`, nil).Success)
			assert.Equal(t, 3, gouo_setting.Get().MaxImagesPerTask)
			assert.Equal(t, notice, gouo_setting.Get().Notice)
			var saved model.Option
			require.NoError(t, db.Where(&model.Option{Key: "gouo_setting.max_images_per_task"}).First(&saved).Error)
			assert.Equal(t, "3", saved.Value)

			// 配额：不能管理同级账号，也不能低于已用空间
			peer := gin.Params{{Key: "id", Value: itoa(users[2].Id)}}
			denied := callGouoAdmin(t, UpdateGouoAdminStorageQuota, 10, http.MethodPut, "/", `{"quota_bytes":1048576}`, peer)
			assert.Equal(t, "No permission to manage users of the same or higher role", denied.MessageKey)
			require.NoError(t, db.Create(&model.GouoAsset{ID: "asset-1", UserID: common.Id, SHA256: "sha", StoragePath: "a.png", MimeType: "image/png", FileSize: 2048}).Error)
			target := gin.Params{{Key: "id", Value: itoa(common.Id)}}
			below := callGouoAdmin(t, UpdateGouoAdminStorageQuota, 10, http.MethodPut, "/", `{"quota_bytes":1024}`, target)
			assert.Equal(t, "Storage quota cannot be lower than the space the user already uses", below.MessageKey)
			require.True(t, callGouoAdmin(t, UpdateGouoAdminStorageQuota, 10, http.MethodPut, "/", `{"quota_bytes":4096}`, target).Success)
			storage := callGouoAdmin(t, ListGouoAdminStorageUsers, 10, http.MethodGet, "/?p=1&page_size=10", "", nil)
			require.Equal(t, 1, storage.Data.Total)
			assert.EqualValues(t, 4096, storage.Data.Items[0]["quota_bytes"])
			assert.EqualValues(t, 2048, storage.Data.Items[0]["used_bytes"])
		})
	}
}

func itoa(value int) string {
	data, _ := common.Marshal(value)
	return string(data)
}
