# 架构与迁移地图

## 1. 产品与边界

用户选择商品主图、白底图、换背景/场景图、海报和批量输出，而不是先理解几十个模型参数。先做这五种通用工作流；淘宝/拼多多/抖音/社媒/外贸差异用模板与可配置导出预设表达，不复制五套应用。AI 模特、高清化、扩图是后续可插拔操作。没有视频范围。

初期使用**模块化单体**：继续使用现有 Go/Gin/GORM，业务域分包；耗时任务在单独 worker 进程执行。不要为了新架构再造认证中心、独立支付微服务或同时维护三套数据库。

```text
Browser: React + Router + TanStack Query + Fabric
  /api/user/*            -> existing session authentication
  /api/studio/*          -> authenticated V2 business API
                             projects / assets / models / jobs
                             subscriptions / entitlements / usage
                             SQL transaction + outbox
                                      |
                                 Asynq / Redis
                                      |
                              server-side worker
                          /                   \
                validated One Hub      direct protocol adapters
                internal relay          (when needed, approved hosts)
                          \                   /
                         provider image APIs
                                      |
                         private assets -> object storage
```

浏览器不能获取 relay service token，也不能直接调用上游或通过旧 `/v1` 绕过 V2 权益。不要把“保留 One Hub”理解为所有新模型必须等待它支持。

## 2. 目录

```text
src/                         legacy UI, kept intact
server/                      existing Go module and gateway
  internal/studio/           new Go domains (B1+)
v2/                          isolated npm workspace
  apps/studio/src/           pages and application integration
  packages/ui/src/           shared UI primitives
  packages/contracts/src/    public types / capabilities / job transitions
  scripts/                   setup + operator image probe
  tests/                     contracts + browser smoke
  config/                    non-secret catalog examples
docs/v2/                     task contracts and design decisions
```

旧 root package.json/package-lock.json 不升级、不转换为 workspace。V2 自带依赖树，旧 root `npm run build` 仍面向旧站。

## 3. 复用地图（均需测试后接入）

| 现有位置 | 处理 | 不应照搬的部分 |
| --- | --- | --- |
| server/middleware/auth.go、controller/user.go | 复用登录态与身份识别 | 不能接受客户端 userId 代替鉴权 |
| server/providers、relay | 复用渠道与已验证协议 | 不能因模型出现在列表就判定图片支持 |
| src/lib/gouoBackend.ts | 已参考账号 envelope；V2 建独立轻量 API client | 不搬其浏览器 relay token 路径到 V2 |
| src/lib/openaiCompatibleImageApi.ts、falAiImageApi.ts | 提取协议行为与测试样例 | 上游执行迁移到 worker，非浏览器长请求 |
| server/controller/gouo_cloud.go、model/gouo_cloud.go | 复用用户隔离与旧素材映射思路 | 旧 done/error 同步记录不是 durable job |
| server/common/storage | 复用 SDK 基础 | 不等于已有私有素材签名下载与 quota 原子性 |
| server/payment/gateway | 复用微信/支付宝/Stripe SDK | 旧充值回调不等于可靠订阅状态机 |
| server/controller/order.go | 查阅协议和历史订单 | 新订单、权益发放必须改成事务/唯一键/幂等 |
| src/lib/exportZip、mask、size 等 | 迁移纯函数及测试 | 不导入完整 store.ts 或旧 UI 类型图 |
| src/store.ts、InputBar、SettingsModal | 行为参考，不作为 V2 状态基础 | 禁止复制成新的超大 store/component |

## 4. 状态与任务

服务端是真实任务、素材、套餐的权威数据源；TanStack Query 缓存这些 DTO。Fabric 画布运行时对象不能直接放进全局 JSON store；持久化必须使用带 schemaVersion 的编辑文档，以 assetId 引用素材，不能存永久外部签名 URL。

新任务先事务写入 job、预留额度和 outbox，再投递队列。Worker 至少一次执行语义由数据库 idempotency key 保证业务效果不重复。上游调用成功但下载保存失败时优先恢复既有结果，不重复生图。

## 5. 运行与部署

开发端口：旧 UI 5173、V2 5174、Go 默认 3000。生产目标同源 `/studio/`，静态文件在 `v2/apps/studio/dist`，API 仍由现有 Go 处理。需要单独新增 Nginx location 与 feature flag，但本提交不变更实际部署配置。

V2 初期不必另建管理员身份系统。模型渠道继续使用 One Hub 管理界面；项目/套餐/任务管理新增带 admin 权限的业务页。只引入一个设计体系；不同时嵌入 Fabric、Konva、tldraw、Filerobot 四套编辑器。
