package midjourney

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"one-api/common/config"
	"one-api/model"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestMidjourneyNotifyAndImageProxyBoundaries(t *testing.T) {
	gin.SetMode(gin.TestMode)
	oldDB, oldRedis := model.DB, config.RedisEnabled
	t.Cleanup(func() { model.DB, config.RedisEnabled = oldDB, oldRedis })
	config.RedisEnabled = false
	db, err := gorm.Open(sqlite.Open(t.TempDir()+"/mj.db"), &gorm.Config{})
	require.NoError(t, err)
	conn, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { conn.Close() })
	require.NoError(t, db.AutoMigrate(&model.Midjourney{}))
	model.DB = db

	var hits atomic.Int32
	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Write([]byte("INTERNAL-SECRET"))
	}))
	defer internal.Close()
	require.NoError(t, db.Create(&model.Midjourney{UserId: 1, MjId: "task-1", ImageUrl: "https://cdn.example.com/a.png", Progress: "100%"}).Error)

	notify := func(userID int, imageURL string) {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/mj/notify", strings.NewReader(`{"id":"task-1","imageUrl":"`+imageURL+`","progress":"100%","status":"SUCCESS"}`))
		c.Request.Header.Set("Content-Type", "application/json")
		c.Set("id", userID)
		RelayMidjourneyNotify(c)
	}
	imageURL := func() string {
		task := model.GetByOnlyMJId("task-1")
		require.NotNil(t, task)
		return task.ImageUrl
	}
	// 其他用户不能改写别人的任务
	notify(2, internal.URL)
	require.Equal(t, "https://cdn.example.com/a.png", imageURL())

	// 即使任务记录里是内网地址，无需登录的图片代理也不能去请求它
	notify(1, internal.URL)
	require.Equal(t, internal.URL, imageURL())
	res := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(res)
	c.Request = httptest.NewRequest(http.MethodGet, "/mj/image/task-1", nil)
	c.Params = gin.Params{{Key: "id", Value: "task-1"}}
	RelayMidjourneyImage(c)
	require.NotEqual(t, http.StatusOK, res.Code)
	require.NotContains(t, res.Body.String(), "INTERNAL-SECRET")
	require.Zero(t, hits.Load())
}
