# 系统打通：实际进度

## B3-N1 Native202 原图片任务与私有项目分段验证（2026-10-02）

新增 opt-in `image-jobs-native.cases.mjs` 与 5 项设施 F 合同：复用随机 loopback/同 workspace .local/固定 Native pin/普通合成身份/本地供应商/报告不可覆盖护栏；生成前原 owner 必须零请求，实际二进制及全部渠道必须匹配固定本地替身。只保存公开白名单、hash、ID、状态，不保存 prompt、图片正文、密码/Bearer。429 立即停止，无模型/资金重试；分段恢复要求同原失败报告、同实例/owner/key、已完成原图/唯一提交与 provider1，原报告 hash 不变。

仅自己随机实例开启图片 job 以加载已冻结 B3 API，Native 未重启、旧 held 未解除。首次账号准备在 API 尚未健康时得到 HTML 而中断；保留 owner9，不初始化资金，其 Native consume/token/subscription 数均 0。验收工具 refresh-api/web 新增 Compose `--wait --wait-timeout 90`，语法检查通过，自己实例真实 API 刷新后 health200、零模型。

owner10 原 **683584b2-b2fd-4311-9044-1672dae3be55** 实际 POST202 accepted→GET completed，唯一 image 提交、本地供应商累计 image +1/chat +0、Native 本人 consume500合成quota，私有 asset **bf027e65-7f16-4b71-a678-d7f2c489d9cf** 与原 PNG hash **796624ad4af7f93c4be52b243483386321deb37279c054bfa6921b16908261f3**已落盘且 staging0/native_pending0。首 runner 错误地按 `result.image` 检查，实际 API 是平铺 `result.url`；报告 `.local/native-image-jobs-report.json` **failed** 保留，未重发原模型意图。此失败属于验收脚本误读，不能把整条首命令记 passed。

修正真实平铺合同后：`node tests/stack/image-jobs-native.cases.mjs --state .local/user-acceptance-D5UKBb/state.json --identity .local/t112-image-jobs-fresh-identity.json --foreign-identity .local/t112-text-continuous-identity.json --report .local/native-image-jobs-resumed-report.json --resume-completed .local/native-image-jobs-report.json --confirm-isolated-native` **resumed-original-read-and-project-passed**，2.6秒，明确 continuousEndToEndPassed=false、无 image-job POST/新模型。本人原图读取、from-asset 私有项目 **379018ec-decf-45bd-a7d2-df870e3bb951**、实际 PATCH revision2、重复 from-asset 同项目与重开原 document hash 一致；foreign job/asset/project/from-asset404、anonymous401。保存完成后的恢复检查 Native资金/用量 hash、Studio全表 hash、供应商全记录 hash不变。费用 recorded/unconfirmed，实际资金二步确认、P未执行，采购0。

最终 `node --test tests/stack/image-jobs-native-fixture.cases.mjs` **5/5 exit0，0.1294秒**，`.local/image-jobs-native-fixture-final.log`，涵盖误终态/秘密/假settled、额外提交/换原图、资金或私有库变动、重复/异实例分段、路径/旧报告/非普通身份护栏。前端202与一次连续 UI Native202仍待；该原私有项目用于 OPS-1 后续冷恢复，旧未知总结/held继续保留。

## SYS-R2b Agent 原编号跨刷新保存与恢复（2026-10-02）

原请求 UUID 编码在现有本人助手消息 ID，等待 IndexedDB 实际提交后才发唯一 POST；保存未完成时重复 Enter 不重复发送，保存失败零模型调用并在同身份/会话且输入为空时恢复 prompt。旧无编号消息不猜编号；已确认预检未外发的错误仍保存，但不变成后台恢复任务。

刷新后从本人会话恢复绑定，只自动 GET 可见会话最新原编号一次，其他保留手动读取；没有轮询或模型重发。读取与异步会话加载均检查 owner/身份 epoch/当前会话；原快照替换、不追加，已收到工具图按原 tool ID 去重，删除画布图片后刷新不会复活。读取失败保留文字、原图和原编号；Ledger completed 的失败终态仍呈现真实失败。

