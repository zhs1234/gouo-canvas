# Gouo Canvas V2 — Codex 从这里开始

2026-10-02 系统打通主线已完成本地首交付：独立分支 `codex/system-integration` 整合UI799ad3b，具备原请求恢复、IDB提交后发送、私有原图与项目、Loomic持久图片任务202关页恢复、电商版式/精确PNG及合成双库冷恢复。QA-FINAL最终check为110领域/205API，隔离浏览器206/206、三阶段stack通过，真实构建及普通Native账号子项另验。接手先读 [LOCAL-SYSTEM-HANDOFF.md](docs/v2/LOCAL-SYSTEM-HANDOFF.md)、[SYSTEM-INTEGRATION-PLAN.md](docs/v2/SYSTEM-INTEGRATION-PLAN.md) 和STATUS顶部。原工作区和日常入口未自动替换；公开安全/真实实扣/付费渠道/生产启用门保持。

目标：为淘宝、拼多多、抖音等国内电商，以及社媒、外贸和海报场景建设图片工作台。当前先做图片生成与编辑，后期接入视频生成，不做视频剪裁。New API 原生用量计费已接入；月度订阅、独立业务额度/审计账本为后续任务。

决策：新前台 + 新业务域，迁移现有可用能力；优先复用成熟 GitHub 项目。保留旧站，不能以旧 UI 兼容为理由放弃新产品目标，也不能把所有后端功能未经审查直接当成可靠基础。

