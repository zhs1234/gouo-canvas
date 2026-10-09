# 光构项目概览

[English](../en/project-overview.md) · [文档中心](../README.md)

光构是一套带账号、额度结算和云端作品库的 AI 图片工作台。用户在 React 前端完成提示词输入、参考图和遮罩编辑、作品整理；基于 One Hub 的 Go 后端负责认证、渠道选择、上游请求和数据归属。图片模型由配置的上游服务提供，仓库本身不包含模型训练或推理服务。

本文面向项目维护者和新接手的开发者，说明产品范围、代码分工、主要数据流及部署边界。依据为 `main` 分支提交 `67cd4d1` 的源码和现有文档，核对日期为 2026-10-05；实际线上配置和运行效果未在本次梳理中验证。

## 产品范围

| 模块 | 已有入口和行为 | 主要代码 |
| --- | --- | --- |
| 账号 | 登录、注册、按后端能力显示邮箱验证与密码重置 | [BackendAuthGate.tsx](../../src/components/BackendAuthGate.tsx) |
| 图片创作 | 文生图、参考图编辑、局部遮罩编辑，尺寸、质量和输出格式参数 | [InputBar.tsx](../../src/components/InputBar.tsx)、[MaskEditorModal.tsx](../../src/components/MaskEditorModal.tsx) |
| 任务与作品 | 状态展示、失败详情、重试、参数复用、搜索筛选、下载和回收站恢复 | [store.ts](../../src/store.ts)、[TaskGrid.tsx](../../src/components/TaskGrid.tsx) |
| 收藏与数据 | 收藏夹、批量操作、ZIP 数据导入导出 | [favorites](../../src/components/favorites)、[DataSettingsTab.tsx](../../src/components/settings/DataSettingsTab.tsx) |
| 用户中心 | 余额、当前图片价格、兑换码、使用记录和账户设置 | [UserCenterModal.tsx](../../src/components/UserCenterModal.tsx) |
| 云端作品库 | 任务及关联图片同步、空间用量、账号隔离 | [cloudSync.ts](../../src/lib/cloudSync.ts)、[gouo_cloud.go](../../server/controller/gouo_cloud.go) |
| 运营后台 | 用户、渠道、额度等 One Hub 管理能力，以及光构存储管理 | [server/web](../../server/web)、[api-router.go](../../server/router/api-router.go) |

前端还提供灵感库、新用户引导、深色主题和 PWA 安装。PWA 缓存页面与静态资源，并跳过 `/api`、`/v1` 和 `/panel`；它不提供离线图片生成。实现见 [main.tsx](../../src/main.tsx) 和 [sw.js](../../public/sw.js)。

## 两种运行模式

| 项目 | 完整产品模式 | 纯前端开发模式 |
| --- | --- | --- |
| 开关 | `VITE_GOUO_BACKEND_ENABLED=true` | `false` 或未设置 |
| 身份 | 后端 Cookie 会话，进入工作台前检查登录 | 不经过产品登录门禁 |
| 图片配置 | 平台后端渠道，默认模型 `gpt-image-2` | 用户配置 OpenAI 兼容、fal.ai 或自定义服务商 |
| API Key | 平台上游密钥保存在服务端，浏览器使用用户中继令牌 | 用户配置的服务商凭据可进入浏览器本地设置 |
| 数据 | 账号作用域的本地缓存，以及启用后的云端作品库 | 当前浏览器本地数据 |
| 适用场景 | 托管产品、账号与计费联调 | 接口兼容、流式响应、异步轮询和模拟 API 调试 |

模式在 Vite 启动或构建时读取。修改 `.env.local` 后需要重启开发服务器；生产环境修改 `VITE_*` 配置需要重新构建前端。后端渠道密钥不能放进 `VITE_*` 变量。

两种模式使用不同的数据作用域。产品模式的存储名为 `gouo-canvas:user:<用户 ID>`；纯前端模式使用 `gouo-canvas`。切换模式或账号后看到不同作品，不能仅凭这一现象认定数据丢失。见 [storageScope.ts](../../src/lib/storageScope.ts) 和[开发指南](./development.md)。

## 技术结构和代码分工

项目有三个独立的依赖与构建单元。

| 单元 | 技术栈 | 依赖与产物 |
| --- | --- | --- |
| 公开前端 | React 19、TypeScript、Vite 6、Zustand、Tailwind CSS 3 | 根目录 npm 和 `package-lock.json`，输出 `dist/` |
| 产品后端 | Go 1.25、Gin、GORM，基于 One Hub | `server/go.mod` 和 `go.sum`，编译为 Go 程序 |
| 管理后台 | React 18、Vite 7、MUI 5、Redux | `server/web` 使用 Yarn 1.22.22 和 `yarn.lock`，输出 `server/web/build/` |

