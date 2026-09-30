# 实际交付与验证状态

## Loomic 集成：当前实际交付（2026-09-30）

- 用户选择成熟 Loomic 前端，图片优先、视频生成后续接入、不做视频剪裁；没有旧数据迁移，云项目/素材库继续暂缓。
- 复用上游 `fancyboi999/Loomic` 提交 `bdb47a5adf900b48615af0bd914336e3770021b5` 的原生画布/工具栏/图层/文件/聊天/项目组件与样式。V2 的 Fabric starter 已替换；不是另写一个 Excalidraw 外壳。MIT LICENSE、原文件哈希和第三方声明随源码保留，见 LOOMIC.md。
- `/studio/` 直接进入无限画布，`/studio/projects` 为本地项目列表。PNG/JPEG/WebP 导入、图形/文字编辑、PNG/Excalidraw 文档导出、项目新建/再打开/删除、本地画布与聊天恢复已接入。移动端聊天覆盖层和图片生成面板适配视口。
- IndexedDB 分类保存访客/账号草稿；登录即切换本地 scope，不迁移访客数据。显式保存显示“正在保存”并在写入结束后提示成功；会话加载期间禁用输入，生成期间仍可准备下一条消息。修正初始化/卸载时 SDK 空场景覆盖草稿的问题，并在账号/项目切换时卸载旧 transport，防止迟到结果插入另一画布。
- 新增 `v2/apps/api` Fastify 服务：New API Bearer 身份校验、脱敏模型目录、Images JSON/multipart、LangGraph Chat Completions/图片工具与本地 SQLite 请求去重。relay key 不进入浏览器；未验证配置不能生成，未知结果不自动重复提交。
- 原生图片面板使用渠道质量/比例/编辑能力；模型切换更新参数，支持任意已验证 quality 字符串，不用旧全局枚举。引用图片经过边界检查，实际结果保持宽高比。
- 未接入 Supabase/PGMQ/积分/支付/品牌库。视频入口禁用，仅保留渲染/事件扩展结构。HTTP 返回事件批次，不是 WebSocket/token 流式服务；SQLite request guard 不是 durable Worker、权益或用量预留。

### 本次实际验证

环境：Node 22.22.0、npm 11.9.0。新增依赖有意更新 V2 锁文件，随后 `npm ci` 重装成功（553 packages）。旧 root 依赖/锁文件、src/、server/ 未修改。

| 检查 | 实际结果 |
| --- | --- |
| `npm run check` | 类型检查、14 个领域/探测测试、7 个 API 测试、生产构建通过 |
| `npm run test:e2e` | 11 passed：4 个认证流程 + 7 个 Loomic 画布/聊天/项目/能力/移动端流程 |
| 关键时序复验 | 生成结果保存/恢复与项目切换中止旧等待各重复 3 次，6 passed |
| API 协议检查 | 匿名/伪造身份拒绝、未验证禁用、owner scoped 重放/参数冲突、未知失败重启后阻止重交、JSON/multipart 保留字段、异常图片/URL-only/错误不成功、本地 LangGraph 工具循环通过 |
| 图片面板与草稿 | 导入→保存→刷新→PNG/文档导出、项目再打开/新建/确认删除且不被卸载保存复活、登录切换草稿、图片工具结果/聊天恢复、xhigh/max 模型切换及参考图参数、图片比例保留、切项目中止旧等待通过 |
| 真实 New API 浏览器联调 | 登录、内存凭据、HttpOnly refresh Cookie、刷新恢复、退出后再刷新仍退出通过；实际业务 API 匿名 401、认证未配置 503；没有模型调用 |
| 启停 | `npm run dev` 同时启动 3001/5174；停止联合进程后两个子服务端口关闭，可重新启动 |
| 预览 | 实际桌面/移动端/本地项目截图已捕获，无页面异常；图片为本地绘制示例，不是 AI 输出 |

构建保留 Excalidraw 同源字体和第三方声明；废弃 Liberation 字体资源排除。Vite 提示部分第三方编辑器 chunk 超过 500 kB，构建成功，首屏/资源裁减需后续性能评估；Node 22 的内置 SQLite 有 experimental warning，当前仅作为开发阶段去重底座。

**下一项 B2：实际 New API 模型渠道验证。** 当前示例模型全部 pending/disabled，没有配置 relay key，没有真实付费生图或视频调用。模板商品字段、批量、Responses/Gemini/fal/视频适配、持久化 Job/Worker、云库、生产身份/HTTPS/CSRF、订阅权益仍有对应任务。不能把 UI 与本地协议检查当成完整可收费 SaaS。配置与接入边界见 LOOMIC.md。

---

以下是 Loomic 接入前的验证历史，Fabric starter 内容不代表当前界面。

## 接入 Loomic 前的后端与范围（2026-09-30，历史）

