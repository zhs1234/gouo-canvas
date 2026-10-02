# New API 原生账号入口与固定协议

> 2026-10-01 T1.10 补验：全新隔离真实 Native UI 走注册/登录→Studio 本人显示名→原生 security proof/改密→旧会话拒绝/当前 Cookie 恢复。第一次 CLI browser 在提交边界关闭，确认真实改密后才发第二个明确不同意图（非重放）；第二 verifyPOST/selfPUT 各一次200，同当前 context 完整刷新 refresh/self200。旧第二 context 和额外登录遭原生429，仍partial，未改限流或反复登录。RO auth_version3、旧三会话 password_changed 撤销、当前一活跃，0模型/资金。实际报告和限制见 QA_ACCEPTANCE_REPORT 顶部；不能用只读 metadata 替代未直接观察的浏览器401。

> 2026-10-01 T1.9增量：所有Studio页共享账户菜单/设置，私有 `PUT /api/studio/profile` 只允许本人显示名称，复用既有严格Native桥/只读确认，不改账号或资金权威。退出前真实保存、不reload；sameowner面板与单tab非秘密意图保护未知结果；登录/退出晚响应epoch核验。实际新随机固定Native、UI/整栈结果和限制见 [ACCOUNT-SETTINGS.md](ACCOUNT-SETTINGS.md)、STATUS顶部。prepared原精确selfPUT仍转Studio资料/密码proof白名单，未解封Nativesetting写。

核对固定 SHA `0aec08fee811ec6136828fda790551b49e410301`，不升级上游或重写 IAM。日常实例未创建账号；隔离 Native 测试使用独立合成账号。Studio 账号面板优先链接同源 New API 原生 UI，复用其 Turnstile、密码加密、登录验证、MFA、passkey、注册和密码恢复流程。基础密码表单只适用于未启用额外验证的实例；不声称完整实现上游登录流程。

T1.5b新增私有未知模型令牌续用恢复，限定相同稳定instanceId/本人owner/v2批准/proof，恢复审计与binding不涉及账号创建、密码或会话；原key409，完整模型key不读取/输出。首次没有Studio binding可在精确默认旧权限证据下CAS插入，不虚构旧绑定。仍须每次业务操作fresh原生鉴权，账号数字ID不能跨实例复用；详见 [TOKEN-RECOVERY.md](TOKEN-RECOVERY.md)。日常真实配置未启用，真实账号安全设置未改。

2026-10-01 T1.3：prepared trial edge 的精确 PUT `/api/user/self` 改由 Studio 安全桥接，只允许单独 `display_name`（1–20 Unicode 字符）或 `password`（8–128 Unicode 字符）及可选 `original_password`。用户名、owner、role、quota、group、setting、language/sidebar、登录加密 DTO、混合资料/密码字段均422，不达 Native PUT。原生 language/sidebar 全 setting 快照会覆盖付款偏好，因此仍拒绝。账号桥接与生成使用同 owner 串行屏障，另一个 owner 独立；密码和 proof 不写 Studio 数据库或日志。该 override 尚未应用到日常8080，详见 TRIAL.md。

密码修改继续经过原生 `/api/verify` 的 `account.password.change` / `account.password.set` 安全证明，再提交原始 Native DTO；桥接透传调用者 Bearer、`X-Security-Proof`、`X-Auth-Session`，不转发 Cookie 或共享 relay key。每次只发一个有界 PUT，原样保留 Native 状态、code 与旋转 bundle。原生密码修改返回 `access_token/token_type/access_expires_at/session/has_password/notification_warning`；当前 refresh secret 保持，旧 access token 和其它会话被撤销。网络/解析/不完整成功包均502并提示结果待确认、不重新提交。Native 500也可能发生在提交后，错误不等于密码未修改。

`node v2/tests/stack/account-native.cases.mjs` 两次退出0：固定真实 Native 验证显示名修改、setting 不变、非法字段0次 PUT、缺 proof403、真实加密验证取得 proof、密码旋转、旧JWT/其它会话401、同 proof失效、当前 Cookie/SID刷新、旧密码失败/新密码登录成功。无模型或金额操作。此为T1.3真实 HTTP 合同证据；邮件/MFA/passkey仍待验收，不能由API成功推导。