[server/main.go](../../server/main.go) 使用 `go:embed` 嵌入管理后台，因此首次构建或运行后端前，需要先生成 `server/web/build/`。根目录前端和管理后台是两个应用，不能用一次根目录 `npm ci` 替代全部安装。

| 目录或文件 | 职责 | 常见修改入口 |
| --- | --- | --- |
| [src/main.tsx](../../src/main.tsx)、[src/App.tsx](../../src/App.tsx) | 页面入口、认证门禁、初始化和云同步启动 | 应用启动行为 |
| [src/store.ts](../../src/store.ts) | 状态、任务提交执行、重试、收藏和数据导入导出 | 创作与任务流程 |
| [src/types.ts](../../src/types.ts) | 设置、服务商、任务参数与记录类型 | 数据结构变更 |
| [src/lib/api.ts](../../src/lib/api.ts) | 图片请求的统一分发与失效令牌刷新重试 | 请求路由和错误处理 |
| [src/lib/openaiCompatibleImageApi.ts](../../src/lib/openaiCompatibleImageApi.ts)、[falAiImageApi.ts](../../src/lib/falAiImageApi.ts) | 各类协议、结果提取和轮询适配 | 服务商兼容 |
| [src/lib/db.ts](../../src/lib/db.ts)、[cloudSync.ts](../../src/lib/cloudSync.ts) | IndexedDB、缩略图、同步队列、资产映射 | 本地持久化与云同步 |
| [src/lib/gouoBackend.ts](../../src/lib/gouoBackend.ts) | 账号、令牌、余额和云库 HTTP 客户端 | 前后端产品接口 |
| [server/router](../../server/router)、[middleware](../../server/middleware) | 路由、认证、权限、限流和渠道分发 | 接口入口与访问控制 |
| [server/controller/gouo_cloud.go](../../server/controller/gouo_cloud.go)、[model/gouo_cloud.go](../../server/model/gouo_cloud.go) | 光构任务、资产、收藏和存储配额 | 云端作品库 |
| [server/relay](../../server/relay)、[providers](../../server/providers) | 上游协议、中继和结算 | 模型渠道与计费 |
| [deploy](../../deploy)、[Dockerfile](../../Dockerfile) | 容器编排、反向代理、环境示例 | 产品部署 |

修改前端时遵循根目录 [AGENTS.md](../../AGENTS.md)；修改后端与管理后台时还要遵循 [server/AGENTS.md](../../server/AGENTS.md)。新持久化字段要考虑旧数据清洗，IndexedDB 结构变更要考虑版本升级与迁移。

## 核心业务流程

### 登录和账号隔离

`main.tsx` 用 `BackendAuthGate` 包住工作台。产品模式先请求 `GET /api/user/self`，未登录时显示登录页。登录成功后激活当前用户的本地存储作用域；若作用域改变，刷新页面后再加载该账号的数据。

随后前端从 `GET /api/token/playground` 获取用户中继令牌。后端按用户查找或创建 `sys_playground` 令牌，并校验已有令牌的有效性；图片请求使用该令牌，账号与云库请求使用 Cookie 会话。`UnlimitedQuota` 表示令牌自身没有独立额度上限，图片调用仍需要检查用户余额。

跨标签页的账号切换会触发存储作用域检查。云同步也会再次确认登录用户与本地作用域一致。服务端 `/api/gouo` 路由使用 `UserAuth`，模型查询包含 `user_id` 条件；管理接口使用 `AdminAuth`。本地隔离和服务端资源归属校验共同保护账号数据。

依据：[BackendAuthGate.tsx](../../src/components/BackendAuthGate.tsx)、[storageScope.ts](../../src/lib/storageScope.ts)、[token.go](../../server/controller/token.go)、[api-router.go](../../server/router/api-router.go)、[gouo_cloud.go](../../server/model/gouo_cloud.go)。

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

产品模式通过 `createBackendSettings` 使用 Images API，并关闭流式传输。纯前端模式保留 Responses API、流式中间图、fal.ai 和自定义异步任务兼容能力；这些能力不能直接当作托管产品已经开放的功能。

普通页面刷新不会恢复已中断的 OpenAI 请求，初始化会把仍处于运行状态的这类本地任务标记为失败。fal.ai 和自定义异步服务商在保存了服务端任务 ID 的情况下，可以继续查询结果。云库同步的是作品记录，不能代替持久化的服务端图片生成队列。

