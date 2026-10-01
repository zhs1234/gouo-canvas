# 系统打通：实际进度

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
