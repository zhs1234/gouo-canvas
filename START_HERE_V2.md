# Gouo Canvas V2 — Codex 从这里开始

目标：为淘宝、拼多多、抖音等国内电商，以及社媒、外贸和海报场景建设图片工作台。只做图片，不做视频。以月度订阅替代前台逐次余额扣费；内部保留成本、额度和审计账本。

决策：新前台 + 新业务域，迁移现有可用能力；优先复用成熟 GitHub 项目。保留旧站，不能以旧 UI 兼容为理由放弃新产品目标，也不能把所有后端功能未经审查直接当成可靠基础。

2026-09-30 后端选择：使用 [New API](https://github.com/QuantumNous/new-api) 替换 One Hub，当前固定开发版本 `v1.0.0-rc.40`。这是新的开发阶段，没有数据需要迁移；云项目/素材库暂不接入，先做模型协议兼容与本地编辑器。

## 启动

选择 `zhs1234/gouo-canvas` 的 **v2** 分支，或从其派生的任务分支。工作树应包含本文件。

```sh
node v2/scripts/setup.mjs
cd v2
npm run check
npm run dev
```

访问 `http://127.0.0.1:5174/studio/`。工作台、模型接入清单和本地 Fabric 编辑器可独立开发；账号页连接 New API，默认 `http://127.0.0.1:3000`。修改 `v2/.env` 的 `GOUO_BACKEND_DEV_TARGET` 即可，**不要放供应商密钥到前端环境变量**。

New API 的部署说明以固定版本的上游文档为准，使用独立开发数据库。当前 Codex 云环境已安装并校验官方发布二进制，可运行 `python3 /workspace/new-api-environment/start.py`，随后运行 `python3 /workspace/new-api-environment/smoke.py` 初始化并检查本地账号。本地随机凭据在权限 0600 的 state/local-credentials.json 中，不打印、不提交。V2 setup 只安装前端，不启动后端或发起真实付费请求。旧后端文档仅供参考。

账号协议为 Bearer access token + HttpOnly refresh Cookie：`POST /api/user/login`、`POST /api/user/auth/refresh`、`POST /api/user/auth/logout`、`GET /api/user/self`。访问令牌仅留内存，不存 localStorage/sessionStorage；退出由服务端撤销。当前仅验证本地 HTTP 开发，生产必须另行配置 HTTPS、安全 Cookie 与 Origin/CSRF 策略。额外验证/MFA 流程尚未在 V2 实现。

## 阅读顺序

1. `AGENTS.md`、`v2/AGENTS.md`：范围与执行规则。
2. `docs/v2/TASKS.md`、`docs/v2/STATUS.md`：下一步任务与真实交付状态。
3. `docs/v2/ARCHITECTURE.md`、`docs/v2/API-DATA.md`：模块、接口、数据与事务边界。
4. `docs/v2/MODELS.md`、`docs/v2/SECURITY-MIGRATION.md`：多模型、Image 2.5、订阅与迁移风险。
5. `docs/v2/DESIGN.md`、`docs/v2/DEPENDENCIES.md`：产品交互与复用清单。

## 可直接发送给 Codex 的首条任务

> 在当前 Gouo Canvas v2 派生分支开发。先阅读 START_HERE_V2.md、适用的 AGENTS.md、docs/v2/TASKS.md 与 STATUS.md。复验 P0，然后实施 B2 的模型目录与 GPT Image 2.5 兼容排查，以固定版本 New API 为网关；先明确服务端业务边界与身份校验，浏览器不持有供应商/relay 密钥。暂不实施 B1 云项目/素材库，不迁移旧数据。不要重写已有认证或模型网关。按验收标准补测试并提交，更新 STATUS.md。真实付费模型测试等待单独授权；缺密钥时完成协议与测试，不伪造上线状态。不改 main、不部署、不执行生产迁移。

## 边界

当前是**可继续开发的工程起点**，不是完整商品图 SaaS。现有 starter 已提供 UI 包、共享类型与校验、账号接口桥接、本地编辑/导出、模型排查工具、测试与 CI。Job/Worker、云项目、生产多模型适配、月度订阅等有明确任务，但未被伪装为已实现。

依赖通过 npm 安装，不把 node_modules、完整第三方仓库或字体文件塞进仓库。V2 已附带通过 GitHub 检查时生成的 package-lock.json；setup 默认使用 npm ci，按锁定版本安装。