root 独立 `node --experimental-strip-types --test tests/loomic-recovery.cases.mjs` **14/14 exit0，0.1075 秒**；独立 5187 `npx playwright test --config=.local/system-playwright.config.mjs tests/loomic-recovery.pw.mjs` **8/8 exit0，12.6 秒**，`.local/system-r2b-root-playwright.log`。实际覆盖 IDB 未放行零 POST、拒绝零 POST、重复 Enter 一发、原 ID 在 POST 前已落盘、部分文字/PNG 跨刷新同 ID GET、删除图片不复活、失败读保内容、迟到 A 不进 B、旧消息及预检失败零恢复 GET。agent 同冻结源码 typecheck/build10.99秒与 8/8 浏览器14.3秒通过；全量整合检查另行进行，未称完整浏览器全部通过。

SYS-R2a/b 的实现已接通；Native 正常/未知总结证据沿此前 T1.12，新增 Loomic 跨刷新编号目前以明确 F 合同验证。下一 B3 前端 202 原任务占位/GET、真实 Native202、E1 电商画布与 OPS-1 双库冷恢复。没有独立 Worker、真实付费测试或生产部署。

## B3 前端接线的真实目录能力（2026-10-02）

`config.mjs catalog`公开imageJobsEnabled boolean，只由enableImageJobs、generationEnabled与本人可用image模型共同决定；仅配置job开关而未批准生成/组路由/有限token/图片能力不得宣称可执行。两项新`image-job-catalog.cases.mjs`参数化/秘密白名单合同 **2/2 exit0**；root完整API **205/205 exit0**，`.local/system-image-job-catalog-api.log`。未修改任何实际实例开关或调用模型。客户端旧缺字段按false，受理后须持久执行方式/原ID、恢复使用job GET，不能受目录失权或初POST错误驱动自动同步重发。下一SYS-R2b冻结后接202图片占位。

## B3.3 pre-Sharp原bytes暂存及本地恢复（2026-10-02）

API六文件实现image_job_staging BLOB/hash、output_received状态与owner/global容量、有界HTTP JSON实际48MiB读、规范40MiB encoded/30MiB原bytes与awaited hook。事务提交在第一次Sharp输出metadata之前；不保存完整供应商body/headers/URL或凭据、不增加binary/URL-only下载入口。GET不公开raw；本地hash/唯一模型提交/原摘要核验后复用Sharp完整decode与asset保存，exact bytes/hash核验成功才同事务删除暂存。旧funding/renewal unknown和历史held不变。

启动及显式finalize可只处理已有raw/output，无Native/供应商；费用仅既有Ledger IDs的pending/unconfirmed。raw确定损坏后保私有，原新模型key与held继续unknown；存储故障维持output_received/output_saved供本地保存重试。HTTP断开、坏JSON或stage写入未成功前仍无法恢复，unknown不重放。未新增队列依赖、凭据储存或跨进程授权。

`image-jobs.cases.mjs`22＋新`image-output.cases.mjs`4，定向 **26/26**：真实loopback供应商child-process停止在raw stage hook await、尚未首metadata→kill→restart/flag-off local恢复相同PNG且provider累计1；另覆盖SQL写失败/原asset校验、虚假/缺失Content-Length、body截断/坏UTF8/JSON、非规范编码、raw hash/format/pixel/完整decode/SQL长度损坏、原key/异户和旧Native funding unknown保留。root独立`npm run test:api` **203/203 exit0，8.082秒**，`.local/system-raw-output-api.log`；agent六文件node/diff-check与check **71领域/203API/type/build10.87秒exit0**，当时包含R2b尚在开发的14领域，最终整合要另外跑。

当前B3-I/B3.3后端合同已实现，默认off。前端202接线、Native202、OPS-1双库恢复及独立Worker授权仍待。下一先SYS-R2b与202读/保存闭环，再冷备份；E1尺寸/编辑文字/商品分层可按现有Excalidraw并行，不调用AI。

