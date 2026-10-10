package controller

import (
	"context"
	"errors"
	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"net/http"
	"one-api/common/config"
	"one-api/common/logger"
	"one-api/common/oidc"
	"one-api/common/utils"
	"one-api/model"
)

func OIDCEndpoint(c *gin.Context) {
	if !config.OIDCAuthEnabled {
		c.JSON(http.StatusOK, gin.H{
			"message": "管理员未开启通过OIDC登录",
			"success": false,
		})
		return
	}
	oidcConfig, err := oidc.GetOIDCConfigInstance()
	if err != nil {
		logger.SysError("获取 OIDC 配置失败, err: " + err.Error())
		c.JSON(http.StatusOK, gin.H{
			"message": "获取 OIDC 配置失败",
			"success": false,
		})
		return
	}

	session := sessions.Default(c)
	state := utils.GetUUID()
	session.Set("oauth_state", state)
	loginURL := oidcConfig.LoginURL(state)
	err = session.Save()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    loginURL,
	})
}

// OIDCAuth 通过OIDC登录
// 首先通过OIDC ID进行登录、如果登录失败尝试使用USERNAME 进行登录（遵循用户禁用条件），如果OIDC ID和USERNAME都不存在则注册新用户（遵循是否开启注册功能条件）
func OIDCAuth(c *gin.Context) {
	if !config.OIDCAuthEnabled {
		c.JSON(http.StatusOK, gin.H{
			"message": "管理员未开启通过OIDC登录",
			"success": false,
		})
		return
	}

	// 验证state参数
	session := sessions.Default(c)
	state := c.Query("state")
	if state == "" || session.Get("oauth_state") == nil || state != session.Get("oauth_state").(string) {
		c.JSON(http.StatusForbidden, gin.H{
			"success": false,
			"message": "state is empty or not same",
		})
		return
	}

	// 获取OIDC配置
	oidcConfig, err := oidc.GetOIDCConfigInstance()
	if err != nil {
		logger.SysError("获取 OIDC 配置失败, err: " + err.Error())
		c.JSON(http.StatusOK, gin.H{
			"message": "获取 OIDC 配置失败",
			"success": false,
		})
		return
	}

	// 处理授权码并获取token
	code := c.Query("code")
	ctx := context.Background()
	token, err := oidcConfig.OAuth2Config.Exchange(ctx, code)
	if err != nil {
		c.String(http.StatusBadRequest, "Failed to exchange token: %v", err)
		return
	}

	// 验证ID Token
	idToken, err := oidcConfig.Verifier.Verify(ctx, token.Extra("id_token").(string))
	if err != nil {
		c.String(http.StatusBadRequest, "Failed to verify ID token: %v", err)
		return
	}

	// 检测OIDC用户ID
	if idToken.Subject == "" {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "ID Token 中没有 Subject",
		})
		return
	}

	// 解析用户信息
	claims := make(map[string]interface{})
	if err := idToken.Claims(&claims); err != nil {
		c.String(http.StatusBadRequest, "Failed to parse claims: %v", err)
		return
	}

	// 获取用户名
	userName, ok := claims[config.OIDCUsernameClaims].(string)
	if !ok || userName == "" {
		c.JSON(http.StatusOK, gin.H{
			"message": "用户没有OIDC登录权限",
			"success": false,
		})
		return
	}

	existing, err := getUserByOIDC(idToken.Subject, userName)
	if err != nil {
		if !errors.Is(err, errOIDCUsernameTaken) {
			logger.SysError("查询用户错误: " + err.Error())
		}
		c.JSON(http.StatusOK, gin.H{
			"message": err.Error(),
			"success": false,
		})
		return
	}
	if existing != nil {
		if existing.Status == config.UserStatusEnabled {
			setupLogin(existing, c)
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"message": "用户已被封禁或不存在",
			"success": false,
		})
		return
	}
	user := model.User{Username: userName, OidcId: idToken.Subject}

	// 注册新用户
	if !config.RegisterEnabled {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "管理员关闭了新用户注册",
		})
		return
	}

	// 检测邀请码
	var inviterId int
	affCode := c.Query("aff")
	if affCode != "" {
		inviterId, _ = model.GetUserIdByAffCode(affCode)
	}
	if inviterId > 0 {
		user.InviterId = inviterId
	}
	// 填充用户信息并创建账户
	// 只采用身份提供方已验证且未被占用的邮箱：未验证的邮箱可以占用他人邮箱，后续 GitHub 登录和重置密码都按邮箱匹配
	if email, ok := claims["email"].(string); ok && claims["email_verified"] == true && email != "" && !model.IsEmailAlreadyTaken(email) {
		user.Email = email
	}
	if displayName, ok := claims["displayName"].(string); ok {
		user.DisplayName = displayName
	}
	if avatarUrl, ok := claims["avatar"].(string); ok {
		user.AvatarUrl = avatarUrl
	}
	user.OidcId = idToken.Subject
	user.Role = config.RoleCommonUser
	user.Status = config.UserStatusEnabled

	if err := user.Insert(0); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	setupLogin(&user, c)
}

var errOIDCUsernameTaken = errors.New("该用户名已被本地账号使用，请联系管理员处理")

// getUserByOIDC 只按 OIDC subject 查找已绑定账号。用户名由身份提供方控制，
// 同名本地账号（包括 root）不能被未绑定的 OIDC 身份静默接管。
func getUserByOIDC(subject, username string) (*model.User, error) {
	user := model.User{OidcId: subject}
	err := user.FillUserByOidcId()
	if err == nil {
		return &user, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if model.IsUsernameAlreadyTaken(username) {
		return nil, errOIDCUsernameTaken
	}
	return nil, nil
}
