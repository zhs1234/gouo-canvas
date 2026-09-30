# 第三阶段交接：新对话使用 gpt-6.1-sol

> 最新用户要求：用户已于 16:53 UTC 看过官方完整 UI 桌面截图并确认“可以”；沿该方案收尾整合与最终 CI，父线程负责合并，不上线。新云端已完成 assistant-ui default starter 视觉阶段，来源、路由和替身边界见 [UI-STARTER.md](UI-STARTER.md)，本阶段证据见 STATUS.md 最上方。此要求优先于下文旧阶段下一步排序。默认 Loomic 保留，真实供应商调用仍为 0。

本轮到第三阶段结束，不自动开启第四阶段。代码在授权分支 `codex/qa-relay-owner-idempotency`，draft PR [#3](https://github.com/zhs1234/gouo-canvas/pull/3)，目标 `codex/new-api-v2`；不合并、不部署。最终精确提交与 CI 见本轮交付回复和 STATUS.md；新环境应先 fetch 并核对两分支及 PR head，不从临时目录恢复代码。

## 产品及代码状态

服务职责按已有文档拆分：New API 是唯一账号、渠道、模型路由与实际费用权威；Studio API 负责业务和单副本 SQLite；React/assistant-ui/官方 Excalidraw 负责交互。没有第二套账号、财务账本、完整 LibreChat 后端或新的商业画布许可。

- `/studio/chat`：真正 SDK token 流、工具/图片、owner-scoped 会话与运行事件、分页和刷新/重登查询。停止接收/断网不等于取消供应商；进程重启 running→unknown，不续跑或重收费。
- 图片“打开画布”与“插入已有画布”：只向 API 提交保存运行的定位字段，不把客户端图片 URL 当作归属证明。原始资产独立存储、唯一来源幂等，失败不自动再生成。
- `/studio/projects`：私有服务器项目新建、列表、改名、打开；旧本机 Loomic 草稿分区保留。
- `/studio/canvas-lab?project=<id>&asset=<id>`：官方 Excalidraw 持久项目，稳定 assetId、独立 processedSourceIds 防重复与删除复活，元素和 files 同存，裁剪保留原 bytes。revision CAS、失败暂停、文档和独立恢复副本导出。无参数仍为独立本地候选；旧草稿只读副本、原 payload/Blob 保留。
- 普通 `model` 路由可选，不需管理员后缀。必须有固定 New API 版本、准确 gatewayOrigin、RetryTimes=0 的人工核验记录；不能填 channelId。默认 pinned 兼容保留，不静默放宽。
- 既有 fail-closed owner、busy 拒绝前不写账本、未知供应商结果禁止重发及 SDK/依赖修复全部保留。锁文件本阶段无新增依赖，MIT/Apache 归属不变。

主要文件：`v2/apps/api/src/{server,history,projects,relay,config}.mjs`；`v2/apps/studio/src/chat-lab/`、`canvas-lab/`、`loomic/ProjectsPage.tsx`。API 数据与限制见 API-DATA.md；路由与安全配置见 MODEL_SETUP.md；默认切换门槛见 CANVAS_COMPARISON.md。

## 可重现运行

仓库根：

```sh
git fetch origin
git switch codex/qa-relay-owner-idempotency
docker compose --env-file v2/deploy/.env.example -f v2/deploy/compose.yml up --build --wait
```

访问 `http://localhost:8080/studio/`。默认回环绑定、生成关闭；可检查 `/setup`、`/console`，不自动初始化。需要 Docker/Compose v2.24+ 及公开构建依赖网络。停止使用同样参数的 `down`，不要 `-v` 删除用户数据。Studio 单副本，数据在独立命名卷；原图/项目/运行备份需 SQLite 一致性快照或停服完整卷。

独立检查：

```sh
cd v2
npm ci
npx playwright install chromium
npm run check
npm run test:e2e -- --workers=1 --reporter=line
npm run test:stack
npm ls --all
npm audit
npm audit --omit=dev
node scripts/check-model-config.mjs
```

浏览器测试共享5174启动器，不与其他 Playwright 命令并行；重构建整栈时也优先串行，避免重负载时序误判。整栈脚本只管理随机临时项目并回收自己的容器/卷/本地镜像，不读用户 `.env`。真实固定版 New API 只验未初始化及安全边界；有账号/生图/费用链路的是明确内存替身，浏览器网络无拦截，实际经过 Nginx→Studio→替身。

原执行器 BuildKit 需既有系统受信任 CA 的只读 secret 和标准代理；此环境特有 override 不入仓库，不能用跳过 TLS、新增根信任或公开后台替代。空间曾满，已只清理明确本任务可再生成缓存；新环境不用依赖其缓存或测试卷。

## 下一步优先级及安全前置

接手小阶段（2026-09-30）修复了保存失败后继续编辑的恢复副本遗漏，以及重复打开/失败初始化覆盖原恢复副本的问题；新增脏状态、保存中状态和浏览器离页提醒。默认入口仍为 Loomic，原草稿/原图未迁移或删除。新增测试和实际验证见 STATUS.md 的“接手增量”；第三阶段 QA 数字是历史基线，不能用来代替本增量验证。

1. 用户在自己的本机或明确授权私有主机按 RUNNING/MODEL_SETUP 原生配置 New API。当前执行器无安全用户 handoff/Vault/受保护后台预览，不能代用户录入密码/key或公开后台。
2. 用户自行初始化账号、两条 Feng 上游渠道、普通账号受限统一 token；上游 `https://api.feng.cx` 的 `gpt-6.1-sol` 与 `gpt-image-2` 各有上游 key，应用仅统一 token。不要在聊天请求密钥。修改原生账号/权限/渠道/RetryTimes 必须明确目标与批准，录入提交由用户完成。
3. 核验真实协议、模型能力、RetryTimes=0、token owner/模型/期限/额度，以及供应商价格和全部调用的保守采购成本上界。总获准费用人民币5元，至今真实调用0元；曾在主聊天暴露的值不得检索/使用，先由用户撤销重建，并仅在原生后台录入；12小时有效或自称有限额不等于合计5元已强制落实。示例输出128 token、n=1不等于价格保证。未知成本/结果则停止，不重复或切渠道。
4. 然后独立验证真实普通聊天、图片、工具循环与费用归属；每步核对原生消费记录，工具循环另核工具支持与调用预算。替身通过不得标模型 live-verified。
5. 默认画布切换前，按 CANVAS_COMPARISON 补复杂历史文档视觉比较、系统文件/剪贴板、移动端和容量验收；当前保留 Loomic 回退，不覆盖历史草稿。

当前限制：共享个人 relay 只允许配置 owner 生成，不是多租户凭据分配；无持久 Worker/自动续流/真正停止供应商、无资产删除/存储额度/保留策略/协作；HTTP文档20MiB、5000元素/100图片、原图30MiB/2400万像素，SQLite单副本。异步本机保存不能保证突然关闭最后片段；服务器项目必须等待确认保存，冲突时先导出恢复副本。MFA与公网生产配置/备份/保留政策仍需独立验收，当前只适合继续隔离测试和演示，不能声称可直接上线收费。
