# Gouo Canvas V2 — Codex 从这里开始

目标：为淘宝、拼多多、抖音等国内电商，以及社媒、外贸和海报场景建设图片工作台。当前先做图片生成与编辑，后期接入视频生成，不做视频剪裁。月度订阅、成本/额度/审计账本为后续任务。

决策：新前台 + 新业务域，迁移现有可用能力；优先复用成熟 GitHub 项目。保留旧站，不能以旧 UI 兼容为理由放弃新产品目标，也不能把所有后端功能未经审查直接当成可靠基础。

2026-09-30 选择：[Loomic](https://github.com/fancyboi999/Loomic) 原生无限画布与智能体前端，固定提交 `bdb47a5adf900b48615af0bd914336e3770021b5`，替换 Fabric starter；账号/网关使用 [New API](https://github.com/QuantumNous/new-api) `v1.0.0-rc.40`。这是新的开发阶段，没有数据迁移；云项目/素材库暂不接入。本地项目、画布和聊天先保存在浏览器。具体复用范围与边界见 `docs/v2/LOOMIC.md`。

## 启动

选择 `zhs1234/gouo-canvas` 的 **v2** 分支，或从其派生的任务分支。工作树应包含本文件。

```sh
node v2/scripts/setup.mjs
cd v2
npm run check
npm run dev
```

访问 `http://127.0.0.1:5174/studio/`，直接进入 Loomic 画布。菜单“项目库”打开本地草稿列表。`npm run dev` 同时启动 Studio API 3001 和 Vite 5174；New API 3000 单独启动。右上角连接账号，本地编辑不依赖登录。配置见 `v2/.env.example`：模型默认禁用，relay 密钥只由 `v2/apps/api` 读取，**不要放入 VITE_* 环境变量**。

New API 的部署说明以固定版本的上游文档为准，使用独立开发数据库。当前 Codex 云环境已安装并校验官方发布二进制，可运行 `python3 /workspace/new-api-environment/start.py`，随后运行 `python3 /workspace/new-api-environment/smoke.py` 初始化并检查本地账号。本地随机凭据在权限 0600 的 state/local-credentials.json 中，不打印、不提交。V2 setup 安装独立 workspace 的依赖，不启动 New API 或发起真实付费请求。旧后端文档仅供参考。

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

当前是**可继续开发的工程起点**，不是完整商品图 SaaS。现有集成提供 Loomic 原生画布/聊天、本地项目/对话恢复、New API 认证桥接，以及 LangGraph + Images 协议适配。仅图片渠道可以直接使用图片模式，不要求额外聊天模型。当前云环境在用户授权后已实测其 `gpt-image-2` 默认参数生成；仅对应仓库外环境配置启用该能力，仓库示例继续禁用，其他模型/编辑能力待验证。HTTP 事件批次不等于流式/可恢复 Worker。本地 SQLite 只防重复提交；Job/Worker、云项目、月度订阅仍待实现。

依赖通过 npm 安装，不把 node_modules、完整第三方仓库或字体文件塞进仓库。V2 已附带通过 GitHub 检查时生成的 package-lock.json；setup 默认使用 npm ci，按锁定版本安装。
