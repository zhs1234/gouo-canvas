# 一套产品，三个独立服务

New API 是账号、渠道、价格、余额和消费日志的唯一权威；Studio API 负责画布业务、模型能力验证、有限智能体循环和请求去重；Studio SQLite 另存账号私有会话、项目和原始素材；浏览器负责编辑及本地草稿。服务和数据库不合并，不引入第二套账号系统。

## 从干净环境启动

需要 Docker Engine 与 Docker Compose v2.24+（隔离测试使用 `!reset`），以及构建时访问 npm、官方 GitHub 发布资产和公开基础镜像。New API 固定 `v1.0.0-rc.40`，amd64/arm64 发布二进制按官方 SHA-256 校验；不依赖任何 `/workspace/...` 环境 helper，不构建旧 `server/`。

仓库根运行：

```sh
docker compose --env-file v2/deploy/.env.example -f v2/deploy/compose.yml up --build --wait
```

访问 **http://localhost:8080/studio/**。所有发布端口默认仅绑定回环地址；New API 与 Studio API 不直接发布宿主端口。初始模型禁用，不需要任何账号密码或 API key，不会调用模型。

- `/studio/`：现有画布、账号和流式聊天。
- `/setup`、`/sign-in`、`/security`、`/wallet`：New API 原生初始化/控制台，沿用其权限校验。
- `/studio/chat`：assistant-ui 正式聊天入口，按 New API 账号持久化会话，复用原生账号与费用面板；`/studio/chat-lab` 兼容跳转，不覆盖旧画布历史。
- `/studio/canvas-lab`：官方 Excalidraw 候选：无参数为本地独立草稿；带 project 参数为账号私有 Studio 项目，可从聊天图片打开或插入。旧草稿仅副本导入，不覆盖。

```text
同源入口 :8080 (Nginx)
  /studio/*          → React 静态产物
  /api/studio/*      → Studio API :3001 → New API :3000 /api/user/self、/v1
  /api/*、原生账号页面 → New API :3000
  /v1/*              → 对浏览器入口拒绝，防止绕过业务授权
```

Nginx 禁用 SSE 缓冲，对写请求校验精确 Origin，保留刷新 Cookie 和 Authorization；不要把 `GOUO_PUBLIC_ORIGIN` 写成另一个地址后用不同 hostname 浏览。使用 127.0.0.1 或自定义端口时同时修改 origin 和端口。普通应用请求与原生控制台仍由 New API 鉴权，不在代理层伪造账号。

## 健康与停止

`docker compose ... ps` 显示三个服务健康检查。安装 Node 依赖后还可运行：

```sh
cd v2
GOUO_STACK_URL=http://localhost:8080 npm run stack:status
```

报告分别检查入口、Studio、New API，并区分“服务可达”和“账号已初始化”；未初始化不是模型可用。停止用同一 Compose 文件的 `down`，**不要添加 `-v`**：命名卷分别保存 New API 数据和 Studio 去重结果/账号会话历史/项目及原始素材，清空它们会丢账号/配置及未知请求保护。当前 Studio 仅单副本，不能用多实例扩容绕过进程内并发守卫。

## 用户安全初始化（本任务没有代做）

1. 在本机访问 `/setup`，由用户自行输入管理员密码、审阅并选择 New API 原生设置。项目脚本不会创建账号、接受条款、设置密码或生成 token。
2. 用户在 New API 原生渠道页面配置两个独立上游渠道：Feng 的 `gpt-6.1-sol` 聊天 key 与 `gpt-image-2` 图片 key。供应商密钥只保留在 New API；按供应商文档确认基址与协议，不根据名称宣称能力已验证。
3. 优先按 [MODEL_SETUP.md](MODEL_SETUP.md) 配置普通账号模型路由，核验固定版本测试实例 RetryTimes=0，准备非秘密人工核验记录。用户在 New API 管理并限制测试账号统一 relay token 的模型、额度和期限。它必须属于用于画布登录的账号；当前个人 relay 模式只允许该 owner 生成，不是多租户凭据分配。模型价格及第三方真实成本分别核实，原生价格不自动等于上游采购成本。
4. 由用户安全编辑 `v2/deploy/runtime/relay-key`（只放统一基础 token，无渠道后缀）和 `models.json`（普通路由从 `v2/config/loomic.models.normal.example.json` 复制）；文件不提交。密钥文件设置仅必要读取权限，容器 Studio 用户为 UID 1000，确保其能够读取，不用全局可写权限。不得在聊天、命令参数或构建参数中提供 key。
5. 复制 `v2/deploy/.env.example` 为本地忽略的 `.env`，填写非秘密 owner ID、运行时文件路径，并在明确授权与验证后开启生成。运行时只支持原有 `GOUO_RELAY_API_KEY` 或新的 `GOUO_RELAY_API_KEY_FILE` 二选一；Compose 使用文件，不将 key 给前端。
6. 模型 JSON 使用准确模型 ID；普通 model 路由不得填 channelId，由 New API 按模型选择渠道。既有 pinned 模式保留，其渠道后缀要求管理员 token，不为后缀提升日常账号权限。聊天设置已验证的 toolCalling/maxChatCalls/maxTokens，图片仅启用实际验证过的 operations/quality/size。未验证继续 pending/disabled，不能为了出现菜单而伪标 live-verified。
7. 用 `--env-file v2/deploy/.env` 重建/重启配置对应的服务。账号登录、余额及日志全部来自同一个 New API，不另建余额库。