## T1.12 真实Native未知总结与原图保留通过（2026-10-02）

opt-in runner新增`--lose-response`，禁止与resume/login-only混用；复用普通身份、固定actualbinary、仅本地供应商、随机loopback/独立卷/报告不可覆盖护栏。真正前段＋tool PNG后context.offline/原HTTP requestfailed，原pausedsummary执行lose-response，不再发模型。loss-only安全快照校验末事件/失败类型/events hash，不保存正文/图片URL/未知错误；正常和旧resume结构保持兼容。新增flag、伪成功/丢图/释放held/错误账本/误称settled和敏感内容反例，root`node --test tests/stack/browser-offline-fixture.cases.mjs` **24/24 exit0，1.287秒**，`.local/t112-loss-fixture.log`；语法检查通过。

实际一次命令：`node tests/stack/browser-offline-native.cases.mjs --state .local/user-acceptance-D5UKBb/state.json --identity .local/t112-image-unknown-identity.json --report .local/t112-image-unknown-offline-report.json --scenario image --confirm-isolated-native --lose-response --check-failed-refresh` **passed**。owner8/run537327ab-e87f-420c-b6d7-40754c3291d1，新普通账号空thread；planning完成→本地原图完成→原summary前段持久→2026-10-02T00:07:04Z真实offline/navigatorfalse/ERR_ABORTED→供应商原summary response-lost。

固定Native此时仍以DONE结束transport，Agent新guard实际收到缺少真实finish标记，原History **failed**，Ledger **completed**（保存失败result）；末run.failed、0run.completed、Ledger/History event hash一致；固定公开“模型响应缺少可信完成标记...”被GET和reload恢复。仅前段没有后段，原PNG仍 **796624ad…261f3**，成功工具图和文字保留；chat/image reservations各unknown，held均未释放。供应商只有原chat2/image1：planning/image completed，summary response-lost，没有retry/换模型。

Native实际本人consume三条quota12/500/28合540，三request IDs精确对应原usage，**recorded/unconfirmed**；不得因为UI失败或fixture丢响应假称Native没有收费/已退款。Terminal→GET/reload所有Native资金安全投影、Studio全表及provider哈希精确不变；恢复businessGET、1原POST，原图片hash恒定。真实采购0，这证明固定Native链路及新SDKguard的N行为，不证明真实供应商质量、付费P或Native两步实扣门。

T1.12核心断网/重连正常文本、原图和未知summary、失败读保partial已实际通过；金融/续用未知全owner守卫沿既有API/F合同，并非此次又释放/核对旧屏障。原owner3/5/6失败报告保留；owner4/7/8三条连续通过与owner6分段补验分列。下一SYS-R2b完整刷新Agent原ID、B3.3解码前私有输出与OPS-1同实例双库冷备份；完整系统保持active。

## UI-I1 首轮整合与Native连续离线两条通过（2026-10-02）

UI799ad3b已cherry-pick为40ba65d：36文件，无原工作区修改；仅STATUS冲突手动保留双方、chat-sidebar自动保两边。独立5187下整合`npm run check` **exit0：57+12领域/195API、typecheck、build11.77秒**，`.local/system-ui-integrated-check.log`。全量PW首 **175/178，4.8分钟**，`.local/system-ui-integrated-playwright.log`：Loomic失权/图片-only/guest预检三例均真实重复错误消息，两处完全相同文字使严格DOM断言失败。修改恢复卡过滤not_submitted，因为根本没有外发请求可读取；原消息、持久化与零POST断言保持。原两个测试文件定向 **15/15、25秒exit0**，`.local/system-ui-preflight-fix.log`。完整178还待复验，首失败trace保留，不称UI-I1全部通过。

只刷新本轮随机project自己的Studio API以加载终止标记/B3代码（B3仍off）；固定Native未重启、pin/CT/资金设置未改。新构建默认ChatLab具备失败刷新保内容后，实际执行：