依据：[store.ts](../../src/store.ts)、[api.ts](../../src/lib/api.ts)、[gouoBackend.ts](../../src/lib/gouoBackend.ts)。

### 计费和失败处理

`/v1/images/generations`、`/v1/images/edits` 和 `/v1/images/variations` 按公开模型定价，每次成功 HTTP 请求收费。模型配置复用 `Price` 表，目录 `/api/gouo/models` 结合实际令牌权限和可用渠道返回售价、能力、输出上限和版本。额度公式为 `ceil(人民币价格 / PaymentUSDRate × QuotaPerUnit)`；无有效价格的模型禁止调用，不回退通用计费。前端模型选择按账号记忆，任务固定模型与报价。

图片中继通过事务条件更新原子预扣用户和令牌额度，不跳过高余额账号。整个 HTTP 请求的渠道重试共用一份预扣，后端失败退款、成功结算，日志记录公开模型、单价快照、计费单位、版本和实际额度；用户组倍率和渠道模型映射不改变售价。价格或能力变化会要求客户端重新确认。

单个请求在模型数量上限内要求多张图仍收费一次。旧 `GOUO_IMAGE_PRICE_CNY` 只用于首次迁移默认模型，迁移的输出上限为 1 张，其他模型需要管理员启用并定价。产品模式关闭请求拆分；纯前端兼容模式可能拆成多个分别收费的请求。浏览器超时、下载图片失败或本地保存失败，不必然说明上游调用失败或后端应退款。持久账本支持中断后核对：未发送的预扣超过 20 分钟自动退款，已发送但结果未知的请求由管理员核对渠道记录后处理。用户可在使用记录查看请求状态；重试会要求确认新请求费用。

依据：[relay/main.go](../../server/relay/main.go)、[quota.go](../../server/relay/relay_util/quota.go)、[openaiCompatibleImageApi.ts](../../src/lib/openaiCompatibleImageApi.ts)。价格、付款配置与生产验证见[后端说明](./backend.md)。

### 云端作品同步

前端用 IndexedDB 保存任务、图片、缩略图、同步队列、游标和本地图片到云资产的映射。终态任务变化后入队，同步先上传关联图片，再写入任务及收藏关系，最后按游标拉取云端变化并合并到本地。缩略图在拉取时下载，原图可按需读取。

同步在初始化、相关状态变化、网络恢复、窗口聚焦及手动重试时触发。队列记录失败次数与下一次尝试时间，但没有独立的持续轮询定时器；下一次同步运行才会处理符合条件的重试项。它提供作品同步，不提供多人实时协作或已验证的并发冲突解决保证。

资产由后端重新计算 SHA-256，并在同一用户内去重。数据库保存任务元数据和归属，文件保存在 `GOUO_ASSET_DIR`。读取图片必须经过鉴权接口，不能把这个目录直接作为公开静态资源。

| 默认限制 | 数值 | 配置 |
| --- | --- | --- |
| 每用户资产空间 | 2 GiB | `GOUO_ASSET_USER_QUOTA_BYTES` |
| 单文件大小 | 25 MiB | `GOUO_ASSET_MAX_FILE_BYTES` |
| 单任务关联资产数 | 32 | `GOUO_ASSET_MAX_TASK_FILES` |

前端上传逻辑也限制为 32 个关联资产，包含参考图、遮罩、输出图和缩略图等；只增加后端限额不会自动扩大前端同步范围。管理员可为用户设置单独空间额度。

删除已同步任务会设置隐藏状态并进入可恢复回收站，云文件继续占用空间。本地未同步任务的删除走本地清理。云同步失败时，本地作品可能仍可查看，但清浏览器数据或换设备可能失去尚未上传的内容。

依据：[db.ts](../../src/lib/db.ts)、[cloudSync.ts](../../src/lib/cloudSync.ts)、[controller/gouo_cloud.go](../../server/controller/gouo_cloud.go)、[model/gouo_cloud.go](../../server/model/gouo_cloud.go)。

## 运行和部署

本地完整产品需要公开前端、Go 后端，以及编译后嵌入后端的管理后台。文档要求 Node.js 22 和 Go 1.25；根前端用 npm，管理后台用 Yarn。SQLite 是未配置 `SQL_DSN` 时的默认数据库，Redis 可在本地省略。Windows 使用当前 SQLite 驱动还需要支持 CGO 的 C 编译器。

