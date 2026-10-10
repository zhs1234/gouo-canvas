package middleware

import (
	"encoding/json"
	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"net/http"
	"net/url"
	"one-api/common/config"
	"one-api/common/logger"
	"time"
)

const turnstileValidSeconds = 10 * 60

type turnstileCheckResponse struct {
	Success bool `json:"success"`
}

func TurnstileCheck() gin.HandlerFunc {
	return func(c *gin.Context) {
		if config.TurnstileCheckEnabled {
			session := sessions.Default(c)
			// 校验结果只在短时间内有效：注册时发验证码与提交注册共用一次校验，但不能让一次校验长期复用（会话 Cookie 有效 30 天，可在其他 IP 重放）
			if checkedAt, ok := session.Get("turnstile_at").(int64); ok && time.Now().Unix()-checkedAt < turnstileValidSeconds {
				c.Next()
				return
			}
			response := c.Query("turnstile")
			if response == "" {
				c.JSON(http.StatusOK, gin.H{
					"success": false,
					"message": "Turnstile token 为空",
				})
				c.Abort()
				return
			}
			rawRes, err := http.PostForm("https://challenges.cloudflare.com/turnstile/v0/siteverify", url.Values{
				"secret":   {config.TurnstileSecretKey},
				"response": {response},
				"remoteip": {c.ClientIP()},
			})
			if err != nil {
				logger.SysError(err.Error())
				c.JSON(http.StatusOK, gin.H{
					"success": false,
					"message": err.Error(),
				})
				c.Abort()
				return
			}
			defer rawRes.Body.Close()
			var res turnstileCheckResponse
			err = json.NewDecoder(rawRes.Body).Decode(&res)
			if err != nil {
				logger.SysError(err.Error())
				c.JSON(http.StatusOK, gin.H{
					"success": false,
					"message": err.Error(),
				})
				c.Abort()
				return
			}
			if !res.Success {
				c.JSON(http.StatusOK, gin.H{
					"success": false,
					"message": "Turnstile 校验失败，请刷新重试！",
				})
				c.Abort()
				return
			}
			session.Set("turnstile_at", time.Now().Unix())
			err = session.Save()
			if err != nil {
				c.JSON(http.StatusOK, gin.H{
					"message": "无法保存会话信息，请重试",
					"success": false,
				})
				c.Abort()
				return
			}
		}
		c.Next()
	}
}