| Native实际命令 | 结果 |
| --- | --- |
| `node tests/stack/browser-offline-native.cases.mjs --state .local/user-acceptance-D5UKBb/state.json --identity .local/t112-image-identity.json --report .local/t112-image-offline-report.json --scenario image --confirm-isolated-native --check-failed-refresh` | **passed**，owner4，原3d0932a5-2e63-4091-86fa-e091cf5e4a5e；2chat/1image。 |
| 同runner，identity `t112-text-continuous-identity.json`，report `t112-text-continuous-offline-report.json`，scenario text，failed-refresh | **passed**，新owner7，原5ccc22ed-6fea-4a3a-bb01-150202687b80；1chat/0image。 |

两例真实普通账号Native encrypted UI login及self/role1/status1证明，单次用户发送；前段到达/持久后context.setOffline得到navigatorOnline=false和原stream net::ERR_ABORTED。离线点击原刷新，已收文本/图片继续可见，0另一次POST；供应商只继续原paused请求。Backend本浏览器仍离线时保存完整原run，真实资金/用量变化只归生成阶段。online manualGET与完整reload同run恢复；这两例是连续通过，区别于早前owner6分段补验。

图片页面/Studio事件/供应商原PNG **796624ad4af7f93c4be52b243483386321deb37279c054bfa6921b16908261f3**一致；GET/reload还是相同原bytes。Terminal→restored Native完整tokens/subscriptions/preconsume/logs及users安全投影、Studio所有非内部表/provider完全hash不变；业务恢复只GET。图片Native3条request IDs/合524合成quota、文本1条/12quota精确映射本人记录，费用仍recorded/unconfirmed，不把合成Native额度称真实采购/钱包结算；realPaidProviderCalls0/procurementCost0。

准备新owner7/8及空thread的helper明确本地合成，0模型；owner8保留供一次未知summary验收，尚未发送。原owner3/5/6失败和分段报告保持，不重放旧意图。**T1.12正常文本/图片离线与失败读子项N通过，完整未知屏障子项仍未完成**。下一受控原summary失响应，SYS-R2b持久Agent ID，B3.3解码前原图暂存；OPS-1冷备份方案已只读审查，未实测。

## SYS-R2a 原请求读取接入与文本分段Native补验（2026-10-02）

Loomic runId/owner/identity epoch绑定对应assistant；断流和Stop使用真实“停止接收”状态，不制造provider run.failed。在线EOF一次GET、恢复联网各原中断请求一次GET、本人手动GET；同kind/id并发读合并，没有定时轮询或POST重试。服务器快照替换文本和工具，真实run.failed保留、成功工具图按toolCallId只插一次；GET失败/格式错/身份变化不丢partial或误插异户画布。独立图片在首次发送前持久原ID/owner到本人canvas占位，刷新/重开读取原结果，不再生成该占位；旧无尺寸结果插图前解码真实bytes，失败仍保留原图下载和原ID。

`request-recovery.ts`等9个新改文件复用现有数据与SDK；生图前fresh currentUser校验owner，读前/后及发布epoch校验覆盖A→B→A。新增12领域与4明确F浏览器：原失败终态+原PNG/去重/POST1，503保partial和原ID，图片占位跨reload GET原PNG/POST1，迟到A不显示/插B且旧A生成处理器对B零POST。root独立4/4 **8.9秒**，`.local/sys-r2-root-playwright.log`；agent4/4 7.9秒及首轮2/4失败trace保留（段落误断言/退出动画等待，未削语义）。`npm test`纳入新领域；root`npm run check` **57+12领域/195API、typecheck、build11.27秒exit0**。原流式5/5 **7.6秒**，`.local/system-r2-streaming.log`，保partial/刷新/零重发断言，改为实际接收/读取状态文字。

**SYS-R2a完成范围**：同mountedpage Loomic恢复与跨reload直接图片恢复。Loomic完整reload虽然从本人IndexedDB保留原文本/图，但agent恢复ID未持久；SYS-R2b仍待完成。未改默认ChatLab/UI布局/账号/官方canvas/项目库，未用F替代Native验收。

