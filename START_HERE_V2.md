# Gouo Canvas V2 — Codex 从这里开始

目标：为淘宝、拼多多、抖音等国内电商，以及社媒、外贸和海报场景建设图片工作台。只做图片，不做视频。以月度订阅替代前台逐次余额扣费；内部保留成本、额度和审计账本。

决策：新前台 + 新业务域，迁移现有可用能力；优先复用成熟 GitHub 项目。保留旧站，不能以旧 UI 兼容为理由放弃新产品目标，也不能把所有后端功能未经审查直接当成可靠基础。

## 启动

选择 `zhs1234/gouo-canvas` 的 **v2** 分支，或从其派生的任务分支。工作树应包含本文件。

```sh
node v2/scripts/setup.mjs
cd v2
npm run check
npm run dev
```

访问 `http://127.0.0.1:5174/studio/`。工作台、模型接入清单和本地 Fabric 编辑器可独立开发；账号页连接现有 Go 后端，默认 `http://127.0.0.1:3000`。修改 `v2/.env` 的 `GOUO_BACKEND_DEV_TARGET` 即可，**不要放供应商密钥到前端环境变量**。

现有后端的安装要求和启动步骤见 `docs/zh-CN/development.md`、`server/AGENTS.md`。使用独立开发数据库/素材目录，不能复用生产数据库。V2 setup 不启动 Go、数据库、Redis 或真实付费请求。

## 阅读顺序

1. `AGENTS.md`、`v2/AGENTS.md`：范围与执行规则。
2. `docs/v2/TASKS.md`、`docs/v2/STATUS.md`：下一步任务与真实交付状态。
3. `docs/v2/ARCHITECTURE.md`、`docs/v2/API-DATA.md`：模块、接口、数据与事务边界。
4. `docs/v2/MODELS.md`、`docs/v2/SECURITY-MIGRATION.md`：多模型、Image 2.5、订阅与迁移风险。
5. `docs/v2/DESIGN.md`、`docs/v2/DEPENDENCIES.md`：产品交互与复用清单。

## 可直接发送给 Codex 的首条任务

> 在当前 Gouo Canvas v2 派生分支开发。先阅读 START_HERE_V2.md、适用的 AGENTS.md、docs/v2/TASKS.md 与 STATUS.md。执行 P0 初始化与基线检查，然后实施 B1：复用现有登录态，建立 Project/Asset 的最小服务端业务闭环和带权限的 API，接入 V2 工作台。不要继续只写方案，不要重写已可复用的认证、支付 SDK 或模型网关。按验收标准补测试并提交，更新 STATUS.md。下一批优先 B2 的模型目录与 GPT Image 2.5 兼容排查。任何真实付费模型测试等待单独授权；缺密钥时完成接口与模拟测试，不伪造上线状态。不改 main、不部署、不执行生产迁移。

## 边界

当前是**可继续开发的工程起点**，不是完整商品图 SaaS。现有 starter 已提供 UI 包、共享类型与校验、账号接口桥接、本地编辑/导出、模型排查工具、测试与 CI。Job/Worker、云项目、生产多模型适配、月度订阅等有明确任务，但未被伪装为已实现。

依赖通过 npm 安装，不把 node_modules、完整第三方仓库或字体文件塞进仓库。V2 已附带通过 GitHub 检查时生成的 package-lock.json；setup 默认使用 npm ci，按锁定版本安装。