2026-10-01 T1.4 追加真实 CLI 浏览器：独立 Native 注册→加密登录→安全页 `account.password.change` proof→精确 PUT 改密→当前 Cookie 刷新200/另一context旧会话401→旧密码拒绝/新密码接受→Studio恢复。固定原生 `/profile` 没有显示名称编辑控件，因此新增Studio薄表单，只PUT本人 `display_name`，随后本人GET精确核对成功再更新session缓存；unknown写不重交，owner切换清空表单与结果。实际浏览器一次PUT200/GET200与NativeSQLite保存一致，无账号替身、模型或资金变更。

实际验收发现原生注册丢失redirect、原生客户端navigate到Studio停在Native404、Nginx `/studio` slash跳转附带容器8080导致跨测试origin。prepared edge现在 `absolute_redirect off`，Native HTML仅注入自有 `/studio/native-navigation.js`：缺redirect的auth入口默认Studio，登录/注册间保持目标，Native history去Studio时完整加载同源document。显式 `/security` 留在原生，外部redirect不由bridge执行；Native自己的权限/redirect安全验证仍保留。该脚本只修跨SPA导航，不重写原生账号流程或上游源码。真实Native CLI已复验注册到Studio自动Cookie恢复、同隔离端口与显式security目标；6个明确导航HTML fixture浏览器回归分列。证据 `.local/native-browser-T0RoAH/security-evidence.json`，脚本 `tests/stack/account-browser-isolation.mjs start|refresh-web|stop`，只管理本次随机项目。

已核对 `web/src/routes/` 与 `web/src/features/auth/hooks/use-auth-redirect.ts`：

| 操作 | 原生路由 |
| --- | --- |
| 登录并返回工作台 | `/sign-in?redirect=%2Fstudio%2F` |
| 注册 / 忘记密码 | `/sign-up` / `/forgot-password` |
| 资料 / 安全与会话 | `/profile` / `/security` |
| 生成令牌 | `/keys` |
| 余额充值 / 用量 | `/wallet` / `/usage-logs` |
| 用户管理（上游权限控制） | `/users` |

此 SHA 的原生前端使用上述路由；旧文档的 `/console` 不能作为其当前入口证据。登录页接受 `redirect`，并经 `sanitizeAuthRedirect` 限制为同源 HTTP(S) 地址；实际prepared入口需上述跨SPA脚本才能完整加载 `/studio/`。返回时 Studio 通过刷新 Cookie 恢复内存 access token。prepared公网 `/keys` 只允许masked model-token读取，写入/完整key关闭，有限续用改由Studio显式入口；`/users` 管理后台保持私有。`/api/user/token` 是Native security proof保护的账号PAT，不是model token。

协议证据为固定 SHA 的 `controller/user.go`、`controller/auth_session.go`、`service/auth_session.go` 和 `router/api-router.go`：

- 登录/刷新 bundle 含 `access_token`、`token_type`、Unix 秒 `access_expires_at`、`user` 与 `session.sid`；原生额外验证响应是 challenge，不能当成 bundle。
- `POST /api/user/auth/refresh` 读取 `new_api_refresh`；可携带 `X-Auth-Session`，返回轮换后的 bundle 和 Cookie。
- refresh Cookie 为 HttpOnly、Path `/api/user/auth`、SameSite Strict；Secure 取决于上游 `SessionCookieSecure`。`new_api_has_session=1` 是可读提示，不能用于鉴权。
- `POST /api/user/auth/logout` 可携带 Bearer 和 `X-Auth-Session`；上游可以返回 `revoked_sid` / `cookie_cleared`。`cookie_cleared:false` 表示 Bearer 会话已撤销但另一浏览器 Cookie 未被清除，Studio 不能显示完全退出成功。Cookie 与预期 SID 不符会失败；不自动退出或撤销另一个账号。
- Studio access token 仅驻留内存；账号查询缓存在成功退出后清除。读取遇 401 可刷新后读取一次；写操作不自动重放。

本轮验证：`cd v2 && npm run typecheck` 通过；`PLAYWRIGHT_BROWSERS_PATH=/tmp/gouo-playwright npx playwright test tests/studio.pw.mjs --workers=1` 8/8 通过。新增测试覆盖原生同源路由、原生登录返回后恢复，保留其他浏览器 Cookie 的退出响应，以及失效/禁用会话恢复为匿名并阻止业务写入；既有测试覆盖无效登录、失败退出、内存令牌、读取刷新和写入不重放。浏览器测试全部使用明确 fixture，未调用真实供应商、账号、邮件或支付。完整原生注册、MFA、邮件及充值实测仍依赖部署配置和单独授权。