2026-10-01 23:48:52 UTC后，在同随机Native64432自然CT窗口结束，执行一次`--resume-completed .local/t112-text-final-offline-report.json`，新profile实际普通登录、本人GET、页面原终态恢复与完整reload cookie恢复通过。报告`.local/t112-text-resumed-readonly-report.json` **resumed-read-only-passed**，同原ef333515-e39f-4942-adce-9731cf74bc3c、**modelSends0**，Native/Studio/provider protected hashes不变；原blocked报告sha256保持。该阶段只读补验明确 **continuousEndToEndPassed=false**，不合并宣称连续离线成功。没有改CT参数/重启Native/重放原付费意图，既有失败报告保留。

下一整合UI799ad3b并全量复验，随后T1.12图片/failed GET/未知响应及SYS-R2b。完整系统目标保持active。

## B3-I 持久图片任务合同通过（2026-10-02）

新增image-jobs.mjs及5条本人认证路由，默认GOUO_ENABLE_IMAGE_JOBS=false、全局活跃上限2。202代表保存任务而非成功生成/预扣金额；同owner同步操作统一守卫、原image key去重域、immutable参数/组/能力/付款意图重新核验。job/outbox/非金额占用与请求接收同事务，模型外发前唯一提交标记和本次试用reserve同事务。私有原图BLOB/hash与output_saved同事务；本地完成不新模型或资金写。

restart accepted/ready→needs_authorization，submitted→unknown，output_saved→仅本地finalize，completed→GET。只有确定未提交的新业务占用可取消；旧held/unknown不迁移。每job内存fetch包装器只标记实际Native token-create/trial-purchase/preference-write，原helper完整凭证成功后清除；只读token-key POST/搜索/验证失败转needs_authorization，不锁全owner；写响应丢失保持native_pending unknown全owner锁。

`apps/api/test/image-jobs.cases.mjs`新增 **18项顶层F合同**，含child-process实际终止accepted/submitted/output_saved、事务回滚、上限/重放、关闭开关、异户/参数/能力/组/付款漂移、已保存图校验、凭据不落SQLite，以及停用/过期/耗尽/缺失token与只读故障、确认购买后读故障和实际购买/令牌/偏好响应丢失对照。root整合源树`npm run check` **exit0：57+12领域、195API、typecheck、build11.27秒**，`.local/system-b3-r2-check.log`；API195含此前11项终止标记测试。`docker compose --env-file deploy/.env.example -f deploy/compose.yml config --quiet` exit0，仅解析未部署。

本轮没有开启Native任务/模型、持久Bearer/管理员替代或安装队列。**B3-I后端合同已实现，完整B3未完成**：前端接线和N实测尚无，收到响应但解码前崩溃仍unknown，B3.3原始输出暂存未实现；B3-II权威后台授权和B3-III独立Worker仍按设计待办。下一整合SYS-R2/UI并继续T1.12。

## Agent 供应商完成证据校验（2026-10-02）

固定Native源码的OpenAI stream helper会在上游不完整响应之后发送传输DONE；DONE不是模型完成证据。`agent.mjs`复用ChatOpenAI实际聚合结果的handleLLMEnd，不另造SSE解析器；每次模型调用必须有stop/tool_calls，最终调用必须stop。缺少或非法终止原因标为真实run.failed，保留已有文本/工具原PNG；费用recorded/unconfirmed，已外发试用占用仍held，未做释放/退款。未完成规划在图片工具和后续gateway fetch之前拦截，maxRetries仍0。

新增`apps/api/test/stream-terminal.cases.mjs`实际 **11/11** exit0，root独立复验0.775秒。正例覆盖batch/SSE及tool_calls→stop；反例覆盖无finish/DONE、length/content_filter/超长值、未知规划零图/零后续chat、未知总结原PNG保留。GET和精确原key replay返回已保存失败终态，不新模型或Native写；修改参数仍409。Ledger completed仅代表已保存终态，不把run.failed称生成成功。全部为实际SDK＋本地HTTP的F合同；未以供应商真实 paid 输出或仅DONE代替N/P验收。

