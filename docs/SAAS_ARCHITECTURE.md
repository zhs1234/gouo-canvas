# 光构 SaaS 架构与实施计划

## 1. 目标

将现有单用户纯前端工具改造为可公开运营的 AI 图片 SaaS，包含：

- 邮箱或第三方账号登录。
- 平台统一管理上游 API Key。
- 充值、套餐、额度及交易明细。
- 服务端任务状态、失败补偿与防重复扣费。
- 管理后台、风险控制和运营数据。
- 用户协议、隐私政策、退款规则与内容安全规则。

## 2. 推荐技术架构

### 前端

继续使用当前 React + Vite 应用。前端只负责交互、上传和任务状态展示，不接触上游 API Key、支付密钥或可修改余额的内部接口。

### API 服务

推荐新增独立 TypeScript API 服务，职责包含：

- 验证登录会话。
- 对生成请求进行参数校验和内容安全检查。
- 按服务端价格表估算费用。
- 在数据库事务中预扣额度并创建任务。
- 从服务端调用 OpenAI 或兼容服务。
- 保存任务结果、结算实际费用，失败时自动退额度。
- 记录审计日志和上游请求 ID。

### 数据库与对象存储

- PostgreSQL：用户、会话、套餐、订单、额度账本、任务元数据。
- S3 兼容对象存储：用户上传的参考图、生成结果和缩略图。
- Redis 或托管队列：限流、短期幂等键、任务队列和分布式锁。MVP 也可先用 PostgreSQL 任务表实现队列。

## 3. 请求链路

```text
浏览器
  -> 登录会话验证
  -> POST /v1/generations（携幂等键）
  -> 服务端校验参数与内容
  -> 数据库事务：预扣额度 + 创建任务
  -> 工作队列调用上游图像 API
  -> 图片写入对象存储
  -> 数据库事务：实际结算 + 任务完成
  -> SSE / 轮询向前端返回状态
```

API 失败时，工作队列必须使用同一任务 ID 进行有上限的重试，不能为每次重试重复预扣额度。

## 4. 核心数据表

### users

- `id`
- `email`
- `status`：active / suspended / deleted
- `role`：user / support / admin
- `created_at`

### credit_accounts

- `user_id`
- `available`
- `reserved`
- `version`：用于乐观并发控制

### credit_ledger

- `id`
- `user_id`
- `type`：recharge / reserve / capture / release / refund / adjustment
- `amount`
- `balance_after`
- `reference_type`
- `reference_id`
- `idempotency_key`
- `created_at`

`credit_ledger` 只追加、不更改。余额的每次变动都必须能追溯到订单、任务或管理员操作。

### generation_tasks

- `id`
- `user_id`
- `status`：queued / running / succeeded / failed / cancelled
- `provider`、`model`、`request_params`
- `estimated_credits`、`charged_credits`
- `upstream_request_id`
- `error_code`、`error_message`
- `created_at`、`started_at`、`finished_at`

### orders

- `id`
- `user_id`
- `provider`
- `provider_order_id`
- `status`：pending / paid / closed / refunded
- `amount`、`currency`、`credits`
- `created_at`、`paid_at`

## 5. 支付与额度

支付渠道尚未确定，因此不在当前代码中虚构支付实现。

- 中国大陆用户为主：通常需要微信支付或支付宝，并准备合法主体与对应商户资质。
- 海外用户为主：可考虑 Stripe Checkout 和 Customer Portal。
- 任何渠道都只在服务端验证签名回调后入账。
- 支付回调以 `provider_order_id` 和事件 ID 做幂等，防止重复充值。

## 6. 身份验证

MVP 推荐先实现邮箱验证码或邮箱魔法链接，再按用户群体增加 GitHub、Google 或微信登录。

- 使用 HttpOnly、Secure、SameSite Cookie 保存会话。
- 不把长期访问令牌保存到 localStorage。
- 密码登录需要 Argon2id 哈希、登录限流和异常地点提醒；MVP 可用无密码邮箱登录降低安全负担。

## 7. 部署方案

### 方案 A：Cloudflare 优先

- 前端：Cloudflare Pages / Workers Static Assets
- API：Cloudflare Workers
- 对象存储：R2
- 数据库：托管 PostgreSQL
- 队列：Cloudflare Queues

优点是部署简单、自动扩容、图片存储与分发成本可控。需要事先确认目标用户所在地区的网络可达性。

### 方案 B：Docker 自托管

- Nginx / Caddy
- 前端静态文件
- Node.js API 和工作队列
- PostgreSQL
- Redis
- MinIO 或云厂商对象存储

优点是数据和网络路线更可控，更适合需要国内节点或特定上游网络的场景；缺点是需要自行运维、备份、监控和安全加固。

## 8. 实施顺序

1. 品牌化、开源声明和用户文档。
2. 抽象前端 API Client，禁用公开站点中的用户自定义上游配置。
3. 服务端会话与用户系统。
4. 额度账本、定价表和幂等扣费。
5. 服务端生成任务、上游 API 代理与失败补偿。
6. 对象存储和跨端历史记录。
7. 充值、支付回调、订单和退款。
8. 管理后台、内容安全、风控、监控和审计。
9. 隐私政策、用户协议、计费说明和客服流程。

## 9. 进入后端实现前必须确定的事项

- 主要用户是中国大陆用户还是海外用户。
- 支付渠道：微信、支付宝、Stripe 或暂不接支付。
- 是否已有可用的公司/个体工商户主体和商户号。
- 上游 API 服务商、计费单位、并发和速率限制。
- 目标地区、域名、备案计划和服务器预算。
- 图片保留时间、用户删除机制和违规内容处理规则。

