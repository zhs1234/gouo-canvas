# Gouo Canvas V2 — Codex 从这里开始

目标：为淘宝、拼多多、抖音等国内电商，以及社媒、外贸和海报场景建设图片工作台。当前先做图片生成与编辑，后期接入视频生成，不做视频剪裁。New API 原生用量计费已接入；月度订阅、独立业务额度/审计账本为后续任务。

决策：新前台 + 新业务域，迁移现有可用能力；优先复用成熟 GitHub 项目。保留旧站，不能以旧 UI 兼容为理由放弃新产品目标，也不能把所有后端功能未经审查直接当成可靠基础。

2026-09-30 选择：[Loomic](https://github.com/fancyboi999/Loomic) 原生无限画布与智能体前端，固定提交 `bdb47a5adf900b48615af0bd914336e3770021b5`，替换 Fabric starter；账号/网关使用 [New API](https://github.com/QuantumNous/new-api) `v1.0.0-rc.40`。这是新的开发阶段，没有数据迁移；云项目/素材库暂不接入。本地项目、画布和聊天先保存在浏览器。具体复用范围与边界见 `docs/v2/LOOMIC.md`。

## 最新入口决策（2026-10-01）

用户要求默认聊天、所有工作区有固定侧栏入口，整体页面与账号管理参考ChatGPT。当前 `/studio/` 默认进入已经认可的完整assistant-ui聊天；聊天、画布、项目库和原Loomic工作台共用侧栏。原工作台移到明确 `/studio/canvas`，旧root的id/session、editor/board及完整query/hash兼容保留；没有覆盖旧草稿或原图。站内返回和浏览器POP均等待真实保存，失败留页可导出。实际ChatGPT参考、地址、保存与恢复边界见 [WORKSPACE-NAVIGATION.md](docs/v2/WORKSPACE-NAVIGATION.md)，真实最终验证见STATUS顶部。以下旧“默认画布”描述按历史读取。

## 最新增量（2026-09-30）

用户批准第三阶段持久项目与原始素材：assistant-ui 图片可打开/插入官方 Excalidraw 私有项目，项目库与 revision 保存/冲突恢复已接入；原默认画布与旧草稿保留。普通模型路由及用户安全配置见 MODEL_SETUP.md；新显式 gpt-6.1-sol 对话首先读 [HANDOFF.md](docs/v2/HANDOFF.md)。此前“云项目暂缓”是历史边界，本轮持久项目授权优先。

用户批准以 assistant-ui 接现有 Studio/LangGraph，会话历史按 New API 账号归属保存到 Studio SQLite；正式聊天入口为 `/studio/chat`。画布仍保留现有默认入口，官方 Excalidraw 对照与旧草稿只读副本导入独立验证，不覆盖原始数据。持久会话不等于持久 Worker、供应商取消或独立计费账本。以下早期本地会话描述保留为历史背景，以 STATUS.md 最新验证为准。

## 启动

Windows 本机环境的工具版本、安装位置、检查与启动说明见 [LOCAL_ENVIRONMENT.md](docs/v2/LOCAL_ENVIRONMENT.md)。2026-10-01 接手起点已包含 PR #3 合并；本轮真实命令结果以 STATUS.md 顶部为准，后文旧交接的“待合并”属于历史记录。

选择 `zhs1234/gouo-canvas` 的 **v2** 分支，或从其派生的任务分支。工作树应包含本文件。

```sh
docker compose --env-file v2/deploy/.env.example -f v2/deploy/compose.yml up --build --wait
```

访问 `http://localhost:8080/studio/`，同一入口提供画布、Studio API 与 New API 原生 `/setup` / `/console`，服务和数据库职责仍然独立。初始无需密码或 key，生成关闭；用户在原生页面安全初始化，脚本不代建账号、token 或渠道。必要配置、健康检查、数据保留和验证边界见 [RUNNING.md](docs/v2/RUNNING.md)。不再依赖仓库外临时 helper。

前端/API 热更新仍可运行 `node v2/scripts/setup.mjs` 后 `cd v2 && npm run dev`，但它要求另行连接明确的 New API 实例；从干净环境启动整套服务使用上面的 Compose。旧根 `deploy/` 和 `server/` 不属于此 V2 编排。

账号协议为 Bearer access token + HttpOnly refresh Cookie：`POST /api/user/login`、`POST /api/user/auth/refresh`、`POST /api/user/auth/logout`、`GET /api/user/self`。访问令牌仅留内存，不存 localStorage/sessionStorage；退出由服务端撤销。当前仅验证本地 HTTP 开发，生产必须另行配置 HTTPS、安全 Cookie 与 Origin/CSRF 策略。额外验证/MFA 流程尚未在 V2 实现。

## 阅读顺序

1. `AGENTS.md`、`v2/AGENTS.md`：范围与执行规则。
2. `docs/v2/TASKS.md`、`docs/v2/STATUS.md`：下一步任务与真实交付状态。
3. `docs/v2/ARCHITECTURE.md`、`docs/v2/API-DATA.md`：模块、接口、数据与事务边界。
4. `docs/v2/MODELS.md`、`docs/v2/SECURITY-MIGRATION.md`：多模型、Image 2.5、订阅与迁移风险。
5. `docs/v2/LOOMIC.md`、`docs/v2/DESIGN.md`、`docs/v2/DEPENDENCIES.md`：Loomic 来源、接入范围、配置与复用清单。

## 可直接发送给 Codex 的首条任务

> 在当前 Gouo Canvas v2 派生分支开发。先阅读 START_HERE_V2.md、适用的 AGENTS.md、docs/v2/TASKS.md 与 STATUS.md。复验 P0，然后实施 B2 的模型目录与 GPT Image 2.5 兼容排查，以固定版本 New API 为网关；业务服务已选定 v2/apps/api，以 New API /api/user/self 验证账号；浏览器不持有供应商/relay 密钥。暂不实施 B1 云项目/素材库，不迁移旧数据。不要重写已有认证或模型网关。按验收标准补测试并提交，更新 STATUS.md。真实付费模型测试等待单独授权；缺密钥时完成协议与测试，不伪造上线状态。不改 main、不部署、不执行生产迁移。

## 边界

当前实例的对话渠道 2 与图片渠道 1 按模型分别路由；用户另行授权复验后，`gpt-5.6-sol → gpt-image-2 → 对话总结` 的真实链路通过，三次调用合计 ¥0.5033058，同请求重放未再次扣费。此前首个对话请求因上游 503 失败、未生图且无该请求的消费记录；没有自动重试。实例启用这两个已验证模型，其他别名/视觉/编辑参数继续等待具体渠道验证。画布账号窗口显示人民币余额、实际消耗和原生单价；用户选定保留现有单价、default 1 倍计费。详见 STATUS.md 和 LOOMIC.md。

当前是**可继续开发的工程起点**，不是完整商品图 SaaS。现有集成提供 Loomic 原生画布/聊天、本地项目/对话恢复、New API 认证桥接，以及 LangGraph + Images 协议适配。Agent 选择器恢复原版，只选择对话模型；图片模型在原生独立偏好设置中选择，供智能体生图工具使用。只有图片渠道时可使用独立“AI 生成图片”面板，聊天入口会提示先配置对话模型，不会自动改成直接生图。当前云环境在用户授权后已实测其 `gpt-image-2` 默认参数生成；仅对应仓库外环境配置启用该能力，仓库示例继续禁用，其他模型/编辑能力待验证。当前已支持真实 SSE 文本/工具事件，仍不是持久可恢复 Worker。本地 SQLite 只防重复提交；Job/Worker、云项目、月度订阅仍待实现。

依赖通过 npm 安装，不把 node_modules、完整第三方仓库或字体文件塞进仓库。V2 已附带通过 GitHub 检查时生成的 package-lock.json；setup 默认使用 npm ci，按锁定版本安装。
