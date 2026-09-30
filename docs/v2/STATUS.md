# 实际交付与验证状态

## 独立 QA 问题修复（2026-09-30，最新）

基于 `c8fcce0` 的独立测试复现两项问题，本次在独立修复分支处理，没有修改实际账号、渠道、凭据或部署：

- 个人 relay 开启生成且提供 key 时必须配置有效 `GOUO_RELAY_OWNER_ID`；缺省时启动报错，直接构造无有效 owner 的服务也会在目录和图片/Agent 路由拒绝生成。其他账号仍 403，个人账单读取与禁用生成的本地预览不受影响。此服务仍非多租户 token 分配系统。
- 同账号忙碌时，新请求在写入 SQLite 之前返回“尚未执行”，空闲或服务重启后可用原 ID 重试。既有完成结果仍可重放，参数冲突、处理中/未知结果继续阻断；没有解除历史 unknown 或自动重试可能扣费的调用。
- 定向更新 Fastify 5.12.5、lodash-es 4.18.1，并仅将 Nano ID 3.3.3 覆盖到 3.3.19。审计 13 → 6 项（2 high / 4 moderate）；剩余 Sharp、Mermaid/Nano ID、LangGraph/UUID 的升级选择见 DEPENDENCIES.md，不声称生产安全检查全部通过。

| 本地检查 | 结果 |
| --- | --- |
| 锁文件安装与依赖树 | `npm ci` 成功，`npm ls --all` 无 invalid 依赖 |
| `npm run check` | 类型检查、14 个领域/探测测试、20 个 API 测试、生产构建通过 |
| 新增回归 | 5 项；旧实现 4 失败 / 1 通过，修复后 5/5；覆盖两个生成端点、owner 缺省/非法/配置、并发拒绝后跨重启重试、完成重放与参数冲突 |
| `npm run test:e2e` | 12/12，通过认证、模型选择、画布恢复、费用 fixture、移动端与中断流程 |
| 独立浏览器 QA | 10/10，通过文字编辑/PNG、图片删除/撤销重做、快速刷新、导航保存、访客/双账号草稿隔离、重复回车、延迟图片取消、损坏文件和存储失败提示 |
| `npm audit` / `--omit=dev` | 均剩 6 项（2 high / 4 moderate），未执行 force 升级 |

本地使用 Node 24.19.0；仓库 CI 使用 Node 22，最终远程提交及检查结果以草稿 PR 为准。测试全部为合成账号、本地 mock/临时 SQLite，无真实模型、扣费、支付或生产数据库。现有构建仍有较大分包告警。此前已写为 unknown 的请求仍需核对网关；不自动删除账本记录。

## 恢复 Loomic 原版 Agent 选择器（2026-09-30，此前）

用户要求去除此前添加的 Agent 图片模式，恢复原版。选择器的界面与上游固定版本一致，只列出可用对话模型和 `Auto (workspace default)`；图片模型保留在原生独立 `Image model` 偏好设置与“AI 生成图片”面板。没有回滚 New API 认证、跨渠道工具调用或原生用量计费。

目录成功加载后清除失效的 Agent 偏好（含旧图片选择），保留有效对话模型及独立图片偏好。聊天提交显式使用对话模型；无可用对话模型时提示配置渠道并停止，不自动转为直接生图。服务端历史图片模式协议兼容保留。访客登录提示和跨项目取消保护继续通过现有流程验证。

| 检查 | 实际结果 |
| --- | --- |
| `npm run check` | 类型检查、14 个领域/探测测试、15 个 API 测试、生产构建通过 |
| `npm run test:e2e` | 12 passed；覆盖混合目录仅显示对话模型、旧图片选择清理、独立图片偏好/工具结果/账单、有效选择刷新保留、仅图片渠道零生成提交，以及既有账号/草稿/移动端/取消流程 |
| `verify-agent-selector.mjs`（环境 helper） | 当前公网生产构建检查通过：原版选择器、独立图片偏好与刷新保留；不登录、不发起付费模型调用 |
| 密钥检查 | 全部 369 个前端构建文件与当前源码 diff 不含真实本地账号密码、provider / relay 凭据 |

公网检查发现旧画布 tunnel 进程已退出，本地预览与业务 API 均为 200；已恢复新的临时入口，实际 URL 以环境 `state/public-url.json` 为准。新 origin 的 IndexedDB 草稿独立，旧已打开页面需先导出备份。本次没有新增付费验证，也没有变更渠道、价格或余额。下一项仍为 B2 的其余模型/参考图协议验证；视频、云库、Worker 与订阅不在本次范围。

## 对话 / 生图跨渠道与 New API 原生计费（2026-09-30，此前）

