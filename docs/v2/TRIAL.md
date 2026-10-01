# T1 注册试用：原生资金与业务次数

2026-10-01 用户确认：每位符合条件的新用户 4 次聊天＋1 次生图。一次用户发送中的有限聊天工具循环算一次聊天，生图工具另占一次生图；当前单次最多 3 次聊天模型调用、1 张图片。采用 New API 原生一次性、零价格、有限额度的试用计划，代码与隔离测试先实现，真实金额、期限和入口安全配置暂不启用。

New API 仍是唯一账号、网关、金额与结算权威。Studio 的 `trial_grants` / `trial_reservations` 仅记录一次领取证据和非货币次数，不保存、计算或增减另一份钱包余额。这是一次性试用资金容器，商业月度会员仍是后续决策。

## 已实现的调用路径

1. 本人 Bearer 经 `/api/user/self` 鉴权，从上游得到 owner；不接收客户端 owner 或模型令牌。
2. 本人组模型与已验证本地模型相交。配置关闭、模型未验证或账号不符合条件时不领取、不发模型。
3. 第一次符合条件的发送读取本人 `/api/subscription/plans` 与 `/api/subscription/self`。计划必须与批准记录严格一致：零售价、有限正 quota、有限期限、只领一次、不重置、不溢出到钱包、不变更组。其它活跃订阅会被拒绝，因为上游预扣不接受 caller 指定 plan ID。
4. 无领取历史且 Studio 无旧领取记录，先保存领取意图，再由本人 POST `/api/subscription/balance/pay` 领取固定计划。HTTP 结果未知不再次购买；后续明确发送只能通过本人原生 receipt 恢复。
5. 每次真正模型提交前选择并确认严格来源：试用为 `subscription_only`，明确付款且该类别耗尽、已核实过期/退役或试用关闭时为 `wallet_only`。所有 user-token 钱包发送都要求本次 true，包括从未领取的成熟账号。不使用 first 偏好或自然回退。偏好 PUT 结果未知后阻断本人所有新的生成请求；一次 GET 读到预期值不能证明旧写入已结束，不能自动解除或重放 PUT。
6. 使用本人的有限 `gouo-studio` 令牌；令牌上限来自批准 cap 和已核验订阅剩余额度，钱包为零也可构造正的有限 cap。令牌 key 只驻留本次服务器内存，继承本人组、严格模型范围、关闭跨组重试。禁用/过期/耗尽令牌不自动续额或放宽权限。
7. 每次真实 SDK chat 或 Images fetch 前，再核验本人原生资金并持久保存提交意图。一次发送内后续 chat 调用复用该发送的一个聊天权益；图片另外占一个权益，直接 Images、image-only 和工具图片共用同一池。
8. 已完成结果可同 ID 重放；不重复领取、占次数或发模型。收到错误、断连、未知结果、后处理失败或重启时保留占用。只读对账不退款、不重新生成。

本地持久库现在先拿同路径 `.process-lock` SQLite 独占事务，再做重启恢复。第二进程拒绝启动，不能把活跃请求误标 unknown。进程退出或崩溃由 SQLite 释放锁；当前仍是单 API 副本，不是 Worker 或跨实例供应商 exactly-once。

## 本人状态与界面

`GET /api/studio/trial` 已鉴权且只读，不领取、不改偏好、不调用模型。返回 `state`、中文说明、chat/image 的 `limit/remaining/used/held` 与 `pendingReconciliation`；不返回 key、内部资金明细或其它账号记录。

状态包括 disabled、ineligible、eligible、active、exhausted、pending、unavailable、expired。原生 receipt 丢失或查询失败吞成空列表时，有本地旧 grant 的账号不会被显示为可首次领取。实例 UUID、plan 或 subscription ID 变化不能重置领取及次数。

聊天和画布的现有账号弹窗复用小 TrialPanel 与本人 TanStack Query；生成结束及刷新任务时重新查询。保留完整 assistant-ui、金额 BillingPanel、原生 `/wallet` 和 `/usage-logs`。不替换账号系统、画布引擎、旧草稿或原图。

T1.2 已接入三个发送入口的一次授权 checkbox「本次允许使用本人 New API 余额」：assistant-ui、Loomic Agent 和独立图片面板。默认不勾选，先捕获本次值再清除；换用户/会话清除，不持久化。未授权请求省略 `payWithBalance`，服务端 false 也规范为省略以兼容旧 hash；true 纳入幂等参数，同 ID 改付款意图 409。查询、Stop、错误或恢复不会再次发送。

