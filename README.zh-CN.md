# 光构 · Gouo Canvas

**简体中文** · [English](./README.md) · [文档中心](./docs/README.md)

AI 图片工作台，支持文生图、参考图编辑、局部遮罩编辑和作品管理。使用 React 前端和基于 One Hub 的 Go 后端；账号、额度和云端作品库由后端管理，平台 API Key 保存在服务端。

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

## 检查

```powershell
npm run build
npm test

# 后端冒烟检查，在 server/ 目录执行
Set-Location server
go test ./controller -run '^$'
go test ./relay/relay_util -run '^TestGetFixedImageQuota$'
```

## 部署

建议同域部署：提供前端静态文件，将 `/api` 和 `/v1` 反向代理到后端。上游密钥只配置在后端管理面板中。

选择 [Docker Compose](./docs/zh-CN/deployment/docker.md) 或 [Linux 手动部署](./docs/zh-CN/deployment/manual.md)。先看[部署总览](./docs/zh-CN/deployment/index.md)，开放注册或支付前完成[上线检查清单](./docs/zh-CN/deployment/checklist.md)。

- 会话和中继令牌密钥需保持固定并保密，不要提交真实环境文件、凭据、数据库、日志或私钥。
- 生产模式下，未同步的作品可能只在原浏览器中；IndexedDB 是缓存，不是备份。纯前端模式下，数据保存在浏览器中，上游服务商可能另行保存请求数据。
- 本地资产目录适用于单后端实例，多实例需要共享存储。
- 用户固定售价不等于上游成本，需按模型、质量、尺寸和编辑类型核对。支付上线需要正式渠道、回调验签、公开价格与退款规则以及对账流程；这些就绪前使用兑换码。

## 其他文档

[用户指南](./docs/zh-CN/user-guide.md) · [测试与模拟 API](./docs/zh-CN/testing.md) · [变更记录](./CHANGELOG.md)

`server/docs/` 是上游 One Hub 的文档，本项目部署请使用上面的光构指南。

## 许可与来源

前端基于 [GPT Image Playground](https://github.com/CookSleep/gpt_image_playground)，按 MIT License 发布。后端基于 [One Hub](https://github.com/MartialBE/one-hub)，保留 Apache-2.0 许可证和原始声明。详见 [LICENSE](./LICENSE) 与 `server/` 中的许可证文件。
