# Codex 任务清单

当前决策（2026-09-30）：使用 New API 作为账号与模型网关，没有旧数据迁移，云库暂缓。当前已接入固定版本 Loomic 原生画布/聊天，业务服务为 v2/apps/api；本地草稿/项目/对话已接通，见 LOOMIC.md。工作顺序为 B2 实际渠道验证 → B3，本地 E1 可继续；B1 及依赖云保存的部分等待后续需求。以下原有项目/素材设计保留作参考，不应自动执行。业务请求通过 New API /api/user/self 校验 Bearer 身份，不写入旧 One Hub 的 server/。视频生成后续接入，视频剪裁不在范围。真实收费必须等额度/幂等底座。每项单独形成可审查提交，更新 STATUS.md。

## P0 — 安装、基线与现状确认（第一个任务）

读取全部适用 AGENTS。运行 `node v2/scripts/setup.mjs`、`cd v2 && npm run check`，安装浏览器后运行 `npm run test:e2e`。已提交 CI 生成的真实 package-lock.json；使用 npm ci，不无故重新解析版本或手工编造 integrity。记录运行的 Node/npm/Go 版本。

验证固定版本 New API 的真实登录、刷新、退出和图片路由鉴权；旧 UI/Go 基线仅在改动旧代码时复验。缺少网络/工具/凭据时明确记录，允许继续不依赖它的任务。确认没有改 main、生产配置和数据。核对 New API 当前版本的模型协议行为，不沿用旧网关限制，见 MODELS.md。

验收：V2 类型检查、领域/探测/API 协议测试和 Playwright 流程通过（实际数量见 STATUS.md）；依赖锁已提交；真实模型调用未自动发生。

## B1 — Project / Asset 服务端闭环（暂缓，历史设计）

位置：server/internal/studio/{projects,assets,httpapi}；新 `/api/studio/*` 路由；v2/apps/studio 的工作台与项目页。

复用 Session 和 GORM，编写增量 migration、回滚说明、owner scoped repository。项目 CRUD 用 revision 乐观锁。上传验证 MIME/魔数/尺寸/大小，素材必须属于当前用户，私有读取接口不得凭 ID 绕过授权。优先先接现有本地私有存储，再实现/验证 OSS/S3 适配，不可因为已有 SDK 就默认开放公开桶。

接入真实项目列表、创建、素材上传和详情；不要展示假“云保存成功”。旧 IndexedDB 未同步资产保持不动。

验收：匿名 401；他人项目/资产 404 或 403；超额/异常文件拒绝；同名上传不覆盖他人文件；创建、刷新、再次打开项目仍在；revision 冲突有提示。使用集成测试验证，不只 mock repository。

## B2 — 多模型目录与协议兼容（Image 2.5 优先）

2026-09-30 本实例已完成 `gpt-5.6-sol` 对话渠道 2 + `gpt-image-2` 图片渠道 1 的授权真实工具链验证和原生账单核对；跨渠道固定路由、受限工具循环、CNY 余额/用量/单价显示已实现。保留当前单价，default 1 倍计费；没有手工改余额或新增订阅。剩余别名价格依据、视觉/编辑/质量参数与其他协议继续按本任务验证，不能把这一次结果推广到全部模型。B3/S1 仍是公众销售、订阅和可恢复任务的前置工作。

业务入口已在 v2/apps/api；Loomic 实际配置参考 v2/config/loomic.models.example.json，原 models.example.json 供 operator probe 参考。已完成 Images JSON/multipart、Chat Completions + LangGraph 工具循环的本地协议测试，仍待真实渠道验证。复用固定版本 New API 的网关适配；确实不支持时评估服务器端 direct adapter，不能逼用户换模型或把供应商密钥发给浏览器。当前不依赖 B1 云库。

实现公开能力目录与仅管理员可编辑的渠道配置；modelKey、upstreamModelId、protocol、adapter、capabilityRevision 分离。先做 OpenAI Images JSON 与 multipart 编辑，再 Responses。后续独立适配 Gemini Content/Interactions、fal Queue、其他 native 协议。每个协议单独提交，不把不同接口假装成一套 Images JSON。

