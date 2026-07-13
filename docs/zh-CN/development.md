# 光构开发指南

[English](../en/development.md) · [文档中心](../README.md)

## 1. 环境要求

- Node.js 22
- npm（仓库包含 `package-lock.json`，不要使用 yarn 或 pnpm）
- Go 1.25（需要运行 `server/` 时）
- Git

前端由 React 19、Vite 6、TypeScript、Zustand 和 Tailwind CSS 构成。后端位于 `server/`，基于 One Hub，使用 Go、Gin 和 GORM；它有独立的上游工程规范和依赖。

## 2. 两种运行模式

光构前端保留两种明确不同的模式。修改或排查问题前，应先确认使用哪一种。

| 模式 | `VITE_GOUO_BACKEND_ENABLED` | 账号与云端同步 | API 配置 |
| --- | --- | --- | --- |
| 完整产品模式 | `true` | 启用 | 平台统一配置，前端隐藏 API 设置 |
| 纯前端开发模式 | `false` 或未设置 | 不启用 | 用户在设置中填写服务商、地址、Key 和模型 |

生产部署使用完整产品模式。纯前端模式用于调试上游兼容性、代理、流式响应和自定义服务商，不应被误写成公开产品的普通用户流程。

## 3. 启动完整产品模式

### 3.1 启动后端

本地开发可以不设置 `SQL_DSN`，后端会在工作目录使用 SQLite。Redis 也可暂时不配置。

```powershell
Set-Location server
$env:SESSION_SECRET = '<至少 32 位的随机值>'
$env:USER_TOKEN_SECRET = '<另一段至少 32 位的随机值>'
$env:GOUO_IMAGE_PRICE_CNY = '0.10'
go run .
```

后端默认监听 `http://127.0.0.1:3000`。首次使用空数据库会创建管理员 `root`，初始密码 `123456`。即使只在本地使用，也建议首次登录后修改。

### 3.2 启动前端

在仓库根目录执行：

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

默认 `.env.example`：

```dotenv
VITE_GOUO_BACKEND_ENABLED=true
VITE_GOUO_BACKEND_URL=
VITE_GOUO_BACKEND_DEV_TARGET=http://127.0.0.1:3000
VITE_GOUO_IMAGE_MODEL=gpt-image-2
```

访问 `http://127.0.0.1:5173`。开发服务器会把同域 `/api`、`/v1` 和 `/panel` 请求代理到后端；浏览器无需处理跨域登录 Cookie。

### 3.3 配置图片渠道

使用管理员账号打开 `http://127.0.0.1:3000/panel`，然后：

1. 在渠道管理中添加 OpenAI 或兼容服务商。
2. 只在后端渠道里填写上游 API Key。
3. 让渠道提供 `VITE_GOUO_IMAGE_MODEL` 对应的模型，必要时配置模型映射。
4. 分别验证 generations、edits 和 variations 图片路由。
5. 再使用普通账号从 `http://127.0.0.1:5173` 完整验证登录、生成、计费和同步。

## 4. 启动纯前端开发模式

在 `.env.local` 中使用：

```dotenv
VITE_GOUO_BACKEND_ENABLED=false
VITE_GOUO_BACKEND_URL=
VITE_GOUO_BACKEND_DEV_TARGET=
```

然后运行：

```powershell
npm install
npm run dev
```

此模式不显示登录页，设置中会出现 API 配置页，可直接创建 OpenAI 兼容、fal.ai 或自定义服务商配置。配置和任务存储在浏览器 IndexedDB/localStorage 中，不会进入光构云端作品库。

切换模式后若看到旧账号或旧任务数据，不要直接判断为隔离失效。产品模式会按用户切换本地存储作用域，纯前端模式使用独立的本地作用域；必要时先导出数据，再通过浏览器开发者工具检查当前站点存储。

## 5. 本地 API 代理

浏览器直连第三方 API 可能受到 CORS 限制。开发环境可复制代理示例：

```powershell
Copy-Item dev-proxy.config.example.json dev-proxy.config.json
```

示例配置：

