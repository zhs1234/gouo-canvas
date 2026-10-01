# 本机开发环境（Windows，2026-10-01）

本轮从已合并 PR #3 的 `abe46c4` 接手，在 `codex/local-environment-p0` 准备环境。当前以 [START_HERE_V2.md](../../START_HERE_V2.md)、[TASKS.md](TASKS.md)、[STATUS.md](STATUS.md) 的最新增量为准。根 README、中英旧开发/部署文档和 `server/docs` 描述旧产品，不能代替 V2 启动流程；本轮没有安装根旧工作区的依赖或启动旧 Go 后端。

## 已安装和核对的工具

| 工具 | 本机实测 | 用途 |
| --- | --- | --- |
| Node.js | 24.15.0 | 满足 V2 `>=22.16.0`；运行 Fastify、SQLite、构建和测试 |
| npm | 11.12.1 | 满足 `>=10`；使用独立 `v2/package-lock.json` 安装 |
| Git | 2.54.0.windows.1 | 分支及可审查提交 |
| Go | 1.26.5 | 主机已有；V2 使用固定 New API 发布二进制，不需要本机 Go 编译 |
| Playwright | 1.63.0（现有锁文件） | Chromium 1243 / Chrome for Testing 153.0.8010.12 已安装 |
| WSL | 2.7.10.0，默认 WSL2 | 已有内核和已启用虚拟化；无需另装 Ubuntu |
| Docker Desktop | 4.93.0.240920 | 新装当前用户版本，使用 WSL2 Linux Engine |
| Docker Engine / Compose | 29.8.1 / 5.5.1 | 满足 Compose `!reset` 和 BuildKit 构建要求 |

V2 `npm ci` 安装 876 个包，审计 881 个包；没有重新解析或修改根/V2 锁文件。`v2/.env` 已存在，核对其生成关闭、无 relay 值及默认回环 New API 目标；没有覆盖文件或输入凭据。

主机尚未设置个人 Git 作者身份，本轮提交通过命令级 `Codex <codex@local.invalid>` 临时身份完成；个人作者配置由用户按自己的姓名/邮箱设置。

Docker 使用 [官方 Windows 安装器](https://docs.docker.com/desktop/setup/install/windows-install/)，SHA-256 与 Docker Inc. Authenticode 均通过。安装器保留在 `D:\CodexTools\DockerDesktop-4.93.0-Installer.exe`，SHA-256 为 `c139124c9cf71477dc565c3c0ea5a18f90b93d68ebe9aaa848a065960416c0bc`。程序在 `C:\Users\56161\AppData\Local\Programs\DockerDesktop`；WSL 数据根为 `D:\CodexTools\DockerData`，避免将镜像主要放在 C 盘。本轮没有使用 `--accept-license`、修改系统信任或关闭 TLS 校验。

## 启动和检查

先从桌面启动 Docker Desktop。若旧入口无法打开，使用实际当前用户安装路径：

```powershell
Start-Process -FilePath "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe" -WindowStyle Hidden
```

安装器已经加入用户 PATH；安装前已打开的终端需要重新打开。项目根目录运行完整三服务：

```powershell
docker compose --env-file v2/deploy/.env.example -f v2/deploy/compose.yml up --build --wait
```

入口为 `http://localhost:8080/studio/`；正式聊天为 `/studio/chat`，项目库为 `/studio/projects`，官方候选画布为 `/studio/canvas-lab`。New API 原生初始化在 `http://localhost:8080/setup`。仅回环端口公开，New API、Studio 和各自数据卷保持独立。账号尚未初始化和生成关闭是安全初始状态。

```powershell
node v2/scripts/setup.mjs
Set-Location v2
npm run check
npm run test:e2e -- --workers=1 --reporter=line
npm run test:stack
npm run stack:status
```

浏览器回归与整栈验收串行执行，避免共享 5174 启动器和重负载时序。`test:stack` 创建并回收自己的随机容器、卷和镜像；实际账号/模型流程使用明确契约替身，不消耗模型费用。最新实际结果及保留的失败过程见 [STATUS.md](STATUS.md)。

`npm run dev` 可同时启动 Vite 5174 与 Studio API 3001，但还需能够访问 `.env` 明确指定的 New API。默认 Compose 不发布 New API 3000；如要连接热更新环境，按 [RUNNING.md](RUNNING.md) 显式提供只绑定回环的开发端口覆盖，不能把“前端能打开”当作账号服务已连接。

停止完整环境时在项目根运行以下命令，保留账号与业务数据：

```powershell
docker compose --env-file v2/deploy/.env.example -f v2/deploy/compose.yml down
```

不要给日常停止加 `-v`。本轮准备范围不包含初始化密码、账号/token/渠道、赠额/价格/支付、真实模型调用或公网部署。真实配置由用户按 [MODEL_SETUP.md](MODEL_SETUP.md) 与 [USER-BILLING.md](USER-BILLING.md) 在原生页面安全完成，再进行单独授权的真实验收。

## 本轮解决的干净环境问题

- V2 内联空 PostCSS 配置，防止 Vite 向上读取根旧 Tailwind 3 配置，继续使用 V2 已有 Tailwind 4 Vite 插件。
- 两项历史 SQLite 测试先关闭 Fastify/数据库再删除临时目录，避免 Windows 文件句柄占用。
- 隔离整栈直接通过 Node 启动已安装 Playwright CLI，避免 Windows `spawn('npx')` 的 `ENOENT`，保持原参数和测试隔离。
- 裁剪回归等待真实图片渲染、命中手柄中心，并只读确认当前裁剪已落盘再重开；终态流式回归等待本地历史写完再刷新。未放宽原图、尺寸、恢复、授权或幂等断言。

本机结果只证明开发环境与相应测试边界。持久 Worker、供应商取消、月度订阅/支付、存储配额/删除/保留策略和生产门禁仍需后续任务；默认画布保持 Loomic。
