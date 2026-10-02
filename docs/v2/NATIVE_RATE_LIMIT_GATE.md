# Native 限流启用决策门槛

2026-10-01，T1.6 源码核对与用户验收发现后的准备文档。本文只供后续用户批准具体方案，不执行配置变更，不授权部署。当前隔离验收的 Native 保持 `CRITICAL_RATE_LIMIT_ENABLE=true`、默认 **20／源 IP／1200 秒**、`TRUSTED_PROXIES=none`；没有降低限流、重启 Native 清空计数或修改日常实例。完成 setup、fixture 生成或本机 UI 验收均不表示公开服务已就绪。

## 固定实现与计数口径

唯一核对版本为 New API `0aec08fee811ec6136828fda790551b49e410301`。本机 flattened 源文件位于 `v2/.local/native-source`，缺失的代理初始化文件从该 SHA 的原始源码只读核对。

| 开关与环境变量 | 固定版默认值 | 实际范围 |
| --- | --- | --- |
| `CRITICAL_RATE_LIMIT_ENABLE` / `CRITICAL_RATE_LIMIT` / `CRITICAL_RATE_LIMIT_DURATION` | true / 20 / 1200 秒 | `CriticalRateLimit()` 的 CT 源 IP 桶；`UserCriticalRateLimit(scope)` 也读取同一组阈值，但按认证 owner＋scope 分桶 |
| `GLOBAL_API_RATE_LIMIT_ENABLE` / `GLOBAL_API_RATE_LIMIT` / `GLOBAL_API_RATE_LIMIT_DURATION` | true / 360 / 180 秒 | API router 的 GA 源 IP 桶，和 CT 同时生效 |
| `GLOBAL_WEB_RATE_LIMIT_ENABLE` / `GLOBAL_WEB_RATE_LIMIT` / `GLOBAL_WEB_RATE_LIMIT_DURATION` | true / 120 / 180 秒 | GW；不能据此假定已经解决 API 身份恢复或 Studio 内部流量 |
| `SEARCH_RATE_LIMIT_ENABLE` / `SEARCH_RATE_LIMIT` / `SEARCH_RATE_LIMIT_DURATION` | true / 10 / 60 秒 | `SearchRateLimit()` 按已认证 user ID 的 SR 桶 |

