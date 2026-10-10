# 光构 · Gouo Canvas

**简体中文** · [English](./README.md) · [文档中心](./docs/README.md)

AI 创作工作台，提供生成图片、无限画布和 Agent 三个工作区。使用 React 前端和基于 One Hub 的 Go 后端；账号、额度和云端作品库由后端管理，平台 API Key 保存在服务端。

- **生成图片**：文生图、参考图编辑、局部遮罩编辑和作品管理。
- **画布**：复用 Infinite Canvas 的界面与交互，组织图片、文字和连线，支持多个项目。
- **Agent**：会话开始前使用居中输入框，开始后切换为消息流和底部输入框；通过平台 API 聊天、提交图片任务和操作关联画布，用户无需安装本机 Codex 或 Claude。

![光构 Logo](./docs/images/gouo-logo-source.png)

[在线演示](https://canvas.wcnmb.top/) · 需要账号登录，图片生成按账户额度结算。

## 预览

公开登录页，截图于 2026-09-30，不含私有账号数据。

![光构登录页](./docs/images/demo-login.png)

## 本地运行

需要 Node.js 22、npm、Git 和 Go 1.25。以下命令使用 PowerShell，从仓库根目录开始。

先启动后端（默认使用 SQLite，本地可不启用 Redis）：

```powershell
Set-Location server
$env:SESSION_SECRET = '<至少 32 位的随机值>'
$env:USER_TOKEN_SECRET = '<另一段至少 32 位的随机值>'
go run .
```

打开第二个终端，在仓库根目录启动前端：

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

访问 `http://127.0.0.1:5173`。Vite 将 `/api`、`/v1` 和 `/panel` 代理到 `VITE_GOUO_BACKEND_DEV_TARGET`，默认是 `http://127.0.0.1:3000`。

空数据库首次启动会创建 `root` / `123456`。**立即修改初始密码，改好前不要对外开放。** 在 `http://127.0.0.1:3000/panel` 配置图片渠道和上游 API Key，并匹配 `VITE_GOUO_IMAGE_MODEL`。生成图片需要可用渠道和账户额度。

完整启动步骤、纯前端模式和前端变量见[开发指南](./docs/zh-CN/development.md)。后端配置、云库限额和备份见[后端说明](./docs/zh-CN/backend.md)，环境示例见 [`.env.example`](./.env.example) 和 [`deploy/.env.example`](./deploy/.env.example)。

### 启用 Agent 模型

在后端管理面板配置文本模型的价格、可用渠道及模型信息：`output_modalities` 包含 `"text"`，`tags` 包含 `"tools"`；支持视觉输入时，`input_modalities` 还需包含 `"image"`。渠道必须实际支持流式工具调用，且当前账号分组和令牌有权使用该模型。能力标记由管理员维护，不会自动探测上游能力。

`GET /api/gouo/agent/models` 只发布符合上述条件的文本模型，不复用图片模型目录；未配置时目录为空。对话调用现有 `/v1/chat/completions` 并按平台文本用量计费，图片工具调用按图片价格单独结算。

### 免费本地模拟

仓库提供只监听本机、不转发上游请求的模拟服务，无需真实密钥或账户额度。在根目录新建 `.env.mock.local`，保持现有 `.env.local` 不变：

```dotenv
VITE_GOUO_BACKEND_ENABLED=true
VITE_GOUO_BACKEND_URL=
VITE_GOUO_BACKEND_DEV_TARGET=http://127.0.0.1:5190
VITE_GOUO_IMAGE_MODEL=gpt-image-2
VITE_CANVAS_ENABLED=true
VITE_AGENT_ENABLED=true
```

两个终端分别执行：

```powershell
# 终端 1：本地模拟 API
node scripts/mock-workspace-api.mjs
```

```powershell
# 终端 2：使用 mock 模式启动前端
npm run dev -- --mode mock --host 127.0.0.1 --port 5175 --strictPort
```

访问 `http://127.0.0.1:5175`，确认账号和模型名称带有 `MOCK`。可测试“生成一张图片”、关联画布后输入“画布添加文字”，或输入“慢速”后停止流式回复。独立自检命令为 `node scripts/mock-workspace-api.mjs --self-test`。模拟结果使用仓库图片，显示的额度和价格均为测试数据；此模式不验证真实上游、实际扣费或云端文档同步。

MOCK 用户中心支持图片请求状态、使用记录筛选/分页、修改显示名称、兑换测试额度、修改测试密码和退出/登录。初始账号 `MOCK-local`、密码 `MOCK-password-123`；兑换码 `MOCK-TOPUP-10` 可使用一次。数据只保存在该进程内存，重启会重置，使用浏览器 Cookie 保留退出状态。注册、邮件、人机验证和云库未在此模拟服务启用，应使用隔离的真实后端验收。图片编辑会校验并回显上传的首张参考图，提示词明确说明未执行真实编辑；不能把回显当作模型理解参考图的证明。Agent 仅按固定规则测试工具链，画布操作按每批最多 50 项拆分，仍受每轮 8 次工具调用上限约束。

## 检查

```powershell
npm run build
npm test

# 后端冒烟检查，在 server/ 目录执行
Set-Location server
go test ./controller -run '^$'
go test ./relay/relay_util -run '^TestGouoImage'
```

## 部署

建议同域部署：提供前端静态文件，将 `/api` 和 `/v1` 反向代理到后端。上游密钥只配置在后端管理面板中。

选择 [Docker Compose](./docs/zh-CN/deployment/docker.md) 或 [Linux 手动部署](./docs/zh-CN/deployment/manual.md)。先看[部署总览](./docs/zh-CN/deployment/index.md)，开放注册或支付前完成[上线检查清单](./docs/zh-CN/deployment/checklist.md)。

- 会话和中继令牌密钥需保持固定并保密，不要提交真实环境文件、凭据、数据库、日志或私钥。
- 生产模式下，未同步的作品可能只在原浏览器中；IndexedDB 是缓存，不是备份。纯前端模式下，数据保存在浏览器中，上游服务商可能另行保存请求数据。
- 本地资产目录适用于单后端实例，多实例需要共享存储。
- 用户固定售价不等于上游成本，需按模型、质量、尺寸和编辑类型核对。支付上线需要正式渠道、回调验签、公开价格与退款规则以及对账流程；这些就绪前使用兑换码。

### 数据升级与关闭入口

浏览器 IndexedDB 升级到 **DB 5**，新增画布项目存储，保留既有任务、图片及旧会话原始记录。仅当前支持的会话格式进入新界面；旧记录不会自动执行。**ZIP 4** 备份包含任务、图片、画布和当前支持格式的 Agent 会话，仍可导入 ZIP 2、3；不兼容的旧会话原始记录留在浏览器中，不包含在新 ZIP 导出内。

升级前备份浏览器作品以及后端数据库、资产目录。需要回退界面时，将 `VITE_CANVAS_ENABLED=false` 或 `VITE_AGENT_ENABLED=false` 后重新构建部署（开发模式重启服务），关闭对应入口并保留文档。不要降低 `DB_VERSION`、清空浏览器存储或用旧版数据层覆盖新版；旧版可能无法打开 DB 5。这两个开关控制前端入口，不替代后端权限配置。

## 其他文档

[用户指南](./docs/zh-CN/user-guide.md) · [测试与模拟 API](./docs/zh-CN/testing.md) · [变更记录](./CHANGELOG.md)

`server/docs/` 是上游 One Hub 的文档，本项目部署请使用上面的光构指南。

## 许可与来源

前端基于 [GPT Image Playground](https://github.com/CookSleep/gpt_image_playground)，按 MIT License 发布。后端基于 [One Hub](https://github.com/MartialBE/one-hub)，保留 Apache-2.0 许可证和原始声明。详见 [LICENSE](./LICENSE) 与 `server/` 中的许可证文件。

画布复用 [Infinite Canvas](https://github.com/basketikun/infinite-canvas)，固定上游提交 `dab19adc0847e32e39b7fc8ff90cb392561fb826`。其 MIT 许可证保留于 [LICENSE.infinite-canvas](./src/lib/canvas/LICENSE.infinite-canvas)，适配范围见 [UPSTREAM.md](./src/lib/canvas/UPSTREAM.md)；发布包包含[第三方声明](./public/third-party-notices.txt)。