当前获准真实测试总预算是人民币 5 元，**尚无凭据、未执行付费测试**。待安全输入和价格/额度上界确认后逐步验证：普通聊天、单次图片、两次聊天加一次图片的工具循环；每步核对实际费用，未知结果停止不重试。不能默认此序列一定低于 5 元。

## 开发与部署边界

前端热更新仍可 `cd v2 && npm run dev`，连接明确配置的 New API；完整可重复入口是上述 Compose。后续如需热更新连接 Compose 中的 New API，应显式添加仅回环的开发端口覆盖，不为生产默认发布内部端口。

此 Compose 是单机开发/预发布运行基础，不是上线授权。公网部署必须由运维提供已经配置好的 HTTPS 终止入口，再设置 `GOUO_PUBLIC_ORIGIN=https://...`、`GOUO_SECURE_COOKIES=true`、`GOUO_TRUSTED_ORIGIN=https://...`；验证 New API 的安全会话密钥、可信代理、备份、日志保留和管理员访问策略。不能把默认本地 HTTP 入口直接暴露到公网。此项目不会自动申请证书、接受新服务条款或修改生产安全设置。

CI 用 `GOUO_STACK_DOCKER_HUB=true` 从 Docker Official Images 原始仓库拉取相同 digest，以避免公开 ECR 数据限流；本地默认镜像内容相同，不自动换成浮动版本。

构建若已有组织代理/受信任 CA，Dockerfile 支持可选 BuildKit secret `build_ca`；仅由操作人员指向已经授权的 CA 文件并传标准 HTTP_PROXY/HTTPS_PROXY 构建参数。默认不改变信任；不得关闭 TLS 校验或加入未知根证书。依赖安装失败应明确处理网络条件，不能从陌生镜像下载替代程序。

## 可重复验收与证据边界

```sh
cd v2
npm ci
npx playwright install chromium
npm run check
npm run test:e2e
npm run test:stack
```

`test:stack` 使用随机隔离 Compose 项目，不读取用户 `.env`，不挂载既有数据，不生成真实持久凭据；完成后只删除它自己创建的容器、卷和自动命名的构建镜像，不执行全局缓存清理：

- 第一轮运行真实固定版本 New API，检查未初始化状态、零 root 账号、同源页面、匿名拒绝、生成关闭、Origin 防护及 `/v1` 隔离；不调用初始化 POST。
- 第二轮将 New API 换为明确的内存契约替身；浏览器网络不被 Playwright 拦截，实际经过 Nginx → Studio → 替身，验证统一登录/刷新/退出、真实 SDK 流式工具生图、当前账号账单、跨账号拒绝、重放不重复执行、画布保存恢复，以及 assistant-ui 已保存图片→原始素材→持久项目→官方画布→项目库/刷新、跨账号404。

第二轮的账号、key、价格和图片全部是公开 fixture，不能宣称真实 New API 登录/渠道/供应商计费已验收。真实集成仍需用户安全初始化后单独测试。

流式 `/runs/stream` 与兼容批次 `/runs` 共用请求去重。终态在完整结果写入 SQLite 后发送，含费用状态。客户端断网或“停止接收”只关闭传输，后台可能继续调用并计费；原画布部分文字节流保存到本地历史，页面突然退出可能丢失最后片段。新 `/studio/chat` 则逐事件保存到 Studio SQLite，刷新/切线程可通过 GET 读取已保存运行；进程重启把未完成任务标为 unknown，不自动续跑。没有自动重发或持久 Worker。服务端未知结果仍阻止重交；不要通过删除账本恢复按钮可用性。


## 会话历史与数据边界