本增量未操作Native服务、历史资金/unknown/held或固定pin。接下来在本轮新随机Native加载代码后验收受控原响应丢失，完整T1.12/B3仍未完成。

## T1.12 离线接收修复，Native恢复仍在验收（2026-10-02）

验收设施已实现：opt-in `tests/stack/browser-offline-native.cases.mjs`限定同工作区`.local`、新随机loopback/固定binary/普通合成账号/明确本地供应商，拒绝覆盖报告、日常8080及旧QA端口、外部卷或公开provider。每条真实生成仅发送一次，供应商受控等待后继续原请求；图片对比可见/持久/供应商原PNG hash。恢复前后读取Native资金安全投影、Studio全表及provider hash；CDP观察仅保存类型/ID/时序，不落正文或凭据。严格429即停、仅记录安全Retry-After，不自动重试。`--resume-completed`只接受已有真实断网和终态证据的同实例报告，另开profile只读恢复；原blocked报告保持hash不变，成功也标`continuousEndToEndPassed=false`。

设施本地测试`node --test tests/stack/browser-offline-fixture.cases.mjs`最终 **19/19** exit0（隔离护栏、脱敏、受控SSE、原图及分段恢复输入反例），`.local/t112-offline-fixture.log`；`--resume-completed ... --validate-only`实际仅输入校验通过，0 Native/浏览器。可用`npm run test:offline-fixture`复验；真实Nativerunner不进入默认check/CI，必须显式隔离确认和人工准备。新分段恢复尚未执行，不把输入校验记为N通过。

共享`event-stream.ts`监听浏览器真实offline事件，取消本机reader并明确断线；读取前后及缓冲帧交付前检查，finally清理监听器与reader。已经交付的文本/工具不清空，不调用服务端取消，不自动重新发送；后端仍处理原请求。此修改适用于默认聊天与Loomic共用流读取。

实际命令：`npm run typecheck` exit0；`npm test` **57/57** exit0（原51加6项离线领域测试），`.local/t112-offline-domain.log`；专属5187 Vite下`npm run test:e2e -- --config .local/system-playwright.config.mjs streaming.pw.mjs --workers=1 --reporter=line` **5/5** exit0，9.4秒；`npm run build` exit0，12.02秒，既有第三方chunk警告，`.local/t112-offline-build.log`。这些是明确浏览器Fetch/ReadableStream替身与实际offline事件的F合同，不能代替Native实测。

新随机固定Native `64432`/本地供应商实际owner6单次文本发送：前半段真实页面可见且保存；`context.setOffline(true)`得到navigatorOnline=false与原stream `net::ERR_ABORTED`；页面保留已收内容，供应商继续等待原请求。明确continue后同runId后台completed，费用recorded/unconfirmed。online历史GET200包含原completed，但随后账户refresh429导致页面恢复断言未通过，完整用例记录 **blocked-rate-limit**，不是passed。报告`.local/t112-text-final-offline-report.json`；不重启/改CT参数/换来源/重发模型，后续等待自然窗口仅GET恢复此原结果。

过程失败保留：原owner3因fixture前半段帧被固定Native暂存，页面未显示；补合法空delta适配真实转发协议后使用全新owner5验收，前段113ms到达。该次仅setOffline没有断开已建立stream，严格断言失败，触发上述产品修复。两次均最后释放已接受的原本地供应商工作以保存终态，不能宣称生成阶段资金不变；没有重放旧请求。原生登录响应body因完整导航CDP丢失，改为真实登录后`/api/user/self`核owner/role/status/Bearer，记录观察限制；独立login-only通过、0模型。

T1.12尚未完成：图片原图路径、自然窗口后的恢复、失败GET保留内容与上游未知屏障仍待实际验收。旧146浏览器/资金P门项未计新通过。下一继续T1.12；SYS-R2/B3-I在独立文件范围并行实现，完整系统目标保持active。