用户新增对话渠道后，旧启动 helper 仍把整个 relay token 固定到图片渠道 1，导致对话渠道 2 无法用于画布。现按每个模型的 `channelId` 分别固定路由，基础 token 留在服务端内存；每次请求同时使用原生 `PinRetrySingleAttempt` 和 SDK 零重试。启动只读既有账号/token/渠道元数据，以实际 `/v1/models`、渠道启用状态和独立验证状态生成 active 配置。

- 已接通同一个 LangGraph 请求里的对话 → 图片工具 → 对话总结。聊天模型需明确 `toolCalling`，本实例最多两次对话、一张图片；未验证视觉/参考图/编辑能力仍拒绝。上游错误展示脱敏 HTTP 状态，不传回密钥或原始供应商错误。
- 新增认证 `GET /api/studio/billing`，读取当前账号真实余额、累计用量、原生价格和自己的消费日志。右上角显示人民币余额，账号窗口提供单价、最近调用和刷新；创作结束后自动刷新。修正账号弹窗的 stacking context，避免画布工具栏遮住余额/价格。
- 创作响应通过原生 request ID 汇总实际费用；三个模型调用都纳入同一创作消费。同请求重放复用已保存结果，不重复生成或查账。账单未到账、ID 缺失/重复或失败请求返回 pending，不伪造零费用；已经产生的图片不会因查账失败丢失。
- 用户确认“保留现有单价，1 倍计费”。通过 New API 原生管理 API 的乐观版本校验持久化既有 `gpt-6-astra` / `gpt-image-2` 有效表达式，保留 `gpt-5.6-sol` 的既有 USD 5/30 每百万输入/输出 token。default 倍率仍为 1，显示改 CNY，沿用配置汇率 7.3；前后 effective pricing 全部一致。未手工修改余额、创建凭据、变更订阅或改上游实现。其他对话别名缺乏可靠价格，未猜价启用。

第一次单独授权的完整链路探测在首个 `gpt-5.6-sol` 对话请求返回 HTTP 503（上游连接超时），没有调用图片模型，也没有该 request ID 的原生消费记录。只读供应商 `/v1/models` 为 200，包含该模型。保留失败报告 `state/gpt-5.6-agent-probe.json`，没有自动重试。

用户再次明确授权额外一次复验后，完整链路成功：**渠道 2 的 gpt-5.6-sol → 渠道 1 的 gpt-image-2 → 渠道 2 的 gpt-5.6-sol**，一张 1254×1254 PNG，合计三次调用。原生账单为 **34473 quota = ¥0.5033058**，账号 used_quota / balance 同量变化、request_count 增加 3。真实业务请求重放返回同一结果，没有再次执行模型。脱敏报告 `state/gpt-5.6-agent-recheck.json` 和真实图片 `state/verified-agent-cup.png` 留在仓库外环境私有 state；两个探测都有独立 wx 一次性守卫，授权已用完，setup/CI/重启不得重跑。

本实例仅这两个模型启用；`gpt-6-astra` 虽有既有价格，工具协议仍未实测，其余对话别名价格/能力不足，保持不可用。仓库示例仍 pending/disabled，不能把结果套用到其他渠道或新环境。视频、月度订阅、云库和可恢复 Worker 不在本次交付。

| 检查 | 实际结果 |
| --- | --- |
| `npm run check` | 类型检查、14 个领域/探测测试、15 个 API 测试和最终生产构建通过 |
| `npm run test:e2e` | 12 passed；含原生工具图片进入画布、人民币单价、自动刷新余额/本次创作费用、手动刷新、直接图片面板消费、认证/草稿/移动端/跨项目迟到结果保护；最后补齐直接图片费用传播后，两项创作流程复验通过，类型/构建再次通过 |
| API 负向/费用检查 | 跨账号查询只取自己的日志、生成 token 仍 owner bound；匿名/伪造身份/未知能力拒绝；幂等重放、不确定费用保留图片；未知定价表达式不伪造单价；渠道分别固定、受限工具循环、503 不重试且不泄露原始错误 |
| New API 配置 | 原生配置前后有效单价一致；default 1 倍、CNY、汇率 7.3，脱敏审阅记录 state/billing-configuration.json |
| 密钥检查 | 全部 369 个前端构建文件与 staged 源码不包含真实账号密码、provider / relay key；Vite 子进程不继承 relay key |
| 公网真实账号与计费 | 恢复后的公网登录、Secure/HttpOnly/Strict Cookie、内存 token、真实 CNY 余额/单价、匿名 billing 拒绝、刷新恢复和退出撤销通过；该浏览器检查阻止所有生图/对话 POST |
| 真实授权复验 | 首次 503 无该请求消费记录；用户另行授权的一次复验成功，3 次模型调用、1 张图片、费用 ¥0.5033058、重放无重复调用 |

