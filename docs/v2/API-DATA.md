# API 与数据契约（设计，不表示接口已经实现）

公共 TypeScript 入口 `v2/packages/contracts/src/index.ts`。Go HTTP 边界必须做自己的运行时校验与鉴权，不能把前端校验当安全机制。统一成功 `{ success: true, data }`；失败 `{ success: false, error: { code, message, requestId } }`，禁止把上游密钥、完整错误响应或内部 URL 返给用户。账号旧接口继续使用旧 envelope，由 legacy client 独立处理。

## 路由

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

正式对象模型在 E1 定义，允许的 type/属性需要白名单和版本迁移。将 Fabric 内部 JSON 直接不加限制反序列化到生产不属于验收通过。
