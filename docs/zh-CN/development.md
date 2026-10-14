# 光构开发指南

[English](../en/development.md) · [文档中心](../README.md)

## 1. 环境要求

- Node.js 22
- npm（仓库包含 `package-lock.json`，不要使用 yarn 或 pnpm）
- Go 1.25（需要运行 `server/` 时）
- Git

前端由 React 19、Vite 6、TypeScript、Zustand 和 Tailwind CSS 构成。后端位于 `server/`，基于 One Hub，使用 Go、Gin 和 GORM；它有独立的上游工程规范和依赖。

## 2. 本地启动

### 2.1 启动后端

本地开发可以不设置 `SQL_DSN`，后端会在工作目录使用 SQLite。Redis 也可暂时不配置。

```powershell
Set-Location server
$env:SESSION_SECRET = '<至少 32 位的随机值>'
$env:USER_TOKEN_SECRET = '<另一段至少 32 位的随机值>'
$env:GOUO_IMAGE_PRICE_CNY = '0.10'
go run .
```

后端默认监听 `http://127.0.0.1:3000`。首次使用空数据库会创建管理员 `root`，初始密码 `123456`。即使只在本地使用，也建议首次登录后修改。

### 2.2 启动前端

在仓库根目录执行：

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

默认 `.env.example`：

```dotenv
VITE_GOUO_BACKEND_URL=
VITE_GOUO_BACKEND_DEV_TARGET=http://127.0.0.1:3000
```

访问 `http://127.0.0.1:5173`。开发服务器会把同域 `/api`、`/v1` 和 `/panel` 请求代理到后端；浏览器无需处理跨域登录 Cookie。

### 2.3 配置图片渠道

使用管理员账号打开 `http://127.0.0.1:3000/panel`，然后：

1. 在渠道管理中添加 OpenAI 或兼容服务商。
2. 只在后端渠道里填写上游 API Key。
3. 配置图片渠道与映射，在“光构 → 光构模型”启用模型并设置积分售价、能力和数量上限，在“光构 → 光构设置”选择默认图片模型。客户端不预设模型。
4. 分别验证 generations、edits 和 variations 图片路由。
5. 再使用普通账号从 `http://127.0.0.1:5173` 完整验证登录、生成、计费和同步。

## 3. 环境变量

| 变量 | 读取阶段 | 说明 |
| --- | --- | --- |
| `VITE_GOUO_BACKEND_URL` | 前端构建/开发 | 跨域后端地址；同域时留空 |
| `VITE_GOUO_BACKEND_DEV_TARGET` | Vite 开发服务器 | 本地 `/api`、`/v1` 和 `/panel` 代理目标 |

## 4. 仓库结构

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

## 5. 数据流与持久化

- `src/store.ts` 管理应用状态和主要 action。
- `src/lib/db.ts` 封装 IndexedDB；修改 schema 需要升级版本并处理旧数据迁移。
- `normalize*` 函数用于清洗旧 localStorage/IndexedDB 数据，不应随意删除兼容分支。
- `src/lib/serverLibrary.ts` 从服务端加载账号的作品和收藏夹（生成图由服务端直接保存），`src/lib/serverDocuments.ts` 保存画布和 Agent 会话。
- 浏览器缓存并不等于服务端备份；未导入账号的本机作品只存在于浏览器。

新增纯函数或共享逻辑优先放在 `src/lib/`，不要继续扩大 `src/store.ts`。共享类型放 `src/types.ts`，局部类型放使用文件顶部。

## 6. 常用命令

```powershell
npm run dev
npm run build
npm test
npm run test:watch
npm run preview
```

推荐修改后先运行：

```powershell
npm run build
npm test
```

仅更新 Markdown 时，仍应检查链接和命令；若文档描述了刚修改的功能，应按相应风险运行构建、测试或人工流程。

## 7. 提交前检查

- 没有提交 `.env.local`、数据库、日志或密钥。
- 文档中的变量、端口和路径与代码/Compose 一致。
- 中英文文档同步更新。
- 没有手动修改 `dist/`。
- 前端使用 npm；只有 `server/web` 的上游管理端继续按照其工程使用 Yarn。
- 构建和相关测试通过。
