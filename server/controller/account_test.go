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
