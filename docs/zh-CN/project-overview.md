# 光构项目概览

[English](../en/project-overview.md) · [文档中心](../README.md)

光构是一套带账号、积分结算和云端作品库的 AI 图片工作台，提供生成图片、无限画布和 Agent 三种创作方式。用户在 React 前端完成提示词输入、参考图和遮罩编辑、画布排版和作品整理；基于 New API 的 Go 后端负责认证、渠道选择、上游请求和数据归属。图片模型由配置的上游服务提供，仓库本身不包含模型训练或推理服务。

本文面向项目维护者和新接手的开发者，说明产品范围、代码分工、主要数据流及部署边界。依据为 2026-10-13 的源码（包含积分制、后台控制客户端第一批和删除新手引导等改动），并在本地演示环境中实际运行核对；线上配置和真实上游的运行效果未在本次梳理中验证。

## 产品范围

| 模块 | 已有入口和行为 | 主要代码 |
| --- | --- | --- |
| 账号 | 登录、注册、按后端能力显示邮箱验证与密码重置 | [BackendAuthGate.tsx](../../src/components/BackendAuthGate.tsx) |
| 图片创作 | 文生图、参考图编辑、局部遮罩编辑，尺寸、质量和输出格式参数 | [InputBar.tsx](../../src/components/InputBar.tsx)、[MaskEditorModal.tsx](../../src/components/MaskEditorModal.tsx) |
| 任务与作品 | 状态展示、失败详情、重试、参数复用、搜索筛选、下载和回收站恢复 | [store.ts](../../src/store.ts)、[TaskGrid.tsx](../../src/components/TaskGrid.tsx) |
| 收藏与数据 | 收藏夹、批量操作、ZIP 数据导入导出 | [favorites](../../src/components/favorites)、[DataSettingsTab.tsx](../../src/components/settings/DataSettingsTab.tsx) |
| 画布 | 无限画布，文本、图片、生成配置和组节点，节点内生成并显示预计扣费，关联 Agent | [canvas](../../src/components/canvas)、[lib/canvas](../../src/lib/canvas) |
| Agent | 对话式创作，调用图片生成和画布读写工具，模型由后台配置 | [agent](../../src/components/agent)、[lib/agent](../../src/lib/agent) |
| 用户中心 | 积分余额、图片计费、兑换码、使用记录和账户设置 | [UserCenterModal.tsx](../../src/components/UserCenterModal.tsx) |
| 云端作品库 | 任务及关联图片同步、空间用量、账号隔离 | [serverLibrary.ts](../../src/lib/serverLibrary.ts)、[gouo_cloud.go](../../server/controller/gouo_cloud.go) |
| 管理后台 | 仅限管理员登录；用户、渠道、兑换码、日志等 New API 管理能力，以及光构设置、图片账务和光构存储 | [server/web](../../server/web)、[api-router.go](../../server/router/api-router.go) |

![创作页](../images/screenshots/client-create.webp)

前端还提供灵感库、深色主题和 PWA 安装。PWA 缓存页面与静态资源，并跳过 `/api`、`/v1` 和 `/pg`；它不提供离线图片生成。实现见 [main.tsx](../../src/main.tsx) 和 [sw.js](../../public/sw.js)。

## 身份与数据

客户端只有一种运行方式：进入工作台前检查后端 Cookie 会话；图片请求经平台后端渠道转发，上游密钥只保存在服务端，浏览器使用登录后下发的用户中继令牌；默认模型由后台“光构设置”指定。

本地缓存按账号隔离，存储名为 `gouo-canvas:user:<用户 ID>`。切换账号后看到不同作品，不能仅凭这一现象认定数据丢失。见 [storageScope.ts](../../src/lib/storageScope.ts)。

`VITE_*` 变量在 Vite 启动或构建时读取。修改 `.env.local` 后需要重启开发服务器；生产环境修改需要重新构建前端。后端渠道密钥不能放进 `VITE_*` 变量。

## 技术结构和代码分工

项目有三个独立的依赖与构建单元。

