# 普通用户与原生计费闭环

固定 New API `0aec08fee811ec6136828fda790551b49e410301`，AGPLv3 + NOTICE，独立服务 HTTP 集成，不复制或重写其账号/钱包。原生页面入口与 JWT/refresh/退出契约见 [ACCOUNT-CONTRACT.md](ACCOUNT-CONTRACT.md)。未升级 rc.41，也不使用其新 scoped PAT 接口。

## 当前实现

2026-10-01 增量：[T1 注册试用、T1.2 付费续用、T1.3 独立钱包生命周期](TRIAL.md) 默认关闭，支持本人零钱包由原生一次性零价有限订阅供资；Studio 只限制 4 次发送＋1 次图片，不另造金额余额。真正启用须批准原生计划、cap/期限与 Studio-only 入口，并完成真实渠道验收。每用户模式所有钱包发送都要求本次 `payWithBalance:true`，包括从未领取的成熟账号与关闭试用的账号。剩余可用类别优先 subscription_only；耗尽或已核实过期/退役/关闭时，明确授权才选 wallet_only，旧领取与次数保留。授权发送后即清除，不存浏览器、不自动沿用。领取未知只能通过原生 receipt 恢复；付款偏好写入未知阻断本人所有新生成，GET一致不能自动解锁，避免旧写入晚到。

钱包核验只读本人 `/api/subscription/self`、旧 grant 的唯一历史 receipt、本人启用状态/组/正余额，不访问当前 `/plans`，不依赖已退役计划的价格/开关/ID。未知/缺失/重复/跨 owner 的旧 receipt 拒绝；有剩余免费次数时的计划查询异常也拒绝，不能借网络失败自动转钱包。每次实际 gateway fetch 前重验本人资金，选择并确认 wallet_only。独立有限 token 的禁用/期限/耗尽仍拒绝，不因钱包充值自动续额或续期。未知偏好的私有恢复见 [FUNDING-RECOVERY.md](FUNDING-RECOVERY.md)，不确认费用或重发旧请求。

原 personal 模式仍限定单一 `GOUO_RELAY_OWNER_ID`，不会因为多用户需求放开共享管理员令牌。新增显式 `user-token` 模式：Studio 每次用已验证的本人 Bearer 调用 `/api/user/self` 和 `/api/user/models?group=<本人组>`，仅显示配置且本组可用的模型；账号组与渠道必须在原生服务中正确配置。普通用户不追加管理员 `channelId` 后缀，模型由 New API 自己路由。账号和网关必须是同一实例；仍需固定版本/同网关 `RetryTimes=0` 核验记录，不静默降级或更换渠道。

第一次实际生成时，查询本人 `/api/token/search` 的唯一 `gouo-studio` 令牌。不存在时，按**操作员明确设置的有限额度上限与有效期** POST `/api/token/`，然后重新查询本人令牌 ID，再 POST `/api/token/:id/key`。固定版本创建仅返回 success/message，不假造 ID/key 响应。令牌继承本人组（group 空字符串）、仅允许当前已验证模型、关闭跨组重试。密钥仅在该请求服务器内存中，绝不存 Studio 数据库、日志或返回浏览器；无需另造加密密钥库。

New API 校验及扣除本人的钱包或已核验试用订阅与令牌额度，Studio 不加减第二份余额。令牌禁用/过期/耗尽、重复同名、owner 不符、unlimited、扩大模型/分组权限均拒绝，不自动续额、续期、提高角色或放宽权限。原生查询与取 key 均按当前 JWT 的本人权限执行；已撤销或禁用账号不能生成。没有符合严格条件的试用原生资金时，零/负钱包余额在调用前返回 402，不创建令牌、不发模型请求。

每个 run 可以发生多次对话/工具模型调用。Studio 保存 owner/kind/run 请求 ID、调用序号、New API request_id 与 HTTP 状态，并提供只读 `/api/studio/requests/:kind/:id` 核对；读取不生成、不退款、不改原去重状态。unknown 执行与 settled 费用可同时存在（例如扣费成功但素材处理失败）；无法确定的调用、缺 ID 或非成功 HTTP 仍 pending。SQLite 单实例守卫不是跨进程供应商 exactly-once；重启 unknown 与相同 ID 重放继续阻断。

账单不再隐去名为“模型测试”的本人消费。允许显示原生已结算负余额，人民币值是 quota_per_unit/usd_exchange_rate 的当前折算，并非供应商采购成本，也不是产品售价或严格预算保护。原生 trust_quota_usd、预扣与实际结算可能导致负余额；¥5 测试预算不能仅凭钱包/令牌余额保证。失败不等于退款、断开不等于取消，不自动重试未知生成或原生非幂等退款。

## 准备配置，保持关闭

只有具体批准原生用户/安全策略与令牌授权后，操作员才在私有运行环境启用：

```dotenv
GOUO_ENABLE_GENERATION=false
GOUO_RELAY_CREDENTIAL_MODE=user-token
GOUO_ACCOUNT_INSTANCE_ID=<本账号数据库稳定 UUID>
GOUO_RELAY_ROUTING_MODE=model
GOUO_NORMAL_ROUTING_EVIDENCE_FILE=/run/gouo/normal-routing.evidence.json
# 两项无默认商业值，批准后填写正整数；上限以原生 quota 单位计。
# GOUO_USER_TOKEN_QUOTA_CAP=<批准的额度上限>
# GOUO_USER_TOKEN_LIFETIME_SECONDS=<批准的有效秒数>
# 不设置共享 GOUO_RELAY_API_KEY(_FILE) 或 GOUO_RELAY_OWNER_ID。
```

注册启用、密码注册、邮箱验证/SMTP、Turnstile/MFA、默认组和组模型、注册赠额、价格/分组倍率、充值商户由原生界面管理。注册默认普通 role=1/group=default/赠额0，注册成功不自动登录、不自动有余额。用户尚未决定赠額、售价/利润、支付渠道；没有修改真实原生选项、赠额或支付。首次原生登录之后 HttpOnly refresh 同源恢复 Studio 会话，使用原生 sign-in 的 Studio 返回入口。

## 验收边界

CI 的三阶段整栈：真实固定版未初始化边界；原 personal 模式的管理员 owner 内存替身（固定渠道后缀只允许管理员）；全新普通用户注册默认0额度→明确 fixture-only 加额→真实 Nginx/Studio/SDK/SQLite→替身聊天/图片→本人三笔账单→画布重开；第二普通用户独立生成与隔离，另测无余额/无组模型/禁用/注销。测试 fixture 的额度/价格/令牌不是实际资金或真实凭据，`/api/fixture/account` 只存在于 fixture 容器。

真实原生注册条件/邮件验证/MFA/账号初始化、真实渠道组权限与供应商结算仍待批准后的验收，不能以 fixture 替代这些证据。默认入口仍 Loomic，不部署；最终 CI 与商业/真实验收阻塞见 STATUS/TASKS。

源码依据：[路由](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/router/api-router.go)、[本人模型与账号 DTO](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/controller/user.go)、[令牌创建/本人取 key](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/controller/token.go)、[普通用户禁止渠道后缀](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/middleware/auth.go)、[结算](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/service/billing_session.go)、[原生资金退款](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/service/funding_source.go)。
