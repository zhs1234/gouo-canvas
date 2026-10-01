# 系统打通：实际进度

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
