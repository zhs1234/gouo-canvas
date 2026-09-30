# 实际依赖与上游资料

## 当前复用

版本以 `v2/package-lock.json` 为准。本次有意引入 Loomic 需要的 UI 依赖与服务器 SDK，移除 Fabric 和未采用的 Filerobot/Konva 包。只安装到独立 V2 workspace，旧 root package/lockfile 不变。

| 项目 / 锁定版本 | 用途 | 许可 |
| --- | --- | --- |
| Loomic `bdb47a5` | 原生画布、聊天、项目组件与样式 | MIT，源码保留 LICENSE/UPSTREAM.json |
| React / React DOM 19.3.0 | 上游组件渲染 | MIT |
| Excalidraw 0.18.1 | 无限画布及编辑/导出 | MIT；字体单独许可 |
| React Router DOM 7.18.4 / TanStack Query 5.103.1 | 路由薄适配、账号缓存 | MIT |
| Base UI 1.3.0 / class-variance-authority 0.7.1 | 原生菜单/对话框/按钮 | MIT / Apache-2.0 |
| Tailwind / Vite plugin 4.2.2、clsx 2.1.1、tailwind-merge 3.5.0、tw-animate-css 1.4.0 | 上游样式 | MIT |
| Framer Motion 12.38.0 / next-themes 0.4.6 | 原生交互与主题 | MIT |
| lucide-react 1.0.1 / react-colorful 5.6.1 | 图标、颜色选择 | ISC / MIT |
| react-markdown 10.1.0 / remark-gfm 4.0.1 | 智能体消息展示 | MIT |
| idb-keyval 6.2.2 | 本地画布/项目/对话 | Apache-2.0 |
| Zod 3.25.76 | 上游契约和业务请求验证 | MIT |
| Fastify 5.12.5 | 新业务服务 | MIT |
| LangChain core/openai 1.2.0、LangGraph 1.4.18 | 服务端智能体与成熟工具循环 | MIT |
| Sharp 0.35.5 | 图片解码、格式/尺寸边界 | Apache-2.0；本机库独立许可 |
| TypeScript 5.9.3 / Vite 7.3.6 | 类型/构建 | Apache-2.0 / MIT |
| Playwright 1.63.0 / node:test | 浏览器及协议回归 | Apache-2.0 / Node 原许可 |
| Geist variable 5.2.8 | 同源 UI 字体 | SIL OFL-1.1 |

Excalidraw 的 `@radix-ui/react-tabs` 固定覆盖为 1.1.21，兼容 React 19。字体由所锁 npm 包同源提供，声明在 `apps/studio/public/third-party-notices.txt`；排除已废弃的 Liberation 字体资源。传递依赖和本机库仍需分别保留其 NOTICE/LICENSE，不能以此表替代全供应链审查。

New API：独立账号/模型网关 https://github.com/QuantumNous/new-api，开发固定 `v1.0.0-rc.40`，源码 `0aec08fee811ec6136828fda790551b49e410301`。官方发布资产已核对校验清单；AGPL-3.0，对外服务/修改时按实际使用履行义务，MIT 前端不覆盖它。

## 安装与验证

`node v2/scripts/setup.mjs` 默认按锁文件 npm ci。它不会启动生产服务、初始化生产库、下载模型权重或发起付费生成。运行 `cd v2 && npm run check` 和 `npm run test:e2e`，实际结果见 STATUS.md。当前新增依赖全部有实际调用；不用 --force 无差别升级。

不复制完整第三方仓库、node_modules 或字体二进制进 Git。上游源码的改动集中于 Vite/路由、认证、能力目录、本地草稿和新 API 边界，来源与功能限制见 LOOMIC.md。

## 后续按需求引入

B3 需要成熟持久化队列，具体按新服务技术栈选型；不默认添加 Go/Asynq。批量上传确有恢复需求时评估 Uppy。抠图需要隔离 worker 和模型权重独立授权，ComfyUI 不阻塞首发。Loomic 上游 Supabase/PGMQ/积分/支付依赖均未引入。

