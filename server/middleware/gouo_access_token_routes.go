package middleware

// DeclareGouoSessionRoute 声明光构接口只接受登录会话，个人访问令牌一律拒绝；在注册路由时调用
func DeclareGouoSessionRoute(method, fullPath string) {
	accessTokenRouteRules[method+" "+fullPath] = accessTokenSessionRule
}
