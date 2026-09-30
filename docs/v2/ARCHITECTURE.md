# 架构与迁移地图

## 当前架构（2026-09-30）

图片优先的无限画布与智能体工作台，后续接入视频生成；不做视频剪裁。使用固定版本 Loomic 原生前端，New API 提供账号与模型网关，业务适配位于 `v2/apps/api`。云项目/素材库暂缓，没有旧数据迁移。

```text
Browser: React + Router + TanStack Query + Loomic/Excalidraw
  IndexedDB             -> local canvas / projects / sessions / messages
  /api/user/*           -> New API account authentication :3000
  /api/studio/models    -> public sanitized capability catalog
  /api/studio/images    -> authenticated Fastify adapter :3001
  /api/studio/threads   -> owner-scoped persistent chat history :3001
  /api/studio/runs       -> authenticated LangGraph agent / read-only status :3001
                              identity via New API /api/user/self
                              local SQLite idempotency guard + conversation events
                              server-only relay -> New API /v1
                                Chat Completions / Images JSON / multipart
```

浏览器账号 token 只在内存中，刷新用 HttpOnly Cookie；真实 relay key 只由业务服务读取，浏览器不能直接请求 `/v1`。默认没有模型密钥与可用模型，不调用付费渠道。当前通过 SSE 逐 token/工具事件传输，兼容批次端点保留；关闭页面不保证供应商取消或恢复完整运行；任务队列和权益尚未实现。

本地草稿按访客/账号 scope 显示，但同一浏览器的 IndexedDB 不提供共享设备安全隔离；重要结果须导出备份。服务端 SQLite 保存请求去重与按账号隔离的聊天历史；未知结果阻止重交，不具备 Worker/usage reservation 语义。详见 [LOOMIC.md](LOOMIC.md)。

## 目录

```text
src/                         legacy UI, kept intact
server/                      legacy One Hub reference, not started by V2
v2/                          isolated npm workspace
  apps/studio/src/loomic/     pinned Loomic frontend and thin adapters
  apps/api/src/              config / auth boundary / agent / images / ledger
  packages/ui/src/           small shared UI primitives (account integration)
  packages/contracts/src/    domain types / capabilities / job transitions
  scripts/                   setup / joint dev startup / explicit operator probe
  tests/                     contracts / probe / browser workflows
  config/                    disabled model examples, no secrets
docs/v2/                     task contracts and decisions
```

旧 root package/lockfile 不升级、不转换为 workspace。前端只使用 Excalidraw 一个画布引擎；移除 Fabric starter 和未采用的其他编辑器包。保留 Loomic 源码许可证与 provenance，不复制完整上游后端。

## 后续业务边界

B2：逐渠道验证模型 ID、JSON/multipart、质量、尺寸、图片理解与返回格式。URL-only 图片当前报错；Responses、Gemini、fal、视频异步协议分别适配，不强行映射为 Images JSON。真实验证前模型保持禁用。

B3/S1：增加持久化 job、事务性的权益/usage reservation/outbox、成熟后台队列、私有输出保存/下载、幂等结算与 unknown reconciliation，再开放收费。刷新/关页恢复与取消费用策略在该阶段实现；不声称当前同步请求已满足这些要求。

B1 暂缓：以后启用云库时明确存储、owner scoped 查询、revision、上传校验和删除/保留策略。当前画布文件内嵌本地图片，不引入 Supabase 或公开桶。

商品主图、白底图、换背景/场景图、海报与批量输出作为后续工作流/模板；保留商品外观的要求应由确定性合成与样本质量回归验证，不由营销名称推断。

## 旧代码参考

旧 `server/providers`、图片 API 纯函数、支付/存储 SDK 可作为协议参考，采用前逐项验证；不复用旧 Session、浏览器 relay token 路径或充值语义。New API 自己维护认证/渠道管理，V2 不再造认证中心。月度订阅的业务管理在新服务独立实现。

## 运行

开发：`cd v2 && npm run dev` 同时运行 API 3001、前端 5174；New API 3000 单独运行。生产目标同源 `/studio/` 静态资源及账号/业务 API 的分别反向代理，产物在 `v2/apps/studio/dist`。生产 HTTPS、Cookie/CSRF、备份、队列和收费策略待单独实施。

## 可重复一体化运行

新增 `v2/deploy/compose.yml`、独立镜像和同源 Nginx 入口，详见 [RUNNING.md](RUNNING.md)。保持前端、Studio、New API 三服务，以及浏览器草稿 / Studio 去重 / New API 账号费用三个数据职责。没有合库或复制第二套认证；旧根部署文件不参与 V2。`/studio/chat-lab` 和 `/studio/canvas-lab` 是隔离、可回退的体验对照，尚未替换默认画布和会话存储。

## 持久聊天与画布对照（C1）

`/studio/chat` 使用 assistant-ui 组件、自定义 Studio transport 和 New API 会话；没有第二套账号、模型网关或账单。Studio 同一 SQLite 文件新增会话、运行与流事件表，每次读写以已验证的 New API user ID 为 owner。历史图像仍以内嵌结果保存，不等于云项目/对象存储。旧 `/studio/chat-lab` 重定向到正式聊天入口，默认画布菜单提供入口与回退。

流中进度逐事件落盘，终态与幂等结果同事务保存；断网/切线程/停止接收只断开客户端接收，运行可在当前进程继续完成。刷新可按线程或 run ID 读取已保存结果，不会重新提交生成。进程重启使尚在 running 的记录变为 unknown；没有后台 Worker 自动续跑，也不保证供应商取消或收费停止。

模型上下文取服务端最近六次完成运行的用户/助手文本，每段最多 8000 字符；完整历史另行保留，不能把上下文窗口称为无限记忆。New API 仍是实际费用权威，历史记录中的 usage 是查询结果/待确认状态，不是新增财务账本。单实例 SQLite 数据与备份应由部署者按隐私及保留策略管理；当前不自动删历史。

官方画布与现有包装共用 Excalidraw，独立存储副本并以只读方式查看当前账号的旧本机草稿。默认编辑器切换必须通过图片文件完整性与交互回归；本阶段不静默替换旧草稿或转换不支持的 Fabric payload。