- 用户选择 New API 替换 One Hub；新开发无历史数据迁移，云项目/素材库暂缓。旧 src/ 和 server/ 保留作参考，默认不启动。
- 开发固定官方 `v1.0.0-rc.40`，源码提交 `0aec08fee811ec6136828fda790551b49e410301`；校验官方 Linux amd64 发布资产与 SHA-256，未修改上游源码。使用独立本地 SQLite，随机管理员凭据不进入仓库或日志。
- V2 已适配 New API 登录、Bearer profile、HttpOnly Cookie 刷新和 POST 退出。访问令牌仅留内存；读请求遇 401 最多刷新重试一次，写请求不自动重交。失败退出保留账号显示并报告错误，缺少有效会话的响应不能标为登录成功。
- 云环境安装/启动配置草稿已保存。运行检查完成不表示配置已发布或未来任务已经重新验证。当前工作在 v2 派生任务分支，不修改 main，不部署。
- 实际页面预览时修正了 Fabric 7 新文字默认居中原点造成的左侧裁切；显式使用左上原点，文字初始完整显示在画布内。页面截图使用本地示例文字，未调用 AI。

## 接入 Loomic 前的验证（2026-09-30，历史）

Node 22.22.0、npm 11.9.0；按已有锁文件 `npm ci` 安装，没有新增 npm 依赖或变更锁文件。New API 运行官方预编译发布资产，不声称完成上游源码构建或完整测试套件。

| 检查 | 实际结果 |
| --- | --- |
| `npm run check` | 类型检查、14 个 Node 测试、生产构建通过 |
| `npm run test:e2e` | 5 passed：本地编辑导出、账号恢复/退出、错误密码/退出失败、读刷新/写不重交、异常登录响应 |
| 本地 New API HTTP 检查 | 控制台、初始化、匿名 401、登录/profile、刷新、退出后令牌撤销、无凭据图片生成/编辑 401 通过 |
| 真实浏览器联调 | V2 → New API 登录、内存凭据、HttpOnly Cookie、页面刷新恢复、退出后再刷新保持退出通过 |
| New API 重启后重复检查 | 沿用独立开发数据库，HTTP 检查与真实浏览器登录流程再次通过 |

New API 控制台和账号可用不表示模型工作流已接通。未配置上游模型渠道，未发起真实付费生图或支付；GPT Image 2.5 等仍未 live-verified。MFA/额外登录验证尚未在 V2 实现；当前仅本地 HTTP 开发，生产 HTTPS、安全 Cookie 与 Origin/CSRF 策略仍需配置验证。下一项为 B2 模型目录/协议兼容，B1 云库继续暂缓。

## Starter 已提交内容

- 独立 npm workspace、React/Vite 应用壳、路由与可复用 UI 包。
- TanStack Query 账号接口桥接；当前已换为 New API 会话协议，不获取浏览器 relay token。
- Fabric 本地图片/文字/变换/多选删除/PNG 导出；不上传、不生图、不收费。
- 共享 TypeScript 领域契约、能力校验、任务状态转换约束。
- 显式付费开关的 OpenAI Images operator probe 与脱敏摘要。
- Node 测试、Playwright smoke、初始化脚本、只读权限 CI、架构/数据/模型/订阅/迁移文档。
- 已提交真实 npm package-lock.json，初始化直接使用 npm ci。

这不表示 Job/Worker、会员支付、所有模型适配或完整编辑器已完成。按 TASKS.md 当前范围继续 B2/B3/E1；云端 Project/Asset API 暂缓。

## 已执行的验证（2026-09-18）

本地 Node 22.16.0：共享契约 TypeScript 编译通过，14 个 Node 测试通过。由于本地环境网络/DNS 限制，完整依赖与浏览器检查改由 GitHub Actions 执行。

GitHub Actions：Ubuntu runner，Node 22.23.2，npm 10.9.8。

| 检查 | 实际结果 |
| --- | --- |
| npm install（首次生成依赖锁） | 通过 |
| npm run typecheck | 通过 |
| npm test | 14 passed，0 failed |
| npm run build | 通过 |
| npm run test:e2e | 1 passed；工作台、文字编辑/PNG 下载、模型清单导航 |

成功记录：
- 应用起点提交 `948cf4d481a8ed283c3c277056fa5703885b450b`，运行 https://github.com/zhs1234/gouo-canvas/actions/runs/35325115628 。
- 依赖锁生成/复核运行 https://github.com/zhs1234/gouo-canvas/actions/runs/35325554586 ，依赖锁提交 `0c9199bc96752529f9fb0ed836980fe749bdb57b`。

临时依赖锁写回任务已完成并从正式 CI 移除；正式 workflow 仅 contents: read，不部署、不自动提交业务改动。后续 CI 使用 npm ci 复验锁文件。历史上一次临时 workflow 的 YAML 条件语法错误已修正，不是应用测试失败。

首次已验证依赖：React/React DOM 19.3.0、Fabric 7.4.0、React Router DOM 7.18.4、TanStack Query 5.103.1、Vite 7.3.6、TypeScript 5.9.3、Playwright 1.63.0。以仓库锁文件为准；升级后必须重新验证。

## 初始交付时尚未验证（历史记录）

没有真实模型/支付凭据测试，GPT Image 2.5 和其他模型在本平台均待真实渠道验证。未启动现有 Go 后端做账号/支付/数据库集成回归。1 个浏览器 smoke 不是完整图像编辑器或商业平台的端到端覆盖。

初始交付未改变 main、部署、生产数据库、额度或账号权限。当时计划先实施 B1；当前已复验 V2 并选择 New API，云库暂缓，以本页最新范围为准。Image 2.5 参数/模型映射诊断仍是 B2 的最高优先级。