| 单元 | 技术栈 | 依赖与产物 |
| --- | --- | --- |
| 公开前端 | React 19、TypeScript、Vite 6、Zustand、Tailwind CSS 3 | 根目录 npm 和 `package-lock.json`，输出 `dist/` |
| 产品后端 | Go 1.26、Gin、GORM，基于 New API | `server/go.mod` 和 `go.sum`，编译为 Go 程序 |
| 管理后台 | React 19、Rsbuild、TanStack Router/Query、Tailwind CSS 4 | `server/web` 使用 Bun 和 `bun.lock`，输出 `server/web/dist/` |

[server/main.go](../../server/main.go) 使用 `go:embed` 嵌入管理后台，因此首次构建或运行后端前，需要先生成 `server/web/dist/`。根目录前端和管理后台是两个应用，不能用一次根目录 `npm ci` 替代全部安装。

| 目录或文件 | 职责 | 常见修改入口 |
| --- | --- | --- |
| [src/main.tsx](../../src/main.tsx)、[src/App.tsx](../../src/App.tsx) | 页面入口、认证门禁、初始化和云同步启动 | 应用启动行为 |
| [src/store.ts](../../src/store.ts) | 状态、任务提交执行、重试、收藏和数据导入导出 | 创作与任务流程 |
| [src/types.ts](../../src/types.ts) | 设置、服务商、任务参数与记录类型 | 数据结构变更 |
| [src/lib/api.ts](../../src/lib/api.ts) | 图片请求的统一分发与失效令牌刷新重试 | 请求路由和错误处理 |
| [src/lib/openaiCompatibleImageApi.ts](../../src/lib/openaiCompatibleImageApi.ts)、[falAiImageApi.ts](../../src/lib/falAiImageApi.ts) | 各类协议、结果提取和轮询适配 | 服务商兼容 |
| [src/lib/db.ts](../../src/lib/db.ts)、[serverLibrary.ts](../../src/lib/serverLibrary.ts)、[serverDocuments.ts](../../src/lib/serverDocuments.ts) | IndexedDB 缓存、云端作品与文档的读取和补交 | 本地缓存与云端作品库 |
| [src/lib/gouoBackend.ts](../../src/lib/gouoBackend.ts) | 账号、令牌、余额和云库 HTTP 客户端 | 前后端产品接口 |
| [server/router](../../server/router)、[middleware](../../server/middleware) | 路由、认证、权限、限流和渠道分发 | 接口入口与访问控制 |
| [server/controller/gouo_cloud.go](../../server/controller/gouo_cloud.go)、[model/gouo_cloud.go](../../server/model/gouo_cloud.go) | 光构任务、资产、收藏和存储配额 | 云端作品库 |
| [server/relay](../../server/relay)、[providers](../../server/providers) | 上游协议、中继和结算 | 模型渠道与计费 |
| [deploy](../../deploy)、[Dockerfile](../../Dockerfile) | 容器编排、反向代理、环境示例 | 产品部署 |

修改前端时遵循根目录 [AGENTS.md](../../AGENTS.md)；修改后端与管理后台时还要遵循 [server/AGENTS.md](../../server/AGENTS.md)。新持久化字段要考虑旧数据清洗，IndexedDB 结构变更要考虑版本升级与迁移。

## 核心业务流程

### 登录和账号隔离

`main.tsx` 用 `BackendAuthGate` 包住工作台。产品模式先请求 `GET /api/user/self`，未登录时显示登录页。登录成功后激活当前用户的本地存储作用域；若作用域改变，刷新页面后再加载该账号的数据。

随后前端从 `GET /api/gouo/token` 获取用户中继令牌。后端按用户查找或创建 `sys_playground` 令牌，；图片请求使用该令牌，账号与云库请求使用 Cookie 会话。`UnlimitedQuota` 表示令牌自身没有独立额度上限，图片调用仍需要检查用户余额。

跨标签页的账号切换会触发存储作用域检查。云同步也会再次确认登录用户与本地作用域一致。服务端 `/api/gouo` 路由使用 `UserAuth`，模型查询包含 `user_id` 条件；管理接口使用 `AdminAuth`。本地隔离和服务端资源归属校验共同保护账号数据。

