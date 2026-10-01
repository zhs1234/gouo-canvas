# API 与数据契约（设计，不表示接口已经实现）

公共 TypeScript 入口 `v2/packages/contracts/src/index.ts`。服务端 HTTP 边界必须做自己的运行时校验与鉴权，不能把前端校验当安全机制。计划中的业务 API 成功 `{ success: true, data }`；失败 `{ success: false, error: { code, message, requestId } }`，禁止把上游密钥、完整错误响应或内部 URL 返给用户。已接入的 New API 账号接口使用上游 `{ success, message, data }` envelope，由 v2/apps/studio/src/api.ts 处理。

2026-09-30 范围：云 Project/Asset 路由和表暂缓，下列数据设计是历史规划。实际业务服务已选定 v2/apps/api，经 New API /api/user/self 验证身份；公开模型目录和认证 /images、/runs 使用 `{success,message,data}` envelope，具体运行契约见 LOOMIC.md。下列 /jobs、订阅与数据库设计尚未实现，不直接套用旧 Session 或执行旧迁移。

## 已实现的持久聊天接口（C1）

均由 New API `/api/user/self` 验证 Bearer 身份；不接受客户端 owner。

| 方法与路径 | 用途 |
| --- | --- |
| GET /api/studio/threads | 当前账号会话分页列表；可选 offset 与 search 标题搜索 |
| POST /api/studio/threads | 创建会话，标题最多 100 字符 |
| GET /api/studio/threads/:id | 当前账号会话与已保存运行/消息/费用状态 |
| GET /api/studio/runs/:id | 只读运行状态与事件，不触发模型调用 |
| POST /api/studio/runs/stream | 可选 threadId；归属校验后执行，服务端读取该会话上下文 |

未知/他人资源返回 404，列表及详情分页最多 50 项。持久化运行状态为 running/completed/failed/unknown；进程重启不恢复执行，未完成变 unknown。停止接收不是供应商取消。带 threadId 的请求不使用客户端历史，同 ID 重放沿用原请求指纹，不随新历史变化；busy 前拒绝不创建假消息。未带 threadId 的既有画布协议保留兼容。

T1.6 标题搜索：`GET /api/studio/threads?search=<标题子串>&offset=0` 仅搜索认证本人全部会话，trim后最多100字符；空搜索保持原顺序与分页。`%`、`_`、反斜杠按字面匹配，SQL绑定参数，不接受客户端owner；非法/重复搜索参数400，匿名401。每页50项、额外一项判断nextOffset，搜索分页与原分页隔离；读取不创建会话或调用模型。UI输入300ms去抖，取消旧query，未加载历史也可直接命中。

2026-10-01 T1.5a 实际费用DTO：完整唯一Native本人type2日志匹配为 `usage.state=recorded`；尚无完整记录为pending；二者 `settlementState=unconfirmed`，不等于资金/token均成功。quota/cost/requestCount/requestIds保留，旧settled在对外读取及重放兼容recorded，不重写旧金额或再次生成。balance是当前原生钱包；spent是累计used_quota折算，recentCalls.cost是日志折算，不是请求级扣款回执。见 [BILLING-EVIDENCE.md](BILLING-EVIDENCE.md)。

## 后续规划路由（未全部实现）

| 方法与路径 | 输入 / 结果 | 约束 |
| --- | --- | --- |
| GET /api/studio/projects | cursor/limit → items,nextCursor | owner scoped，最大 limit 100 |
| POST /api/studio/projects | title → Project | title 1–100 字符；服务端 owner |
| GET /api/studio/projects/:id | Project + document + assets | owner scoped |
| PATCH /api/studio/projects/:id | title/document + expectedRevision | 原子 revision CAS，冲突 409 |
| POST /api/studio/assets | multipart file → Asset | magic bytes、像素、字节、quota 校验 |
| GET /api/studio/assets/:id/content | 私有二进制/短期签名 | 先鉴权；签名 URL 不做永久 ID |
| GET /api/studio/models | PublicModel[] | 只公开启用且 live-verified 的渠道能力 |
| POST /api/studio/jobs | projectId + GenerationIntent | Idempotency-Key；202 + JobSummary |
| GET /api/studio/jobs/:id | JobSummary | owner scoped |
| POST /api/studio/jobs/:id/cancel | 取消请求结果 | running 不假装已经取消；可用 provider cancel 或等待结算 |
| GET /api/studio/plans | 当前可售 plan versions | 仅服务端定价 |
| GET /api/studio/subscription | Subscription + entitlements | 当前身份 |
| POST /api/studio/orders | planVersionId + paymentMethod | 幂等；固定报价快照 |
| GET /api/studio/orders/:id | 订单状态 | 当前身份 |
| GET /api/studio/usage | cursor → 用户账本摘要 | 不暴露其他用户或供应商密钥 |

管理员 routes 单独加 AdminAuth。每次资源关联均验证 owner，不仅检查顶层 projectId。API 中不接受客户端 userId、上游 baseUrl、apiKey、price、remainingQuota、finalStatus 或 channelToken。

## 表设计与关键约束

这不是可直接执行到生产的 SQL。B1 开始根据现有 GORM/migration 约定写正式 schema 与迁移，先使用独立开发数据库。