2026-09-30 选择：[Loomic](https://github.com/fancyboi999/Loomic) 原生无限画布与智能体前端，固定提交 `bdb47a5adf900b48615af0bd914336e3770021b5`，替换 Fabric starter；账号/网关使用 [New API](https://github.com/QuantumNous/new-api) `v1.0.0-rc.40`。这是新的开发阶段，没有数据迁移；云项目/素材库暂不接入。本地项目、画布和聊天先保存在浏览器。具体复用范围与边界见 `docs/v2/LOOMIC.md`。

## 最新入口决策（2026-10-01）

2026-10-02 UI增量：用户要求先完整规划、再逐页按ChatGPT基准改善布局。计划与逐页证据见 [UI-REDESIGN-PLAN.md](docs/v2/UI-REDESIGN-PLAN.md) / [UI-REDESIGN-STATUS.md](docs/v2/UI-REDESIGN-STATUS.md)。首页改为直接输入、首次明确发送才创建会话；项目库、五分类设置和两种画布共用中性样式。UI799ad3b已整合到独立 `codex/system-integration` 工作树，首次发送meta/detail合同修复及最终系统回归完成。原UI工作区仍保留，不把UI局部验收当作真实收费验收。

用户要求默认聊天、所有工作区有固定侧栏入口，整体页面与账号管理参考ChatGPT。当前 `/studio/` 默认进入已经认可的完整assistant-ui聊天；聊天、画布、项目库和原Loomic工作台共用侧栏。原工作台移到明确 `/studio/canvas`，旧root的id/session、editor/board及完整query/hash兼容保留；没有覆盖旧草稿或原图。站内返回和浏览器POP均等待真实保存，失败留页可导出。实际ChatGPT参考、地址、保存与恢复边界见 [WORKSPACE-NAVIGATION.md](docs/v2/WORKSPACE-NAVIGATION.md)，真实最终验证见STATUS顶部。以下旧“默认画布”描述按历史读取。

## 最新增量（2026-09-30）

用户批准第三阶段持久项目与原始素材：assistant-ui 图片可打开/插入官方 Excalidraw 私有项目，项目库与 revision 保存/冲突恢复已接入；原默认画布与旧草稿保留。普通模型路由及用户安全配置见 MODEL_SETUP.md；新显式 gpt-6.1-sol 对话首先读 [HANDOFF.md](docs/v2/HANDOFF.md)。此前“云项目暂缓”是历史边界，本轮持久项目授权优先。

用户批准以 assistant-ui 接现有 Studio/LangGraph，会话历史按 New API 账号归属保存到 Studio SQLite；正式聊天入口为 `/studio/chat`。画布仍保留现有默认入口，官方 Excalidraw 对照与旧草稿只读副本导入独立验证，不覆盖原始数据。持久会话不等于持久 Worker、供应商取消或独立计费账本。以下早期本地会话描述保留为历史背景，以 STATUS.md 最新验证为准。

## 启动

Windows 本机环境的工具版本、安装位置、检查与启动说明见 [LOCAL_ENVIRONMENT.md](docs/v2/LOCAL_ENVIRONMENT.md)。2026-10-01 接手起点已包含 PR #3 合并；本轮真实命令结果以 STATUS.md 顶部为准，后文旧交接的“待合并”属于历史记录。

选择 `zhs1234/gouo-canvas` 的 **v2** 分支，或从其派生的任务分支。本轮交付在`codex/system-integration`；工作树应包含本文件。

以下默认Compose名为`gouo-v2`、端口8080；仅不存在该项目/数据卷且8080空闲的干净机器可直接执行。当前用户机器已有日常项目，不要从系统worktree直接重建它；本机新实例必须另选`-p`项目名、空闲端口和匹配origin，见RUNNING。

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

> 在 Gouo Canvas v2 派生分支继续。先读 START_HERE_V2.md、适用AGENTS、LOCAL-SYSTEM-HANDOFF、TASKS与STATUS顶部，核对已完成的本地首交付；不要重做私有项目/原图、原请求恢复或202图片任务。下一公开启用任务为G1→G2→具体渠道P，后台持续授权先B3-II再独立Worker。先在源码及隔离环境形成可审查方案，按既有授权边界处理正式配置和执行。New API唯一账号/金额/网关，v2/apps/api业务适配，浏览器仅内存access token、HttpOnly refresh；供应商/relay key不进浏览器。每项coherent scope补负授权/幂等检查、记录实际命令并提交。不改main、不部署、不生产迁移，不自动调用付费模型或改变正式权益。

## 边界

2026-09-30仓库外云环境历史：当时对话渠道2与图片渠道1按模型分别路由；用户另行授权复验后，`gpt-5.6-sol → gpt-image-2 → 对话总结` 真实链路通过，三次调用合计 ¥0.5033058，同请求重放未再次扣费。此前首个对话请求因上游503失败、未生图且无该请求消费记录，没有自动重试。该次两个模型成功仅对应当时渠道/参数，其他别名/视觉/编辑参数另验，详见STATUS和LOOMIC。这不是本轮60169合成实例或日常8080已经开放真实生成的证明；本轮未访问或修改该云环境。

当前系统分支提供**本地工程闭环**：普通账号、默认assistant-ui聊天、Loomic/官方Excalidraw、账号私有会话/原图BLOB/hash/项目revision、CAS冲突保护和导出，以及原请求GET恢复和受限持久图片任务。只有Loomic直接“AI生成图片”在actual catalog批准jobs时使用202；Agent/默认聊天继续SSE与原结果恢复。关页后原图片任务可在同API进程继续，重启未提交需本人授权，已提交未知不重发，已暂存原图仅本地保存恢复；独立Worker/无人值守授权尚未实现。

Agent只选择对话模型，图片模型使用本人独立偏好，只有图片渠道也能直接生图；无聊天模型不自动换入口。电商增量为可编辑图层和指定像素PNG，长文案可原生调整，尚无Logo素材库/完整批处理。仓库示例生成/job/试用/续用仍关闭；历史云环境的 `gpt-image-2` 付费成功仅对应当时渠道/默认参数，不能推及本次合成验收、其他模型或编辑能力。公开收费SaaS、月度订阅、真实资金结算及供应商质量仍按G1/G2/P等明确门项处理。

依赖通过 npm 安装，不把 node_modules、完整第三方仓库或字体文件塞进仓库。V2 已附带通过 GitHub 检查时生成的 package-lock.json；setup 默认使用 npm ci，按锁定版本安装。
