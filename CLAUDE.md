# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

先用 Read 读根目录 `AGENTS.md`：代码风格（2 空格、单引号、无分号、中文注释）、架构约束和命名规则都在那里，这里不重复。改 `server/` 前还要读 `server/AGENTS.md`（以及它要求的 `server/web/AGENTS.md`、计费规则文件）。

## 仓库组成

光构（Gouo Canvas）= 两个独立工程放在同一仓库：

- **根目录**：用户端 SPA（React 19 + Vite 6 + Zustand + Tailwind，npm）。三个工作区：生图、无限画布、Agent。
- **`server/`**：基于 New API（`github.com/QuantumNous/new-api`，Go 1.26 + Gin + GORM）的后端。`server/web/` 是它的管理后台（Rsbuild + TanStack，**用 Bun**），光构后台页面在 `server/web/src/features/gouo/`。

## 分支规则（强制）

`migrate/new-api` 是把后端从 One Hub 换成 New API 的独立开发分支，**严禁合并到 `main`**：不要开以 `main` 为目标的 PR，不要把它 merge/rebase 进 `main`，也不要推送到 `origin/main`。`main` 仍是 One Hub 线；从 `main` 往这个分支同步可以。

## 常用命令

```powershell
# 前端（仓库根目录）
npm run dev                      # Vite，/api /v1 /pg 代理到 VITE_GOUO_BACKEND_DEV_TARGET（默认 127.0.0.1:3000）
npm run build                    # tsc -b + vite build；改完先跑这个
npm test                         # vitest run，匹配 src/**/*.test.{ts,tsx,mjs}
npx vitest run src/lib/api.test.ts           # 单个文件
npx vitest run -t '测试名片段'                # 按名称

# 本地 mock 后端（不连上游、不扣费）
node scripts/mock-workspace-api.mjs          # 监听 5190；前端用 npm run dev -- --mode mock（读 .env.mock.local）
node scripts/mock-workspace-api.mjs --self-test

# 后端（server/）
go run .                                     # 默认 SQLite，监听 3000；空库创建 root/123456
go test ./controller -run '^$'               # 只编译检查
go test ./relay -run Gouo                    # 光构图片相关
go test ./model -run Gouo                    # 计费、文档、回收站等；未设 TEST_MYSQL_DSN / TEST_POSTGRES_DSN 时跳过对应数据库矩阵

# 管理后台（server/web/）
bun run dev | bun run build | bun run test | bun run typecheck | bun run lint
```

本地 Docker 容器 `gouo-local-backend` 挂载的是**主检出目录** `光构/.local-runtime`（二进制）和 `光构/server/data`，不是这个 worktree。

## 架构要点

**前后端边界**：上游 API Key 只存在后端渠道里。客户端登录后用会话 Cookie 访问 `/api/*`（`src/lib/gouoBackend.ts` 的 `backendFetch`/`backendRequest`，401 时走 `/api/user/auth/refresh`）。图片请求先通过 `GET /api/gouo/token` 拿平台令牌 `sys_playground`，再以 OpenAI 兼容方式调用同源 `/v1`（`createBackendSettings` → `src/lib/api.ts`）；Agent 对话直接用登录会话调原生 `/pg/chat/completions`。生产环境要求前后端同源，由反向代理转发 `/api`、`/v1`、`/pg`。

**后端光构扩展**：所有光构专属代码文件名都带 `gouo` 前缀，入口是 `server/router/gouo-router.go`。`/api/gouo/*` 是用户接口，`/api/gouo/admin/*` 是管理接口，都只接受登录会话（通过 `middleware.DeclareGouoSessionRoute` 登记）。图片计费在 `model/gouo_billing.go` 和 `relay/helper/gouo_price.go`，图片中继在 `relay/gouo_image.go`。模型能力、价格、分辨率档位都由后台配置，客户端不写死模型。

**模型目录**：`/api/gouo/models` 和 `/api/gouo/agent/models` 由 `controller/gouo.go` 的 `gouoCatalog` 从 New API 原生 `model.GetPricing()` 生成，没有光构自己的模型表。图片模型是原生识别为 image-generation 的模型，能力看模型管理里的标签（`edit` 参考图、`mask` 遮罩）；Agent 模型是带 `tools` 标签且已定价的文本模型，`vision` 表示能识图。对话走 New API 原生 Playground `/pg/chat/completions`（登录会话鉴权，带 `X-Gouo-Agent` 头才套用光构的 Agent 开关和回复上限），Agent 工具调用生成的图片按图片价格单独计费。

**客户端状态与持久化**：
- `src/store.ts`：生图工作区的 Zustand store，带 IndexedDB 持久化和 `normalize*` 旧数据清洗。
- `src/stores/agentStore.ts`、`src/stores/canvasStore.ts`：Agent 和画布的 store。
- `src/lib/db.ts`：IndexedDB 封装（当前 DB 5），改 schema 要升 `DB_VERSION`，不要降级。
- `src/lib/serverLibrary.ts`：从后端同步作品和收藏夹，`App.tsx` 中 `initStore()` 之后启动。
- `src/lib/serverDocuments.ts`：画布和 Agent 会话的云端文档。
- IndexedDB 只是缓存，不是备份。ZIP 导出格式为 ZIP 4，兼容导入 2、3。

**画布**：`src/lib/canvas/` 移植自 Infinite Canvas（固定在某个上游 commit），对上游的改动要记到 `UPSTREAM.md`。Agent 通过 `src/lib/canvas/agentOps.ts` 和 `src/lib/agent/tools.ts` 操作画布。

**复用 New API 原生能力**：New API 已有的功能直接复用，不再自建。例如创作页公告读取原生控制台公告（`/api/status` 的 `announcements`），价格在原生模型定价里设置，账号、邮箱、兑换、使用记录都走原生接口。

**功能开关**：`VITE_CANVAS_ENABLED` / `VITE_AGENT_ENABLED` 只控制前端入口是否显示，不是后端鉴权，改后需要重启或重新构建。
