# T1.4 有限生成权限续用

默认关闭，真实计划、金额、期限与入口设置仍未启用。New API 是账号、模型令牌和资金的唯一权威；Studio 只保存本人令牌 ID/name 的绑定与非金额操作屏障，不保存令牌 key，不充值、不购买新试用、不变更原试用次数。有限令牌的 quota 是权限边界，不是供应商采购成本的硬保证。

## 为何创建新令牌

固定版 `0aec08fee811ec6136828fda790551b49e410301` 的普通 token PUT 写回整份额度/期限快照，没有用于并发结算的 CAS。旧请求的晚到结算可能与这种更新互相覆盖。Studio 因而不修改旧令牌的额度、期限或状态，不用 PUT/DELETE 续用；旧权限获得已失效证据后，明确创建一个新的有限令牌，并在 Studio 同一事务提交成功结果和新的 owner binding。旧 ID/key/额度/期限/用量完整保留。

准许的旧状态仅为：Native 精确读取的期限严格小于该响应 `Date` 的秒数，或 status=4 且 remain_quota<=0。Node 本机时钟不充当到期证据。Native 同一秒仍可能有效，不能提前续用。status=1 且零额时先持久化 intent，内部取得旧模型 key，仅向同一 Native 发不计模型费用的 `GET /v1/models`；只有明确 401 后精确读取 status=4 才继续。缺证据、停用状态2、扩大模型/分组/IP/auto_groups、无限额、重复名称、ID/owner变化均拒绝。该 GET 不访问供应商模型生成端点，也不是模型可用性证明。

只有本人新鲜启用状态、同一组、正钱包余额且旧 receipt 可核验，或现行已批准且仍有业务次数的 active 有限试用资金，可以提供新令牌 cap。新 cap 不超过已核验原生资金与操作员批准上限；期限沿用批准秒数，模型沿用本人已核验模型范围、空 group、关闭跨组重试。续用不会重领 4+1、改变付款偏好、发送模型、自动勾选余额授权。之后每次钱包发送仍须单独同意。

## API 与未知结果

- `GET /api/studio/access`：本人只读状态、中文原因、可选 canRenew/version/期限；不取完整 key、不创建令牌、不发模型。配置关闭也可报告原生权限状态，生成整体关闭则返回 unavailable。
- `POST /api/studio/access/renew`：本人 Bearer、UUID `Idempotency-Key`、严格 `{ "version": "<查询给出的64位摘要>", "confirm": true }`。不接受 owner、quota、期限、模型、key 或付款偏好。version 绑定实例、owner、旧令牌精确元数据及批准政策，变化后必须重新查询与确认。
- 同 owner 续用、资料修改和生成互斥，其他 owner 独立。已完成的同 key 重放只返回保存结果，不再 POST；更改参数拒绝，另一 owner 不能重放该结果。
- Native 证明操作前先落 pending intent。任何证明、创建或读回异常统一 unknown，重启 pending 也成为 unknown。一个已创建但未确认的新 token 不能凭名称自动认领；Native 名称没有唯一约束，GET 也不能证明旧 POST 已结束。
- unknown 续用阻止本人后续所有新生成与续用。旧 running/unknown/failed 模型请求、held 试用占用、未知原生试用领取、未知付款偏好也阻止续用；不自动退款或解占用。

目前**没有续用 unknown 的操作员恢复工具**。不要手改 SQLite、清屏障、改旧 key 或借 `reconcile-funding.mjs` 解锁；该工具只核对付款偏好，不能确认 token 创建结果。T1.5 需要另行实现停服、固定实例证据、旧/新令牌核对和可审查恢复。浏览器未知提示只允许刷新只读查询，不会再提交相同或新的写请求。

## 启用前的独立核验

需要用户明确批准真实目标后，操作员在私有运行目录填写政策，不是复制示例并直接开关。`v2/config/token-renewal.policy.example.json` 的 `operatorVerified=false` 和占位 UUID 有意不能用于启用。加载严格绑定固定 sourceCommit、普通路由证据的 gatewayOrigin、稳定账号库 instanceId；要求三边界 `studio-only`，Redis/batch关闭且无未知字段。

```dotenv
GOUO_ENABLE_TOKEN_RENEWAL=false
# GOUO_TOKEN_RENEWAL_POLICY_FILE=/受保护目录/token-renewal-policy.json
```

准备好的 `nginx.studio-only.conf` 关闭公网所有 Native model token 创建、修改、删除和单个/批量完整 key 提取；masked token GET 保留。所有 relay 路径与后台保持私有，Studio 的服务器内网调用仍可达固定 Native。`/api/user/token` 是原生账号 PAT，受 Native security proof 保护，和 `/api/token/*` 的模型 key 是两种权限；不能把两者的测试混称。此政策要求的是模型令牌的排他写入及完整模型 key 边界。

政策文件是人工核验记录，不是网络隔离本身。必须另外检查所有其他公网域名、宿主端口、隧道、插件路径、管理入口及可信操作员的内部并发消费者；准备模板与隔离测试不证明真实部署的排他性。Docker Native 无宿主端口、单 Studio 进程锁、关闭 Redis/batch 是当前支持条件，不宣称支持集群。真实主栈未换用此模板、未填写政策、未启用续用。

## 实际证据

API 反例覆盖只读无写、到期/耗尽、同 key 与跨 owner、参数冲突、禁用/扩大权限/缺资金/配置关闭、未知创建/读回与持久重启、旧生成/占用屏障、并发和新 binding 后的生成。浏览器 fixture 验续用不发模型、清本人的旧余额勾选、不清另一个 owner、unknown 不重交。

`node tests/stack/token-native.cases.mjs` 使用 SHA-256 校验的固定真实 Native、独立 SQLite、随机 Compose 项目和两个合成普通账户：hard-expired ID1→ID2；enabled零额 ID3→status4 后新 ID4。每例恰好一次 Native POST，0 PUT/DELETE；同 key 重放不创建，旧 ID/key/expiry/quota/used 保持（零额仅状态1→4），原生钱包/用量/请求数/订阅/消费日志保持。0模型调用、0真实费用。证据 `.local/native-token-Q263Xh/evidence.json` 明确 `preparedEdgeExclusivityVerified=false`，仅证明真实 HTTP token 合同，edge另测。实际命令与最终全量数量见 [STATUS.md](STATUS.md)。