聊天和图片分别优先使用剩余试用。聊天次数耗尽后，明确授权且本人原生 quota>0 才选钱包；剩余图片试用仍保留。每种类别在本次发送第一次实际调用时确定来源，其后聊天工具循环保持同来源，因此占掉第四次试用的工具总结仍免费。混合请求可以是钱包聊天→试用图片→钱包总结。付费调用不新增 trial reservation；每个 fetch 前持久化 `model_submissions` 的类别、模型与 `selectedFundingSource`，缺响应也保留意图。响应 `fundingSelection` 是选择意图，实际金额及来源必须通过真实 Native request_id 日志核验，不能拿它证明已扣费。

`funding_writes` 仅是本人账号全局偏好写入的安全状态，不是另一钱包。写前持久化 pending，单次 PUT 成功且读回确认才 confirmed；其余写结果 unknown。重启 pending→unknown，阻断所有新 ID/所有类别，已完成结果和本人历史仍可读。关闭试用后查询仍优先提示这一屏障。首次升级对旧 unknown claim 或没有响应证据的 unknown run 保守设屏障，可能包括其实只有模型失败的旧请求；没有旧写入证据时不能假设安全。建表、导入和恢复同事务，失败后可重试迁移。没有自动解锁或对外解锁接口；T1.3 提供本机停服、连续锁会话和实际 Native 进程重启证据的私有 CLI，见 [FUNDING-RECOVERY.md](FUNDING-RECOVERY.md)。恢复只记 reconciled，不确认偏好/收费，不改变旧模型 unknown 或 held 次数。

付费仍使用同一有限本人 token，不因充值自动续额/续期。每次钱包 fetch 前重新核验本人状态、组及余额；实际预扣/结算和不足拒绝由 New API 完成，正余额不是成本硬上限。已耗尽类别的付费路径只核验旧唯一 receipt，不查询当前计划；已知过期/退役/关闭时，本次 true 可以只用钱包，保留未使用次数，不重新领取。查询缺失/重复/格式错误仍拒绝，不把未知免费失败转成钱包回退。状态中的可选 `preservedRemaining` 只展示旧 active grant 已记录的未用次数，当前不可使用；无 grant 不展示已发放权益。

## 配置及对外入口门槛

默认 `GOUO_ENABLE_TRIAL=false`，不自动修改本机 `.env`、New API 设置或账号。`v2/config/trial-policy.example.json` 含占位值及 `operatorVerified=false`，不能直接使用。

私有政策必须明确固定 SHA、同 gateway origin、该安装固定 UUID、新用户最小账号 ID、plan ID、`relayIngress=studio-only`、批准的有限 quota/期限及全部计划字段。本人 DTO 无创建时间，因此最小 ID 是操作员为本安装确定的资格边界，不能假称注册日期证明；重建 New API 实例必须隔离 Studio 数据，不能复用 owner ID。

每用户模式另要求稳定 `GOUO_ACCOUNT_INSTANCE_ID` UUID；启用试用时可从批准政策 `instanceId` 取得，两者同时配置必须相等。关闭试用后仍提供同 UUID，不能撤掉绑定或给重建后的账号库接旧 Studio 卷。UUID不是秘密或原生账号标识，不由客户端提供，不代替 Native 鉴权。

必须同时核验普通模型路由记录、RetryTimes=0、本人组模型、有限 token cap/lifetime，以及真实模型协议证据。计划和令牌资金上限须覆盖全部允许输入/输出、预扣、最多 12 次聊天模型调用＋1 次图片的保守成本，不能用“五次预估价”代替上界。默认关闭不构成真实 4+1 可用承诺。

已准备 `v2/deploy/compose.trial-edge.yml` 与 `nginx.studio-only.conf`，**未应用到日常 8080 栈**。该入口采用固定 Native method/path 白名单；管理后台、未知 API、直接 relay、WebSocket、原生订阅购买与付款偏好写入、会清空付款偏好的 notification setting replacement 公开拒绝。T1.3 精确 PUT `/api/user/self` 只路由 Studio 显示名/密码白名单，带 query也走同适配器；setting/language/sidebar、owner/权限/额度、登录密文及混合字段422不达Native，编码/规范化别名404。保留原生 proof和轮换bundle，详见 [ACCOUNT-CONTRACT.md](ACCOUNT-CONTRACT.md)。New API / Studio 无宿主发布端口，Studio 容器内部仍可访问 Native；内部管理员或其它账号消费者也不能并行更改付款设置，这仍是明确启用门槛。

原生 UI/static 无调用者凭据、Cookie 或 upstream query，避免 Native NoRoute 的动态插件匹配利用网页请求带来的模型 key。插件占用 UI 路径可能导致 UI 401；这不是所有插件环境 UI 可用性的保证。普通账户 API 使用已登记固定路由，保留本人认证。原生管理操作需另设用户批准的私有入口，不能把测试配置当作完整公共管理后台。

配置准备方式（只有独立审批后才执行 up）：