```json
{
  "enabled": true,
  "prefix": "/api-proxy",
  "target": "http://127.0.0.1:3000",
  "changeOrigin": true,
  "secure": false
}
```

`dev-proxy.config.json` 已加入 `.gitignore`。只把 `target` 指向自己信任的服务，不要提交真实地址或密钥。代理只解决浏览器请求路径和 CORS，不会自动提供账号隔离或隐藏保存在浏览器中的 API Key。

## 6. 环境变量

### 光构产品模式

| 变量 | 读取阶段 | 说明 |
| --- | --- | --- |
| `VITE_GOUO_BACKEND_ENABLED` | 前端构建/开发 | 值严格等于 `true` 时启用产品登录模式 |
| `VITE_GOUO_BACKEND_URL` | 前端构建/开发 | 跨域后端地址；同域时留空 |
| `VITE_GOUO_BACKEND_DEV_TARGET` | Vite 开发服务器 | 本地 `/api`、`/v1` 和 `/panel` 代理目标 |
| `VITE_GOUO_IMAGE_MODEL` | 前端构建/开发 | 产品模式使用的图片模型名 |

### 纯前端与兼容部署变量

代码还支持 `VITE_DEFAULT_API_URL`、`VITE_API_PROXY_AVAILABLE`、`VITE_API_PROXY_LOCKED` 和 `VITE_SHOW_DEFAULT_CONFIG_ONLY` 等纯前端构建变量。它们用于默认 API 配置和代理限制，不替代光构后端认证。

生产产品部署应使用根目录 `Dockerfile` 和 `deploy/docker-compose.yml`。不要把旧的纯前端容器参数与当前全栈 Compose 教程混用。

## 7. 仓库结构

```text
.
├─ src/
│  ├─ components/       React 组件
│  ├─ hooks/            自定义 hooks
│  ├─ lib/              API、同步、数据库和纯工具逻辑
│  ├─ store.ts          Zustand 状态与 action 入口
│  └─ types.ts          共享 TypeScript 类型
├─ public/              PWA manifest、图标和 service worker
├─ scripts/             本地辅助脚本和模拟 API
├─ deploy/              全栈 Compose、Nginx 和生产环境示例
├─ docs/                光构中英文文档
├─ server/              One Hub 派生后端及其管理端
├─ Dockerfile           光构公开前端生产镜像
└─ vite.config.ts       Vite 和本地代理配置
```

不要手动编辑 `dist/`。前端构建产物由 Vite 生成。`server/` 内存在独立的 `AGENTS.md`，修改后端前必须同时遵守该目录规则。

## 8. 数据流与持久化

- `src/store.ts` 管理应用状态和主要 action。
- `src/lib/db.ts` 封装 IndexedDB；修改 schema 需要升级版本并处理旧数据迁移。
- `normalize*` 函数用于清洗旧 localStorage/IndexedDB 数据，不应随意删除兼容分支。
- 产品模式下，`src/lib/cloudSync.ts` 把账号作用域内的任务、图片和收藏夹与后端同步。
- 浏览器缓存并不等于服务端备份；同步失败任务可能只在本地存在。

新增纯函数或共享逻辑优先放在 `src/lib/`，不要继续扩大 `src/store.ts`。共享类型放 `src/types.ts`，局部类型放使用文件顶部。

## 9. 常用命令

```powershell
npm run dev
npm run build
npm test
npm run test:watch
npm run mock:api
npm run preview
```

推荐修改后先运行：

```powershell
npm run build
npm test
```

仅更新 Markdown 时，仍应检查链接和命令；若文档描述了刚修改的功能，应按相应风险运行构建、测试或人工流程。

## 10. 提交前检查

- 没有提交 `.env.local`、`dev-proxy.config.json`、数据库、日志或密钥。
- 文档中的变量、端口和路径与代码/Compose 一致。
- 中英文文档同步更新。
- 没有手动修改 `dist/`。
- 前端使用 npm；只有 `server/web` 的上游管理端继续按照其工程使用 Yarn。
- 构建和相关测试通过。