## B3 授权与执行边界审查（2026-10-02）

方案见 [B3-JOBS.md](B3-JOBS.md)。已核对现有业务实现、固定Native鉴权/资金源码和成熟队列官方文档：有限relay key本身不能证明完整owner/token/group/资金receipt，也不能代替浏览器会话撤销证据。第一阶段采用同API进程内存授权和持久图片任务；重启未提交转needs_authorization，已提交未知保持unknown，不持久账号Bearer、不借管理员凭据。B3-II/III再解决权威后台授权与独立队列执行，不能以新增job表称完整Worker。

此次仅设计审查，没有安装队列依赖、改变Native pin、储存凭据或运行模型。B3-I已开始实现；接口、测试与202行为尚未验收，未计完成。

## SYS-R1 原请求只读结果恢复（2026-10-02）

已实现`GET /api/studio/requests/:kind/:id/result`，复用Ledger，支持无threadId agent与独立image终态。新接口仅本人身份校验＋只读存储，字段白名单，不回显内部元数据；running/unknown保持原状态，completed保留真实失败事件和保守费用。旧费用核对GET/会话history合同未改。完整DTO见 [API-DATA.md](API-DATA.md)。

实现文件`v2/apps/api/src/ledger.mjs`、`server.mjs`，新测试`test/request-recovery.cases.mjs`。9项新测试覆盖匿名/异户/非法参数、无threadId/image、不同kind、重启终态、unknown/held/旧key409、坏数据/超限/嵌套秘密、只读全表不变及旧GET兼容。首轮8/9为101字符参数被Fastify先拒414，修正准确测试预期后9/9；原拒绝断言保留。

| 实际命令 | 结果 |
| --- | --- |
| `npm run check` | exit0：51领域、166API、类型检查、build11.05秒；现有第三方大chunk警告，`.local/system-r1-check.log` |
| 最终schema/时间边界后的`npm run test:api` | 166/166 exit0，2.94秒，`.local/system-r1-api-final.log` |
| 定向恢复/history/user-relay/trial/gateway/renewals | 68/68 exit0；最终恢复9/9 exit0 |
| `node --check` / `git diff --check` | exit0 |

独立新随机Native`64432`/`gouo-user-acceptance-31248-muq4syb7`已准备，只用固定binary与明确本地供应商，尚未模型发送。合成账号准备首次误把创建thread metadata当detail，helper断言失败且保留一个空测试账号/thread；改为GET详情后另外两个普通账号3/4和空thread准备成功，没有删除失败数据或重放模型。此准备不是T1.12通过；实际browser offline与Native证据待执行。

前端尚未接线，旧日常入口未整合此分支，不称持久Worker/完整系统。下一T1.12，随后SYS-R2/B3。

## 2026-10-02 全面审计与计划

- 用户批准按全面计划持续实施，并要求与 UI chat 并行避免冲突；已读取其任务及用户协调授权，发送一次明确分工消息。
- 独立系统 worktree：`C:/Users/56161/.codex/worktrees/system-integration/gouo-canvas`，`codex/system-integration`，基线 `6e8c4c8`。未切换原工作区分支，未改日常服务。
- 三个子智能体独立只读审计 backend/frontend/acceptance；实际缺口与顺序见 [SYSTEM-INTEGRATION-PLAN.md](SYSTEM-INTEGRATION-PLAN.md)。
- 原工作区只读基线 `npm run check` exit0：51领域、157API、类型和build13.74秒。日志 `.local/system-baseline-check.log`（位于原工作区v2）；尚未新复验146浏览器或Native/P。
- 独立worktree `npm ci` exit0：876包、881审计、0漏洞；锁文件未改。缓存复用原工作区已忽略npm缓存，结果在本worktree `.local/system-install.log`。
- 待实施 SYS-R1：统一只读原请求结果恢复。没有声称持久Worker、真实试用、付费/支付或生产门已完成。

未运行模型，未改余额/权限/旧unknown/held，未push/merge/main或部署。下一任务 SYS-R1，随后T1.12。