```sh
docker compose --env-file v2/deploy/.env -f v2/deploy/compose.yml -f v2/deploy/compose.trial-edge.yml config --quiet
```

该 override 才向 Studio 传递试用开关与政策路径；文件挂载沿用私有 `/run/gouo`。`config` 校验不代表已经启用。真实计划额度、有效期、payment compliance、入口变更、供应商真实调用与价格须分别完成用户授权。不会代操作员确认原生 payment compliance 声明。

## 验证边界与下一步

2026-10-01：API 85/85、浏览器 53/53，通过次数、工具循环、并发、去重、跨户、重启、资金/receipt/实例轮换、未知结果等反例。真实 SDK 使用本地明确 fixture 回环模型；原生资金 HTTP DTO 单元测试用固定源码核验的 fixture。

追加 `node tests/stack/trial-native.cases.mjs` 退出0：真实固定版 Native＋当前 Studio＋本地替身供应商。普通测试用户钱包始终0，唯一零价有限订阅总额500000合成quota，4次发送产生5chat＋1image；六笔原生日志共560quota、本人used_quota560、订阅amount_used560、有限token剩余499440，Native SQLite落盘一致。每笔日志资金来源subscription、偏好subscription_only、wallet_quota_deducted=0，plan/subscription为本人唯一试用。第五次发送402、第二次原生购买拒绝，等待结算只读poll没有模型重发。本机脱敏证据在忽略的 `.local/native-trial-3un3gM/evidence.json`。

Native试验中的用户、金额价格、合规标记和凭据都是明确隔离合成测试数据，随机回环端口/独立SQLite，供应商监听本机loopback并拒绝匿名；采购成本0、真实付费供应商调用0。测试DB直接seed合规true/v1，不调用现实声明确认接口、不接受现实法律声明。此验收证明固定网关的原生资金合同与真实预扣/结算实现可用，不能替代真实渠道质量、采购价、成本上界或真实用户合规/安全配置。

独立 edge 验证实际运行真实 Nginx＋固定 New API 空库：账户 HTML/JS/CSS 可达；直接 relay/admin/未知路径、编码路径变体、WebSocket 与偏好写入拒绝；内部模型路由匿名 401，无模型请求。凭据/query 剥离另用明确 Node echo 契约验证。未初始化真实账号、确认真实合规声明、购买真实计划或调用付费模型。

T1.2 追加隔离原生验收退出0：保留第一个零钱包用户六笔订阅消费560；第二用户四次纯聊天后拒绝未授权第五次，seed 明确合成兑换码并走真实 Native `/api/user/topup` 兑换10000quota，然后授权混合请求钱包→订阅→钱包、授权图片钱包。第二用户八笔真实原生日志总1072，订阅消耗548、钱包消耗524、钱包剩9476，有限 token498928、ID/有效期不变；HTTP与Native SQLite一致。每次 provider 收到请求时只读检查 Studio提交意图已落盘。钱包日志没有 `wallet_quota_deducted` 字段，未把缺失当0，以真实余额变化和账单来源核对。最终证据 `.local/native-trial-2H4N1n/evidence.json`；两户共14次真实 Native relay，模型全部为本机替身，真实供应商费用0，合成兑换码不代表商户支付验收。

T1.3 追加真实固定 Native 验收两次退出0：保留原混合资金链，关闭 Studio 试用和更换批准计划后默认纯聊天各402，明确 true 各产生一笔 wallet_only 消费12quota；旧 grant/reservations快照不变、原 receipt仍唯一、token ID/期限不变。第二位用户最终钱包9452、订阅使用548、总用量1096、token498904、日志10条；两户共13chat＋3image，真实采购0。首次新增场景触发固定 Native `POST /api/token/2/key` 的默认 CriticalRateLimit（20/IP/20分钟），测试在原消费 settled 后显式重启隔离 Native清内存窗口、保留DB，使用新run ID；未修改限流或重发失败请求。证据 `.local/native-trial-s4CXmO/evidence.json`。其他真实账户/恢复/edge及完整测试结果见 STATUS 最新节。

下一项 T1.4：有限 token 到期/耗尽的可审查续用流程及原生资料/密码完整浏览器路径。真实计划与入口仍遵从暂不启用的用户决定；获批准后再验真实渠道、价格与费用上界。整体产品准备好之后，按 [QA_ACCEPTANCE.md](QA_ACCEPTANCE.md) 让多个子智能体分别模拟新用户、回访聊天、画布创作和跨账号访问，统计发现、复现条件、严重级别、修复和复验结果。

固定源码依据：[原生计划与本人接口](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/controller/subscription.go)、[一次领取及预扣](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/model/subscription.go)、[原生资金选择](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/service/billing_session.go)、[默认偏好](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/common/str.go)、[令牌认证](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/middleware/auth.go)。