开发访问前端 `http://127.0.0.1:5173`，后端默认监听 3000。Vite 根据 `VITE_GOUO_BACKEND_DEV_TARGET` 代理 `/api`、`/v1` 和 `/panel`；完整产品示例将目标设为 `http://127.0.0.1:3000`。空数据库会创建 `root` / `123456`，必须及时改密码。

当前产品部署入口是根目录 `Dockerfile` 与 [deploy/docker-compose.yml](../../deploy/docker-compose.yml)。Compose 启动 Nginx 前端、Go 后端、MySQL 8.4 和 Redis 7.4；公开端口默认 8080，后端管理端口只绑定宿主机 `127.0.0.1:3000`。生产 Nginx 代理 `/api/` 和 `/v1/`，没有把 `/panel` 代理到公开端口；管理后台需要经受控入口访问。

数据库保存账号、额度、渠道与作品关系，`backend-data` 保存后端数据和资产。备份恢复必须同时覆盖数据库、资产文件和相关签名密钥。多个后端实例还需要共享数据库、协调层和资产文件系统；光构专用云库目前使用文件目录，不能因为上游有对象存储模块就认为本产品云库已经接入对象存储。

仓库还保留 GitHub Pages、Vercel Hook 和镜像发布工作流。[Docker 工作流](../../.github/workflows/docker.yml)与 Compose 统一使用根 [Dockerfile](../../Dockerfile)，构建启用后端的产品前端；`gpt_image_playground` 镜像名称保留兼容。旧 [deploy/Dockerfile](../../deploy/Dockerfile) 不再用于自动发布。静态托管工作流仍需单独配置后端地址。本轮只修改发布配置，没有触发发布。

操作步骤见[开发指南](./development.md)、[Docker Compose 部署](./deployment/docker.md)、[Linux 手动部署](./deployment/manual.md)和[上线检查清单](./deployment/checklist.md)。

## 验证状态和后续工作

2026-10-05 在当前 Windows 工作区及 Docker Linux/CGO 环境完成以下检查。使用隔离数据库和模拟图片上游，不代表生产服务或真实上游计费已经通过回归。

| 检查 | 结果 |
| --- | --- |
| 根前端 `npm ci` 和 `npm run build` | 通过 |
| 根前端 `npm test` | 19 个测试文件、194 项测试通过 |
| 管理后台 Yarn 锁定安装和构建 | 通过，已生成嵌入所需文件 |
| Go 1.25.14 与后端 `go mod download`、`go mod verify` | 完成，模块校验通过 |
| Docker Linux/CGO 后端编译及 model/controller/relay/relay_util 包测试 | 通过 |
| 隔离 SQLite/Redis 与模拟上游 HTTP 验收 | 模型目录、不同价格、映射、失败退款、内部重试、报价变更、有限令牌与并发余额检查通过 |
| 桌面和 390px 手机界面 | 模型选择、账号选择记忆、数量/编辑能力限制、模拟生成和参考图编辑通过；后台价格加载、校验及保存通过 |
| 真实收费上游、MySQL/PostgreSQL、生产迁移、跨设备同步、支付和 CSV 文件下载端到端 | 未验证 |

根目录 npm 安装报告 17 项依赖漏洞，其中 12 项为 high。这是安装时的审计结果，不等于已证明存在可利用的线上漏洞；本次未执行自动修复或升级。前端构建还提示旧 Browserslist 数据和混合导入，管理后台提示 peer dependency、Tailwind 内容配置和较大分包，这些警告未阻止本次构建。

上线前应在目标数据库验证迁移和备份恢复，再用真实上游与独立账号回归生成、计费、同步和回收站，最后核对发布工作流与依赖审计。在线支付需要单独验证配置、回调、重复通知和对账；源码中存在上游支付能力不代表可以直接对外开放收款。

## 文档阅读顺序

1. [用户指南](./user-guide.md)：了解公开产品的实际入口。
2. [开发指南](./development.md)：搭建环境并明确运行模式。
3. [后端说明](./backend.md)：配置渠道、价格、空间与备份。
4. [测试与本地模拟 API](./testing.md)：定位兼容和异常场景。
5. [部署总览](./deployment/index.md)：选择部署方式并完成上线检查。

前端来源为 GPT Image Playground，使用 MIT License；后端来源为 One Hub，保留 Apache-2.0 声明。上游通用说明在 `server/docs/`，光构产品接入与部署以根目录 `docs/` 为准。来源和许可见 [README.zh-CN.md](../../README.zh-CN.md)。