Image 2.5 优先核查官方两个 ID 与实际渠道别名，JSON 字段、模型映射 multipart 字段、quality xhigh/max、usage、超时、路由权限和计费。加入脱敏 golden request/response fixtures。没有凭据时保持禁用：示例占位模型为 pending，本地 adapter 测试仅证明协议行为；实际渠道必须 live-verified 后才可启用。URL-only 输出当前明确拒绝，后续需要私有下载适配后单独验证。

验收：新模型无需改前端源码便可注册；不支持的参数明确拒绝；multipart 改名不丢字段；JSON、b64、URL、错误/拒绝、超时都有测试；配置未验证时 fail closed。真实付费探测需另行授权。

## B3 — Durable Job / Worker / Usage Reservation

在已选的 v2/apps/api 边界划分 jobs/usage/outbox 与独立 worker 入口；按实际技术栈选择成熟队列。当前 SQLite request guard 不是 durable job 或 usage reservation；原 Asynq/Go 建议是可选方案，不能为了它默认搬回旧 server/。云库暂缓时不得宣称已有云端结果保存，输出保留/下载与删除策略需在本任务明确。

POST job 返回 202 + jobId。数据库事务写 job/reservation/outbox，server 校验套餐权益与素材归属。后台 worker 执行、保存私有结果、持久化状态；浏览器只查询，不持有上游长连接或 service token。刷新/关页不丢任务。

实现有界重试与 reconciling；收到上游任务 ID 后只查询，不重复提交。不确定调用结果时不得盲目换渠道。部分成功按成功输出结算，释放剩余额度；失败/取消与回调重复必须幂等。真实费用与会员单位分开。

验收：队列重复投递、worker 重启、网络中断、上游 429、成功但素材下载失败、部分成功、超额并发、重放 idempotency key 均测试；数据库账本不重复；不依赖内存锁。

## E1 — 编辑器 / 模板

使用 Loomic + Excalidraw 的原生编辑功能，维护已接入的图层、文字/图片、项目保存/恢复和导出；无需重写画布引擎。继续添加电商模板字段、对齐/导出预设、品牌素材、图片处理和文档版本。现在文档内嵌图片，云 assetId 仅在 B1 重启后采用。视频生成是独立后续协议任务，视频剪裁不实现。只序列化认可的对象类型，不接受任意外部 URL/SVG/脚本。恢复时等待字体/图片加载完成。

商品、背景、价格、卖点和 Logo 独立图层；价格与宣传文案可修改，不要求重新生图。商用字体/模板必须有单独授权记录；不从系统拷贝字体入仓库。尺寸先作为用户可配置预设，不假称“平台官方最新规则”。

验收：导出尺寸正确；非拉伸裁剪策略明确；保存后恢复视觉一致；撤销/重做覆盖文字与图片；大图片有边界；不能访问其他用户素材。用 Playwright 测核心交互。

## S1 — 月度订阅 / 权益 / 订单

新增 plan version、subscription period、entitlement grants、usage ledger 和 order item；复用支付 SDK，但重写业务 settlement 的事务边界。订单由服务器按 planVersion 计价，不接受客户端价格。

先按月购买/手动续费，不假定具备自动扣款签约资格。周期 UTC 半开区间，明确自然月锚点及月末规则；不做“每月1号清所有用户余额”。旧钱包不直接清零/转换，制定管理员批准的迁移政策。

验收：重复/乱序支付通知不重复发权益；金额币种商户校验；订单成功与权益发放一致；到期并发边界；退款独立事件；被禁用/退款订阅不能绕过权限；旧 `/v1` 与 user token 路径不可绕过 V2 订阅。

## W1 — 电商工作流 / 批量 / 发布准备

复用 B1-B3/E1/S1，完成白底图、场景替换、主图、海报、批量导出。模板、prompt、模型路线、费用/额度版本化。先保证商品主体、Logo、颜色不被无意改变，再拓展复杂工作流。必要时背景 AI 生成 + 商品前景确定性合成。

验收：代表性商品样本集（反光、透明、细文字、边缘复杂等）有人工质量回归；用户任务取消/失败行为清楚；存储备份和恢复演练；灰度账号验证与一键入口回滚。ComfyUI/AI 模特不阻塞首个可收费版本。
