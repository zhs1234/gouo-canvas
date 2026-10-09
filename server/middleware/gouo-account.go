package middleware

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// GouoAccountMatch 拒绝页面所载账号与当前会话账号不一致的请求。
// 同源的后台面板可能在另一个标签页切换了登录账号，旧页面不能把本地数据写进新账号，也不能把新账号的数据读进旧账号的本地空间。
// 未带 X-Gouo-User 的调用方（后台面板、API 客户端）不受影响。
func GouoAccountMatch() gin.HandlerFunc {
	return func(c *gin.Context) {
		expected := c.GetHeader("X-Gouo-User")
		if expected == "" || expected == strconv.Itoa(c.GetInt("id")) {
			c.Next()
			return
		}
		c.AbortWithStatusJSON(http.StatusConflict, gin.H{
			"success": false,
			"message": "当前登录账号已在其他页面切换，请刷新页面",
			"data":    gin.H{"code": "account_mismatch"},
		})
	}
}
