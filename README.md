# 光构 · Gouo Canvas

> 把灵感构造成图像。

光构是由 **xgouo** 打造的 AI 图片生成与编辑平台，面向需要文生图、参考图编辑、局部重绘和素材管理的创作者。

[![React](https://img.shields.io/badge/React-19-149eca)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6-646cff)](https://vite.dev/)
[![Go](https://img.shields.io/badge/Go-backend-00add8)](https://go.dev/)
[![License](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

项目仓库：[zhs1234/gouo-canvas](https://github.com/zhs1234/gouo-canvas)

![光构 Logo](./docs/images/gouo-logo-source.png)

## 功能

- 文生图、参考图编辑、图片变体与局部遮罩编辑
- 画廊、搜索、收藏夹、批量下载与本地数据管理
- 登录、注册、会话保持和光构原生用户中心
- 平台统一管理上游 API，浏览器不接触平台 API Key
- 用户独立中继令牌、额度展示、兑换码充值和使用记录
- 账号云端作品库、跨设备画廊、收藏夹同步和可恢复回收站
- 图片接口按成功请求次数固定计费，默认 ¥0.10/次
- One Hub 管理后台，用于渠道、用户、额度和系统配置

## 技术结构

```text
浏览器（React + Vite）
  ├─ /api/*  → 登录、用户中心、额度与系统接口
  └─ /v1/*   → 统一图片生成接口
                  ↓
           光构后端（Go / One Hub）
             ├─ MySQL / SQLite
             ├─ Redis（可选）
             └─ OpenAI 兼容上游
```

生产环境推荐让前端和后端使用同一个域名，由反向代理转发 `/api` 和 `/v1`。平台的上游密钥只配置在后端渠道中。

## 本地运行

需要 Node.js、npm 和 Go。先启动后端：

```powershell
Set-Location server
$env:SESSION_SECRET = '<至少 32 位随机值>'
$env:USER_TOKEN_SECRET = '<至少 32 位随机值>'
$env:GOUO_IMAGE_PRICE_CNY = '0.10'
go run .
```

再复制前端环境变量并启动开发服务器：

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

打开 `http://127.0.0.1:5173`。Vite 会按照 `.env.local` 中的配置，将 `/api` 和 `/v1` 代理到 `http://127.0.0.1:3000`。

首次启动空数据库时，后端会创建管理员 `root`，初始密码为 `123456`。这只适合本地初始化；任何联网部署都必须在开放访问前立即修改密码。

## 验证

```powershell
npm run build
npm test
```

后端核心包验证：

```powershell
Set-Location server
go test ./controller -run '^$'
go test ./relay/relay_util -run '^TestGetFixedImageQuota$'
```

## 部署

生产部署分为两条独立路线，请选择一种，不要混用两套目录和升级命令：

- [Docker Compose 部署](./docs/DEPLOYMENT_DOCKER.md)：推荐路线，一次启动前端、后端、MySQL 和 Redis，适合首次部署和单机生产环境。
- [传统服务器手动部署](./docs/DEPLOYMENT_MANUAL.md)：直接使用 Nginx、systemd、MySQL 和 Redis，适合有 Linux 运维经验并需要精细控制目录与进程的用户。

先阅读[部署方式选择与共同要求](./docs/DEPLOYMENT.md)。两份教程分别包含环境准备、密钥、数据库、构建启动、HTTPS、管理端访问、云端图片持久化、备份、升级、回滚、排障和验收步骤。正式开放前还必须完整执行[生产上线检查清单](./docs/PRODUCTION_CHECKLIST.md)。

## 配置项

| 变量 | 位置 | 用途 |
| --- | --- | --- |
| `VITE_GOUO_BACKEND_ENABLED` | 前端构建 | 是否启用登录和服务端中继 |
| `VITE_GOUO_BACKEND_URL` | 前端构建 | 跨域后端地址；同域部署时留空 |
| `VITE_GOUO_BACKEND_DEV_TARGET` | 前端开发 | Vite 本地代理目标 |
| `VITE_GOUO_IMAGE_MODEL` | 前端构建 | 默认图片模型名 |
| `SESSION_SECRET` | 后端 | 会话签名密钥，生产环境必须固定且保密 |
| `USER_TOKEN_SECRET` | 后端 | 用户中继令牌密钥，设置后不要随意更换 |
| `GOUO_IMAGE_PRICE_CNY` | 后端 | 每次成功图片请求的人民币价格 |
| `GOUO_CLOUD_LIBRARY_ENABLED` | 后端 | 是否启用账号云端作品库 |
| `GOUO_ASSET_DIR` | 后端 | 私有图片文件目录，Docker 默认 `/data/gouo-assets` |
| `GOUO_ASSET_USER_QUOTA_BYTES` | 后端 | 默认单用户云端空间，默认 2 GB |
| `SQL_DSN` | 后端 | MySQL/PostgreSQL 连接；未设置时使用 SQLite |
| `REDIS_CONN_STRING` | 后端 | Redis 连接，多实例部署时应配置 |

完整示例见 [`.env.example`](./.env.example) 和 [`deploy/.env.example`](./deploy/.env.example)。不要提交真实 `.env`、数据库、日志或密钥文件。

## 文档

- [用户使用指南](./docs/USER_GUIDE.md)
- [部署方式选择](./docs/DEPLOYMENT.md)
- [Docker Compose 部署](./docs/DEPLOYMENT_DOCKER.md)
- [传统服务器手动部署](./docs/DEPLOYMENT_MANUAL.md)
- [后端接入与部署](./docs/BACKEND_INTEGRATION.md)
- [生产上线检查清单](./docs/PRODUCTION_CHECKLIST.md)
- [SaaS 架构与后续计划](./docs/SAAS_ARCHITECTURE.md)
- [原项目自定义服务商说明](./docs/custom-provider-llm-prompt.md)

## 当前边界

- 登录用户的作品、图片资产和收藏夹会同步到云端，浏览器 IndexedDB 作为本地缓存和待同步队列；未登录数据和同步失败的数据仍只存在当前浏览器中。
- 在线支付需要先在管理后台配置正式支付渠道、回调地址和密钥；未完成前可使用兑换码充值。
- 固定售价不等于上游实际成本，上线前应按模型、质量和尺寸核对账单。
- 本仓库仍保留 One Hub 的部分通用能力和上游文档，光构前台只开放当前已接入的产品流程。

## 开源声明

前端基于 [GPT Image Playground](https://github.com/CookSleep/gpt_image_playground) 修改，依照 MIT License 使用和再发布。后端基于 [One Hub](https://github.com/MartialBE/one-hub)，其源代码目录保留 Apache-2.0 许可证和原始版权声明。详见根目录 [LICENSE](./LICENSE) 及 `server/` 内的许可证文件。
