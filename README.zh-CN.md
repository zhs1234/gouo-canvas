# 光构 · Gouo Canvas

> 把灵感构造成图像。

**简体中文** · [English](./README.md) · [文档中心](./docs/README.md)

光构是一套面向 AI 图片创作的工作台，覆盖文生图、参考图编辑、局部遮罩编辑和素材管理。生产模式由 React 前端和基于 One Hub 的 Go 后端组成：平台 API Key 只保存在服务端，每位用户拥有独立账号、额度、中继令牌和云端作品库。

![光构 Logo](./docs/images/gouo-logo-source.png)

## 主要功能

- 文生图、参考图编辑、图片变体和局部遮罩编辑
- 最多 16 张参考图，并可在提示词中明确引用每张图片
- 尺寸、质量、格式、透明背景、压缩率、审核方式和输出数量设置
- 画廊搜索、收藏夹、批量选择、ZIP 导出、任务重试和配置复用
- 用户名/密码账号、额度展示、兑换码充值和使用记录
- 任务、输出图、参考图、遮罩、缩略图和收藏夹云端同步
- 可恢复回收站和按用户计算的云端空间配额
- 支持安装为 PWA，适配桌面和移动端
- 独立的纯前端开发模式，用于直接测试 API 配置

## 技术结构

```text
浏览器（React 19 + Vite 6 + TypeScript + Zustand）
  ├─ /api/*  → 登录、用户、额度与云端作品库
  └─ /v1/*   → OpenAI 兼容图片接口
                    ↓
            光构后端（Go / One Hub）
              ├─ MySQL 或 SQLite
              ├─ Redis（本地开发可选）
              ├─ 私有图片资产目录
              └─ 上游图片服务商
```

生产环境建议使用同一个公开域名：反向代理提供前端静态文件，并把 `/api` 和 `/v1` 转发至后端。上游 API Key 只在 One Hub 管理后台配置。

## 快速开始

环境要求：

- Node.js 22 和 npm
- 后端需要 Go 1.25
- Git

本地开发可先使用 SQLite 启动后端：

```powershell
Set-Location server
$env:SESSION_SECRET = '<至少 32 位的随机值>'
$env:USER_TOKEN_SECRET = '<另一段至少 32 位的随机值>'
go run .
```

打开第二个终端启动前端：

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

访问 `http://127.0.0.1:5173`。Vite 会按照 `VITE_GOUO_BACKEND_DEV_TARGET` 将 `/api`、`/v1` 和 `/panel` 代理到后端，默认目标为 `http://127.0.0.1:3000`。

后端使用空数据库首次启动时会创建管理员 `root`，初始密码为 `123456`。它只用于初始化；必须立即修改，仍使用默认密码的实例不得开放网络访问。

完整环境准备、全栈与纯前端模式、仓库结构参见[开发指南](./docs/zh-CN/development.md)。

## 验证修改

```powershell
npm run build
npm test
```

本仓库常用的后端冒烟检查：

```powershell
Set-Location server
go test ./controller -run '^$'
go test ./relay/relay_util -run '^TestGetFixedImageQuota$'
```

## 生产部署

请选择一种路线并完整执行，不要混用两套命令：

- [Docker Compose 部署](./docs/zh-CN/deployment/docker.md)：推荐用于新的单机生产环境
- [传统 Linux 手动部署](./docs/zh-CN/deployment/manual.md)：适合直接维护 Nginx、systemd、MySQL 和 Redis 的运维人员

选择前先阅读[部署总览](./docs/zh-CN/deployment/index.md)，开放注册或支付前完成[生产上线检查清单](./docs/zh-CN/deployment/checklist.md)。

## 配置项

### 前端构建变量

| 变量 | 用途 |
| --- | --- |
| `VITE_GOUO_BACKEND_ENABLED` | 启用登录门、后端中继和账号隔离存储 |
| `VITE_GOUO_BACKEND_URL` | 跨域后端基础地址；同域生产部署时留空 |
| `VITE_GOUO_BACKEND_DEV_TARGET` | Vite 本地代理目标 |
| `VITE_GOUO_IMAGE_MODEL` | 生产模式下前端请求的图片模型 |

### 后端运行变量

| 变量 | 用途 |
| --- | --- |
| `SESSION_SECRET` | 登录会话签名密钥，必须固定并保密 |
| `USER_TOKEN_SECRET` | 用户中继令牌签名密钥，必须固定并保密 |
| `GOUO_IMAGE_PRICE_CNY` | 每次成功图片请求的固定售价 |
| `GOUO_CLOUD_LIBRARY_ENABLED` | 是否启用账号云端作品库接口 |
| `GOUO_ASSET_DIR` | 同步图片文件的私有目录 |
| `GOUO_ASSET_USER_QUOTA_BYTES` | 默认单用户云端空间 |
| `GOUO_ASSET_MAX_FILE_BYTES` | 单个同步资产大小上限 |
| `GOUO_ASSET_MAX_TASK_FILES` | 单个任务可关联的资产数量上限 |
| `SQL_DSN` | MySQL/PostgreSQL 连接串；未设置时使用 SQLite |
| `REDIS_CONN_STRING` | Redis 连接串 |

示例见 [`.env.example`](./.env.example) 和 [`deploy/.env.example`](./deploy/.env.example)。不要提交真实环境文件、凭据、数据库、日志或私钥。

## 文档

- [文档中心](./docs/README.md)
- [用户指南](./docs/zh-CN/user-guide.md)
- [开发指南](./docs/zh-CN/development.md)
- [后端接入说明](./docs/zh-CN/backend.md)
- [测试与本地模拟 API](./docs/zh-CN/testing.md)
- [部署总览](./docs/zh-CN/deployment/index.md)
- [变更记录](./CHANGELOG.md)

`server/docs/` 是上游 One Hub 项目的原始文档，仅作为上游参考保留，不是光构的生产部署教程。

## 数据与安全边界

- 生产模式下，登录用户的作品会同步到后端。IndexedDB 仍承担本地缓存和失败重试队列；未同步成功的数据可能只存在原浏览器。
- 纯前端模式下，配置、任务和图片只保存在浏览器中，除非所配置的上游服务商另行保存请求数据。
- 当前本地资产目录只适合单后端实例。多实例需要共享文件系统，或后续接入对象存储。
- 用户固定售价不等于上游成本。开放付费前必须按模型、质量、尺寸和编辑类型核对真实账单。
- 在线支付需要正式支付渠道、回调验签、公开价格与退款规则以及运营对账流程。在这些工作完成前，兑换码是更稳妥的充值方式。

## 开源许可与致谢

前端基于 [GPT Image Playground](https://github.com/CookSleep/gpt_image_playground) 修改，并依照 MIT License 再发布。后端基于 [One Hub](https://github.com/MartialBE/one-hub)，其源码目录保留 Apache-2.0 许可证和原始版权声明。详见 [LICENSE](./LICENSE) 与 `server/` 下的许可证文件。