原临时画布 tunnel 已断开并重新建立；URL 以环境 state/public-url.json 为准，不再使用旧地址。浏览器 IndexedDB 随 origin 隔离，用户原已打开页面的草稿需导出备份；临时链接变化不表示云同步。进程/连接仍不随环境休眠保存。这是开发实例接通和原生用量计费，不是公众销售/订阅权益完成；下一项仍为 B2 其余模型与参考图协议验证，公众销售需 B3/S1。

## 画布登录与实际图片渠道接通（2026-09-30，此前）

原外网画布 helper 只提供静态页面和模型状态，拒绝账号/生成接口；业务服务也没有读取用户新配置的渠道令牌，并且对话入口强制要求聊天模型。因此“New API 渠道测试成功”没有接通画布。

- 当前临时公网画布同源转发真实登录、profile、refresh、logout 和 Studio API。登录写入检查精确 Origin，认证 Cookie 为 Secure/HttpOnly/Strict；管理后台和 `/v1` 继续使用独立 New API 入口。helper 位于云环境 `/workspace/gouo-public-preview/`，可重用启动说明已保存到环境配置草稿。
- 新增图片模式：只有图片渠道时，对话栏直接发送图片需求，不要求额外聊天模型；有聊天模型时仍可使用 LangGraph 工具循环。选择器、输入提示与按钮区分这两种行为，图片结果沿用 Loomic 事件契约进入原生画布。画布参考图的 `canvas-ref` 类型已与业务请求对齐。
- `GOUO_RELAY_OWNER_ID` 可将开发 relay token 的生成权限限定到其原账号；其他真实账号及伪造 `New-Api-User` 不能消费该 token。Vite 子进程不继承 relay key。
- 云环境启动 helper 只读现有开发 New API 数据库，在内存复用用户已创建的 token，不生成新 token、不复制 provider key。根据实际 `/v1/models` 可见列表生成服务器模型配置，并固定渠道 1，利用 New API `PinRetrySingleAttempt` 阻止内部重试。既有账号、权限、配置、余额和订阅没有被手工修改。

用户单独授权一次真实 `gpt-image-2` 图片验证。实际 `POST /v1/images/generations`，`n=1`、`response_format=b64_json`、未指定质量/尺寸；HTTP 200 返回一张通过 Sharp 格式/像素校验的 **1254×1254 PNG**。耗时约 37 秒；New API 日志为同一次 attempt 的 channel_selected/request_completed，消费日志总数从 5 增至 6，没有第二次请求或失败重交。脱敏报告和测试图片保存在环境私有 state，未提交图片或凭据。

仅环境中的 `gpt-image-2`、渠道 1、固定 New API `v1.0.0-rc.40` 的本次默认参数生成操作标为 live-verified 并启用。其余图片别名保持不可用；`gpt-image-2-4k` 未出现在该 token 的实际目录中。编辑、质量、比例参数、其他模型和一般文字聊天均未因此获得验证。仓库示例配置继续 pending/disabled；不能将本次结论套用到其他渠道或新安装环境。

| 本次检查 | 实际结果 |
| --- | --- |
| `npm run check` | 类型检查、14 个领域/探测测试、10 个 API 测试及构建通过；随后补充跨创作模式复用请求 ID 的防重复消费检查，最终 `npm run test:api` 为 11 passed |
| `npm run test:e2e` | 12 passed；新增仅图片渠道的模式选择、发送及结果进入画布检查；初次因两个生图按钮同名导致定位歧义，明确对话按钮名称后全套通过 |
| 最终 `npm run build` | 通过，临时外网入口已使用更新后的生产构建 |
| 公网真实账号 | 原生画布登录、内存 token、Secure/HttpOnly refresh、刷新恢复、退出撤销、匿名/外站拒绝、畸形图片请求拒绝通过；此账号检查没有发起模型调用 |
| 密钥检查 | 实际 relay key 不在全部 128 个前端构建文件中；代码/测试/文档不包含真实密钥 |
| 真实图片验证 | 用户授权后恰好一次 Images 调用成功；结果为 1254×1254 PNG |

下一项仍为 B2：按用户选择验证其他模型及参考图编辑能力；视频、可恢复 Worker、云库、订阅权益仍未接入。临时 tunnel URL 随重启变化，环境休眠后服务需要按启动说明恢复；这不是生产部署。

## Loomic 集成：此前交付（2026-09-30）

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
