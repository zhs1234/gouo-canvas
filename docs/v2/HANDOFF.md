# 第三阶段交接：新对话使用 gpt-6.1-sol

> 2026-10-01 T1.6 最新：基于0350f75，在codex/registration-trial完成四角色独立浏览器实操和八项产品修复，当前准确28场景统计及F/N/P边界见QA_ACCEPTANCE_REPORT.md；保留原失败证据与实际同数据复验。51领域、151API、87浏览器/2.2分钟及三阶段stack通过（stack先于Q8搜索增量，增量后完整API/PW/build另验）。JWT仅内存、跨标签静态失效与epoch竞态防护、429明确手动恢复、草稿保存后导航、持续导入错误/实际失败原因/原生钱包、正确官方路径及本人服务端标题搜索均完成。合成零钱包实际Native试用闭环与原图/旧库保留，不等于真实供应商/支付，采购0。真实CT共享IP20/1200造成部分门项等待，未调整；logself实际吃GA而非CT，纠正源码归纳，启用决策见NATIVE_RATE_LIMIT_GATE.md。日常只更新web/Studio，Native原ID/启动时间不变、setup仍false、generation/trial/renewal全false、默认edge；无push/merge/部署或锁变化。下一T1.7补隔离剩余场景与启用门槛，整体产品仍未完成。下文旧“最终28未执行”是历史基线，以本报告当前实际部分执行为准。

> T1.6最终补充：28核心F/N范围16通过、11partial、1未执行，所有P未验；provider23实际到达/Native22消费日志/3个held分列。自然窗口后B历史搜索/Stop/新线程与指定会话撤销、D6重启新ID屏障复验完成，未验补充子项仍partial。G2新增真实Native预扣门项：owner6日志和userused36、sub/token56，唯一失败NativeID预扣20仍consumed；退款SysLog有SQLite锁但缺requestID关联，不认定根因/结算/退款。history.failed与trial.unknown是不同状态，安全证据及调查门槛见BILLING-EVIDENCE。下一T1.7优先准备G2最小重现/可审查方案，保持旧held/资金/模型key不动，不静默升级pin。

> 2026-10-01 T1.5b最新：基于9ca25f9，在codex/registration-trial完成v2不可变续用批准快照、Native退休proof先持久后唯一POST，以及私有inspect/adopt/close-empty。连续锁下实际结束旧Native进程、前后RO完整持久证据、重核配置和Studio审计/binding/CAS事务；原key409，旧run/held/funding/资金/次数不动。51领域、150API、71浏览器、三阶段整栈通过；真实固定Native恢复两例与正常到期/耗尽两例另验，0模型/真实费用。旧v1/缺proof/软删除/重复/消费/漂移仍拒，部分组模型子集暂保守拒；失败可能Native仍停止，CLI不启动Studio。详见STATUS/TOKEN-RECOVERY。日常真实配置保持关闭、恢复未对日常卷执行。下一T1.6四角色28场景综合浏览器验收与问题修复，F/N/P分别统计；最终用户模拟尚未执行，整体目标继续，以下旧下一项均按历史读取。

> 2026-10-01 T1.5a最新：T1.4已提交 `cc498a0`；本轮修复consume日志被误称settled的问题，完整唯一本人日志只表示recorded/实扣unconfirmed，旧settled/pending历史和重放只读兼容，金额/ID/旧库保留。22领域、147API、71浏览器、三阶段整栈通过；真实固定Native正常DTO/SQLite快照与16次本地替身relay另验，0真实采购。下一项T1.5b未知token续用私有停服恢复，当前旧target不足adopt、工具尚未实现；真实日常配置仍关闭、最终28场景四角色模拟未执行。详情见STATUS/BILLING-EVIDENCE/TOKEN-RENEWAL，以下旧下一项顺序按历史读取。

> 2026-10-01 最新交接优先于下文历史：PR #3 已合并，基线 `abe46c4`；本机环境提交 `1545e25`、`40338ea`，当前功能分支 `codex/registration-trial` 从该 V2 基线派生，没有从main开发。T1 `7195190`、T1.2 `2cbfd90`、T1.3 `2793093` 已接通原生资金/明确付款/安全账户/停服恢复；本轮T1.4完成默认关闭的有限权限查询和明确新token续用、持久owner绑定与unknown屏障。真实固定Native两类token合同、完整注册/加密登录/proof改密/旧会话撤销/Studio恢复/显示名，以及prepared模型key私有边界分别通过。22领域、142API、68浏览器及三阶段整栈通过，0真实采购。日常8080仍未初始化，真实计划/入口未启用，详细证据与限制见STATUS/TRIAL/ACCOUNT-CONTRACT/TOKEN-RENEWAL。下一项 **T1.5 原生费用记录证据语义与未知token续用私有恢复**；consume log不能独立证明Native资金和token均结算成功，先修状态兼容，再单独核对恢复。最终28场景多智能体真实UI模拟仍待执行。下文draft PR、待合并、旧分支和旧下一步是历史记录。

