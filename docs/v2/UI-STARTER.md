# 官方完整聊天样板：视觉确认阶段

2026-09-30 用户拒绝旧自拼聊天页面后，改用仍维护的 assistant-ui 主仓库 default starter 完整页面。只替换展示与薄适配，不复制其 AI SDK 服务端、云服务、认证或计费。用户已于 16:53 UTC 查看桌面截图并确认“可以”，授权最终检查后由父线程合并到 codex/new-api-v2；未批准默认画布切换或部署。

## 固定来源与许可

- 仓库：[assistant-ui/assistant-ui](https://github.com/assistant-ui/assistant-ui)
- 精确提交：`f008537f39f0936992b0f6d2433c092935df5faf`，2026-09-24，现有 `@assistant-ui/react@0.15.22` 对应官方 tag。
- 完整页面：[templates/default/app/assistant.tsx](https://github.com/assistant-ui/assistant-ui/blob/f008537f39f0936992b0f6d2433c092935df5faf/templates/default/app/assistant.tsx)
- 页面实际使用的组件源：同提交 `packages/ui/src/components/react/assistant-ui/elements/` 与 `packages/ui/src/components/react/ui/base/`，hooks 来自 `packages/ui/src/hooks/`。
- 主题 token：同提交 `templates/default/app/globals.css`，仅限聊天页；Geist 字体复用项目已有包。
- MIT / Copyright (c) 2026 AgentbaseAI Inc.：完整许可保存在 `v2/apps/studio/src/chat-starter/LICENSE`；每个复用 TS 文件有来源注释。未使用已归档独立 starter 仓库。

## 复用与必要适配

完整复用 SidebarProvider、ThreadListSidebar、SidebarInset、移动抽屉、官方 Thread 欢迎页/消息排版/输入框/工具折叠/复制导出、官方 Base UI 控件和主题。品牌及文案中文化；顶部样板文档链接替换为模型选择，侧栏尾部改为项目/画布/现有 New API 账号费用。

会话新建、分页和切换沿用当前 Studio GET/POST 协议与既有 owner 私有历史。会话列表保留官方样板的搜索、新建、当前项视觉，数据改由原 OwnedThreads 提供，不引入另一套云线程服务。Thread 接既有 useLocalRuntime + studioAdapter；图片槽复用 GeneratedImage 的保存源定位及打开/插入项目功能。未知/运行中结果、停止接收费用提示、只读历史页仍显式保护。

后端没有历史编辑/重新生成/附件上传协议，隐藏这些对应控件，移除附件拖放入口；复制与 Markdown 导出保留。删除无引用的上游组件，不拷贝整仓库。新增 `@assistant-ui/react-markdown@0.14.17` 是同提交官方配套版本；不升级业务 SDK。

官方 Excalidraw 本体不改。外壳只保留项目标题、主要保存/导出与状态，其他调试/导入/本机恢复操作放在可展开“更多操作”。失败/冲突及恢复副本逻辑保留，移动标题单行省略避免挤成竖排。默认入口仍为 Loomic。

## 实际截图与替身边界

`v2/tests/ui-starter-visual.pw.mjs` 在 Chromium 中访问真实 Vite 页面，桌面 1440×1000、移动 390×844。截图保存在执行环境 `/workspace/scratch/gouo-ui-review/`，并上传 ChatGPT Library：

- `chat-desktop.png`：`/studio/chat?thread=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`
- `chat-dark.png`：同路由，主题切换后等待动画稳定。
- `chat-mobile.png`、`chat-mobile-sidebar.png`：同路由，移动输入框与原生抽屉。
- `canvas-desktop.png`、`canvas-mobile.png`：`/studio/canvas-lab?project=eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee`

截图是实际浏览器渲染，不是 ImageGen 效果图。账号、模型目录、会话、项目 API 用 Playwright 明确替身；文本为固定验收内容，商品素材是测试内 SVG 经 Sharp 转 PNG，未调用供应商。模型名、图片与画布内有替身标记。视觉 fixture 禁止发送生成请求。截图不能证明真实供应商、New API 初始化/渠道或真实计费通过；整栈测试另外经过实际 Studio/Nginx 与内存网关替身。

复现：`cd v2 && npm ci && npx playwright install chromium && npm run test:e2e -- --workers=1 --reporter=line tests/ui-starter-visual.pw.mjs`。复现截图默认在 Playwright 本测试 outputPath 的 `ui-review/` 子目录，不依赖 `/workspace`；上面的 scratch 路径为首次 Library 交付时的保存位置。当前环境浏览器在 `/tmp/gouo-playwright`，运行时加 `PLAYWRIGHT_BROWSERS_PATH=/tmp/gouo-playwright`。本机 localhost 不是用户共享预览地址。
