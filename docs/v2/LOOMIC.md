# Loomic 创作工作台接入记录

## 选择与来源（2026-09-30）

用户要求使用成熟项目的完整前端，兼顾无限画布与智能体；以图片生成开始，视频生成后续接入，不做视频剪裁、不接云库、不迁移旧数据。因此用 Loomic 原有创作界面替换 Fabric starter。

- 上游：[fancyboi999/Loomic](https://github.com/fancyboi999/Loomic)。固定提交 `bdb47a5adf900b48615af0bd914336e3770021b5`，MIT。
- 接入源：`v2/apps/studio/src/loomic/`。保留上游 LICENSE；`UPSTREAM.json` 记录原始路径和文件 SHA-256，哈希对应适配前的原文件。
- 保留原生 CanvasPage 布局、Excalidraw 编辑器、浮动工具栏、图层/文件面板、项目菜单、聊天/会话/消息/附件面板和共享事件契约。项目列表也复用上游组件。
- Next 的 dynamic/link/navigation 改为薄层 React/Vite/Router 适配；继续使用上游 Tailwind 样式。未复制完整第三方仓库、node_modules 或上游后端。

## 最新实际行为（2026-10-02）

默认`/studio/`为持久assistant-ui聊天；Loomic创作工作台在`/studio/canvas`，官方Excalidraw与私有服务器项目已接通，共用New API身份和侧栏。旧Loomic草稿仍按owner scope保存在IndexedDB；服务器项目、原图与会话则按真实Native owner保存在Studio SQLite。没有覆盖、删除或迁移旧草稿，详见 [WORKSPACE-NAVIGATION.md](WORKSPACE-NAVIGATION.md) 与 [SYSTEM-INTEGRATION-PLAN.md](SYSTEM-INTEGRATION-PLAN.md)。

assistant-ui已有按thread/run的只读历史恢复；SYS-R1新增`GET /api/studio/requests/:kind/:id/result`覆盖Loomic无threadId及独立生图已保存结果，前端保存原ID与恢复入口仍待接线。当前没有持久Worker、供应商取消或月度订阅。以下早期默认画布、Agent偏好清理与“没有服务器恢复接口”等叙述属于当时阶段，模型失权选择保留以MODEL-SELECTION.md最新合同为准。

## 早期接入行为（历史，2026-09-30）

`/studio/` 直接打开创作画布；`/studio/projects` 列出本地草稿。可以导入 PNG/JPEG/WebP、编辑图片和文字/图形、使用原生图层工具、缩放/平移、保存草稿、重新打开并导出 PNG 或 Excalidraw 文档。移动端默认收起聊天，点击“对话”后打开覆盖面板。

项目、图片文件、会话和消息存入 IndexedDB。访客与登录账号按 `local:guest` / `local:<New API user id>` 显示各自的草稿；登录切换不迁移访客草稿。这只是浏览器内的分类，不是共享设备上的安全隔离或云同步。清理站点数据会删除草稿，请导出备份。快速关闭页面时浏览器不保证异步保存完成，重要修改使用“本地保存”，等待成功提示后再刷新或关闭。

原生组件里部分 `accessToken` 属性沿用上游名称，现在传入的是本地草稿 scope，真实账号令牌由现有 `api.ts` 在内存中管理。`use-websocket.ts` 保留事件消费契约，但运输层改为同源认证 HTTP：现通过 `/api/studio/runs/stream` SSE 逐 token/工具事件交付，原 `/runs` 批次兼容保留。没有 WebSocket 服务、服务器恢复接口或持久化 Worker。部分文字节流保存到原会话，停止接收不代表取消供应商费用。取消按钮中止浏览器等待，不能保证取消已经提交到模型的操作或费用。

按用户要求，侧边栏恢复原版 `Agent Model` 选择器，仅列出可用的对话模型和 `Auto (workspace default)`。图片模型仍在原生独立 `Image model` 偏好设置中选择，供智能体工具使用；工具栏“AI 生成图片”继续提供独立生图面板。目录成功加载后，只清除已失效的 Agent 模型偏好（含之前选过的图片模型），保留有效对话选择及独立图片设置。聊天提交显式选择对话模型；无可用对话模型时停止并提示，不自动调用图片渠道。

没有搬入 Loomic 的 Supabase 认证/对象存储、PGMQ、积分/支付和品牌库。共享目录仍包含原始 DTO 类型；这些类型不代表对应服务已接入。视频渲染与事件契约保留，生成动作禁用；业务 API 同样拒绝视频请求。

## New API 与业务服务

```text
Browser /studio/  (React + Loomic + Excalidraw)
  /api/user/*    -> New API account service :3000
  /api/studio/*  -> v2/apps/api (Fastify) :3001
                       validates Bearer via New API /api/user/self
                       server-only relay -> New API /v1
                       LangGraph agent -> Chat Completions + Images tool
```

New API 固定开发版本 `v1.0.0-rc.40`，源码提交 `0aec08fee811ec6136828fda790551b49e410301`。业务服务独立于旧 `server/`，浏览器不调用 `/v1`，不获取 relay key。

| 接口 | 当前用途 |
| --- | --- |
| `GET /api/studio/health` | 本地创作服务健康状态 |
| `GET /api/studio/models` | 脱敏能力目录，不包含上游 ID、内部地址或密钥 |
| `GET /api/studio/billing` | 当前账号的人民币余额、原生用量、模型单价和最近消费记录 |
| `POST /api/studio/images` | 认证后执行已验证的 Images JSON / multipart 编辑协议 |
| `POST /api/studio/runs/stream` | 真实 SSE 文本/工具事件，终态保存后携带费用状态 |
| `POST /api/studio/runs` | 认证后执行 LangGraph 智能体或图片模式，返回 Loomic 事件数组 |

智能体采用 LangGraph 的 `createReactAgent` 和 ToolNode，不手写推理引擎。服务端提供唯一生图工具，最多生成一张图片/请求，不配置视频工具。侧边栏仅提交对话模型，由智能体使用独立图片偏好调用生图工具；独立生图面板通过 `/api/studio/images` 发送图片需求。`/api/studio/runs` 的历史直接图片协议兼容仍保留，前端不再从 Agent 选择器进入该模式。模型与参数来自服务端目录，不能由浏览器提供任意供应商地址。智能体附件需要视觉聊天模型；图片编辑需要该图片模型验证过的 edit 能力。当前图片结果只接受内嵌 b64_json，URL-only 返回会明确报错，没有任意 URL 图片代理。

本地图片导入上限 15 MB / 2400 万像素；发送给模型的参考图验证上限为单张 8 MB / 2400 万像素，最多 4 张，整个 HTTP 请求上限 20 MB。图片魔数/尺寸由 Sharp 检查。未验证质量、比例或编辑能力直接拒绝，不静默丢参数或降级。

SQLite 记录 owner/kind/idempotency key、请求哈希和已完成响应；同 key 重放返回结果，改参数冲突，未知/中断请求阻止重复提交。SDK 和图片请求均不自动重试。它是单实例开发阶段的重复提交保护，**不是 B3 的持久化任务队列、订阅权益、预留额度或用量账本**。数据库可能保留提示词和结果图片，生产前需完善权限、保留/删除策略、限额与恢复机制。

## 启动与安全默认值

### 渠道与原生计费

服务端模型可配置 `channelId`，分别将对话和图片操作固定到对应 New API 渠道。此时 `GOUO_RELAY_API_KEY` 使用未固定渠道的基础令牌，由适配器为每次调用添加原生渠道标记；不要把全局令牌固定到图片渠道。New API 的 `PinRetrySingleAttempt` 与 SDK `maxRetries=0` 一起阻止付费请求自动重试。启用工具调用还需该聊天模型的 `toolCalling=true` 和已验证的图片模型；每次最多一张图片，对话调用上限由 `maxChatCalls`（1–3）、单次输出上限由 `maxTokens` 控制。目录里的名字不代表已验证能力。

余额与结算直接读取 New API 的当前账号、原生价格和消费日志，不另建一个模拟积分账本。画布右上角显示人民币余额，账号窗口展示累计消耗、分组倍率、模型单价和最近调用；生成结束后刷新用量。人民币金额使用原生 `quota_per_unit` 与配置的 `usd_exchange_rate` 换算，汇率不是实时行情。已知 token 表达式只用于单价展示，未识别规则显示“按网关规则结算”，不在业务层执行表达式或自行扣费。

创作响应携带原生 request ID 对应的费用；一个智能体任务可能包含两次对话和一次生图，按所有实际调用结算。账单未到账或请求结果不确定时显示待结算，不伪造零费用；已生成图片仍交给画布。同一请求重放返回保存结果，避免再次调用模型。账号用量查询只读取自己的日志，去除令牌名和私有请求元数据；原生管理员“模型测试”日志不混入最近创作调用。

本实例用户选择保留现有单价、default 分组 1 倍计费，New API 显示改为人民币，保留配置的 1 USD = 7.3 CNY。`gpt-5.6-sol` 输入/输出分别为 USD 5/30 每百万 token；`gpt-6-astra` 和 `gpt-image-2` 保留原生分层表达式。其他聊天别名缺少可靠价格时继续不可用，不自动套用兜底单价。没有新增月度订阅、支付或手工改余额；当前开发账号绑定仍不等于多用户商业授权服务。真实渠道验证结果见 STATUS.md。

要求 Node 22.16+、npm；当前验证为 Node 22.22.0 / npm 11.9.0。仓库根运行 `node v2/scripts/setup.mjs`，然后：

```sh
cd v2
npm run dev
```

该命令同时启动 Studio API 3001 和 Vite 5174。账号服务 New API 3000 单独启动；本地画布不要求账号或模型可用。实际预览地址为 `http://127.0.0.1:5174/studio/`。生产需要同源反向代理分别分发账号与 Studio API；Vite preview 仅用于静态资源检查。

环境示例见 `v2/.env.example`，默认没有密钥且 `GOUO_ENABLE_GENERATION=false`。服务端默认读取 `v2/config/loomic.models.example.json`，里面都是禁用的占位 ID，不能直接当成真实模型列表。

后续配置流程：在 New API 配置实际模型渠道；复制示例到仓库外的服务端配置文件，填实际 upstreamModelId、操作/质量/比例映射，先保留 pending/disabled。按 `MODELS.md` 对具体渠道协议做探测，付费探测需要单独授权。只有该渠道 live-verified 后，管理员才启用对应模型、配置服务端 `GOUO_RELAY_API_KEY`、`GOUO_STUDIO_MODELS_FILE` 和生成开关，并重启 Studio API。视频始终不可用，直到另行实现适配。

密钥只放服务端 `.env` 或机密管理设施，不用 VITE_*、不提交、不放浏览器存储或日志。复用单个开发账号的 relay token 时必须设置 `GOUO_RELAY_OWNER_ID` 为其真实账号 ID，其他账号不能代用。开启生成且提供 relay key 却缺少 owner 时，服务启动报错；目录与生成路由也拒绝无有效 owner 的配置。默认禁用生成的预览不要求 owner；它不是多用户 token 管理或订阅授权服务。联合启动的 Vite 子进程不继承 relay key。当前账号采用 Bearer 内存令牌 + HttpOnly refresh Cookie。临时公网 helper 已验证同源账号/Studio 转发、精确 Origin 与 Secure/HttpOnly/Strict Cookie；生产 HTTPS、额度/并发与支付策略尚需验证，当前开发开关不替代生产收费授权。

## 字体与许可证

`v2/apps/studio/public/third-party-notices.txt` 随构建发布，保留 Loomic、Excalidraw、UI 依赖与字体声明。字体从锁定 npm 包同源提供，不提交字体二进制，不依赖字体 CDN。保留 Excalifont、Comic Shanns、Xiaolai、Nunito、Lilita、Cascadia、Assistant 和 Geist 的独立许可声明。

排除 Excalidraw 包中已废弃的 Liberation 字体资源，不提供使用该旧字体的历史文档兼容。本项目没有待迁移旧文档，当前使用编辑器现行字体。New API 作为独立 AGPL-3.0 上游服务，应按实际修改与对外服务方式履行其许可义务；Loomic 的 MIT 不覆盖 New API 或全部传递依赖。

## 已验证与下一步

验证结果与命令见 `STATUS.md`。浏览器中已验证导入→保存→刷新→导出、本地项目再打开/新建、登录切换草稿、聊天失败提示、协议 fixture 的图片进入画布并恢复，以及移动端布局。API 测试包含真实 LangGraph 工具循环连接本地 OpenAI 协议 fixture，未调用付费渠道。

当前云环境已在用户明确付费授权后，验证渠道 1 的 `gpt-image-2` 默认参数 Images 生成，并另外完成渠道 2 的 `gpt-5.6-sol` 调用该图片工具及对话总结的真实链路，返回 1254×1254 PNG，三次调用共 ¥0.5033058，详见 STATUS.md。本实例启用这两个已验证模型；token 与模型配置留在仓库外，仓库示例默认禁用，其他模型、视觉、编辑和视频仍待验证/实现。云库、模板商品字段、批量生成、可恢复队列与订阅不是本次交付。下一项是 B2 其余渠道能力验证；收费开放前完成 B3/S1。

### 并发拒绝与请求重放

当前单进程并发守卫在创建新 SQLite 请求记录之前拒绝同账号的忙碌请求，返回 409 并明确“本次请求尚未执行”。调用方可等待后使用同一请求 ID 重试；客户端不会自动重试生成。已有完成结果在忙碌期间仍可重放，正在执行或结果未知的同 ID 请求仍拒绝，参数变更仍冲突。真正发出后失败/重启遗留的 unknown 记录不会被此修复解除。旧版本已写成 unknown 的记录无法仅凭数据库辨认是否产生了上游调用，仍需核对网关，不自动清理或重新生成。此守卫不是多进程分布式锁或持久 Worker。
