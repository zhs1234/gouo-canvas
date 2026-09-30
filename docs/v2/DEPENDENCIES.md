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
| LangChain core/openai/LangGraph 1.2.0 | 服务端智能体与成熟工具循环 | MIT |
| Sharp 0.34.5 | 图片解码、格式/尺寸边界 | Apache-2.0；本机库独立许可 |
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
- 仅覆盖 `nanoid@3.3.3` → 3.3.19，修复 Excalidraw 直接依赖；不把 Mermaid 的 Nano ID 4 强制降到 3 或跨主版本升到 5。
- 锁文件由 npm 实际安装生成；`npm ls` 无 invalid 依赖。未改旧根 workspace。

本次 `npm audit` 从 13 项（4 high / 9 moderate）降为 6 项（2 high / 4 moderate），仍不是零风险：

| 剩余依赖 | 告警 / 决策 |
| --- | --- |
| sharp 0.34.5 | high；修复版本 0.35.5 跨越 0.x 次版本兼容边界，涉及本机图片库。需独立验证支持平台、格式及解码行为后升级。格式检查发生在解析之后，不把 MIME/像素上限视为完整缓解。[上游公告](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) |
| nanoid 4.0.2 | high；由 mermaid-to-excalidraw 2.2.2 精确引入。升级到已修补的 5.x 或更新父包需独立验证图表导入/布局；当前未作跨主版本覆盖。Excalidraw 0.18.1 与 mermaid-to-excalidraw 2.2.2 各有一项传播的 moderate 告警 |
| uuid 10.0.0 / LangGraph 1.2.0 | 两项 moderate；直接强制 UUID 11+ 跨主版本，更新 LangGraph 至审计建议的 1.4.18 则涉及智能体循环兼容检查，本次保持现有架构版本 |

未复现这些剩余漏洞的实际利用，不能据此声称不可利用。生产开放前应单独解决，不能把它们归为开发依赖告警。