原 One Hub/Fabric 资料仅作历史参考。E1 不叠加第二套画布引擎；视频接入需要独立协议/任务恢复测试，保留界面并不代表能力已实现。

## 2026-09-30 独立 QA 后的定向安全更新

- Fastify 5.6.2 → 5.12.5，保持 5.x 公共 API；随其声明更新 fast-json-stringify 并去重，不单独强制升级内部序列化器。上游 [5.12.5 安全发布](https://github.com/fastify/fastify/releases/tag/v5.12.5)。
- 精确覆盖 lodash-es 为 4.18.1，解除 Chevrotain 的旧版精确锁定，保持 4.x。
- 仅覆盖 `nanoid@3.3.3` → 3.3.19，修复 Excalidraw 直接依赖；Mermaid 的 Nano ID 4 在下述独立验证后单独处理。
- 锁文件由 npm 实际安装生成；`npm ls` 无 invalid 依赖。未改旧根 workspace。

首轮审计从 13 项（4 high / 9 moderate）降为 6 项。随后针对剩余高危检查实际调用点和上游变更，并增加兼容回归：

| 原有运行时路径 | 修复 / 验证 |
| --- | --- |
| `@gouo/studio-api → sharp@0.34.5` | 升至 0.35.5；GHSA-f88m-g3jw-g9cj 修复下限 0.35.0，GHSA-rgj7-g3m4-5g8c 修复下限 0.35.4。当前应用仅用带像素上限的 metadata，不涉及删除的编码参数；新增 PNG/JPEG/WebP 字节/尺寸/编辑上传、伪装格式、损坏图片、大小上限 5 项回归。 |
| `@excalidraw/excalidraw@0.18.1 → @excalidraw/mermaid-to-excalidraw@2.2.2 → nanoid@4.0.2` | 仅在转换器父包下覆盖 5.1.16；4.x 无修复版。保留 Excalidraw 0.18.1 和转换器 2.2.2，不采用审计建议的 Excalidraw 0.17.6 降级。调用点仅同步无参数 nanoid()，不涉及 5.x 删除的异步接口；浏览器对比流程图、时序图、类图和 ER 图，验证绑定和 SVG 素材 ID。 |

Sharp 0.35 要求 Node >=20.9，当前项目 >=22.16 满足；它不再自动回退到源码编译，特殊平台部署需显式处理本机构建。本次只验证 Linux x64 与项目 CI，不能推广为所有平台已验证。Nano ID 5 改用 Web Crypto，当前受支持浏览器通过真实转换回归。此前暂缓是缺少这些兼容证据，并非已证实不能升级。

上游变更：[Sharp 0.35.0](https://sharp.pixelplumbing.com/changelog/v0.35.0/)、[Sharp 0.35.5](https://sharp.pixelplumbing.com/changelog/v0.35.5/)、[libheif 公告](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c)、[Nano ID 5 变更](https://github.com/ai/nanoid/blob/5.0.0/CHANGELOG.md)。

该轮之后曾剩余 2 项 moderate，均为运行时路径 `@gouo/studio-api → @langchain/langgraph@1.2.0 → uuid@10.0.0`：UUID 本体一项、LangGraph 传播一项。GHSA-w5hq-g745-h8pq 修复版本为 11.1.1。当前 LangGraph 直接使用 v4() 与 validate()，未用受 UUID 11 行为变更影响的 v1/v7 options，但不能只凭调用点声称完整依赖兼容。探索性的父包和版本限定覆盖在当前 npm workspace 安装中未实际替换 UUID 10，因此已移除，未提交无效覆盖或手工伪造已修复锁文件。

当时建议单独评审 LangGraph 1.4.18 的兼容升级（审计推荐版本）：会将 SDK 从 ~1.6.5 推至 ~1.12.0，并引入 protocol ^0.0.19；需覆盖工具循环、消息/检查点、取消、错误与重复执行边界，再决定是否接受。另一选择是等待父包回补 UUID；等待期间保留这两项告警，不开放为已通过生产安全门禁。当前没有复现 UUID 漏洞利用，也没有证据证明其不可利用。[UUID 11.1.1 修复记录](https://github.com/uuidjs/uuid/blob/v11.1.1/CHANGELOG.md)。

## 2026-09-30 授权扩大 SDK 升级验证（当前）

用户随后批准升级智能体 SDK 并扩大回归。实际安装 LangGraph 1.4.18，其声明的 SDK ~1.12.0 解析为 1.12.0，protocol ^0.0.19 解析为 0.0.19；checkpoint 保持 1.1.5。LangChain core/openai 均保持 1.2.0，满足 LangGraph core ^1.1.48 的 peer 要求，Zod 3.25.76 同样满足声明。未增加 UUID override。

锁文件差异只有 LangGraph/SDK 更新、protocol 新增，以及它们原有 UUID 10.0.0/13.0.2 副本移除；Mermaid 自身 UUID 14.0.2 保持原样。`npm ci` 与 `npm ls --all` 验证真实解析，完整/`--omit=dev` 审计均为 0 项告警。因此上节剩余两项 UUID 告警已解决，无须继续等待父包回补。上游 [1.4.18 发布记录](https://github.com/langchain-ai/langgraphjs/releases/tag/@langchain%2Flanggraph@1.4.18) 确认 SDK 1.12.0 更新。

保留当前 createReactAgent / ToolNode、有限调用次数、零自动重试、个人 relay 所属账号及 SQLite 幂等边界，不因 SDK 升级迁移 Agent 架构。新增 8 项通过真实 SDK 和回环 HTTP 网关的测试，覆盖工具→图片→总结/请求费用归属、纯文本历史与禁用工具、工具 HTTP 错误、参数错误、重复工具、总结/图片连接丢失以及客户端断开与 busy 重试；既有权限/账单/跨重启 unknown 回归继续运行。无真实供应商调用。

客户端取消仅中止浏览器传输，不承诺撤销已发出的供应商任务或费用；服务端仍可能完成并保存结果，相同 ID 不重执行。零审计告警只表示当前依赖公告检查通过，不替代真实渠道联调、部署平台验证或生产安全审查。

扩大测试还复现了连接丢失时的费用归属缺口：未收到响应的总结或图片请求未被计入汇总，之前成功调用的账单可能被误报为整次已结算。现对两类 fetch 异常各补记一个无 request ID 的未知调用；汇总保持 pending 且不显示确定总费用。回归在修复前分别失败、修复后通过；不改变零重试、结果保存或账本去重规则。

## 一体化与聊天实验依赖

assistant-ui `@assistant-ui/react@0.15.22`（MIT）用于独立 ChatLab，不替换 LangGraph 或 New API。安装新增 326 个 lock 路径，新增包许可字段均 MIT；API 与许可证按已安装固定版本检查，未复制整个上游仓库。完整归属在 `docs/v2/licenses/assistant-ui-MIT.txt`，同份文件随前端发布到 `/studio/assistant-ui-LICENSE.txt`。未配置 assistant-cloud 服务。详见 CHAT-LAB.md；不引入 tldraw 或新的商业许可证。

V2 镜像只使用官方 New API `v1.0.0-rc.40` 发布二进制，amd64/arm64 SHA-256 固定于 `v2/deploy/NewAPI.Dockerfile`，并包含固定源码提交的 LICENSE/NOTICE/THIRD-PARTY-LICENSES。Node 与 Nginx 基础镜像以 manifest digest 固定。Docker Hub 匿名限流时使用公开 Docker Official Images 镜像源，未用陌生转发替换 New API 发布资产。此构建未修改 New API；既有 AGPL 义务仍适用。