正式聊天 `/studio/chat` 可以直接打开原 New API 账号/费用面板，并在刷新、退出再登录后读取当前账号历史。默认画布菜单提供入口；旧画布对话仍在原 IndexedDB，不静默迁移。详情分页与模型上下文窗口见 CHAT-LAB.md；官方画布的只读副本导入与默认切换条件见 CANVAS_COMPARISON.md。

Studio 会话只保存 New API 的数字 owner ID，不保存密码或复制账号体系。每用户模式必须配置稳定 `GOUO_ACCOUNT_INSTANCE_ID` UUID；启用试用时可取批准policy.instanceId，同时配置必须一致。Studio数据卷永久绑定同账号数据库实例，关闭试用仍保留UUID；已有绑定而缺失/改为另一UUID拒绝启动。备份/恢复需保持同一 Native与Studio数据关系，重建账号库必须新UUID和业务卷，不能复用数字owner ID。当前没有跨账号系统的历史迁移。图片以内嵌结果保存，历史尚无自动保留期限；大量图片的分页响应仍可能较大，部署前需评估容量、备份与保留策略。

未知付款偏好写入暂停本人所有新发送，关闭试用仍显示待核对；GET一致或重启Studio不会解除。T1.3私有本机恢复CLI的目标核验、显式停服/重启授权、只读inspect、连续锁会话及CAS见 [FUNDING-RECOVERY.md](FUNDING-RECOVERY.md)。仅支持固定单容器SQLite拓扑，不写Native偏好/钱，不释放旧unknown或次数；日常服务未执行该恢复。


## 安全配置交接

T1.4 的有限生成权限续用与原生登录导航均为 prepared opt-in 配置。日常栈仍不启用试用、生成或续用；人工核验文件不会自行开放网络。具体原生固定版本、三个私有模型入口、Redis/batch关闭、状态/version/幂等合同及unknown限制见 [TOKEN-RENEWAL.md](TOKEN-RENEWAL.md)。`GOUO_ENABLE_TOKEN_RENEWAL=false` 是示例默认值。未知续用不能借付款偏好恢复工具解锁。

T1.5b私有 `node scripts/reconcile-renewal.mjs inspect|adopt|close-empty` 的完整身份、offline Studio、明确Native重启及私有入口确认见 [TOKEN-RECOVERY.md](TOKEN-RECOVERY.md)。只支持v2完整批准/proof、同SQLite日志、无Redis/batch、固定单容器私有拓扑和配置不变；真实日常数据未执行。恢复不启动Studio，失败可能Native仍停止，需核对状态；原key永久409，Native资金/token不写，旧run/held/funding不清。可重复真实合同 `GOUO_RECOVERY_TEST_DOCKER=<Docker路径> node tests/stack/renewal-recovery-native.cases.mjs` 只创建随机合成隔离栈，无host发布/供应商调用，不读取用户.env或日常卷。

新增可重复测试：`node tests/stack/token-native.cases.mjs` 验真实固定Native token合同（不验真实部署排他性），`node tests/stack/account-browser-isolation.mjs start` 创建随机prepared账号浏览器栈，`refresh-web <state.json>` 只刷新该栈Studio静态构建，`stop <state.json>` 只清理该栈。真实UI注册/安全证明/密码旋转与Studio显示名称证据见ACCOUNT-CONTRACT；测试账号/额度均合成，没有真实供应商费用。完整CLI操作是验收证据，不声明脚本自动完成用户交互。

`localhost:8080` 只对运行 Compose 的那台机器可达，不是云执行环境到用户浏览器的共享预览地址。只有在环境实际提供受保护的端口预览和用户接管能力时，才能把原生 `/setup`、`/sign-in`、`/security`、`/wallet` 作为远程配置入口；不要假设有 Personal Vault，也不要为交接临时公开管理后台或数据。

没有上述能力时，最小方式是用户在自己的电脑/已授权私有测试主机运行本分支 Compose，再在该机器的浏览器完成原生账号、渠道与受限统一 token 配置，并以本机受保护文件将 token 交给 Studio。助手可以准备非秘密配置与测试步骤，密码、两个渠道密钥及 token 的最终录入/提交由用户完成。使用新测试账号、token 或权限设置前需明确目标实例与授权范围；已有生产实例不能默认为测试目标。

录入之后仍先核对两模型真实价格和渠道/token硬限额，确保整个测试的保守上界不超过 ¥5；未知价格或未知已扣费结果时暂停付费步骤。不要在保存渠道时顺带发起未经预算核验的自动测试。