| 表 | 必要列 | 不变量/索引 |
| --- | --- | --- |
| studio_projects | id, owner_id, title, revision, schema_version, document_json, created_at, updated_at, deleted_at | (owner_id,updated_at,id)，revision CAS |
| studio_assets | id, owner_id, storage_key, mime, bytes, width,height,sha256,state | quota reservation 原子；引用检查；按 owner 去重不跨用户泄漏 |
| studio_project_assets | project_id,asset_id,role,position | 关联两端同 owner；联合唯一 |
| studio_models | model_key,label,protocol,adapter_id,enabled,capabilities_json,capability_revision,verification | model_key 唯一；发布附真实渠道验证证据 |
| studio_model_channels | model_key,channel_id,upstream_model_id,secret_ref,route_policy,region | 后端专属，禁止公开 secret/base URL |
| studio_jobs | id,owner_id,project_id,request_hash,idempotency_key,status,model_key,route_snapshot,quote_snapshot,provider_request_id,created_at,updated_at | (owner_id,idempotency_key) 唯一；同 key 不同 body →409 |
| studio_job_outputs | job_id,position,asset_id,state | (job_id,position) 唯一；结果持久化后才可标成功 |
| studio_outbox | id,event_key,event_type,payload,published_at,attempts | event_key 唯一；与 job/reservation 同事务 |
| studio_plans | id,version,name,price_minor,currency,period_rule,entitlements_json,enabled | (id,version) 唯一；已售版本不可原地改权益 |
| studio_subscriptions | id,owner_id,plan_version_id,state,period_start,period_end | 周期重叠政策明确，UTC [start,end) |
| studio_entitlement_grants | id,subscription_id,period_id,granted_units,reserved_units,used_units | 数据库原子校验 used+reserved <= granted |
| studio_usage_entries | id,owner_id,job_id,period_id,kind,units,idempotency_key,created_at | idempotency_key 唯一；只追加，不改历史 |
| studio_orders | id,owner_id,plan_version_id,price_minor,currency,state,provider_trade_id | 报价快照；provider_trade_id 唯一（含渠道作用域） |
| studio_payment_events | id,provider,event_id,order_id,verified_at,applied_at | (provider,event_id) 唯一；与订单/权益结算事务关联 |
| studio_provider_costs | job_id,attempt_id,provider_request_id,currency,cost_decimal,usage_json | 供应商真实成本账本，与会员 unit 分离 |
| studio_legacy_asset_map | owner_id,legacy_asset_id,new_asset_id,checksum | 联合唯一，迁移可重入 |

金额使用整数最小币种单位或 decimal，禁止浮点作为账本真值。会员额度使用整数；不要假定“每个模型一张图都同成本”。删除采用延迟回收，仍被项目/任务引用的素材不能物理删除。

## 任务与结算

`queued → running → succeeded / partially-succeeded / failed`；请求结果未知进入 `reconciling`，由上游 request ID 查证或人工处理；`queued → canceled` 可安全取消并释放预留。running 的取消意图与最终结果分离。终态不能重开；用户主动重试创建新任务/幂等键。

创建事务：校验身份/素材/能力/套餐 → 计算并固定报价 → 预留 unit → 写 job/outbox → commit。Worker 不重复预留。结算事务用唯一 settlement key 将已成功输出的预留转为使用量，释放剩余额度。超时不是“必然免费失败”；先核查上游是否接受任务，避免同时退款与重跑导致双损失。

## 编辑文档

```json
{"schemaVersion":1,"projectId":"server-issued-id","revision":1,"pages":[{"id":"page-1","width":1280,"height":1280,"background":"#ffffff","objects":[]}],"assetReferences":[]}
```

正式对象模型在 E1 定义，允许的 type/属性需要白名单和版本迁移。当前使用 Loomic/Excalidraw 本地文档；将任意画布 SDK 的内部 JSON 不加限制反序列化到生产不属于验收通过。

## 第三阶段 Studio 项目与原始素材

Studio API 复用 New API `/api/user/self` 验证 owner，无新账号或余额系统。与会话/请求去重共享单副本 SQLite；备份应使用 SQLite 一致性备份或停止服务后包含 WAL 的完整卷，不能运行中仅复制主文件。

- `GET/POST /api/studio/projects`：50 条分页 / 创建空项目。
- `GET/PATCH /api/studio/projects/:id`：详情 / `{expectedRevision,title?,document?}` CAS；冲突409，其他 owner404。
- `POST /api/studio/assets/from-run`：`{runId,toolCallId,artifactIndex}`，从 owner 已保存 `tool.completed` 事件取原图，稳定去重。已知图片可来自后续失败/unknown 的运行；不改变运行费用未知状态。
- `GET /api/studio/assets/:id`：owner 私有 metadata/dataURL，private no-store。
- `POST /api/studio/projects/from-asset`：`{assetId,title?}`，同一 owner/素材幂等生成一个空项目；浏览器用稳定 assetId 插入一次。

文档包含 elements/appState/files 及独立 processedSourceIds；新 SDK序列化时保留删除标记。素材只支持可完整解码的单页 PNG/JPEG/WebP，原 bytes+SHA-256 不变；禁止 URL 输入和跨账号引用。限制：HTTP body20MiB，文档最多5000元素/100图片，原图30MiB/2400万像素（HTTP 文档上限会更早限制内嵌文件）。当前无删除、存储配额或保留策略。