依据：[BackendAuthGate.tsx](../../src/components/BackendAuthGate.tsx)、[storageScope.ts](../../src/lib/storageScope.ts)、[gouo.go](../../server/controller/gouo.go)、[gouo-router.go](../../server/router/gouo-router.go)、[gouo_cloud.go](../../server/model/gouo_cloud.go)。

### 图片生成和编辑

```text
提示词、参数、参考图、遮罩
  → InputBar 调用 submitTask
  → 校验输入，写入本地 running 任务
  → executeTask 加载输入图片和遮罩
  → callImageApi 选择请求配置和协议
  → /v1/images/* 经过令牌鉴权、渠道分发与上游调用
  → 输出图片落入 IndexedDB，任务更新为 done 或 error
  → 云同步订阅终态任务的变化
```

遮罩提交会核对目标参考图与遮罩尺寸，整图覆盖需用户确认。成功结果保存图片 ID、实际参数、耗时等信息；失败保留错误详情，部分协议还保留原始图片链接或响应以便排查。重试会创建新任务，可能产生新的上游调用和费用。

图片请求通过 `createBackendSettings` 取得中继令牌，走后端 Images API，不使用流式传输；多张图拆成带序号的并发单图请求，每张单独结算。

普通页面刷新不会恢复已中断的请求，初始化会把仍处于运行状态的本地任务标记为失败。请求已发出的任务可以按原请求编号向服务端取回结果，不会重新生成或扣费。云库同步的是作品记录，不能代替持久化的服务端图片生成队列。

依据：[store.ts](../../src/store.ts)、[api.ts](../../src/lib/api.ts)、[gouoBackend.ts](../../src/lib/gouoBackend.ts)。

### 计费和失败处理

`/v1/images/generations` 和 `/v1/images/edits` 使用 New API 自身的模型定价（按次价格、模型倍率或阶梯表达式），用户组倍率等规则照常生效；`/v1/images/variations` 未实现。光构图片模型只能走图片接口，其他入口调用会被拒绝。目录 `/api/gouo/models` 返回当前账号分组可用的已启用模型、计费方式、能力、输出上限和价格版本；版本由生效定价和能力配置计算，变化时客户端需要重新确认。前端模型选择按账号记忆，任务固定模型与报价。

光构产品客户端把多张拆成单图请求，每张成功的图片单独收费。图片请求在预扣时写入持久账本并按请求编号去重，没有向用户返回图片的请求自动退款，超过 20 分钟仍未结算的由主节点定时退款。浏览器超时、下载图片失败或本地保存失败，不必然说明上游调用失败或后端应退款。重试会要求确认新请求费用。

依据：[relay/gouo_image.go](../../server/relay/gouo_image.go)、[model/gouo_billing.go](../../server/model/gouo_billing.go)、[api.ts](../../src/lib/api.ts)。价格、付款配置与生产验证见[后端说明](./backend.md)。

### 云端作品库

作品以服务端为准：生成成功的图片在出图时由服务端直接写入作品库，浏览器 IndexedDB 只做缓存，按游标从服务端拉取作品和收藏夹。浏览器只对已完成的任务补交元数据（参数、参考图和遮罩），失败最多重试 3 次；不再排队上传或双向合并。本机旧作品和 ZIP 导入的作品需要用户在“用户中心 → 导入本机旧作品”手动导入。画布和 Agent 会话按文档整体保存，带版本号防止覆盖。它不提供多人实时协作。

资产由后端重新计算 SHA-256，并在同一用户内去重。数据库保存任务元数据和归属，文件保存在 `GOUO_ASSET_DIR`。读取图片必须经过鉴权接口，不能把这个目录直接作为公开静态资源。

| 默认限制 | 数值 | 配置 |
| --- | --- | --- |
| 每用户资产空间 | 2 GiB | 后台“光构设置” |
| 单文件大小 | 25 MiB | 后台“光构设置” |
| 单任务关联资产数 | 32 | `GOUO_ASSET_MAX_TASK_FILES` |

前端补交逻辑也限制为 32 个关联资产（参考图、遮罩和输出图）；只增加后端限额不会自动扩大前端范围。空间配额只约束用户上传，服务端保存的已付费生成图不受配额限制。管理员可为用户设置单独空间额度。