变量在启动 `InitEnv` 时读取，并非在运行中改一个账户 setting 就能调整。见固定 [common/init.go](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/common/init.go#L122-L137)。`CriticalRateLimit` 的内存 key 是 `mark + c.ClientIP()`；Redis 模式仍按 mark/IP，换 Redis 不会自动变成每用户。内存拒绝返回 429 与完整窗口 `Retry-After` 上界，不能把该数字当作准确剩余 TTL。见 [middleware/rate-limit.go](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/middleware/rate-limit.go#L127-L190)。本文不申请启用 Redis；现有试用／恢复合同仍要求 Redis、batch 关闭。

CT 的公开账户路由包括注册、登录、refresh、logout；token 的 `POST /api/token/:id/key` 也使用 CT。见 [账户路由](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/router/api-router.go#L75-L85)及[完整 key 读取路由](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/router/api-router.go#L273-L286)。密码加密公钥 GET 并未在该处附加 CT，但仍经过 GA。

**消费日志读取必须按注册次序核对。** `/api/log/self` 在第 319 行先注册，后面的 `logRoute.Use(CriticalRateLimit())` 仅影响随后注册的 `/api/log/token`。因此 Studio 使用的 `/api/log/self` 吃 GA，不能误算成 CT 20 次桶。见[固定 log 路由](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/router/api-router.go#L313-L349)。固定版使用 Gin v1.9.1，其路由注册时合并 handler chain；后加 Group.Use 不追改已注册路由。见 [固定 go.mod](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/go.mod)和 [Gin routergroup.go](https://github.com/gin-gonic/gin/blob/v1.9.1/routergroup.go#L64-L89)。这纠正了验收期间“key＋消费日志共同消耗 CT”的早期归纳。

## Studio 当前调用预算

下面是每个函数的正常执行路径，不含重登、额外 UI 查询、首次领取、资金偏好读写或未知核对等开销。拒绝／缺失日志不会自动重试。

| 当前 Studio 操作 | Native 请求数量 | 限流含义 |
| --- | --- | --- |
| `userRelay`，已有有效 token，一次用户发送 | token search 1 次＋完整 key POST 1 次 | search 吃 GA＋本人 SR；key 吃 GA＋共享 Studio 源 IP 的 CT |
| `userRelay`，首次没有 token | 上述基础上增加有限 token POST 1 次、search 1 次 | 创建路由未额外挂 CT；不能重试模糊创建 |
| 一次工具发送有 N 个实际模型响应 | `recordedUsage` 读 status 1 次＋精确本人 consume log N 次 | GA；聊天→图片→聊天 N=3 时查 3 次日志，但不会因此取 3 次 key |
| 账户费用面板一次查询 | status、pricing、本人最近 consume log，各 1 次 | GA；不是 CT，也不是资金结算写入 |
| `readStudioToken` 一次权限查询 | exact-name search 1 次＋exact-ID GET 1 次 | GA，search 另有本人 SR |
| status1 零额度退休证明 | 上述核验基础上完整 key POST 1 次、Native `/v1/models` 鉴权拒绝、再次 token 核验 | key 有 CT；模型列表证明不请求 provider；不能自动重试证明或创建 |

实现见 `v2/apps/api/src/user-relay.mjs:29`、`billing.mjs:58,88`、`relay-access.mjs:34,66` 及 server 的一次 `userRelay` 后工具循环。key 仅在服务器内存，不建议为躲避限流持久保存 key，亦不能跳过资金／权限核验或减少完整唯一日志证据。

在当前 `TRUSTED_PROXIES=none` 拓扑下，浏览器账户 API 经 web 容器进入 Native，共享 web 的源 IP；Studio 的所有 owner 经同一 API 容器进入 Native，共享 Studio 的源 IP。所以二十次注册／登录／恢复不是“每个用户二十次”；二十次完整 key 获取也不是“每个 owner 二十次”。日志 N 次虽不消耗 CT，仍叠加到共享 GA 预算。试用发送次数、Native 模型用量与 HTTP 限流次数是三种不同统计。

T1.6 四角色已经实测共享账户 CT 触发 429。新版身份 gate 显示等待与手动恢复，业务写不重放，草稿保持挂载；这改善错误恢复，不增加服务器容量。不能通过 Native 重启、批量注册更换 IP、自动 refresh 循环或提高参数来把 blocked 统计为通过。

## 代理信任边界

固定 `TRUSTED_PROXIES` 为空时默认信任 loopback、RFC1918 和 IPv6 ULA；明确 `none` 返回空可信代理集；显式 IP/CIDR 列表取代默认值，不与默认值合并。无效列表由 Gin 校验后阻止启动。见 [common/trusted_proxies.go](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/common/trusted_proxies.go)及 [middleware/trusted_proxies.go](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/middleware/trusted_proxies.go)。[main.go](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/main.go#L165-L170) 与 plugin router 均应用该配置。

prepared edge 的账户与 Studio API 当前把 X-Forwarded-For **覆盖为 edge 看到的 `$remote_addr`**，不沿用客户端输入链。`none` 时 Native 不信任这个头，仍识别 socket 对端。将 Native 改为仅信任固定 edge IP 后，浏览器流量才能按 edge 证实的客户端 IP 分桶；如果 edge 自身在另一个代理后面，`$remote_addr` 仍可能只是那个代理，必须另外审查最外层来源，不能假定已得到真实用户 IP。

不能信任 `0.0.0.0/0`、任意 XFF、整段包含可注入请求的容器网络，或为每 owner 编造 IP。Native 不发布宿主端口、其他容器不可伪装 edge、edge 覆盖 IPv4/IPv6 XFF/X-Real-IP 的路径都要有真实负向证据。仅信任 edge 也不会分散 Studio 的内部 key 桶；不要为了该问题把 Studio 变成可传客户端 IP 的无审查可信代理。

## 最小决策与分阶段方案

**当前决策：保留所有默认值，继续私有准备，公开启用仍 blocked。** 以下选项均待用户对确切目标实例、变更 diff、参数和维护窗口另行批准；本文不是批准。

1. **有限私有演示／验收，保持上游不变。** 只允许已知参与者，按原生窗口串行安排注册／登录，预算全体 Studio key、search 和 GA 查询，遇 429 等自然窗口。该方案最小、无安全参数变更，但不承诺并发公开用户可用；本次部分门项因此仍 blocked。
2. **公开入口的最小候选：精确代理归属＋本人 key 桶。** 在单独任务中准备固定私有 edge IP 的 compose diff 和 `TRUSTED_PROXIES=<该IP>`，保留 CT=true/20/1200、GA=true/360/180、SR=true/10/60。账户 CT 仍按可验证的真实客户端 IP（NAT 用户仍共享），明确禁止直达 Native。另准备可审查的 Native 小补丁：已有 UserAuth 后的 `POST /api/token/:id/key` 将 IP CT 改为 `UserCriticalRateLimit("studio-token-key")`，仍 20/owner/1200；完整 key 路由继续只允许 Studio 私有调用，普通用户不得直接获取 key。该补丁不是现配置能通过 env 启用的功能，必须重新固定 source SHA／binary hash、复核安全合同和更新批准证据，不能沿用旧 pin 或暗改上游。
3. **仅容量参数调整的备选，不作为公开推荐。** `CRITICAL_RATE_LIMIT`／duration 可由 env 覆盖，但同一参数同时影响全部 CT 和原生 UC 安全范围；提高值不是只增加 Studio key 容量。若未来仅私有试运行需要，例如候选 `true/120/1200`，必须明示其相对默认六倍窗口额度、允许人数和结束时间，单独批准并验收，不能据此声称公开认证保护等价。公开方案的 GA 容量也须依据实际总查询预算选择确切值，不能预先无依据扩大。

Native 已有 `UserCriticalRateLimit(scope)` 和 `SearchRateLimit()`，但 key 路由没有挂本人 UC；这不是可直接使用的管理员 setting。原生 relay 还有 ModelRequestRateLimit，固定默认 enabled=false，它限制模型路径，不能替代 refresh/key/log HTTP 路由的预算和身份信任审查。以上均不申请开 Redis、batch、replica 或改变资金、试用、续用合同。候选新 pin 还必须核对 Studio 固定来源验证、routing/trial/renewal policy 与私有恢复工具的二进制证据；旧 immutable snapshot 或 unknown 屏障不能靠更新 sourceCommit 清除或改写，不能假定新版本工具可恢复旧版本操作。

## 批准前验收与回滚

公开候选先在新的随机隔离栈做零采购合同测试，保留固定二进制和全部 env diff。至少覆盖：

- 未授权来源伪造 XFF/X-Real-IP/多跳链/IPv6 不能换桶；直接 Native 网络入口不可达；合法 edge 看到不同真实来源时确实分桶；同 NAT 的多个用户共享行为明确。
- 两个已认证 owner 的 key 桶独立，修改客户端 owner/IP 字段无效；owner1 耗尽不耗尽 owner2；key 仍私有、授权和审计未绕过。未认证拒绝，不能用管理员共享 key。
- 同一桶达到批准阈值确实 429，Retry-After 与 UI 手动恢复正确；401、403、429 不混淆；旧 SID、跨标签迟到刷新不能发送业务；不自动重放模型、偏好 PUT、token POST。
- 纯文字和最大工具循环核对上述实际 HTTP 次数；费用面板、精确日志核对和 search 加入容量测试。日志被限流时仍 pending/unconfirmed，原图和历史可恢复，不减少证据条件或补扣／退款。
- 四角色实际并发、刷新、NAT 场景和账户安全入口回归，F/N/P 分开。fixture 参数测试不计真实公开部署或付费供应商通过。

批准记录必须有目标实例／容器、当前和目标完整 env、edge 可信 IP 来源、原生源码 diff／pin/hash、预计 owner 数与每窗口最坏 HTTP 预算、测试命令和结果、维护及回滚负责人。不能只批准“把限流调大”。

回滚恢复旧 edge 信任与 Native pin/env，保持 Studio generation／trial／renewal 不新增启用；先停止新业务、保留和核对所有未知请求及 held，再按单独维护授权操作服务。Native 重启会失去内存限流计数，不能当作日常解锁方法。已有 funding／renewal unknown 不能因限流回滚而清除，旧业务不会自动补发；原生资金和令牌状态不以这份文档为由修改。回滚后可用性不满足则继续关闭公开入口，不能改信任范围来强行通过验收。

本文验证范围为固定源码、当前 Studio 调用路径和 T1.6 的限流 UI 证据；没有进行配置变更、公开负载／代理伪造实测、Native 补丁实现或安全参数验收。