> 最新用户要求：用户继续授权账号管理、计费、新普通用户注册后可用性收尾，优先级 CI→fresh 普通用户闭环→原生账号→计费异常对账→移动恢复→最终 CI。简明计划见 TASKS.md，固定契约见 ACCOUNT-CONTRACT.md，每用户模式与真实执行阻塞见 USER-BILLING.md。真实配置默认关闭，未设赠额/售价/支付，父负责最终合并。

> 上一阶段视觉：用户已于 16:53 UTC 看过官方完整 UI 桌面截图并确认“可以”；沿该方案收尾整合与最终 CI，父线程负责合并，不上线。新云端已完成 assistant-ui default starter 视觉阶段，来源、路由和替身边界见 [UI-STARTER.md](UI-STARTER.md)，本阶段证据见 STATUS.md 最上方。此要求优先于下文旧阶段下一步排序。默认 Loomic 保留，真实供应商调用仍为 0。

用户已追加授权上述账号与计费最小增量，不扩大到新 IAM、队列或支付系统。代码在授权分支 `codex/qa-relay-owner-idempotency`，draft PR [#3](https://github.com/zhs1234/gouo-canvas/pull/3)，目标 `codex/new-api-v2`；不合并、不部署。最终精确提交与 CI 见本轮交付回复和 STATUS.md；新环境应先 fetch 并核对两分支及 PR head，不从临时目录恢复代码。

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
git switch codex/registration-trial
docker compose --env-file v2/deploy/.env.example -f v2/deploy/compose.yml up --build --wait
```

访问 `http://localhost:8080/studio/`。默认回环绑定、生成关闭；可检查 `/setup`、`/sign-in`、`/security`、`/wallet`，不自动初始化。需要 Docker/Compose v2.24+ 及公开构建依赖网络。停止使用同样参数的 `down`，不要 `-v` 删除用户数据。Studio 单副本，数据在独立命名卷；原图/项目/运行备份需 SQLite 一致性快照或停服完整卷。

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

浏览器测试共享5174启动器，不与其他 Playwright 命令并行；重构建整栈时也优先串行，避免重负载时序误判。整栈脚本只管理随机临时项目并回收自己的容器/卷/本地镜像，不读用户 `.env`。`test:stack` 的固定版New API阶段只验未初始化及安全边界，有账号/生图/费用链路的该脚本阶段是明确内存替身，浏览器网络无拦截、经过Nginx→Studio→替身。新增独立 `trial-native/account-native/recovery-native` 脚本另验真实固定Native：前者模型供应商仍是本机替身，后二者没有模型调用；不能混称真实付费模型验收。

原执行器 BuildKit 需既有系统受信任 CA 的只读 secret 和标准代理；此环境特有 override 不入仓库，不能用跳过 TLS、新增根信任或公开后台替代。空间曾满，已只清理明确本任务可再生成缓存；新环境不用依赖其缓存或测试卷。

## 下一步优先级及安全前置

接手小阶段（2026-09-30）修复了保存失败后继续编辑的恢复副本遗漏，以及重复打开/失败初始化覆盖原恢复副本的问题；新增脏状态、保存中状态和浏览器离页提醒。默认入口仍为 Loomic，原草稿/原图未迁移或删除。新增测试和实际验证见 STATUS.md 的“接手增量”；第三阶段 QA 数字是历史基线，不能用来代替本增量验证。

1. 用户在自己的本机或明确授权私有主机按 RUNNING/MODEL_SETUP 原生配置 New API。当前执行器无安全用户 handoff/Vault/受保护后台预览，不能代用户录入密码/key或公开后台。
2. 用户自行初始化账号、两条 Feng 上游渠道、普通账号受限统一 token；上游 `https://api.feng.cx` 的 `gpt-6.1-sol` 与 `gpt-image-2` 各有上游 key，应用仅统一 token。不要在聊天请求密钥。修改原生账号/权限/渠道/RetryTimes 必须明确目标与批准，录入提交由用户完成。
3. 核验真实协议、模型能力、RetryTimes=0、token owner/模型/期限/额度，以及供应商价格和全部调用的保守采购成本上界。总获准费用人民币5元，至今真实调用0元；曾在主聊天暴露的值不得检索/使用，先由用户撤销重建，并仅在原生后台录入；12小时有效或自称有限额不等于合计5元已强制落实。示例输出128 token、n=1不等于价格保证。未知成本/结果则停止，不重复或切渠道。
4. 然后独立验证真实普通聊天、图片、工具循环与费用归属；每步核对原生消费记录，工具循环另核工具支持与调用预算。替身通过不得标模型 live-verified。
5. 默认画布切换前，按 CANVAS_COMPARISON 补复杂历史文档视觉比较、系统文件/剪贴板、移动端和容量验收；当前保留 Loomic 回退，不覆盖历史草稿。

当前限制：共享个人 relay 只允许配置 owner 生成，不是多租户凭据分配；无持久 Worker/自动续流/真正停止供应商、无资产删除/存储额度/保留策略/协作；HTTP文档20MiB、5000元素/100图片、原图30MiB/2400万像素，SQLite单副本。异步本机保存不能保证突然关闭最后片段；服务器项目必须等待确认保存，冲突时先导出恢复副本。MFA与公网生产配置/备份/保留政策仍需独立验收，当前只适合继续隔离测试和演示，不能声称可直接上线收费。