删除云端作品、画布、会话或收藏夹会进入回收站，默认保留 3 天（后台可改为 1–30 天），期间可恢复并继续占用空间；之后由主节点每小时的清理任务彻底删除记录和不再被引用的图片。尚未导入账号的本机作品只存在于原浏览器，清理浏览器数据或换设备会丢失。

依据：[db.ts](../../src/lib/db.ts)、[serverLibrary.ts](../../src/lib/serverLibrary.ts)、[gouo_trash.go](../../server/model/gouo_trash.go)、[controller/gouo_cloud.go](../../server/controller/gouo_cloud.go)、[model/gouo_cloud.go](../../server/model/gouo_cloud.go)。

## 运行和部署

本地完整产品需要公开前端、Go 后端，以及编译后嵌入后端的管理后台。文档要求 Node.js 22、Bun 和 Go 1.26；根前端用 npm，管理后台用 Bun。SQLite 是未配置 `SQL_DSN` 时的默认数据库（纯 Go 驱动，不需要 CGO），Redis 可在本地省略。

开发访问前端 `http://127.0.0.1:5173`，后端默认监听 3000。Vite 根据 `VITE_GOUO_BACKEND_DEV_TARGET` 代理 `/api`、`/v1` 和 `/pg`；完整产品示例将目标设为 `http://127.0.0.1:3000`。空数据库会创建 `root` / `123456`，必须及时改密码。

当前产品部署入口是根目录 `Dockerfile` 与 [deploy/docker-compose.yml](../../deploy/docker-compose.yml)。Compose 启动 Nginx 前端、Go 后端、MySQL 8.4 和 Redis 7.4；公开端口默认 8080，后端管理端口只绑定宿主机 `127.0.0.1:3000`。生产 Nginx 只代理 `/api/`、`/v1/` 和 `/pg/`，管理后台（后端根路径）不在公开端口上，需要经受控入口访问。

数据库保存账号、额度、渠道与作品关系，`backend-data` 保存后端数据和资产。备份恢复必须同时覆盖数据库、资产文件和相关签名密钥。多个后端实例还需要共享数据库、协调层和资产文件系统；光构专用云库目前使用文件目录，不能因为上游有对象存储模块就认为本产品云库已经接入对象存储。

仓库还保留 GitHub Pages、Vercel Hook 和镜像发布工作流。[Docker 工作流](../../.github/workflows/docker.yml)与 Compose 统一使用根 [Dockerfile](../../Dockerfile)，构建启用后端的产品前端；`gpt_image_playground` 镜像名称保留兼容。旧的 deploy/Dockerfile 运行时注入路径已移除。静态托管工作流仍需单独配置后端地址。本轮只修改发布配置，没有触发发布。

操作步骤见[开发指南](./development.md)、[Docker Compose 部署](./deployment/docker.md)、[Linux 手动部署](./deployment/manual.md)和[上线检查清单](./deployment/checklist.md)。

## 验证状态和后续工作

当前 `migrate/new-api` 分支把后端从 One Hub 换成了 New API，旧版的验证记录已不适用。新后端还需要在目标数据库验证迁移和备份恢复，再用真实上游与独立账号回归生成、计费、同步和回收站。在线支付需要单独验证配置、回调、重复通知和对账；源码中存在上游支付能力不代表可以直接对外开放收款。

## 文档阅读顺序

1. [用户指南](./user-guide.md)：了解公开产品的实际入口。
2. [开发指南](./development.md)：搭建环境并明确运行模式。
3. [后端说明](./backend.md)：配置渠道、价格、空间与备份。
4. [测试与本地模拟 API](./testing.md)：定位兼容和异常场景。
5. [部署总览](./deployment/index.md)：选择部署方式并完成上线检查。

前端来源为 GPT Image Playground，使用 MIT License；后端来源为 New API，按 AGPL-3.0 发布并保留原始声明。上游通用说明在 `server/docs/`，光构产品接入与部署以根目录 `docs/` 为准。来源和许可见 [README.zh-CN.md](../../README.zh-CN.md)。
