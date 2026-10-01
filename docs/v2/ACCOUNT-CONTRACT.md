# New API 原生账号入口与固定协议

本轮核对固定 SHA `0aec08fee811ec6136828fda790551b49e410301`，不升级上游、不创建账号或重写 IAM。Studio 账号面板优先链接同源 New API 原生 UI，复用其 Turnstile、密码加密、登录验证、MFA、passkey、注册和密码恢复流程。基础密码表单只适用于未启用额外验证的实例；不声称完整实现上游登录流程。

2026-10-01 prepared trial edge 的新增限制：全部公开 PUT `/api/user/self` 暂时拒绝，原生 language/sidebar setting 快照更新可覆盖账号付款偏好，造成试用误扣钱包。资料/安全页面读取仍可用，资料与密码提交须 T1.3 安全适配器；不要把页面可打开等同于修改完整可用。该 override 尚未应用到日常8080，原生日常入口保持原配置，详见 TRIAL.md。

已核对 `web/src/routes/` 与 `web/src/features/auth/hooks/use-auth-redirect.ts`：

| 操作 | 原生路由 |
| --- | --- |
| 登录并返回工作台 | `/sign-in?redirect=%2Fstudio%2F` |
| 注册 / 忘记密码 | `/sign-up` / `/forgot-password` |
| 资料 / 安全与会话 | `/profile` / `/security` |
| 生成令牌 | `/keys` |
| 余额充值 / 用量 | `/wallet` / `/usage-logs` |
| 用户管理（上游权限控制） | `/users` |

此 SHA 的原生前端使用上述路由；旧文档的 `/console` 不能作为其当前入口证据。登录页接受 `redirect`，并经 `sanitizeAuthRedirect` 限制为同源 HTTP(S) 地址；成功登录及已登录访问均可返回 `/studio/`。返回时 Studio 通过刷新 Cookie 恢复内存 access token。

协议证据为固定 SHA 的 `controller/user.go`、`controller/auth_session.go`、`service/auth_session.go` 和 `router/api-router.go`：

- 登录/刷新 bundle 含 `access_token`、`token_type`、Unix 秒 `access_expires_at`、`user` 与 `session.sid`；原生额外验证响应是 challenge，不能当成 bundle。
- `POST /api/user/auth/refresh` 读取 `new_api_refresh`；可携带 `X-Auth-Session`，返回轮换后的 bundle 和 Cookie。
- refresh Cookie 为 HttpOnly、Path `/api/user/auth`、SameSite Strict；Secure 取决于上游 `SessionCookieSecure`。`new_api_has_session=1` 是可读提示，不能用于鉴权。
- `POST /api/user/auth/logout` 可携带 Bearer 和 `X-Auth-Session`；上游可以返回 `revoked_sid` / `cookie_cleared`。`cookie_cleared:false` 表示 Bearer 会话已撤销但另一浏览器 Cookie 未被清除，Studio 不能显示完全退出成功。Cookie 与预期 SID 不符会失败；不自动退出或撤销另一个账号。
- Studio access token 仅驻留内存；账号查询缓存在成功退出后清除。读取遇 401 可刷新后读取一次；写操作不自动重放。

本轮验证：`cd v2 && npm run typecheck` 通过；`PLAYWRIGHT_BROWSERS_PATH=/tmp/gouo-playwright npx playwright test tests/studio.pw.mjs --workers=1` 8/8 通过。新增测试覆盖原生同源路由、原生登录返回后恢复，保留其他浏览器 Cookie 的退出响应，以及失效/禁用会话恢复为匿名并阻止业务写入；既有测试覆盖无效登录、失败退出、内存令牌、读取刷新和写入不重放。浏览器测试全部使用明确 fixture，未调用真实供应商、账号、邮件或支付。完整原生注册、MFA、邮件及充值实测仍依赖部署配置和单独授权。
