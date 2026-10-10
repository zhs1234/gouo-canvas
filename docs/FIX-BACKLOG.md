# 光构待修复清单

截至 2026 年 10 月 10 日（北京时间），光构共登记 86 项问题：14 项已在本地运行环境验证修复（GOUO-027 至 033 为本日新增）；27 项待验证（修复已合并）；38 项修复中（[PR #20](https://github.com/zhs1234/gouo-canvas/pull/20) 至 [PR #32](https://github.com/zhs1234/gouo-canvas/pull/32)，未合并）；6 项只登记、暂缓；GOUO-025 不适用。原 42 项的历史验收范围保留。

原始审查基线为 main 提交 [1f3c463](https://github.com/zhs1234/gouo-canvas/commit/1f3c463d4f5d5b51ede64622fab20cef265770b6)。原始结论均为静态代码发现；各条目的单元测试及复现情况见其"修复记录"；用户于 2026 年 10 月 9 日说明该项目没有线上运行；此部署状态为用户提供，尚未独立核实，实际部署版本及功能开关未核验。P1/P2 是修复优先级，不表示相关条件已在生产环境成立。

## 当前状态

- v2 路线：暂时废弃。用户明确重启前，不继续验收或开发；保留分支及历史，不做删除。

- 已验证修复：14 项（GOUO-001、007、015、020、021、022、023，2026-10-09 验证；GOUO-027 至 033，2026-10-10 在 SQLite 与 PostgreSQL 16 上验证），均为本地运行环境，见"本地运行验证"与"第三轮运行时回归"两节

- 待验证：18 项已合并（GOUO-002 至 006、008 至 014、016 至 019、024、026），修复见 [PR #8](https://github.com/zhs1234/gouo-canvas/pull/8) 身份权限、[PR #9](https://github.com/zhs1234/gouo-canvas/pull/9) 支付、[PR #10](https://github.com/zhs1234/gouo-canvas/pull/10) 图片中继、[PR #11](https://github.com/zhs1234/gouo-canvas/pull/11) 云同步、[PR #12](https://github.com/zhs1234/gouo-canvas/pull/12) 前端安全、[PR #13](https://github.com/zhs1234/gouo-canvas/pull/13) 存储与账号（叠加在 PR #11 之上）、[PR #14](https://github.com/zhs1234/gouo-canvas/pull/14) 来源 IP 与 Agent 确认，均已于 2026-10-09 合并到 main（合并后提交 [0b9b54f](https://github.com/zhs1234/gouo-canvas/commit/0b9b54f)）

- 已合并到 main a496a11（2026-10-09）：GOUO-027、028（[PR #15](https://github.com/zhs1234/gouo-canvas/pull/15)）；GOUO-029、030 及 GOUO-006 的换商户说明（[PR #16](https://github.com/zhs1234/gouo-canvas/pull/16)）；GOUO-026 的费用显示与 GOUO-039（[PR #17](https://github.com/zhs1234/gouo-canvas/pull/17)）；其中 GOUO-027 至 030 已验证

- 待验证（第二轮审查，2026-10-09 合并到 main a496a11）：GOUO-034（[PR #18](https://github.com/zhs1234/gouo-canvas/pull/18)，同 PR 的 031 至 033 已验证）、GOUO-035 至 038 和 040 至 042（[PR #19](https://github.com/zhs1234/gouo-canvas/pull/19)）

- 修复中：38 项（GOUO-043 至 080），已开 [PR #20](https://github.com/zhs1234/gouo-canvas/pull/20) 至 [PR #32](https://github.com/zhs1234/gouo-canvas/pull/32)，均未合并；13 个分支已试合并、跑过单元测试和本地运行回归，见"第三轮运行时回归"

- 暂缓（只登记）：6 项（GOUO-081 至 086），其中 GOUO-084 通用对话可透支为 P1，属上游设计

- 待修复：0 项（无候选补丁项）；修复中不等于已修复或已验证

- 不适用：1 项（GOUO-025，复核为误报）

- 验证状态：19 项已由单元测试复现（撤掉修复后失败），GOUO-005 由脚本复现，GOUO-024 已用本地请求复现，GOUO-027 已用前端解析复现，GOUO-028 已由单元测试复现，GOUO-013、GOUO-015、GOUO-021、GOUO-022 待复现；2026-10-09 本地运行环境的验证结果见"本地运行验证"一节，支付沙箱和实际部署环境均未验证

- 已完成并验证的修复：14 项（本地运行环境：SQLite、PostgreSQL 16、mock 上游、模拟代理头，未在实际部署环境验证）

- 仓库没有在 PR 上运行的 CI；以上测试均为本地运行，不代表 CI 或线上验证通过

- 原始 16 项中，GOUO-003、GOUO-004、GOUO-011、GOUO-014 为既有 PR #6 问题的独立复核，其余 12 项为该轮新增；本轮新增 GOUO-043 至 GOUO-059

## 本轮复核（2026-10-10，北京时间）

本轮主干仍为 [a496a116fa75e7d7db1e316803a5551d5682894f](https://github.com/zhs1234/gouo-canvas/commit/a496a116fa75e7d7db1e316803a5551d5682894f)，文档 PR #7 仍为开放草稿，更新前文档 head 为 [fa04bdec2c7c14726df9790017256ac99d348cd1](https://github.com/zhs1234/gouo-canvas/commit/fa04bdec2c7c14726df9790017256ac99d348cd1)。原登记 42 项的 7 项本地验证、34 项待验证、1 项不适用是此前验收范围的历史结果，不能扩展成下列新场景已通过。新增问题与候选补丁需另行计数。

发现 8 条直接基于当前 main 的候选修复分支，各领先 main 1 个提交、落后 0 个提交；本轮读取时均没有开放 PR，不能写成已合并：
- fix/auth-hardening：[7f703bcd4263936da91487f69614e1dac643fb06](https://github.com/zhs1234/gouo-canvas/commit/7f703bcd4263936da91487f69614e1dac643fb06)
- fix/admin-token-payment-scope：[f96b5af4bf2b7991908f0403fab04d47a31790e5](https://github.com/zhs1234/gouo-canvas/commit/f96b5af4bf2b7991908f0403fab04d47a31790e5)
- fix/payment-callbacks：[c6aa0d5ec95fd7adffbc607b2005da5496e1f52e](https://github.com/zhs1234/gouo-canvas/commit/c6aa0d5ec95fd7adffbc607b2005da5496e1f52e)
- fix/image-form-duplicates：[a8a52dd07adcc798ed4951ebcb56bca3d87c4ae7](https://github.com/zhs1234/gouo-canvas/commit/a8a52dd07adcc798ed4951ebcb56bca3d87c4ae7)
- fix/mj-notify-ssrf：[f9dc70333ce379b27a73e91a04d3384d684a1373](https://github.com/zhs1234/gouo-canvas/commit/f9dc70333ce379b27a73e91a04d3384d684a1373)
- fix/gouo-storage-limits：[8b0faa88c37da1af6e4f83cc6edb8317c82efea1](https://github.com/zhs1234/gouo-canvas/commit/8b0faa88c37da1af6e4f83cc6edb8317c82efea1)
- fix/frontend-sync-multitab：[e6c292f116f48408797162fb578019188fa2ae71](https://github.com/zhs1234/gouo-canvas/commit/e6c292f116f48408797162fb578019188fa2ae71)
- fix/task-watchdog-fal：[e5d9360a409abc61f7de16f29e6eaa02d3922297](https://github.com/zhs1234/gouo-canvas/commit/e5d9360a409abc61f7de16f29e6eaa02d3922297)

其他 PR #8 至 #19 的修复 head 均已在 main 祖先链内、无未合并增量。旧 docs/concise-readme、docs/demo-and-screenshots 虽在 compare 中各有 1 个 ahead 提交，但其 PR #1/#2 已合并，是旧文档历史，不是本轮新修复。codex/frontend-cleanup-account-isolation 是 7 月旧分叉；没有开放 PR，不列为当前 main 活跃修复。v2、codex/new-api-v2、codex/registration-trial、codex/qa-relay-owner-idempotency 已排除。

### CI 与部署边界（2026-10-10 静态查询）

对 main、文档 head 和上述 8 个候选 head 共 10 个固定 SHA 的查询均为：check-runs 0、commit statuses 空、对应 Actions runs 0。GitHub 汇总 status 返回 pending 且 total_count=0，表示没有检查结果，不表示任务正在运行，也不代表通过。

main 并非完全没有工作流：存在仅以 v* tag push / 部分允许 workflow_dispatch 触发的 [Pages](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/.github/workflows/deploy.yml#L1-L6)、[Docker 发布](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/.github/workflows/docker.yml#L1-L6)、[Vercel Hook](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/.github/workflows/vercel-tag-deploy.yml#L1-L26)，未配置面向 main PR 的自动测试门禁。最近三条历史部署运行关联的是旧提交 a7132c1e7e290ef3c29abcdb8cc7c60da6ee696c：[Pages 失败](https://github.com/zhs1234/gouo-canvas/actions/runs/37915140169)、[Docker 成功](https://github.com/zhs1234/gouo-canvas/actions/runs/37915139956)、[Vercel Hook 作业成功](https://github.com/zhs1234/gouo-canvas/actions/runs/37915140291)。Hook 工作流含 secret 缺失时跳过的分支，成功也不能证明实际站点已部署。没有独立核验线上服务、运行版本或功能开关，保留“用户称无线上运行，尚未独立核实”的边界。


私有清单 Page：待同步。本轮未读取或更新，不能认定其内容与仓库一致。

策略待确认（不计入 59 项）：Turnstile 的通行复用时效及 IP/操作范围；支付配置管理是否限定 root。候选权限收紧和时效缩短不自动证明原策略违规。管理员删除消费日志的变更不能表述为可删除调额审计。

第三轮修复会话补充：上述三项改动分别在 [PR #20](https://github.com/zhs1234/gouo-canvas/pull/20)（Turnstile 10 分钟）和 [PR #23](https://github.com/zhs1234/gouo-canvas/pull/23)（支付网关增删改查与批量删除日志仅限 root）中，是否采用由用户决定；核对 `DeleteOldLog` 确认只删除消费日志（`type = consume`），PR #23 描述已据此更正。

## 优先处理顺序

1. 先确认 GOUO-001 和 GOUO-002 的部署条件，修复身份边界；评估限制 GitHub OAuth 入口及轮换可能暴露的管理令牌。

2. 修复 GOUO-003 至 GOUO-006，优先保护草稿、云文档和已付款订单。

3. 根据实际配置核查 GOUO-007、GOUO-008，并修复其下载目标和凭据绑定限制。

4. 完成其余 P2 问题及回归覆盖，尤其关注跨账号同步和停止后的付费派发。

5. PR #8 至 #14 已全部合并到 main（0b9b54f），合并后本地重新运行 `npm test`（452 项）、`npm run build` 及相关 `go test` 均通过。下一步部署到测试环境，按各条目验收检查完成验证后再标记为已验证修复。PR #13 上线后会立即删除回收站中已超过 3 天的内容，部署前评估是否先备份。

6. 反向代理不在本机或私有网段的部署，升级前配置 `TRUSTED_PROXIES`。

7. GOUO-029、030 已合并，按当前 main 重新验收；GOUO-006 已选择方案 (a)，但本轮发现停用旧网关会阻断回调，按该条更正安排验收，不能直接执行旧停用建议。

8. 优先复核 GOUO-043 至 GOUO-048 的身份、令牌、支付和中继边界，再覆盖 GOUO-049 至 GOUO-059 的资源、同步与并发场景。第三轮修复已开 PR #20 至 #32（13 个分支已试合并无冲突）：先审阅含 P1 的 #20（043、044、049）、#21（047）、#22（046、050）、#23（045）、#24（048），再合并其余；Turnstile 时效、支付配置仅限 root、删除日志仅限 root 三项需先定策略。合并后按"交给用户验证"补做外部服务验证。

## P1 待修复

### GOUO-001 普通管理员响应暴露管理令牌

优先级：P1。处理状态：已验证修复。验证状态：已验证（本地运行环境，main 0b9b54f，见下方本地验证记录）。

**触发场景**

普通管理员已登录且 root 账号启用。用户列表只排除 password，仍返回 access_token，查询没有屏蔽 root 或同级账号。

**影响**

普通管理员可能取得 root 的管理令牌并越过角色权限边界。

**建议修复**

采用字段白名单输出用户信息，删除所有管理令牌字段；统一列表与详情的角色范围检查；核查历史暴露并按需轮换令牌。

**验收检查**

分别检查普通用户、管理员、root 的列表响应；均不包含 password 或 access_token。管理员不能读取超出权限的账号；撤销的旧令牌无法通过 RootAuth。

**代码依据**

[列表路由](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/router/api-router.go#L95-L104)、[查询字段](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/model/user.go#L83-L94)、[令牌序列化](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/model/user.go#L38)、[直接返回结果](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/controller/user.go#L202-L218)、[Bearer 认证](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/middleware/auth.go#L41-L85)。

**修复记录（2026-10-09）**

[PR #8](https://github.com/zhs1234/gouo-canvas/pull/8)，提交 [719694d](https://github.com/zhs1234/gouo-canvas/commit/719694d)，基于 main 1f3c463。已运行：`TestUserListAndDetailHideAccessTokens`：admin/root 列表与详情均不含令牌，admin 只能看到更低权限账号、不能读取 root 详情。合并并按上方验收检查完成验证前，不标记为已验证修复。

**本地验证记录（2026-10-09）**

root、admin1、普通用户分别调用用户列表与详情：root 列表含全部 5 个账号，admin1 只看到 2 个普通用户，所有响应都不含管理令牌和密码哈希；普通用户调用列表被拒（权限不足）；admin1 读取 root、admin2 详情被拒，读取普通用户正常。root 重新生成管理令牌后，旧令牌访问 RootAuth 接口 `/api/option/` 返回"access token 无效"，新令牌正常。11 项检查全部通过，验收场景已全部覆盖。

### GOUO-002 GitHub OAuth 空邮箱匹配本地账号

优先级：P1。处理状态：待验证。验证状态：已复现（单元测试，撤掉修复后失败），尚未在运行环境复现。

**触发场景**

开启 GitHub OAuth，新 GitHub ID 尚未绑定；未获得 verified primary 邮箱，本地存在启用的空邮箱账号。默认 root 没有设置邮箱；空邮箱仍参与查询并可进入已有账号登录路径。

**影响**

不同 GitHub 身份可能登录同一个本地空邮箱账号，包括满足条件的 root。关闭新用户注册不能阻断已有账号匹配。

**建议修复**

禁止空邮箱匹配；优先改为先登录本地账号再显式绑定 GitHub，取消按邮箱静默绑定。修复前评估关闭该 OAuth 入口。

**验收检查**

覆盖新 GitHub ID、空邮箱、没有 verified primary 邮箱、本地空邮箱 root、关闭注册等组合。任何新身份都不得因空邮箱匹配已有账号。

**代码依据**

[邮箱结果](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/controller/github.go#L152-L185)、[空邮箱参与匹配](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/controller/github.go#L188-L213)、[数据库查询](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/model/user.go#L339-L362)、[默认 root](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/model/main.go#L41-L59)、[匹配后登录](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/controller/github.go#L308-L332)。

**修复记录（2026-10-09）**

[PR #8](https://github.com/zhs1234/gouo-canvas/pull/8)，提交 [e74276c](https://github.com/zhs1234/gouo-canvas/commit/e74276c)，基于 main 1f3c463。已运行：`TestGitHubLoginIgnoresEmptyEmailAndZeroID`：空邮箱新身份、id 为 0 均不匹配 root；已验证邮箱仍可匹配。合并并按上方验收检查完成验证前，不标记为已验证修复。

**本地验证记录（2026-10-09）**

需要真实 GitHub OAuth 应用，本地未验证，见"交给用户验证"。

### GOUO-003 远端素材下载覆盖新的 Agent 草稿

优先级：P1。处理状态：待验证。验证状态：已复现（单元测试，撤掉修复后失败），尚未在运行环境复现。

**触发场景**

接收云端会话时等待素材下载；用户在此期间输入草稿，300 ms 防抖尚未写库。下载前检查版本，下载后只检查账号并直接替换内存会话。

**影响**

新的未落库草稿可能永久丢失；数据库 CAS 无法保护这段内存修改。

**建议修复**

下载完成后重新检查内存版本、数据库版本与内容指纹，满足条件再发布；有并发修改时保留冲突副本。

**验收检查**

延迟 downloadAsset，在等待期间修改草稿后完成下载；验证当前内存、持久化内容和刷新后的草稿都保留新输入。

**代码依据**

[检查与下载间隔](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/lib/serverDocuments.ts#L68-L85)、[替换内存](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/lib/serverDocuments.ts#L44-L53)、[草稿防抖](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/stores/agentStore.ts#L60-L74)。

**修复记录（2026-10-09）**

[PR #11](https://github.com/zhs1234/gouo-canvas/pull/11)，提交 [4d7fa93](https://github.com/zhs1234/gouo-canvas/commit/4d7fa93)，基于 main 1f3c463。已运行：`serverDocuments.test.ts`：素材下载期间修改草稿后草稿保留、游标不推进；写库期间的编辑另存为副本。合并并按上方验收检查完成验证前，不标记为已验证修复。

**本地验证记录（2026-10-09）**

依赖浏览器中的 Agent 草稿与素材下载时序，本地未验证，见"交给用户验证"。

### GOUO-004 旧标签页借用共享版本覆盖云文档

优先级：P1。处理状态：待验证。验证状态：已复现（单元测试，撤掉修复后失败），尚未在运行环境复现。

**触发场景**

同账号的 A 标签页先读旧内容，B 随后保存并上传新版、推进共享 cloud meta；A 再读到新 meta，将旧内容与新 expected_revision 一起提交。

**影响**

服务端乐观锁可能允许旧内容覆盖 B 的新文档。

**建议修复**

将内容和云版本作为配对快照读取；提交前复核本地指纹；建立跨标签页上传协调，阻止过期快照使用新版本号。

**验收检查**

强制 B 更新发生在 A 读取内容与读取 meta 之间；A 的旧快照必须被拒绝或形成显式冲突，新版云文档不得丢失。

**代码依据**

[快照枚举](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/lib/serverDocuments.ts#L133-L143)、[读取版本并提交](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/lib/serverDocuments.ts#L90-L108)、[服务端版本检查](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/model/gouo-document.go#L66-L73)。

**修复记录（2026-10-09）**

[PR #11](https://github.com/zhs1234/gouo-canvas/pull/11)，提交 [7f00a53](https://github.com/zhs1234/gouo-canvas/commit/7f00a53)，基于 main 1f3c463。已运行：`serverDocuments.test.ts`：列表快照过期时不提交旧内容；`db.documents.test.ts`：同一事务读取文档与同步记录。合并并按上方验收检查完成验证前，不标记为已验证修复。

**本地验证记录（2026-10-09）**

依赖多个浏览器标签页，本地未验证，见"交给用户验证"。

### GOUO-005 微信支付金额截断与订单金额不一致

优先级：P1。处理状态：待验证。验证状态：已复现（脚本确认旧写法 int64(money*100) 把 0.29、1.15、2.01、4.35、8.7、19.99 各少算一分），尚未在支付沙箱复现。

**触发场景**

微信支付开启；Money×100 出现略小于整数的浮点结果，例如 1.15。请求使用 int64 截断，回调按实际金额与订单金额严格比较。

**影响**

可能已收款但不入账；金额差一分时结算回滚，重复回调无法修复。

**建议修复**

从十进制金额生成统一的整数分快照；订单、支付请求、回调验价共用该快照。核账流程需识别受影响订单。

**验收检查**

在支付沙箱或 mock 中覆盖 1.15、1.29 和折扣、手续费、汇率小数；创建金额与验价一致；重复回调只入账一次。

**代码依据**

[创建金额](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/payment/gateway/wxpay/client.go#L15-L28)、[回调金额](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/payment/gateway/wxpay/payment.go#L110-L119)、[严格验价](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/model/order.go#L82-L108)。

**修复记录（2026-10-09）**

[PR #9](https://github.com/zhs1234/gouo-canvas/pull/9)，提交 [4871c52](https://github.com/zhs1234/gouo-canvas/commit/4871c52)，基于 main 1f3c463。已运行：`TestMoneyToFenRoundsDecimalAmounts`：0.01、0.29、1.15、1.29、2.01、4.35、8.7、19.99、100 换算正确。合并并按上方验收检查完成验证前，不标记为已验证修复。

**本地验证记录（2026-10-09）**

需要微信支付沙箱，本地未验证；`TestMoneyToFenRoundsDecimalAmounts` 本次重新运行通过。见"交给用户验证"。

### GOUO-006 全局支付客户端串用商户配置

优先级：P1。处理状态：待验证。验证状态：已复现（单元测试，撤掉修复后失败），尚未在运行环境复现。

**触发场景**

同进程先使用支付宝商户 A 再使用 B，或修改配置后未重启。付款沿用首次初始化的全局 client，回调却使用当前网关配置验签和检查 AppID。微信也存在同类缓存。

**影响**

支付宝 B 的订单可能由 A 收款后被拒绝入账；微信跨商户可能在创建时失败，具体表现待验证。

**建议修复**

按网关及配置版本隔离 client，或使用局部 client；订单保存对应的历史商户身份版本，回调使用匹配配置。

**验收检查**

在沙箱或 mock 中交替、并发使用不同商户；热更新配置后验证新订单；旧订单仍按原商户正确验签与结算。

**代码依据**

[全局缓存及首次初始化](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/payment/gateway/alipay/payment.go#L23-L60)、[付款使用缓存](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/payment/gateway/alipay/client.go#L15-L55)、[回调使用当前配置](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/payment/gateway/alipay/payment.go#L63-L103)、[同类全局缓存](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/payment/gateway/wxpay/payment.go#L36-L75)。

**修复记录（2026-10-09）**

[PR #9](https://github.com/zhs1234/gouo-canvas/pull/9)，提交 [cc74160](https://github.com/zhs1234/gouo-canvas/commit/cc74160)，基于 main 1f3c463。已运行：`TestPayUsesCurrentMerchantConfig`：交替使用两个支付宝商户，支付链接 app_id 各自正确。合并并按上方验收检查完成验证前，不标记为已验证修复。

**本地验证记录（2026-10-09）**

建两个支付宝网关（本地生成的测试 RSA 密钥，网页支付）：交替下单 5 笔、并发交替下单 10 笔，支付链接中的 app_id 全部与所选网关一致；热更新网关 A 的配置后，新订单使用新 app_id。回调用本地生成的"平台密钥"按 RSA2 规则签名模拟：用其他商户密钥签名的回调被拒；B 的订单发到 A 的回调地址不结算；B 的订单经 B 的回调验签并结算成功。

**历史决策背景（2026-10-09，已选择方案 a；下述旧建议由 2026-10-10 更正取代）**：网关 A 热更新为另一个商户（换 app_id 和平台公钥）后，热更新前创建的订单再收到原商户签名的回调会被拒绝，因为回调总是按网关当前配置验签。这与验收检查"旧订单仍按原商户正确验签与结算"不符。可选：(a) 作为使用约束写进文档：更换商户时新建网关，旧网关保留到其订单全部完成；(b) 下单时保存网关配置快照，回调按订单快照验签。同一商户轮换平台公钥不受影响。

剩余：支付宝沙箱真实回调、微信支付多商户部分，见"交给用户验证"。

**修复记录（2026-10-09，换商户后旧订单回调）**

历史记录（此处保留原结论，当前操作建议见下方更正）：用户要求修复已知问题，按此前推荐的方案 (a) 处理：在部署文档中说明支付回调按网关当前配置验签，更换商户时新建网关并停用旧网关，旧网关保留到其订单全部完成或关闭（[PR #16](https://github.com/zhs1234/gouo-canvas/pull/16)，`docs/zh-CN/backend.md`、`docs/en/backend.md`）。代码行为不变；如需让改配置后的旧订单仍能按原商户入账，需改为下单时保存配置快照（方案 b），另行决定。

**静态复核更正（2026-10-10，北京时间；main a496a116fa75e7d7db1e316803a5551d5682894f）**

此前方案 (a) 和部署文档的“新建网关并停用旧网关”建议存在代码前提遗漏。当前 main 的 [PaymentCallback](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/controller/order.go#L116-L122) 仍调用下单共用的加载路径，而 [GetPaymentByUUID](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/model/payment.go#L40-L43) 只查询启用、未软删除的网关。因此旧网关一旦停用或删除，先前已付款订单的后续回调会返回 payment not found，不能自动到账。原文的[部署建议](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/docs/zh-CN/backend.md#L76) 不足以实现预期。

本地订单超时关闭也不等于支付渠道不再收款；[结算代码允许 closed 订单迟到入账](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/model/order.go#L82-L90)。不能仅凭本地订单已关闭就认定可停用网关。

候选提交 [c6aa0d5ec95fd7adffbc607b2005da5496e1f52e](https://github.com/zhs1234/gouo-canvas/commit/c6aa0d5ec95fd7adffbc607b2005da5496e1f52e) 新增 [只供回调使用的无状态过滤加载](https://github.com/zhs1234/gouo-canvas/blob/c6aa0d5ec95fd7adffbc607b2005da5496e1f52e/server/model/payment.go#L46-L50)，允许停用或软删除后仍按保留配置验签，下单路径保持启用限制。它没有保存历史商户配置快照，原地改商户配置仍会破坏原商户回调。新增 [停用后软删除网关的测试](https://github.com/zhs1234/gouo-canvas/blob/c6aa0d5ec95fd7adffbc607b2005da5496e1f52e/server/controller/payment_callback_test.go#L67-L71) 本轮未运行，且只测停用并软删除的组合，仍需分别覆盖启用、仅停用、仅软删除及所有受支持网关。

**当前使用建议（取代历史停用旧网关建议）**

“支付回调目前按网关的当前配置验签，更换商户应新建网关，不要原地覆盖仍有未结清交易的旧网关配置。当前 main 停用或删除旧网关会同时阻断其回调；在回调独立加载补丁合并并验证前，不能把‘停用旧网关’当成既停止新下单、又保证旧订单到账的切换方式。若保留旧网关接收回调，它仍须保持启用，这也仍允许新下单，需另行安排受控停单与对账窗口。所有支付会话、延迟回调和未结清交易应先完成核对；仅本地订单超时关闭不代表支付渠道已撤销付款。候选补丁验证通过后，可停止旧网关新下单，同时保留其原配置处理历史回调。更换商户配置快照方案仍需另行决定。”

处理状态继续待验证，不改变本条历史本地验证记录。应补充验收：停用/软删后新下单被拒，旧订单正确签名仍可到账；延迟到达的 closed 订单正确处理；重复回调幂等；错误签名、金额和币种仍拒绝；商户配置不可被旧订单静默替换。

**修复记录（2026-10-10，第三轮修复会话）**：[PR #22](https://github.com/zhs1234/gouo-canvas/pull/22)，单元测试 `controller/payment_callback_test.go` 撤掉修复后失败。 历史商户配置快照仍未实现，原地改商户配置仍会破坏原商户回调；按上方"当前使用建议"操作。

### GOUO-007 供应商图片 URL 可触发后端内网请求

优先级：P1。处理状态：已验证修复。验证状态：已验证（本地运行环境，main 0b9b54f，见下方本地验证记录）。

**触发场景**

供应商响应可被控制，例如被攻陷的供应商或恶意渠道。图片 URL 仅检查 http/https 与 hostname，独立 http.Client 直接下载并默认跟随重定向。

**影响**

服务器可能访问私网、本机或链路本地地址。尚未证明普通用户可任意指定 URL；非图片正文通常不能进入素材库，不据此判定任意内网正文泄露。

**建议修复**

统一使用安全下载器；限制目标协议与地址，校验 DNS 解析结果，并逐跳检查重定向，阻止私网、本机、链路本地和等价 IPv6 地址。

**验收检查**

使用隔离测试服务覆盖私网、IPv6、本机、重定向到内网和 DNS 重绑定；请求在接触受限目标前被拒绝。

**代码依据**

[URL 校验](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/relay/gouo-image.go#L75-L77)、[直接下载](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/relay/gouo-image.go#L246-L273)。

**修复记录（2026-10-09）**

[PR #10](https://github.com/zhs1234/gouo-canvas/pull/10)，提交 [fb4c689](https://github.com/zhs1234/gouo-canvas/commit/fb4c689)，基于 main 1f3c463。已运行：`TestIsPublicIP`、`TestPublicHTTPClientRejectsLoopbackAndRedirects`、`TestGouoImageBytesRejectsInternalURLsAndOversizedImages`：回环、私网、链路本地、IPv4 映射地址及 localhost 均被拒绝且目标未收到请求。合并并按上方验收检查完成验证前，不标记为已验证修复。

**本地验证记录（2026-10-09）**

mock 上游分别返回 `http://127.0.0.1:18900/...` 和 `http://localhost:18900/...` 的图片地址：后端在建立连接时拒绝（日志"禁止访问非公网地址 127.0.0.1"），作品未入库，"内网"目标服务收到 0 次请求。检查发生在 DNS 解析之后、建立连接之时（`localhost` 也被拦截即为此），因此 DNS 重绑定同样被拦截；私网、IPv6、IPv4 映射地址和重定向到内网由 `TestIsPublicIP`、`TestPublicHTTPClientRejectsLoopbackAndRedirects`、`TestGouoImageBytesRejectsInternalURLsAndOversizedImages` 覆盖，本次重新运行均通过。图片地址仍原样返回给客户端，由浏览器自行加载，不经过后端。

### GOUO-008 URL 换源继承已有前端 API Key

优先级：P1。处理状态：待验证。验证状态：已复现（单元测试，撤掉修复后失败），尚未在运行环境复现。

**触发场景**

前端自带 Key 模式、默认配置专用模式生效、已有 Key 且没有锁定代理。用户打开只带 apiUrl 的链接后发起生成；URL 设置修改 baseUrl 却保留旧 Key，并自动应用。

**影响**

后续请求可能将旧 Bearer Key 发往新源。平台后端模式会覆盖请求配置，不能由此推断平台服务器 Key 泄露。

**建议修复**

来源改变时清空 Key，或要求用户确认新目标后重新绑定凭据；URL 导入不得静默继承其他来源的 Key。

**验收检查**

使用假 Key 和受控端点，覆盖仅 apiUrl、同源与跨源、锁定代理及平台模式；旧凭据不得发送到未经确认的新源。

**代码依据**

[换源与保留 Key](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/lib/urlSettings.ts#L119-L145)、[自动应用](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/App.tsx#L69-L73)、[Bearer Key](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/lib/openaiCompatibleImageApi.ts#L85-L88)、[发送目标](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/lib/openaiCompatibleImageApi.ts#L723-L731)。

**修复记录（2026-10-09）**

[PR #12](https://github.com/zhs1234/gouo-canvas/pull/12)，提交 [7d54e49](https://github.com/zhs1234/gouo-canvas/commit/7d54e49)，基于 main 1f3c463。已运行：`urlSettings.test.ts`：两种模式下仅 apiUrl 跨源时 Key 清空，同源保留，显式 apiKey 生效，settings JSON 不继承默认 Key。合并并按上方验收检查完成验证前，不标记为已验证修复。

**本地验证记录（2026-10-09）**

前端 URL 参数逻辑，需要在浏览器中验证，见"交给用户验证"。

## P2 待修复

### GOUO-009 面板切换账号后本地与云身份不一致

优先级：P2。处理状态：待验证。验证状态：已复现（单元测试，撤掉修复后失败），尚未在运行环境复现。

**触发场景**

A 的 Gouo 页面保持打开；另一 One Hub 面板标签页退出 A 并登录 B，且云作品库开启。共享 Cookie 已改变，Gouo active-user 标记未同步。

**影响**

旧页面仍使用 A 的本地空间，而云请求作为 B 执行，可能将 B 云数据写入 A 本地，或将 A 收藏、文档上传到 B。

**建议修复**

所有登录入口统一广播账号变化；请求携带预期用户 ID 并由后端核对；账号切换时取消或拒收过期在途请求。

**验收检查**

覆盖面板切换账号、在途响应、未同步收藏、文档和素材；A 与 B 的本地及云数据不得交叉。

**代码依据**

[面板登录退出](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/web/src/hooks/useLogin.js#L118-L132)、[身份监听](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/components/BackendAuthGate.tsx#L71-L98)、[仅检查本地标记](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/lib/storageScope.ts#L65-L72)、[Cookie 请求](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/lib/gouoBackend.ts#L215-L224)、[文档上传](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/lib/serverDocuments.ts#L90-L109)。

**修复记录（2026-10-09）**

[PR #11](https://github.com/zhs1234/gouo-canvas/pull/11)，提交 [97907f9](https://github.com/zhs1234/gouo-canvas/commit/97907f9)，基于 main 1f3c463。已运行：`TestGouoAccountMatch`：账号头为空或一致时放行，不一致返回 409；`gouoBackend.test.ts`：请求均携带账号头，收到 account_mismatch 时刷新页面。合并并按上方验收检查完成验证前，不标记为已验证修复。

**本地验证记录（2026-10-09）**

`X-Gouo-User` 与会话一致时请求正常；不一致时返回 409 `account_mismatch`，读取与写入都被拒绝，写入没有生效；不带该头时不受影响。剩余：浏览器中面板切换账号、在途响应及本地数据不交叉，见"交给用户验证"。

### GOUO-010 用户删除接口返回值不准确

优先级：P2。处理状态：待验证。验证状态：已复现（单元测试，撤掉修复后失败），尚未在运行环境复现。

**触发场景**

删除操作失败时返回 success:true；删除成功时没有预期 JSON 响应。相关修复尚未进入本次 main 基线。

**影响**

调用方可能误报成功或无法正确解析成功结果，造成界面与数据库状态不一致。

**建议修复**

成功与失败均返回明确、一致的 JSON 和相应状态；权限不足、目标不存在、数据库异常分别处理。

**验收检查**

覆盖成功、数据库失败、无权限、不存在 ID；核对 HTTP/JSON、界面反馈与最终数据库状态一致。

**代码依据**

[证据 L571–579](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/controller/user.go#L571-L579)。

**修复记录（2026-10-09）**

[PR #8](https://github.com/zhs1234/gouo-canvas/pull/8)，提交 [6a80715](https://github.com/zhs1234/gouo-canvas/commit/6a80715)，基于 main 1f3c463。已运行：`TestDeleteUserResponse`：成功与数据库失败两种情况的 JSON 与剩余记录数。合并并按上方验收检查完成验证前，不标记为已验证修复。

**本地验证记录（2026-10-09）**

删除成功时返回 `success:true`，账号随后不存在；删除不存在的 ID 返回 `success:false`（record not found）；admin 删除同级管理员、删除 root，以及普通用户调用删除接口均被拒，账号仍在。数据库失败由 `TestDeleteUserResponse` 覆盖，本次重新运行通过。剩余：后台面板中失败时的界面提示，见"交给用户验证"。

### GOUO-011 收藏变化被增量同步跳过

优先级：P2。处理状态：待验证。验证状态：已复现（单元测试，撤掉修复后失败），尚未在运行环境复现。

**触发场景**

设备 A 收藏或取消收藏，只修改收藏表而不推进任务 updated_at；设备 B 已见过该任务并按时间过滤。

**影响**

B 可能持续显示过期收藏关系。

**建议修复**

在事务内更新任务的同步时间，或建立独立收藏增量及取消收藏记录；确保游标能覆盖关系变化。

**验收检查**

两设备之间执行收藏和取消收藏，保持任务其他字段不变；B 的增量同步必须准确收到两种变化。

**代码依据**

[增量过滤](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/lib/serverLibrary.ts#L215-L235)、[仅修改收藏表](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/model/gouo_cloud.go#L341-L347)。

**修复记录（2026-10-09）**

[PR #11](https://github.com/zhs1234/gouo-canvas/pull/11)，提交 [498f69b](https://github.com/zhs1234/gouo-canvas/commit/498f69b)，基于 main 1f3c463。已运行：`TestGouoFavoriteChangesAdvanceTaskCursor`：收藏、取消收藏都推进任务 updated_at。合并并按上方验收检查完成验证前，不标记为已验证修复。

**本地验证记录（2026-10-09）**

按 `serverLibrary.ts` 中 `loadTasks` 的增量算法（读到 `updated_at` 不大于已见值即停止）模拟设备 B：设备 A 收藏、取消收藏后，B 的下一次增量同步都拿到该作品，收藏夹字段分别为该收藏夹和空，作品其他字段不变。剩余：两台设备的浏览器实际操作，见"交给用户验证"。

### GOUO-012 专用画布导入未触发云保存

优先级：P2。处理状态：待验证。验证状态：已复现（单元测试，撤掉修复后失败），尚未在运行环境复现。

**触发场景**

启动同步已经完成，随后导入专用画布；导入仅写本地，没有 documents-changed 事件，且用户不再编辑、重载或触发 online。

**影响**

导入的画布可能长期停留本地，其他设备不可见。

**建议修复**

导入事务成功后统一触发文档变更事件，纳入正常上传队列；事务失败不得发布。

**验收检查**

导入后不做任何编辑，检查云画布及素材映射均完成上传；失败导入不生成云文档。

**代码依据**

[导入保存](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/lib/canvas/export.ts#L125-L128)、[推送入口](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/lib/serverDocuments.ts#L193-L200)、[全量导入对照](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/store.ts#L2537-L2544)。

**修复记录（2026-10-09）**

[PR #11](https://github.com/zhs1234/gouo-canvas/pull/11)，提交 [18eb5b4](https://github.com/zhs1234/gouo-canvas/commit/18eb5b4)，基于 main 1f3c463。已运行：`export.test.ts`：导入成功后发出 documents-changed 事件，事务失败时不发。合并并按上方验收检查完成验证前，不标记为已验证修复。

**本地验证记录（2026-10-09）**

前端导入流程，需要在浏览器中验证，见"交给用户验证"。

### GOUO-013 全量 ZIP 导入缺少解压限制

优先级：P2。处理状态：待验证。验证状态：待复现；修复后行为有单元测试覆盖，测试依赖新增的共享函数，未做撤销对照，尚未在浏览器中用压缩炸弹复现。

**触发场景**

用户导入恶意或异常的第三方全量备份；文件被完整读取，并在主线程无界 unzipSync。

**影响**

浏览器可能内存耗尽或卡死，危及未保存编辑；不涉及已证明的服务器资源耗尽。

**建议修复**

限制压缩文件大小、条目数、单项及累计解压体积；在大内存分配和写库前拒绝异常输入，必要时采用可取消的隔离解压。

**验收检查**

使用受控压缩炸弹、累计超限、多条目和超大单项样本；超限时可控失败、界面可恢复、现有数据与草稿不变。

**代码依据**

[读完整文件](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/store.ts#L2474-L2477)、[无界解压](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/lib/exportZip.ts#L104-L110)、[画布导入已有防护](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/lib/canvas/export.ts#L55-L63)。

**修复记录（2026-10-09）**

[PR #12](https://github.com/zhs1234/gouo-canvas/pull/12)，提交 [3768f86](https://github.com/zhs1234/gouo-canvas/commit/3768f86)，基于 main 1f3c463。已运行：`exportZip.test.ts`：单项超限、累计超限报错，白名单外条目被跳过；`store.test.ts`：超大文件不读入内存。合并并按上方验收检查完成验证前，不标记为已验证修复。

**本地验证记录（2026-10-09）**

前端导入流程，需要在浏览器中验证，见"交给用户验证"。

### GOUO-014 批量部分失败导致云图片 ID 错绑

优先级：P2。处理状态：待验证。验证状态：已复现（单元测试，撤掉修复后失败），尚未在运行环境复现。

**触发场景**

批量任务前项失败、后项成功，前端把成功结果压缩成数组；后端保留原 requestIndex 作为 Position，却按压缩下标绑定客户端 ID。服务端成功但浏览器下载失败也是触发路径。

**影响**

清缓存或换设备后，同一图片 ID 可能指向另一张图，连带污染画布、Agent 与参数引用。

**建议修复**

全链路保留明确的 position-imageId 对或稳定结果 ID，禁止把压缩数组下标当成原请求位置。

**验收检查**

覆盖首项失败、中项失败、客户端下载失败；清缓存或换设备后逐项比对图片 ID、图像哈希与参数，引用保持一致。

**代码依据**

[压缩成功数组](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/lib/openaiCompatibleImageApi.ts#L508-L550)、[原始 Position](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/model/gouo_cloud.go#L438-L461)、[按下标绑定](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/model/gouo_cloud.go#L501-L508)。

**修复记录（2026-10-09）**

[PR #11](https://github.com/zhs1234/gouo-canvas/pull/11)，提交 [1510a7a](https://github.com/zhs1234/gouo-canvas/commit/1510a7a)，基于 main 1f3c463。已运行：`TestGouoTaskMetaBindsClientImagesByPosition`、`serverLibrary.test.ts`：前项失败时按原始位置绑定。合并并按上方验收检查完成验证前，不标记为已验证修复。

**本地验证记录（2026-10-09）**

同一作品的 3 个请求中，第 0 个由 mock 返回 400，第 1、2 个成功：服务端按原始位置 1、2 保存输出；客户端按 `client_image_positions: {output: [1, 2]}` 上报后，两个客户端图片 ID 分别绑定到位置 1、2，对应图片的哈希正确。剩余：中项失败、客户端下载失败、清缓存或换设备后的前端比对，见"交给用户验证"。

### GOUO-015 模型映射后图片编辑参数丢失

优先级：P2。处理状态：已验证修复。验证状态：已验证（本地运行环境，main 0b9b54f，见下方本地验证记录）。

**触发场景**

OpenAI 图片编辑启用公开模型名映射后重建 multipart；类型与字段白名单遗漏 quality、output_format、output_compression 和 moderation。

**影响**

用户选择的质量、格式、压缩和审核参数可能不再传到上游。

**建议修复**

保留已验证的原字段与文件，仅替换 model；补全类型及允许字段，保持映射前后语义一致。

**验收检查**

用 mock 捕获映射前后 multipart；除 model 外，上述参数、其他字段以及上传文件哈希必须一致。

**代码依据**

[前端字段](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/lib/openaiCompatibleImageApi.ts#L633-L656)、[缺少字段的类型](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/types/image.go#L37-L47)、[映射重建](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/providers/openai/image_edits.go#L56-L80)、[字段白名单](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/providers/openai/image_edits.go#L90-L152)。

**修复记录（2026-10-09）**

[PR #10](https://github.com/zhs1234/gouo-canvas/pull/10)，提交 [6430daa](https://github.com/zhs1234/gouo-canvas/commit/6430daa)，基于 main 1f3c463。已运行：`TestImagesEditsMultipartFormKeepsFieldsWhenModelIsMapped`：映射前后除 model 外字段与文件字节一致。合并并按上方验收检查完成验证前，不标记为已验证修复。

**本地验证记录（2026-10-09）**

渠道配置模型映射 `gpt-image-2` → `mock-image-upstream`，经后端调用图片编辑（两张 `image[]`、mask，以及 prompt、size、n、quality=high、output_format=webp、output_compression=80、background=transparent、moderation=low、input_fidelity=high、user）：上游收到的 model 为映射后的值，其余 10 个字段与原请求一致；mask 和参考图的 SHA-256 与原文件一致（mock 按字段名记录最后一个文件，全部文件的逐一比对由 `TestImagesEditsMultipartFormKeepsFieldsWhenModelIsMapped` 覆盖）；作品库记录的参数包含 quality 与 output_format。验收场景已全部覆盖。

### GOUO-016 Agent 停止后仍可派发待提交图片任务

优先级：P2。处理状态：待验证。验证状态：已复现（单元测试，撤掉修复后失败），尚未在运行环境复现。

**触发场景**

图片工具正在等待报价或图片准备时点击停止；abort signal 未传入 submitImageTask，准备完成后仍继续保存并 executeTask。

**影响**

用户停止后仍可能新增付费图片请求。此项针对尚未派发任务，已派发任务的后台执行与恢复语义需另行保持。

**建议修复**

将 signal 贯穿图片准备与提交链路，在每段异步等待之后、首次派发之前检查取消状态，阻止新增请求。

**验收检查**

延迟报价或图片准备，点击停止后再释放等待；断言没有新的图片 POST 或付费派发，同时验证已派发任务的结果恢复不受影响。

**代码依据**

[停止 abort](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/stores/agentStore.ts#L320-L322)、[提交不传 signal](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/lib/agent/tools.ts#L166-L183)、[等待报价](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/lib/imageTasks.ts#L117-L126)、[继续派发](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/lib/imageTasks.ts#L207-L224)。

**修复记录（2026-10-09）**

[PR #12](https://github.com/zhs1234/gouo-canvas/pull/12)，提交 [deb5c27](https://github.com/zhs1234/gouo-canvas/commit/deb5c27)，基于 main 1f3c463。已运行：`imageTasks.test.ts`：等待报价期间停止，不保存也不派发任务。合并并按上方验收检查完成验证前，不标记为已验证修复。

**本地验证记录（2026-10-09）**

Agent 停止的时序需要在浏览器中验证，见"交给用户验证"。

## 新增待修复（GOUO-017 起）

### GOUO-017 OIDC 按用户名回退匹配本地账号

优先级：P1。处理状态：待验证。验证状态：已复现（单元测试，撤掉修复后失败），尚未在运行环境复现。

**触发场景**

开启 OIDC 登录；某个 OIDC 主体尚未绑定本地账号，但其用户名声明与已有本地账号的用户名相同，例如 root。

**影响**

该 OIDC 身份会被直接绑定到同名本地账号并登录，可能取得 root 或管理员权限。用户名由身份提供方控制，关闭注册不能阻断。

**建议修复**

取消按用户名静默绑定，改为先登录本地账号再显式绑定 OIDC；修复前评估关闭该入口。

**验收检查**

用户名与 root、管理员、普通用户同名的新 OIDC 主体均不能登录已有账号；已绑定的 OIDC 主体仍可正常登录。

**代码依据**

[按用户名回退并绑定登录](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/controller/oidc.go#L158-L171)。修复 GOUO-002 时发现。

**修复记录（2026-10-09）**

[PR #8](https://github.com/zhs1234/gouo-canvas/pull/8)，提交 [3867282](https://github.com/zhs1234/gouo-canvas/commit/3867282)，基于 main 1f3c463。已运行：`TestOIDCLoginDoesNotTakeOverAccountsByUsername`：用户名声明为 root 的新主体被拒绝且 root 未被绑定；已绑定主体改名后仍可登录；新用户名正常进入注册。合并并按上方验收检查完成验证前，不标记为已验证修复。

**本地验证记录（2026-10-09）**

需要 OIDC 身份提供方，本地未验证，见"交给用户验证"。

### GOUO-018 对话图片 URL 下载可触发后端内网请求

优先级：P1。处理状态：待验证。验证状态：已复现（单元测试，撤掉修复后失败），尚未在运行环境复现。

**触发场景**

用户在对话请求中提供 `image_url`，所选渠道为 Claude、Gemini、Ollama、OpenRouter 等需要服务端先下载图片的供应商。下载没有限制目标地址。

**影响**

与 GOUO-007 同类，但 URL 由普通用户直接控制，服务器可能访问私网、本机或链路本地地址。

**建议修复**

复用 GOUO-007 引入的 `utils.NewPublicHTTPClient` 下载用户提供的图片 URL。

**验收检查**

使用隔离测试服务覆盖私网、IPv6、本机、重定向到内网和 DNS 重绑定；请求在接触受限目标前被拒绝，公网图片仍可正常下载。

**代码依据**

[GetImageFromUrl](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/common/image/image.go#L20)，调用方如 [claude/chat.go](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/providers/claude/chat.go#L325)、[gemini/type.go](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/providers/gemini/type.go#L558)。修复 GOUO-007 时发现。

**修复记录（2026-10-09）**

[PR #10](https://github.com/zhs1234/gouo-canvas/pull/10)，提交 [681720c](https://github.com/zhs1234/gouo-canvas/commit/681720c)，基于 main 1f3c463。已运行：`TestGetImageFromUrlRejectsInternalAddresses`：直连及配置代理两种模式下，下载和尺寸探测都拒绝回环地址且目标未收到请求；`TestCheckPublicHost`。合并并按上方验收检查完成验证前，不标记为已验证修复。

**本地验证记录（2026-10-09）**

建 Claude 类型渠道，对话中分别附带 `127.0.0.1`、`localhost`、`[::1]` 的 image_url：请求返回 400（image_url_invalid），"内网"目标服务收到 0 次请求，上游也没有收到请求；不带图片的对话经同一渠道正常。代理模式和重定向由 `TestGetImageFromUrlRejectsInternalAddresses`、`TestCheckPublicHost` 覆盖，本次重新运行通过。剩余：公网图片仍能正常下载——本容器没有可直连外网的 DNS，无法验证，见"交给用户验证"。

### GOUO-019 隐藏收藏夹不推进相关任务的同步游标

优先级：P2。处理状态：待验证。验证状态：已复现（单元测试，撤掉修复后失败），尚未在运行环境复现。

**触发场景**

设备 A 删除（隐藏）或恢复某个收藏夹；设备 B 已同步过夹内任务，并按任务 updated_at 增量拉取。

**影响**

与 GOUO-011 同类：设备 B 可能持续显示过期的收藏夹归属。

**建议修复**

隐藏或恢复收藏夹时，在同一事务内推进夹内任务的 updated_at，或建立独立的收藏夹增量记录。下发的收藏关系同时排除已隐藏的收藏夹，否则重新拉取到的任务仍带着已删除收藏夹的编号。

**验收检查**

两设备之间隐藏、恢复收藏夹，设备 B 的增量同步准确反映夹内任务的收藏状态。

**代码依据**

[SetGouoCollectionHidden](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/model/gouo_cloud.go#L332-L339)。修复 GOUO-011 时发现。

**修复记录（2026-10-09）**

[PR #11](https://github.com/zhs1234/gouo-canvas/pull/11)，提交 [cacb90e](https://github.com/zhs1234/gouo-canvas/commit/cacb90e)，基于 main 1f3c463。已运行：`TestGouoCollectionHideAdvancesTaskCursorAndHidesFavorites`：隐藏、恢复收藏夹均推进夹内任务 updated_at，夹外任务不变；隐藏期间不下发收藏，恢复后恢复。合并并按上方验收检查完成验证前，不标记为已验证修复。

**本地验证记录（2026-10-09）**

用 GOUO-011 中的设备 B 模拟：A 隐藏收藏夹后，B 增量拿到夹内作品且收藏为空，夹外作品不在变化中；A 恢复后，B 拿到夹内作品且收藏恢复。剩余：浏览器实际操作，见"交给用户验证"。

### GOUO-020 注册验证码可重复使用，同一邮箱可注册多个账号

优先级：P2。处理状态：已验证修复。验证状态：已验证（本地运行环境，main 0b9b54f，见下方本地验证记录）。

**触发场景**

开启邮箱验证注册，且设置了新用户赠送额度或邀请奖励。发送验证码时检查过邮箱未被占用，但注册时只校验验证码，既不作废验证码，也不再次检查邮箱是否已被注册。

**影响**

同一个邮箱和验证码在 10 分钟有效期内可以连续注册多个账号，每个账号都领取新用户赠送额度，邀请人也重复获得奖励。邮箱重复后，按邮箱重置密码、GitHub 按邮箱匹配都会取到第一个账号，行为不可预期。邮箱绑定接口同样不作废验证码。

**建议修复**

注册与邮箱绑定成功后立即作废验证码；注册时在同一事务内再次检查邮箱唯一，必要时为非空邮箱建立唯一约束并清理历史重复数据。

**验收检查**

用同一验证码连续注册两次，第二次被拒绝；并发注册同一邮箱只成功一个；赠送额度和邀请奖励只发放一次。

**代码依据**

[注册只校验验证码](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/controller/user.go#L162-L195)、[验证码校验后不删除](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/common/verification.go#L46-L55)、[邮箱字段非唯一](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/model/user.go#L29)、[注册赠送额度与邀请奖励](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/model/user.go#L150-L170)。

**修复记录（2026-10-09）**

[PR #13](https://github.com/zhs1234/gouo-canvas/pull/13)（叠加在 PR #11 之上），提交 [f92e941](https://github.com/zhs1234/gouo-canvas/commit/f92e941)，基于 main 1f3c463。已运行：`TestRegisterVerificationCodeIsSingleUse`：同一验证码不能注册第二个账号，邮箱已注册时新验证码也不能用；`TestConsumeCodeWithKeyOnlyOnce`。合并并按上方验收检查完成验证前，不标记为已验证修复。

**本地验证记录（2026-10-09）**

用 SMTP mock 收取验证码：首次注册成功；同一验证码和邮箱再注册第二个账号被拒；已注册邮箱不能再申请验证码；新用户额度为注册赠送 777 加受邀奖励 222，邀请人只得到一次 111。同一验证码并发提交 8 个注册只成功 1 个（其余提示"验证码错误或已过期"），该邮箱只对应一个账号，邀请奖励只发一次；同一邮箱多次申请后并发 6 个注册也只成功 1 个。验证码只存放在进程内存中、没有 Redis 分支，本地验证的就是线上代码路径（多实例部署之间不共享验证码，属既有设计）。验收场景已全部覆盖。

### GOUO-021 云文档与任务记录不计入云端空间配额

优先级：P2。处理状态：已验证修复。验证状态：已验证（本地运行环境，main 0b9b54f，见下方本地验证记录）。

**触发场景**

开启云端作品库。用户反复写入不同 client_id 的画布、会话（每份最多 4 MB）或任务记录（每条最多 512 KB），数量没有上限。

**影响**

空间配额只统计图片素材，文档和任务记录可以无限增长，单个账号即可持续占用数据库空间。

**建议修复**

把文档和任务记录的体积计入用户配额，或为每个账号设置文档、任务数量与总体积上限；超限时返回明确错误。

**验收检查**

写入超过上限的文档或任务被拒绝且不影响已有数据；空间统计包含文档与任务；管理员调整配额后立即生效。

**代码依据**

[空间统计只含素材](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/model/gouo_cloud.go#L113-L123)、[文档单份 4 MB 无数量限制](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/controller/gouo_documents.go#L147-L219)。

**修复记录（2026-10-09）**

[PR #13](https://github.com/zhs1234/gouo-canvas/pull/13)（叠加在 PR #11 之上），提交 [28cef64](https://github.com/zhs1234/gouo-canvas/commit/28cef64)，基于 main 1f3c463。已运行：`TestGouoDocumentsAndTasksCountTowardStorageQuota`：已用空间包含文档与作品记录，超额写入被拒绝，缩小已有文档和付费生成结果不受限制；`TestGouoContentBytesMigrationBackfillsExistingRows`：旧数据回填字节数。合并并按上方验收检查完成验证前，不标记为已验证修复。

**本地验证记录（2026-10-09）**

写入 200 KB 文档后，已用空间相应增加；root 把配额调到略高于用量后立即生效；新建超额文档、把已有文档扩大到超额、写入超额作品记录，均返回 507 `storage_quota_exceeded`，已有文档的内容与版本不变；缩小已有文档不受限制；调回配额后立即可以写入；管理端与用户端统计一致。作品记录计入统计另由 `TestGouoDocumentsAndTasksCountTowardStorageQuota` 覆盖。验收场景已全部覆盖。

### GOUO-022 云端作品无法彻底删除，回收站一直占用空间

优先级：P2。处理状态：已验证修复。验证状态：已验证（本地运行环境，main 0b9b54f，见下方本地验证记录）。

**触发场景**

用户删除作品、画布或会话后，它们只进入回收站；服务端没有任何删除素材文件、任务或文档记录的路径，删除账号也不会清理。

**影响**

空间占满后，用户无法通过删除作品释放空间，后续云同步持续失败；注销或被删除的账号，其图片文件和提示词仍保留在服务器上。

**建议修复**

提供回收站彻底删除（可设保留期后自动清理），删除时移除不再被引用的素材文件与记录；删除账号时按策略清理或匿名化其云端数据。

**验收检查**

彻底删除后空间统计相应减少、文件被移除，仍被其他作品或文档引用的素材不被删除；删除账号后其云端数据按策略处理。

**代码依据**

[界面说明回收站仍占空间](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/components/settings/DataSettingsTab.tsx#L85)、[空间统计](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/model/gouo_cloud.go#L113-L123)。服务端 model、controller 中没有删除素材文件或作品记录的代码。

**修复记录（2026-10-09）**

用户于 2026 年 10 月 9 日确定保留期为 3 天：回收站内容保留 3 天后彻底删除，已删除账号的云端数据同样保留 3 天后清除。作品库、画布、数据设置中的回收站提示已改为"3 天内可以恢复"；落地页按用户决定保留原文，仍写"可以随时恢复"。[PR #13](https://github.com/zhs1234/gouo-canvas/pull/13)（叠加在 PR #11 之上），提交 [698c196](https://github.com/zhs1234/gouo-canvas/commit/698c196)，基于 main 1f3c463。已运行：`TestPurgeGouoTrashAfterRetention`：超过 3 天的回收站作品、文档、收藏夹被删除，未过期内容、仍被引用的图片和刚上传的图片保留，未引用图片的文件被删除，已删除满 3 天的账号数据被清除，重复运行无副作用；`serverDocuments.test.ts`、`serverLibrary.test.ts`：本地过期内容同步删除，云端图片失效后清除本地映射。合并并按上方验收检查完成验证前，不标记为已验证修复。

**本地验证记录（2026-10-09）**

用户 A 隐藏 3 个作品（2 个把隐藏时间改到 4 天前、1 个保持刚隐藏）、1 个文档和 1 个收藏夹（夹内是未隐藏的作品），另有一张被未隐藏文档引用的图片。未满 3 天时清理不删除任何内容；改时间后清理：过期的作品、文档、收藏夹被删除，刚隐藏的作品和未隐藏内容保留；无人引用的图片记录和磁盘文件被删除，被文档引用的图片保留；空间统计相应减少；重复清理无变化。用户 B 删除账号后未满 3 天时数据保留，把删除时间改到 4 天前后，图片记录和文件全部清除。清理由临时 Go 程序直接调用 `model.PurgeGouoTrash`，没有等待每小时一次的定时任务；客户端本地清理由 `serverDocuments.test.ts`、`serverLibrary.test.ts` 覆盖。验收场景已全部覆盖。

### GOUO-023 普通管理员可查看 root 与其他管理员的作品

优先级：P2。处理状态：已验证修复。验证状态：已验证（本地运行环境，main 0b9b54f，见下方本地验证记录）。

**触发场景**

普通管理员调用管理端作品接口，传入 root 或其他管理员的用户 ID。接口只要求管理员身份，不检查目标账号的权限等级。

**影响**

普通管理员可以读取 root 与同级管理员的提示词和生成图片，权限范围与用户管理接口不一致。另外落地页写明"作品、画布与会话……只有本人登录可见"，而管理员可以查看用户作品，对外承诺与实际能力不符。

**建议修复**

管理端作品接口与 GOUO-001 采用相同的角色范围（非 root 只能查看权限更低的账号）；修改落地页文案，如实说明管理员在何种情况下可以查看作品，或收紧管理端的查看能力。

**验收检查**

普通管理员查看 root、同级管理员的作品被拒绝，查看普通用户正常；root 可查看全部；落地页文案与实际权限一致。

**代码依据**

[管理端作品路由](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/router/api-router.go#L231-L241)、[作品列表与图片内容](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/controller/gouo_cloud.go#L732-L775)、[落地页承诺](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/components/landing/LandingPage.tsx#L55)。

**修复记录（2026-10-09）**

用户于 2026 年 10 月 9 日决定不修改落地页文案，PR #13 已还原该改动（提交 [e586aa1](https://github.com/zhs1234/gouo-canvas/commit/e586aa1)）。"对外承诺与实际能力不符"这一部分及其验收检查不在本次修复范围内，落地页仍写"只有本人登录可见"；权限范围部分的修复不变。[PR #13](https://github.com/zhs1234/gouo-canvas/pull/13)（叠加在 PR #11 之上），提交 [f3a40ed](https://github.com/zhs1234/gouo-canvas/commit/f3a40ed)，基于 main 1f3c463。已运行：`TestGouoAdminWorkEndpointsRespectRoleScope`：普通管理员访问 root 与同级管理员的作品列表、图片和配额返回 403，访问普通用户正常，root 可访问全部。合并并按上方验收检查完成验证前，不标记为已验证修复。

**本地验证记录（2026-10-09）**

admin1 访问 root、admin2 的作品列表、图片内容、配额修改，均返回 403；访问普通用户正常；root 访问 admin2 和普通用户正常。落地页文案按用户决定不在本次范围内。验证中发现管理端两个列表接口仍未按角色过滤，另登记为 GOUO-030。后端验收场景已全部覆盖。

### GOUO-024 客户端可伪造来源 IP，绕过限流与令牌 IP 白名单

优先级：P1。处理状态：待验证。验证状态：已复现（本地用 gin 1.10.1 构造请求，客户端自带 `X-Forwarded-For: 1.2.3.4` 时 `ClientIP()` 返回 1.2.3.4），尚未在运行环境复现。

**触发场景**

后端没有调用 `SetTrustedProxies`，gin 默认信任所有来源的代理头。未配置 `trusted_header` 时，客户端在请求中自带 `X-Forwarded-For`；随附的 nginx 配置用 `$proxy_add_x_forwarded_for` 追加真实地址，原值保留在最左侧。

**影响**

所有按 IP 计数的限流都可以通过每次更换伪造 IP 绕过，包括登录（20 次/20 分钟）、注册、发送验证码和重置密码邮件，可借此暴力尝试密码或批量发送邮件。令牌的 IP 白名单可被伪造的白名单地址直接通过；日志与 Turnstile 校验中记录的 IP 也不可信。

**建议修复**

启动时调用 `SetTrustedProxies`，只信任部署中的反向代理地址（如本机或容器网段），可通过配置项调整；或者在已知代理后改用 `TrustedPlatform` 读取由代理覆盖写入的头（如 `X-Real-IP`）。同步更新部署文档。

**验收检查**

直连后端时自带 `X-Forwarded-For` 不改变识别到的 IP；经随附 nginx 访问时识别到真实客户端地址；伪造 IP 无法绕过登录限流和令牌 IP 白名单。

**代码依据**

[未设置可信代理](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/main.go#L122-L130)、[限流按 ClientIP 计数](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/middleware/rate-limit.go#L43)、[另一处限流](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/middleware/rate-limit.go#L85)、[令牌 IP 白名单](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/middleware/auth.go#L184-L205)、[Turnstile 校验](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/server/middleware/turnstile-check.go#L38)、[nginx 追加转发头](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/deploy/nginx.conf#L23)。

**修复记录（2026-10-09）**

[PR #14](https://github.com/zhs1234/gouo-canvas/pull/14)（叠加在 PR #12 之上），提交 [8cd2e02](https://github.com/zhs1234/gouo-canvas/commit/8cd2e02)，基于 main 1f3c463。新增配置 `trusted_proxies`（环境变量 `TRUSTED_PROXIES`），默认只信任本机与私有网段的反向代理。已运行：`TestClientIPOnlyTrustsConfiguredProxies`：直连时忽略自带转发头，经容器网段 nginx 时取追加的真实地址，逗号分隔配置可解析，设为空时不信任任何代理。反向代理位于其他公网地址的部署需在升级时把其地址加入配置。合并并按上方验收检查完成验证前，不标记为已验证修复。

**本地验证记录（2026-10-09）**

① 默认配置，模拟 nginx 追加真实地址（`伪造值, 203.0.113.77`）：每次轮换伪造值，第 21 次登录返回 429；换一个真实地址不受影响；令牌 IP 白名单按真实地址判断，伪造白名单内的 IP 被拒（403），真实地址在白名单内时正常。② config.yaml 写 `trusted_proxies: ""` 后直连：自带的 X-Forwarded-For 不生效，限流与白名单都按连接地址。③ 用环境变量 `TRUSTED_PROXIES=`（空）直连：不生效，仍信任本机与私有网段，伪造 IP 可以绕过限流和白名单，登记为 GOUO-029。剩余：GOUO-029 修复；在实际 nginx 部署上复查，见"交给用户验证"。

### GOUO-025 自定义服务商的异步任务轮询不经过 API 代理

优先级：P2。处理状态：不适用。验证状态：复核后确认为误报。

**触发场景**

使用带轮询配置的自定义服务商，并开启 API 代理（或部署设置了锁定代理）。提交请求按代理设置发送，查询任务结果时却固定直连服务地址。

**影响**

上游不允许浏览器跨域时轮询全部失败，已提交、可能已计费的任务拿不到结果；锁定代理模式下，API Key 会绕过代理直接发往服务地址，与"所有请求经同源代理"的设定不符。

**建议修复**

轮询与提交使用同一份代理判断（`shouldUseApiProxy`），并把它传入 `pollCustomTaskResult`，包括恢复未完成任务时的调用。

**验收检查**

开启代理或锁定代理时，提交与轮询都发往同源代理路径；关闭代理时都直连；恢复未完成任务时同样遵循代理设置。

**代码依据**

[提交按代理设置](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/lib/openaiCompatibleImageApi.ts#L951)、[轮询固定直连](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/lib/openaiCompatibleImageApi.ts#L986)、[恢复任务时的轮询](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/lib/openaiCompatibleImageApi.ts#L1028)、[常规调用](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/lib/openaiCompatibleImageApi.ts#L1063)。

**复核记录（2026-10-09）**

原结论遗漏了提交前的检查：开启 API 代理（含锁定代理）时，带 `taskIdPath` 或 `poll` 的自定义服务商在提交前就被拒绝，并提示关闭代理或改用同步服务商，因此不会出现"提交走代理、轮询直连"。唯一直连轮询的路径是恢复此前在未开代理时提交的任务，此时任务本就在上游直连提交。不修改代码。重新核查的触发点：若以后允许异步自定义服务商使用 API 代理，需同时让轮询走代理。依据：[提交前拒绝](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/lib/openaiCompatibleImageApi.ts#L1042-L1047)。

### GOUO-026 Agent 单次运行可连续提交多个付费图片任务，无费用上限或确认

优先级：P2。处理状态：待验证。验证状态：已复现（单元测试，撤掉修复后失败），尚未在运行环境复现。

**触发场景**

用户发送一条消息后，模型在一次运行里可以调用最多 8 次工具；每次 `create_image_task` 可请求 1 到 10 张图片，提交前不需要用户确认，也没有按金额或张数的上限。

**影响**

模型误判、循环调用或受到会话内容诱导时，一条消息最多可提交 8 个付费任务、共 80 张图片，按默认单价约 8 元，且无法撤回已派发的请求。

**建议修复**

为单次运行设置图片张数或金额上限；超过阈值（例如单次多于 1 个任务或多张图片）时先展示预估费用并请用户确认；在会话界面显示本轮已提交的费用。

**验收检查**

模型在一次运行中请求超过上限的图片时被拦截并提示；确认后才继续提交；费用显示与实际扣费一致。

**代码依据**

[每轮工具调用上限 8 次](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/stores/agentStore.ts#L128-L148)、[单次最多 10 张](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/lib/agent/tools.ts#L179)、[直接提交付费任务](https://github.com/zhs1234/gouo-canvas/blob/1f3c463d4f5d5b51ede64622fab20cef265770b6/src/lib/agent/tools.ts#L181)。

**修复记录（2026-10-09）**

[PR #14](https://github.com/zhs1234/gouo-canvas/pull/14)（叠加在 PR #12 之上），提交 [835c5d1](https://github.com/zhs1234/gouo-canvas/commit/835c5d1)，基于 main 1f3c463。从最近一条用户消息起累计已提交的图片张数，超过 4 张前弹窗请用户确认，确认框显示已提交与本次张数；取消或停止运行均不提交。上限 4 张为默认值，可调整。确认框未显示金额，验收检查中的"费用显示"尚未实现。已运行：`tools.test.ts`：不超过 4 张不弹窗，上一条消息与失败任务不计入，超过时取消不提交、确认后提交，等待确认时停止运行不提交并关闭确认框。合并并按上方验收检查完成验证前，不标记为已验证修复。

**本地验证记录（2026-10-09）**

历史记录（PR #17 合并前）：Agent 交互需要在浏览器中验证；当时确认框尚未显示金额。PR #17 已补充金额显示，当前需按下方记录在 main 重新验收，不能把历史缺口写成当前未实现。

**修复记录（2026-10-09，费用显示）**

[PR #17](https://github.com/zhs1234/gouo-canvas/pull/17)，提交 [6f7472f](https://github.com/zhs1234/gouo-canvas/commit/6f7472f)，基于 main 0b9b54f。确认框按所选模型的当前目录价格显示单价和本次预计扣费；读取价格失败时仍要求确认，只是不显示金额；提交时照旧校验价格版本，确认后价格变动会被拒绝而不是按新价扣费。已运行：`tools.test.ts` 新增金额显示与读取失败两种情况，`npm test`（453 项）、`npm run build` 通过。合并并按上方验收检查完成验证前，不标记为已验证修复。

### GOUO-027 重置密码链接未编码邮箱，含"+"的邮箱无法通过链接重置

优先级：P2。处理状态：已验证修复。验证状态：已验证（本地运行环境，main a496a11；2026-10-10 在 SQLite 与 PostgreSQL 16 上复跑通过，见"第三轮运行时回归"）。

**触发场景**

用户邮箱含 `+`（如 `name+tag@example.com`）或其他 URL 保留字符，申请重置密码后点击邮件中的链接。后端拼接链接时没有对邮箱做 URL 编码，前端按查询参数解析时 `+` 变为空格。

**影响**

重置表单预填的邮箱与发码时的邮箱不一致，提交后提示"重置链接非法或已过期"。用户手动改回邮箱时，表单会同时清空链接带来的验证码，只能重新申请。

**建议修复**

拼接链接时用 `url.QueryEscape` 编码邮箱和令牌（或用 `url.Values` 构造查询串）；后台面板的重置链接走同一处代码。

**验收检查**

邮箱含 `+`、`%`、`&` 时，点击邮件链接可直接完成重置；普通邮箱不受影响。

**代码依据**

[拼接重置链接](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/server/controller/misc.go#L170)、[前端读取链接参数](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/src/components/BackendAuthGate.tsx#L46-L54)。基线为合并后的 main 0b9b54f。

**修复记录（2026-10-09）**

[PR #15](https://github.com/zhs1234/gouo-canvas/pull/15)，提交 [4030dc2](https://github.com/zhs1234/gouo-canvas/commit/4030dc2)，基于 main 0b9b54f。用 `url.Values` 编码邮箱与令牌。已运行：`TestPasswordResetLinkEncodesEmail`：含 `+` 的邮箱和含 `&` 的令牌解析后与原值一致。合并并按上方验收检查完成验证前，不标记为已验证修复。

**本地验证记录（2026-10-09）**

用 PR #15 head（cbfa082）构建运行：邮箱 `name+tag@`、`a%b@`、`x&y@` 和普通邮箱各申请一次重置，从邮件中取出链接，按前端方式（`URLSearchParams`）解析，邮箱与原值一致，重置成功并能用新密码登录。对照 main 0b9b54f：含 `+` 的邮箱被解析成空格，含 `&` 的邮箱被截断，重置失败（原问题复现）。验收场景已全部覆盖；修复尚未合并到 main，合并后即可标记为已验证修复。

### GOUO-028 管理员调整余额与核对账务不受角色范围限制

优先级：P2。处理状态：已验证修复。验证状态：已验证（本地运行环境，main a496a11；2026-10-10 在 SQLite 与 PostgreSQL 16 上复跑通过，见"第三轮运行时回归"）。

**触发场景**

普通管理员调用"增减用户额度"接口，目标为 root 或其他管理员；或在图片账务核对中，对 root、同级管理员或自己的"待核对"请求选择结算或退款。两个接口只要求管理员身份，不检查目标账号的权限等级，也不排除操作者本人。

**影响**

普通管理员可以扣减 root 和其他管理员的余额，或把自己的待核对请求退款。权限范围与用户管理、作品管理接口（GOUO-001、GOUO-023）不一致。管理员本身可以生成兑换码，所以给自己加余额并不是新增的能力；问题在于可以操作更高或同级的账号，以及自己核对自己的账务。

**建议修复**

两个接口采用与用户管理相同的范围：root 可操作全部，普通管理员只能操作权限更低的账号；账务核对禁止处理本人的请求，或要求 root 处理。

**验收检查**

普通管理员调整 root、同级管理员余额，或核对其请求时被拒绝；核对本人请求被拒绝；root 及对普通用户的操作正常，日志记录不变。

**代码依据**

[增减额度无角色检查](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/server/controller/user.go#L857-L898)、[路由仅要求管理员](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/server/router/api-router.go#L102)、[账务核对](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/server/controller/gouo_billing.go#L77-L99)、[核对路由](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/server/router/api-router.go#L236)。基线为合并后的 main 0b9b54f。

**修复记录（2026-10-09）**

[PR #15](https://github.com/zhs1234/gouo-canvas/pull/15)，提交 [cbfa082](https://github.com/zhs1234/gouo-canvas/commit/cbfa082)，基于 main 0b9b54f。额度调整与账务核对采用与用户管理相同的角色范围，普通管理员不能操作自己。已运行：`TestAdminQuotaAndBillingActionsRespectRoleScope`：普通管理员调整或核对 root、同级管理员和自己时被拒绝且数据不变，对普通用户正常，root 可操作管理员。合并并按上方验收检查完成验证前，不标记为已验证修复。

**本地验证记录（2026-10-09）**

用 PR #15 head（cbfa082）构建运行：admin1 调整 root、admin2 和自己的余额均被拒，余额和"管理员增减用户额度"日志都不变；admin1 调整普通用户、root 调整管理员和普通用户均成功，各记 1 条日志。每个账号生成 1 次图片得到账务记录并改为待核对：admin1 核对 root、admin2 和自己的请求返回 403，状态和余额不变；admin1 核对普通用户、root 核对 admin2 成功并退回额度。对照 main 0b9b54f：普通管理员的越级和自我操作全部成功（原问题复现）。验收场景已全部覆盖；修复尚未合并到 main，合并后即可标记为已验证修复。

### GOUO-029 环境变量无法把 TRUSTED_PROXIES 设为空

优先级：P2。处理状态：已验证修复。验证状态：已验证（本地运行环境，main a496a11；2026-10-10 在 SQLite 与 PostgreSQL 16 上复跑通过，见"第三轮运行时回归"）。

**触发场景**

按文档在后端直接对外时，用环境变量 `TRUSTED_PROXIES=`（空字符串）关闭对代理的信任。viper 的 `AutomaticEnv` 默认把值为空的环境变量当作未设置（未开启 `AllowEmptyEnv`），于是回退到默认值，仍信任本机与私有网段。写在 config.yaml 里的空字符串可以生效。

**影响**

连接来源是本机或私有网段地址、但前面并没有可信代理的部署（例如流量经 Docker userland-proxy 转发后来源变为网桥网关地址，或后端直接暴露在内网中），仍会采信客户端自带的 X-Forwarded-For，GOUO-024 的伪造 IP 绕过登录限流与令牌 IP 白名单在这些部署中依旧存在。

**建议修复**

读取 `trusted_proxies` 时先用 `os.LookupEnv("TRUSTED_PROXIES")` 判断环境变量是否存在，存在就使用其值（空即不信任任何代理）；或全局开启 `viper.AllowEmptyEnv(true)`，但需评估对其他配置项的影响。

**验收检查**

环境变量设为空时，直连伪造 X-Forwarded-For 不生效，登录限流与令牌白名单都按连接地址；不设置时仍为默认值；config.yaml 设为空同样生效。

**代码依据**

[读取配置](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/server/middleware/client-ip.go#L13-L19)、[环境变量与默认值](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/server/common/config/config.go#L33-L40)、[文档说明设为空](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/docs/zh-CN/backend.md#L62)。基线为 main 0b9b54f。

**复现记录（2026-10-09）**

本地运行 main 0b9b54f，以 `TRUSTED_PROXIES=` 启动后直连：每次轮换伪造的 X-Forwarded-For，连续 25 次登录全部返回 200，没有被限流；令牌白名单只允许 198.51.100.200 时，伪造该 IP 访问 `/v1/models` 返回 200。同样的请求在 config.yaml 写 `trusted_proxies: ""` 时，第 20 次左右开始返回 429，白名单返回 403。

**修复记录（2026-10-09）**

[PR #16](https://github.com/zhs1234/gouo-canvas/pull/16)，提交 [9e8ad7a](https://github.com/zhs1234/gouo-canvas/commit/9e8ad7a)，基于 main 0b9b54f。环境变量 `TRUSTED_PROXIES` 存在时直接使用其值，空即不信任任何代理；未设置时仍用 config.yaml 或默认值。已运行：`TestClientIPOnlyTrustsConfiguredProxies` 新增环境变量设为空、设为网段两种情况。合并并按上方验收检查完成验证前，不标记为已验证修复。

### GOUO-030 管理端空间用户列表与图片账务列表不按角色过滤

优先级：P2。处理状态：已验证修复。验证状态：已验证（本地运行环境，main a496a11；2026-10-10 在 SQLite 与 PostgreSQL 16 上复跑通过，见"第三轮运行时回归"）。

**触发场景**

普通管理员打开云端空间的用户列表（`GET /api/gouo/admin/storage/users`），或查询图片账务（`GET /api/gouo/admin/image-charges`，可带任意 `user_id`）。两个接口只要求管理员身份，返回全部账号的数据。

**影响**

普通管理员可以看到 root 和其他管理员的用户名、云端空间用量与图片数量，以及他们的图片请求记录（模型、额度、状态、核对备注）。作品内容、配额修改和账务核对已按 GOUO-023、GOUO-028 拦截，这里是只读元数据，但与用户列表（GOUO-001）只显示更低权限账号的范围不一致。

**建议修复**

两个列表对普通管理员只返回权限更低的账号（按 users.role 过滤，与 `gouoAdminCanAccess` 一致），指定超出范围的 `user_id` 时返回空或 403；root 不变。

**验收检查**

普通管理员的两个列表都不含 root 和同级管理员的数据，指定这些账号的 `user_id` 查询时返回空或 403；root 能看到全部；普通用户的数据正常显示。

**代码依据**

[空间用户列表](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/server/controller/gouo_cloud.go#L717-L749)、[按用户汇总用量](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/server/model/gouo_cloud.go#L460-L466)、[账务列表](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/server/controller/gouo_billing.go#L42-L75)、[管理端路由](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/server/router/api-router.go#L231-L241)。基线为 main 0b9b54f。

**复现记录（2026-10-09）**

本地运行 main 0b9b54f：admin1 的空间用户列表返回 alice、admin2、root、bob 四个账号的用户名与用量。PR #15 构建上：admin1 用 `user_id=1` 查询图片账务，返回 root 的待核对记录（模型、额度、状态）。

**修复记录（2026-10-09）**

[PR #16](https://github.com/zhs1234/gouo-canvas/pull/16)，提交 [9e8ad7a](https://github.com/zhs1234/gouo-canvas/commit/9e8ad7a)，基于 main 0b9b54f。普通管理员的空间用户列表和图片账务列表只返回权限更低的账号（账务包含已删除账号的记录）；用 `user_id` 查询同级或更高等级账号的账务返回 403；root 不变。全站汇总统计（总用量、总数）未拆分，仍为全站数字。已运行：`TestGouoAdminListsRespectRoleScope`。合并并按上方验收检查完成验证前，不标记为已验证修复。

### GOUO-031 光构图片模型可经其他入口免费调用

优先级：P1。处理状态：已验证修复。验证状态：已验证（本地运行环境，main a496a11；2026-10-10 在 SQLite 与 PostgreSQL 16 上复跑通过，见"第三轮运行时回归"）。

**触发场景**

用普通令牌请求 `POST /recraftAI/v1/images/generations`（或 `/v1/chat/completions`、`/v1/responses`），模型填光构图片模型（如 gpt-image-2）。光构计费只在路径以 `/v1/images/` 开头时生效，这些入口改走通用计费；迁移时为光构模型创建的 Price 没有设置通用单价，预扣和结算都是 0。

**影响**

渠道不做模型映射时（常见配置）可以无限免费生成图片，也不产生账务记录；做了映射时按映射后模型的通用价格计费，与公开价格不一致。

**建议修复**

图片接口以外的入口一律拒绝开启了光构定价的模型；通用预扣再加一道兜底，覆盖 recraft 工具、任务、搜索等其他入口。

**验收检查**

用普通令牌从 recraft、对话、responses 入口调用光构模型均被拒绝且额度不变；`/v1/images/*` 照常按目录价格扣费；普通模型不受影响。

**代码依据**

[只按路径前缀进入光构计费](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/server/relay/gouo-image.go#L95-L98)、[recraft 生成按图片生成处理](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/server/relay/common.go#L38)、[recraft 路由](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/server/router/relay-router.go#L128-L132)、[通用预扣](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/server/relay/relay_util/quota.go#L104-L111)、[迁移创建的 Price](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/server/model/gouo-model.go#L88)。基线为 main 0b9b54f。

**复现记录（2026-10-09）**

本地运行 main 0b9b54f：渠道不做模型映射时，`/recraftAI/v1/images/generations` 返回 200 和图片，用户额度不变，账务表无记录；做了映射时扣 30000 额度（通用默认价），而光构目录价为 6850。

**修复记录（2026-10-09）**

[PR #18](https://github.com/zhs1234/gouo-canvas/pull/18)，提交 [f5c1b41](https://github.com/zhs1234/gouo-canvas/commit/f5c1b41)。已运行：`TestGouoImageRequestQuoteAndCapabilities`、`TestGouoImageModelRejectedOutsideImageBilling`。本地运行修复后的构建：recraft 和对话入口返回 400 `image_model_endpoint` 且额度不变，`/v1/images/generations` 仍扣 6850。合并并按上方验收检查完成验证前，不标记为已验证修复。

### GOUO-032 补充作品信息接口不检查云端空间配额

优先级：P2。处理状态：已验证修复。验证状态：已验证（本地运行环境，main a496a11；2026-10-10 在 SQLite 与 PostgreSQL 16 上复跑通过，见"第三轮运行时回归"）。

**触发场景**

先用 `PUT /api/gouo/tasks/:id` 创建大量很小的作品记录（均能通过配额检查），再对每条调用 `PATCH /api/gouo/tasks/:id/meta`，把 prompt、params、result_meta 填到接近 512 KB。

**影响**

`UpdateGouoTaskMeta` 只重新计算 `content_bytes`，不检查配额，GOUO-021 的配额可被绕过，数据库可被无限写大。

**建议修复**

更新前计算新旧字节差，超额返回 507。

**验收检查**

配额已满时，PATCH 使作品记录变大返回 507 且原内容不变；变小不受限制。

**代码依据**

[UpdateGouoTaskMeta](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/server/model/gouo_cloud.go#L571-L603)，对比 [UpsertGouoTask 的配额检查](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/server/model/gouo_cloud.go#L243)。基线为 main 0b9b54f。

**修复记录（2026-10-09）**

[PR #18](https://github.com/zhs1234/gouo-canvas/pull/18)，提交 [f5c1b41](https://github.com/zhs1234/gouo-canvas/commit/f5c1b41)。已运行：`TestGouoDocumentsAndTasksCountTowardStorageQuota` 新增 PATCH 超额被拒、原内容不变、缩小正常。合并并按上方验收检查完成验证前，不标记为已验证修复。

### GOUO-033 图片编辑的参考图和遮罩不受配额与单文件上限约束

优先级：P2。处理状态：已验证修复。验证状态：已验证（本地运行环境，main a496a11；2026-10-10 在 SQLite 与 PostgreSQL 16 上复跑通过，见"第三轮运行时回归"）。

**触发场景**

带 `X-Gouo-Task-Id` 发一次成功的图片编辑请求，附带多张大参考图或遮罩。

**影响**

参考图和遮罩按"付费生成结果"的方式入库，不检查配额，也不受单文件 25 MB 上限约束；超过 64 MB 的文件会被截断后保存。只付一次编辑的费用就能存入大量不计配额的数据。

**建议修复**

参考图和遮罩按普通上传处理：检查配额和单文件上限，超过时只记日志、不入库；生成结果仍不受配额限制。

**验收检查**

空间已满或文件超过上限时，编辑结果照常入库，参考图和遮罩不入库；正常情况下参考图照常保存。

**代码依据**

[recordGouoGeneration](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/server/relay/gouo-image.go#L194-L240)。基线为 main 0b9b54f。

**修复记录（2026-10-09）**

[PR #18](https://github.com/zhs1234/gouo-canvas/pull/18)，提交 [f5c1b41](https://github.com/zhs1234/gouo-canvas/commit/f5c1b41)。已运行：`TestRecordGouoGenerationStoresOutputsAndReferences` 新增空间已满、单文件超限两种情况。合并并按上方验收检查完成验证前，不标记为已验证修复。

### GOUO-034 回收站清理可能删掉刚被去重复用的图片

优先级：P2。处理状态：待验证。验证状态：已复现（单元测试，撤掉修复后失败），尚未在运行环境验证修复。

**触发场景**

用户重新上传一张 3 天前就有、当前没有被引用的图片（命中去重，返回旧记录），每小时一次的清理恰好在"上传"与"保存作品或文档"之间运行。

**影响**

清理按 `created_at` 保护近期图片，去重命中不刷新时间，图片记录和文件可能被删除；随后保存的作品或文档引用的图片永久 404。窗口很小。

**建议修复**

去重命中时刷新 `updated_at`，清理按 `updated_at` 判断。

**验收检查**

旧图片被重新上传后立即运行清理，图片记录和文件保留。

**代码依据**

[去重直接返回旧记录](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/server/model/gouo-asset-store.go#L66-L72)、[按 created_at 清理](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/server/model/gouo-trash.go#L138-L141)。基线为 main 0b9b54f。

**修复记录（2026-10-09）**

[PR #18](https://github.com/zhs1234/gouo-canvas/pull/18)，提交 [f5c1b41](https://github.com/zhs1234/gouo-canvas/commit/f5c1b41)。已运行：`TestPurgeGouoTrashKeepsReuploadedAsset`（撤掉修复后失败）、`TestPurgeGouoTrashAfterRetention`。合并并按上方验收检查完成验证前，不标记为已验证修复。

**补充复核（2026-10-10，main a496a116）**

PR #18 已修复“去重命中不刷新 updated_at”，但仍有另一段清理与同内容重传的竞态：purgeGouoUserTrash 在数据库删除后返回并释放素材锁，外层随后才删除物理文件。两者之间同用户重新上传同内容时，新记录会重新建立并复用旧路径；随后清理删除该路径，留下新记录指向不存在的文件。这不是原有“刷新 updated_at”验收能覆盖的时序。

证据：[锁在内层函数返回时释放](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/model/gouo-trash.go#L54-L74)、[外层删物理文件](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/model/gouo-trash.go#L59-L64)、[按同一用户和哈希路径复用已存在文件并新建记录](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/model/gouo-asset-store.go#L91-L143)。

候选修复位于 [8b0faa88](https://github.com/zhs1234/gouo-canvas/blob/8b0faa88c37da1af6e4f83cc6edb8317c82efea1/server/model/gouo-trash.go#L69-L173)：按用户锁覆盖数据库删除和物理文件删除。该分支未合并；本轮只读核对，未执行其测试。当前仍为待验证，不能写“主干完整修复”。锁是进程内锁，多实例共享素材盘的正确性仍未证明。

新增验收：在数据库记录删除完成、物理文件删除尚未执行处设确定性屏障，并发重传同内容，验证新记录和文件始终一致；再以两个进程共享数据库/素材盘验证。不得仅以普通顺序重传测试代替该时序。

**修复记录（2026-10-10，第三轮修复会话）**：修复在 [PR #25](https://github.com/zhs1234/gouo-canvas/pull/25)（按用户锁覆盖数据库删除和物理文件删除），并新增 `TestPurgeGouoTrashKeepsAssetTouchedDuringPurge`（清理事务挑出候选后、删除前刷新 updated_at，撤掉"删除时按 updated_at 过滤"后失败）及 GOUO-060 的用户行锁。上方要求的"数据库删除后、删文件前设屏障并发重传"的确定性测试和双进程验证尚未做；锁是进程内锁，多实例共享素材盘时文件删除与重传仍有窗口。

### GOUO-035 平台账号令牌明文留在本地存储和备份文件中

优先级：P1。处理状态：待验证。验证状态：已复现（单元测试，撤掉修复后失败），尚未在运行环境验证修复。

**触发场景**

平台模式下登录后，① 导出备份（"包含配置"默认勾选）；② 在共用电脑上退出登录。

**影响**

登录后下发的 `sys_playground` 令牌额度不限、不过期，可直接调用 `/v1` 消耗账号余额。它以 `settings.apiKey` 明文写入 localStorage（持久化只清了各配置档案中的 Key），退出登录后仍在，也会被写进备份文件。拿到备份文件或接触这台电脑的人可以用它花费该账号的余额。

**建议修复**

平台模式下持久化和导出时都清空所有 Key，登录时重新获取。可再考虑退出登录时由服务端轮换该令牌。

**验收检查**

平台模式下 localStorage 和导出的备份中都不含令牌；刷新页面、重新登录后仍可正常生成。

**代码依据**

[登录后写入令牌](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/src/components/BackendAuthGate.tsx#L32-L39)、[持久化只清档案 Key](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/src/store.ts#L475-L481)、[导出写入 settings](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/src/store.ts#L2429-L2432)、[令牌不限额不过期](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/server/controller/token.go#L102-L120)。基线为 main 0b9b54f。

**修复记录（2026-10-09）**

[PR #19](https://github.com/zhs1234/gouo-canvas/pull/19)，提交 [a32ef33](https://github.com/zhs1234/gouo-canvas/commit/a32ef33)。已运行：`store.test.ts` 新增"不持久化平台账号令牌"（撤掉修复后失败）。退出时轮换令牌未实现。合并并按上方验收检查完成验证前，不标记为已验证修复。

### GOUO-036 快速连续撤销会永久丢失最近的画布编辑

优先级：P1。处理状态：待验证。验证状态：已复现（单元测试，撤掉修复后失败），尚未在运行环境验证修复。

**触发场景**

按住 Ctrl/Cmd+Z（按键自动重复），或在画布较大、IndexedDB 写入较慢时连续点两次撤销。

**影响**

撤销要等保存完成才更新历史，第二次撤销读到旧历史，把同一步撤销两次，并把最新状态从重做列表中挤掉；最新编辑在内存和本地库中都不存在了，重做也回不去。

**建议修复**

在发起保存后立即同步更新历史。

**验收检查**

连续两次撤销不等保存完成，之后能逐步重做回最新状态。

**代码依据**

[undo / redo](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/src/stores/canvasStore.ts#L176-L191)。基线为 main 0b9b54f。

**修复记录（2026-10-09）**

[PR #19](https://github.com/zhs1234/gouo-canvas/pull/19)，提交 [a32ef33](https://github.com/zhs1234/gouo-canvas/commit/a32ef33)。已运行：`canvas/store.test.ts` 新增连续撤销测试（撤掉修复后失败）。合并并按上方验收检查完成验证前，不标记为已验证修复。

### GOUO-037 新开标签页把其他标签页正在生成的任务标为中断

优先级：P2。处理状态：待验证。验证状态：已复现（单元测试，撤掉修复后失败），尚未在运行环境验证修复。

**触发场景**

标签页 A 提交生成任务后仍在等待结果，同一账号新开标签页 B。

**影响**

B 启动时把所有 running 任务标为"请求中断"并写库。B 中显示失败并提供重试，按提示重试会新建付费请求，而 A 的原请求仍会成功；在 B 中对该任务做写操作还会用旧状态覆盖 A 写入的结果。

**建议修复**

执行任务期间持有该任务的 Web Lock，启动时跳过锁仍被其他标签页持有的任务。

**验收检查**

两个标签页中，A 执行中的任务在 B 中仍显示为生成中；没有标签页执行的 running 任务照常标为中断。

**代码依据**

[标记中断](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/src/store.ts#L1017-L1035)、[启动时写库](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/src/store.ts#L1394-L1416)。基线为 main 0b9b54f。

**修复记录（2026-10-09）**

[PR #19](https://github.com/zhs1234/gouo-canvas/pull/19)，提交 [a32ef33](https://github.com/zhs1234/gouo-canvas/commit/a32ef33)。已运行：`store.test.ts` 新增"其他标签页执行中的任务保持运行中"（撤掉修复后失败）。B 不会实时收到 A 的结果，刷新后显示最新状态。合并并按上方验收检查完成验证前，不标记为已验证修复。

### GOUO-038 平台模式下画布节点单独选择的模型必然提交失败

优先级：P2。处理状态：待验证。验证状态：代码确认，已补单元测试，尚未在运行环境验证修复。

**触发场景**

在画布配置节点里选一个与顶部选择器不同的模型，然后点生成。

**影响**

模型与全局不同时不传价格版本，报价校验每次都报"模型价格或能力已更新"，并多出一个错误节点；按节点选模型的功能不可用（不会扣费）。

**建议修复**

提交时传入画布上展示价格对应的价格版本。

**验收检查**

平台模式下按节点选择的模型可正常提交，扣费与画布显示的预计价格一致；价格变动后提交被拒。

**代码依据**

[不同模型不传版本](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/src/lib/imageTasks.ts#L119-L122)、[无版本即报价格变动](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/src/lib/gouoBackend.ts#L106-L120)、[画布传入节点模型](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/src/lib/canvas/generation.ts#L81-L82)。基线为 main 0b9b54f。

**修复记录（2026-10-09）**

[PR #19](https://github.com/zhs1234/gouo-canvas/pull/19)，提交 [a32ef33](https://github.com/zhs1234/gouo-canvas/commit/a32ef33)。已运行：`imageTasks.test.ts`、`canvas/generation.test.ts` 新增价格版本传递测试。合并并按上方验收检查完成验证前，不标记为已验证修复。

### GOUO-039 Agent 确认框点遮罩或按 Esc 关闭后会话卡住

优先级：P2。处理状态：待验证。验证状态：代码确认，已补单元测试，尚未在运行环境验证修复。

**触发场景**

Agent 在一条消息里请求超过 4 张图片，弹出确认框，用户点遮罩或按 Esc 关闭。

**影响**

关闭弹窗不会调用 `cancelAction`，工具调用一直等待，会话显示运行中，最长 180 秒后才以超时中断。

**建议修复**

监听弹窗状态，弹窗关闭即按取消处理。

**验收检查**

点遮罩、按 Esc、点取消都立即结束本次工具调用且不提交；点确认正常提交。

**代码依据**

[关闭不调用 cancelAction](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/src/components/ConfirmDialog.tsx#L69-L94)、[等待确认](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/src/lib/agent/tools.ts#L196-L219)。基线为 main 0b9b54f。

**修复记录（2026-10-09）**

[PR #17](https://github.com/zhs1234/gouo-canvas/pull/17)，提交 [0c445ee](https://github.com/zhs1234/gouo-canvas/commit/0c445ee)（与 GOUO-026 的费用显示同一 PR）。已运行：`tools.test.ts` 新增"关闭弹窗按取消处理"。合并并按上方验收检查完成验证前，不标记为已验证修复。

### GOUO-040 云端已清除的文档在离线设备上编辑后一直保存失败

优先级：P2。处理状态：待验证。验证状态：代码确认，已补单元测试，尚未在运行环境验证修复。

**触发场景**

设备 A 把画布移入回收站，设备 B 超过 3 天没打开；期间服务端已彻底删除该文档。B 上线后编辑这个画布。

**影响**

服务端记录已不存在，带旧版本号的保存被判为冲突且不返回当前版本，前端只会重抛，之后每次重试都失败，修改只留在本地。

**建议修复**

冲突且没有当前版本时，按新文档重新创建。

**验收检查**

模拟冲突且无当前版本时，下一次保存以版本 0 重新创建并记录新版本。

**代码依据**

[pushDocument](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/src/lib/serverDocuments.ts#L99-L128)、[冲突时 data 为空](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/server/controller/gouo_documents.go#L221-L234)。基线为 main 0b9b54f。

**修复记录（2026-10-09）**

[PR #19](https://github.com/zhs1234/gouo-canvas/pull/19)，提交 [a32ef33](https://github.com/zhs1234/gouo-canvas/commit/a32ef33)。已运行：`serverDocuments.test.ts` 新增重建测试。重建会让在其他设备删除的文档重新出现，以保留本地修改为先。合并并按上方验收检查完成验证前，不标记为已验证修复。

### GOUO-041 撤销后已完成的生成节点一直显示生成中

优先级：P2。处理状态：待验证。验证状态：已复现（单元测试，撤掉修复后失败），尚未在运行环境验证修复。

**触发场景**

点生成后在等待期间做了别的编辑，生成完成、结果回填后按撤销。

**影响**

撤销恢复出"生成中"的节点，回填只在任务列表变化时触发，节点会一直转圈到刷新页面；用户可能以为没生成好而再次付费。另外，任务错误信息超过 10 万字符时回填会整体失败。

**建议修复**

历史变化后重新回填；回填时截断过长的错误信息。

**验收检查**

撤销后节点恢复为成功并显示原图片；超长错误信息不影响其他节点回填。

**代码依据**

[撤销直接套用旧快照](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/src/stores/canvasStore.ts#L176-L191)、[只在任务变化时回填](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/src/lib/canvas/generation.ts#L180-L184)、[错误信息未截断](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/src/lib/canvas/generation.ts#L167)。基线为 main 0b9b54f。

**修复记录（2026-10-09）**

[PR #19](https://github.com/zhs1234/gouo-canvas/pull/19)，提交 [a32ef33](https://github.com/zhs1234/gouo-canvas/commit/a32ef33)。已运行：`canvas/generation.test.ts` 新增撤销后回填测试（撤掉修复后失败）。合并并按上方验收检查完成验证前，不标记为已验证修复。

### GOUO-042 画布重试直接新建付费请求，不经确认

优先级：P2。处理状态：待验证。验证状态：代码确认，尚未在运行环境验证修复。

**触发场景**

画布中失败的输出节点（包括网络中断、结果待核对等情况）点"重试"。

**影响**

会生成新的请求标识并立即提交，没有作品列表重试时的"原任务可能已扣费"确认，用户一键就可能再付一次钱。

**建议修复**

平台模式下与作品列表的重试一致，先确认并显示预计扣费。

**验收检查**

平台模式下点重试先弹确认框，显示张数和预计扣费；取消后不出现新任务。

**代码依据**

[generate](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/src/components/canvas/canvasEditor.tsx#L566-L582)、[重试按钮](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/src/components/canvas/canvasEditor.tsx#L959-L960)、[作品列表重试的确认](https://github.com/zhs1234/gouo-canvas/blob/0b9b54ff49f2388d61f23c4b4dd22ad490e27593/src/store.ts#L2010-L2040)。基线为 main 0b9b54f。

**修复记录（2026-10-09）**

[PR #19](https://github.com/zhs1234/gouo-canvas/pull/19)，提交 [a32ef33](https://github.com/zhs1234/gouo-canvas/commit/a32ef33)。确认框属于界面交互，未写自动化测试，需要在浏览器中验证。合并并按上方验收检查完成验证前，不标记为已验证修复。

## 2026-10-10 新增问题（GOUO-043 至 GOUO-059）

以下17项编号接续既有GOUO-042，须与既有条目和本轮顶部计数一同维护。均基于main a496a116fa75e7d7db1e316803a5551d5682894f 的独立源代码阅读；候选分支均未合并。测试源码不等于执行结果。本轮未运行仓库测试、浏览器验收或模型/支付请求。

### GOUO-043 GitHub 改名后的旧用户名可覆盖数字身份匹配

优先级：P1。处理状态：修复中（候选分支未合并，待验证）。验证状态：代码确认，本轮未运行复现或验收。

**触发场景**

GitHub 登录开启且旧用户名回退未关闭。已有本地账号绑定 GitHub 用户名 A 和数字 ID X；该 GitHub 用户改名后，另一个数字 ID Y 的身份注册了 A。新身份的数字 ID 未匹配账号时，main 仍用旧用户名 A 匹配原账号，不要求原账号的数字 ID 为空。

**影响**

新持有者可以登录原账号，包括原账号已有的角色和数据。main 对已存在账号的数字 ID、用户名更新还只写在内存对象中，并未持久化，旧账号不能靠正常登录完成可靠迁移。这与 GOUO-002 的空邮箱匹配根因不同。

**代码依据**

[数字 ID 未命中后仍按用户名匹配](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/controller/github.go#L188-L213)、[更新仅在内存且随后登录](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/controller/github.go#L308-L332)。

**候选修复与限制**

候选提交 [7f703bcd4263936da91487f69614e1dac643fb06](https://github.com/zhs1234/gouo-canvas/commit/7f703bcd4263936da91487f69614e1dac643fb06) 将用户名回退限制为数字 ID 为 0/NULL 的旧账号，并持久化数字 ID：[旧账号查询](https://github.com/zhs1234/gouo-canvas/blob/7f703bcd4263936da91487f69614e1dac643fb06/server/model/user.go#L343-L354)、[持久化](https://github.com/zhs1234/gouo-canvas/blob/7f703bcd4263936da91487f69614e1dac643fb06/server/controller/github.go#L309-L330)。但是，尚未迁移的旧账号仍可能被回收用户名的现持有者匹配，不能把该补丁描述成消除了所有改名接管。需明确旧账号的安全迁移方式，或关闭用户名回退并要求验证身份后重新绑定。

**验收检查**

已绑定数字 ID X 的账号不能被相同用户名、不同 ID Y 登录；X 改名后仍进入原账号；旧账号成功迁移后数字 ID 写入数据库，后续不能再被回收用户名登录；为尚未迁移旧账号明确并验证安全处理方式。检查存在的 [TestGitHubLoginDoesNotMatchRenamedUsername](https://github.com/zhs1234/gouo-canvas/blob/7f703bcd4263936da91487f69614e1dac643fb06/server/controller/user_test.go#L198-L215)，本轮未运行；该测试不覆盖 HTTP 登录后的 ID 持久化。

**修复记录（2026-10-10，第三轮修复会话）**：[PR #20](https://github.com/zhs1234/gouo-canvas/pull/20)，单元测试 `TestGitHubLoginDoesNotMatchRenamedUsername` 撤掉修复后失败。真实 GitHub OAuth 未验证。 未迁移的旧账号（从未记录数字 ID）仍按用户名匹配，被回收用户名的现持有者仍可能登录；需决定关闭用户名回退或要求验证后重新绑定，本 PR 未处理。

### GOUO-044 OIDC 新账号接受未验证或已占用邮箱

优先级：P1。处理状态：修复中（候选分支未合并，待验证）。验证状态：代码确认，本轮未运行复现或验收。

**触发场景**

开启 OIDC 与注册，身份提供方允许声明尚未验证的邮箱。新 OIDC 主体的用户名未被占用时，main 直接把字符串 email 声明写入账号，不检查 email_verified，也不检查邮箱是否已被占用。

**影响**

攻击者可先创建带他人邮箱的账号。如果真正邮箱持有者之后首次经 GitHub 登录，GitHub 的已验证邮箱回退可能将其关联到攻击者仍能用 OIDC 登录的账号；若邮箱已有本地账号，则可以形成重复邮箱，让按邮箱登录、找回密码或关联账号的行为混淆。这里不声称仅凭未验证邮箱即可直接登录任意已存在账号。根因是 OIDC 邮箱信任边界，区别于 GOUO-017 的用户名静默绑定，也区别于 GOUO-020 的注册验证码重复使用。

**代码依据**

[OIDC 邮箱直接写入](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/controller/oidc.go#L151-L193)、[GitHub 按非空邮箱关联](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/controller/github.go#L205-L211)、[email 非唯一索引](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/model/user.go#L22-L33)、[Insert 只检查用户名](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/model/user.go#L143-L160)、[按邮箱重置取首个账号](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/model/user.go#L388-L397)。

**候选修复与限制**

候选提交 [7f703bcd4263936da91487f69614e1dac643fb06](https://github.com/zhs1234/gouo-canvas/commit/7f703bcd4263936da91487f69614e1dac643fb06) [仅采用已验证且未占用的非空邮箱](https://github.com/zhs1234/gouo-canvas/blob/7f703bcd4263936da91487f69614e1dac643fb06/server/controller/oidc.go#L171-L186)。查询与插入不在同一原子唯一约束下，并发的不同主体仍可能都通过空闲检查；没有清理历史错误邮箱或关联。该提交没有新增专门覆盖 OIDC 邮箱声明的测试。

**验收检查**

email_verified 缺失、false、类型错误、空邮箱均不能占用邮箱；已被使用的邮箱不能再次写入；新鲜且已验证邮箱正常保存；不同 subject 并发使用同一邮箱不会产生重复；历史错误绑定另行检查。用真实邮箱持有者首次 GitHub 登录验证不会进入他人预先占用的 OIDC 账号。

**修复记录（2026-10-10，第三轮修复会话）**：[PR #20](https://github.com/zhs1234/gouo-canvas/pull/20)，单元测试覆盖。真实 OIDC 未验证。

### GOUO-045 管理员可越级读取及转移模型调用令牌

优先级：P1。处理状态：修复中（候选分支未合并，待验证）。验证状态：代码确认，本轮未运行复现或验收。

**触发场景**

普通管理员调用 GET /api/token/admin/search 或 PUT /api/token/admin。列表不按令牌所有者角色过滤，Token.key 原样返回；修改接口只验证目标用户存在，没有检查当前所有者和转入账号的角色。

**影响**

普通管理员可获得 root、同级管理员的模型调用密钥（包括其 sys_playground 令牌）、修改其令牌设置，或把自己已知密钥的令牌转给 root，使后续调用归到目标账号。这里的 Token.key 用于中继调用；不能把它表述为直接取得通过 RootAuth 的 User.access_token。与 GOUO-001 管理令牌字段泄漏、GOUO-028 直接调整额度和 GOUO-030 元数据列表不同，建议单独登记。

**代码依据**

[管理员路由](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/router/api-router.go#L242-L247)、[key 序列化](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/model/token.go#L29-L45)、[无角色筛选的列表](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/model/token.go#L128-L148)、[转移只检查用户存在](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/controller/token.go#L393-L429)、[写入 owner](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/controller/token.go#L458-L475)、[中继身份取 token.UserId](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/middleware/auth.go#L117-L140)。

**候选修复**

候选提交 [f96b5af4bf2b7991908f0403fab04d47a31790e5](https://github.com/zhs1234/gouo-canvas/commit/f96b5af4bf2b7991908f0403fab04d47a31790e5) 对列表和修改加入低角色范围；[当前所有者与新所有者都检查](https://github.com/zhs1234/gouo-canvas/blob/f96b5af4bf2b7991908f0403fab04d47a31790e5/server/controller/token.go#L424-L431)。修复不会撤销此前已被查看的密钥，是否轮换需另行决定与授权。

**验收检查**

管理员无筛选、指定 user_id、指定 token_id 的列表均不返回 root、同级和自己的密钥；越级修改、status_only、向高/同级账号转移均被拒且数据库及缓存保持原状；对普通用户和 root 合法操作保持正常；确认转移后计费身份与缓存一致。新增 [TestAdminTokenEndpointsRespectRoleScope](https://github.com/zhs1234/gouo-canvas/blob/f96b5af4bf2b7991908f0403fab04d47a31790e5/server/controller/admin_token_scope_test.go#L19-L76) 是直接设置角色再调用控制器，本轮未运行；不能据此声称真实路由、中继消费或 Redis 已验收。

**修复记录（2026-10-10，第三轮修复会话）**：[PR #23](https://github.com/zhs1234/gouo-canvas/pull/23)，单元测试 `controller/admin_token_scope_test.go` 撤掉修复后失败；本地运行环境 main 构建复现，修复构建通过（SQLite 与 PostgreSQL）。

### GOUO-046 Stripe 回调允许空签名密钥参与验签

优先级：P1。处理状态：修复中（候选分支未合并，待验证）。验证状态：代码确认，本轮未运行复现或验收。

**触发场景**

Stripe 网关已存在，其配置中的 webhook_secret 被更新为空或遗漏；配置更新不会重新调用 CreatedPay。main 在回调中解析配置后直接把空字符串交给 webhook.ConstructEvent，没有拒绝空签名密钥。

**影响**

Stripe SDK 使用该字符串作为 HMAC 密钥；空密钥是可知值。可构造满足订单号、支付金额和币种等本地检查的假支付通知，使未实际付款的订单被入账。需同时存在空密钥配置这一前提，不能写成所有 Stripe 网关默认可伪造。区别于 GOUO-005 金额截断和 GOUO-006 多商户配置混用。

**代码依据**

[回调未检查空密钥](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/payment/gateway/stripe/payment.go#L171-L188)、[修改配置直接落库](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/controller/payment.go#L95-L119)、[订单金额、币种及入账检查](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/model/order.go#L71-L120)。依赖固定为 [stripe-go v80.2.1](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/go.mod#L44)，其 [HMAC 使用 secret 原始字节](https://github.com/stripe/stripe-go/blob/v80.2.1/webhook/client.go#L44-L55) 和 [验签比较](https://github.com/stripe/stripe-go/blob/v80.2.1/webhook/client.go#L271-L291) 已静态核对。

**候选修复与限制**

候选提交 [c6aa0d5ec95fd7adffbc607b2005da5496e1f52e](https://github.com/zhs1234/gouo-canvas/commit/c6aa0d5ec95fd7adffbc607b2005da5496e1f52e) [在验签前拒绝空签名密钥](https://github.com/zhs1234/gouo-canvas/blob/c6aa0d5ec95fd7adffbc607b2005da5496e1f52e/server/payment/gateway/stripe/payment.go#L178-L193)。它没有在配置更新和新下单前阻止该错误配置；修复后误配网关仍可能收款但回调被拒，配置完整性仍需检查。

**验收检查**

空值和缺失值配置的伪造回调不能入账；正确签名正常入账，错误签名、金额或币种不匹配仍失败；重复回调只入账一次；配置更新与下单对缺失签名密钥有明确处理。新增 [TestStripeCallbackGatewayEdgeCases 的空密钥用例](https://github.com/zhs1234/gouo-canvas/blob/c6aa0d5ec95fd7adffbc607b2005da5496e1f52e/server/controller/payment_callback_test.go#L52-L56) 本轮未运行，也不是 Stripe 沙箱或真实付款验证。

**修复记录（2026-10-10，第三轮修复会话）**：[PR #22](https://github.com/zhs1234/gouo-canvas/pull/22)，单元测试覆盖。Stripe 创建网关需联网，未做端到端验证。

### GOUO-047 图片编辑重复单值字段导致校验与上游语义不一致

优先级：P1。处理状态：修复中（候选分支未合并）。验证状态：静态代码确认；未在本轮运行环境复现。

触发条件：已认证用户向 /v1/images/edits 提交重复的 n、model 等本应单值的 multipart 字段，上游按与 Gin 单值绑定不同的规则解析重复值。主干按绑定后的单值决定模型与输出限制，但无映射时转发原始请求，有映射时仍转发全部非 model 字段值。

影响：在上游采用后值等不同解析规则的条件下，可绕过已校验的输出数量或模型选择，实际生成语义与本地限额/计费使用的值不一致。是否可实际多出图或跨模型取决于上游解析，不写成所有供应商均可绕过。此项不同于 GOUO-015 的“映射时丢参数”，也不同于 GOUO-031 的“其他 API 路由未计费”。

代码依据：[绑定入口](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/common/gin.go#L16-L37)、[图片编辑绑定](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/relay/image-edits.go#L24-L43)、[按解析后的 n 检查](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/relay/gouo-image.go#L119-L139)、[原始请求和全部表单值转发](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/providers/openai/image_edits.go#L57-L118)。

候选修复：[a8a52dd07adcc798ed4951ebcb56bca3d87c4ae7](https://github.com/zhs1234/gouo-canvas/blob/a8a52dd07adcc798ed4951ebcb56bca3d87c4ae7/server/relay/gouo-image.go#L103-L116)，拒绝重复单值表单及重复 mask，保留合法多张 image[]。已看到新增测试源码，但没有本轮执行或 CI 通过记录。

验收：无映射/有映射各测试重复 n、model、quality、mask；到达上游之前明确拒绝，未派发、未预扣；合法多张参考图与 GOUO-015 的参数保真用例仍成功。

**修复记录（2026-10-10，第三轮修复会话）**：[PR #21](https://github.com/zhs1234/gouo-canvas/pull/21)，单元测试撤掉修复后失败；本地运行环境 main 构建返回 200 出图，修复构建返回 400。

### GOUO-048 Midjourney 通知可改写他人任务，公开图片代理可请求内网

优先级：P1。处理状态：修复中（候选分支未合并）。验证状态：静态代码确认；未在本轮运行环境复现。

触发条件：MJ 路由可用；有可通过 MJ 认证/分发的令牌并知道任务 ID。/mj/notify 仅凭任务 ID 全局取任务，没有按调用者所属账号限定，并把传入 imageUrl 写入记录。随后 /mj/image/:id 在注册认证中间件之前暴露，直接 http.Get 记录里的 URL。

影响：令牌用户可改写其他账号任务的状态和图片地址；任务所有者也可为自己的任务写入内网 URL，再通过图片代理触发服务端请求并把响应返回。主干该路径没有连接时公网检查、超时或响应大小限制。实际利用条件包括 MJ 配置、有效令牌及目标可达性，未推断生产已暴露。此为独立 MJ 路由，GOUO-007、018 的已修复下载器没有覆盖它。

代码依据：[公开图片路由与后续认证中间件](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/router/relay-router.go#L78-L93)、[按全局 ID 更新图片 URL](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/relay/midjourney/relay-mj.go#L66-L103)、[直接下载并回传](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/relay/midjourney/relay-mj.go#L27-L64)。

候选修复：[f9dc70333ce379b27a73e91a04d3384d684a1373](https://github.com/zhs1234/gouo-canvas/blob/f9dc70333ce379b27a73e91a04d3384d684a1373/server/relay/midjourney/relay-mj.go#L27-L101)，通知按用户 ID 限定，下载采用公网 client、30 秒超时及 64 MiB 截断。分支未合并；看到 TestMidjourneyNotifyAndImageProxyBoundaries 源码，未执行。64 MiB 以上目前是直接截断成功流，而非明确返回超限错误，需验收确认消费者行为。

验收：账号 B 无法通知更新 A 的任务；A 正常通知仍可工作。记录含回环、私网、链路本地、重定向到内网及 DNS 重绑定目标时，目标收到 0 次请求；公网图片正常；超时、64 MiB 边界及非200错误体受限，不泄露内网响应。验证真实 MJ 回调凭据与任务 owner 匹配。

**修复记录（2026-10-10，第三轮修复会话）**：[PR #24](https://github.com/zhs1234/gouo-canvas/pull/24)，单元测试撤掉修复后失败；本地运行环境 main 构建返回 200 和内网图片，修复构建返回 500 `http_get_image_failed`。

### GOUO-049 改密与重置按字节计算长度，与注册规则不一致

优先级：P2。处理状态：修复中（候选分支未合并，待验证）。验证状态：代码确认，本轮未运行复现或验收。

**触发场景与影响**

新密码包含中文等多字节字符。改密、重置以 len(string) 检查 8–20，实际检查的是 UTF-8 字节数；例如“密码12”共 4 个字符、8 个字节能通过长度检查，8 个汉字却因 24 字节被拒绝。注册使用字符串字符数校验，造成规则不一致。本项不同于 GOUO-027 的重置链接邮箱编码。

**代码依据**

[改密长度](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/controller/user.go#L527-L548)、[重置长度](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/controller/misc.go#L190-L213)、[注册校验](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/controller/user.go#L146-L160)、[密码字段规则](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/model/user.go#L22-L29)。

**候选修复与限制**

候选提交 [7f703bcd4263936da91487f69614e1dac643fb06](https://github.com/zhs1234/gouo-canvas/commit/7f703bcd4263936da91487f69614e1dac643fb06) 在两个入口改用 utf8.RuneCountInString。仍需统一处理 bcrypt 的 72 字节上限：19–20 个四字节字符会通过新字符数校验，但 [Password2Hash](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/common/crypto.go#L3-L8) 调用的 bcrypt 会报错；不能承诺所有 8–20 字符密码均成功。依赖固定为 [x/crypto v0.40.0](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/go.mod#L49)，其 [72 字节检查](https://github.com/golang/crypto/blob/v0.40.0/bcrypt/bcrypt.go#L85-L98) 已静态核对。

**验收检查**

注册、改密和重置分别覆盖 7/8/20/21 个 ASCII 字符、中文及混合字符；“密码12”被拒绝；8–20 个普通汉字按相同规则处理；超过 bcrypt 字节上限给出明确且一致的输入错误。[TestChangePasswordCountsCharacters](https://github.com/zhs1234/gouo-canvas/blob/7f703bcd4263936da91487f69614e1dac643fb06/server/controller/user_test.go#L217-L229) 仅覆盖改密短字符场景，本轮未运行，重置和长多字节边界尚无新增覆盖。

**修复记录（2026-10-10，第三轮修复会话）**：[PR #20](https://github.com/zhs1234/gouo-canvas/pull/20)，单元测试 `TestChangePasswordCountsCharacters` 撤掉修复后失败；本地运行环境中 main 构建可改成功，修复构建拒绝。

### GOUO-050 无关 Stripe 会话被当成结算失败

优先级：P2。处理状态：修复中（候选分支未合并，覆盖不完整，待验证）。验证状态：代码确认，本轮未运行复现或验收。

**触发场景与影响**

同一 Stripe 账号的回调端点接收其他网关或其他业务的 checkout.session.completed/async_payment_succeeded 事件。对于合法签名且 paid 的会话，订单号为空时会进入无效参数错误；订单不存在或属于另一网关时，结算查询返回 RecordNotFound。控制器均按失败回应，导致无关通知成为错误及重试噪声。本项不代表跨网关错误入账，main 的 gateway_id 仍阻止跨网关结算。

**代码依据**

[将空 client_reference_id 继续转换为通知](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/payment/gateway/stripe/payment.go#L190-L216)、[所有结算错误返回 500](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/controller/order.go#L131-L140)、[空参数及本网关订单匹配](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/model/order.go#L72-L93)。

**候选修复与限制**

候选提交 [c6aa0d5ec95fd7adffbc607b2005da5496e1f52e](https://github.com/zhs1234/gouo-canvas/commit/c6aa0d5ec95fd7adffbc607b2005da5496e1f52e) 忽略空订单号，并对 [RecordNotFound 确认收到而不入账](https://github.com/zhs1234/gouo-canvas/blob/c6aa0d5ec95fd7adffbc607b2005da5496e1f52e/server/controller/order.go#L136-L146)。但 [缺少 payment_intent 的检查仍早于空订单号判断](https://github.com/zhs1234/gouo-canvas/blob/c6aa0d5ec95fd7adffbc607b2005da5496e1f52e/server/payment/gateway/stripe/payment.go#L203-L214)：合法签名、paid、没有本系统引用且没有 payment_intent 的无关会话仍返回 400。因此不能记为完全覆盖无关会话。RecordNotFound 的确认逻辑也应用于其他支付网关，需要确认是否会掩盖错配的回调地址或数据库缺单。

**验收检查**

空引用、未知引用、属于另一网关的有效签名事件均得到适当确认且余额不变；额外覆盖缺少 payment_intent、无关模式和零金额的事件，避免在识别归属前被本地结算校验拒绝；本系统订单的真实数据库错误保持可重试，错误金额、币种、签名不能入账；异常忽略有可查日志。新增 [TestStripeCallbackGatewayEdgeCases 的外来订单用例](https://github.com/zhs1234/gouo-canvas/blob/c6aa0d5ec95fd7adffbc607b2005da5496e1f52e/server/controller/payment_callback_test.go#L58-L65) 本轮未运行；测试构造器总是包含 payment_intent，未覆盖上述缺口。

**修复记录（2026-10-10，第三轮修复会话）**：[PR #22](https://github.com/zhs1234/gouo-canvas/pull/22)，单元测试覆盖；本地运行环境用支付宝模拟验证：跨网关回调确认收到但不结算，原网关回调正常入账。 补充提交（同在 [PR #22](https://github.com/zhs1234/gouo-canvas/pull/22)）：没有订单号的会话在检查 payment_intent 之前确认收到，测试新增无 payment_intent 的零金额外来会话，撤掉后失败。RecordNotFound 确认收到时写系统日志，错配回调地址可从日志发现；其他网关同样适用，是否需要告警由用户决定。

### GOUO-051 单次对话远程图片总量没有内存预算

优先级：P2。处理状态：修复中（候选分支未合并）。验证状态：静态代码确认；未做资源压测。

触发条件：使用会把远程 URL 下载转为 base64 的渠道，例如 Claude；请求包含很多远程图片 URL。main 只有每个下载 20 MiB 上限，未在对话请求层限制远程图片数或累计下载字节；转换后的各张 base64 同时留在请求对象中。

影响：小型 URL 列表可放大为较高内存占用，单用户或并发请求可耗尽进程内存。与 GOUO-018 的 SSRF 根因不同。

代码依据：[主干请求校验没有图片预算](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/relay/chat.go#L37-L64)、[逐张转为 base64 并累积](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/providers/claude/chat.go#L310-L345)、[单文件限制](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/common/image/http.go#L29-L31)、[完整读入与编码](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/common/image/image.go#L35-L47)。

候选修复：[f9dc7033 的最多32张限制](https://github.com/zhs1234/gouo-canvas/blob/f9dc70333ce379b27a73e91a04d3384d684a1373/server/relay/chat.go#L52-L65)。仅数量限制仍允许约 640 MiB 原始数据以及更大的 base64 表示，不应直接标记“内存耗尽风险已完整消除”。需考虑请求累计字节预算和并发限制。TestChatRequestLimitsRemoteImages 只有源码，未运行。

验收：32/33张、少量大图、多消息累计图片、并发请求、超时与取消时的内存释放；预期超限在昂贵下载前拒绝，保留合理合法请求的兼容性，并记录压测预算。

**修复记录（2026-10-10，第三轮修复会话）**：[PR #24](https://github.com/zhs1234/gouo-canvas/pull/24)，单元测试 `relay/chat_images_test.go` 撤掉修复后失败。另把 `::/96`、`2002::/16`、`64:ff9b:1::/48` 视为非公网地址。

### GOUO-052 收藏夹及收藏关系不计配额且数量无限制

优先级：P2。处理状态：修复中（候选分支未合并）。验证状态：静态代码确认，未运行资源或并发测试。

触发条件：开启云端作品库，有效账号反复创建不同 ID 的收藏夹。当前配额只累加素材、任务文本和文档文本，收藏夹/关系不计入；创建接口只检查名称和 ID 长度，不限制数量。它是 GOUO-021 已验收文档/任务配额之外的新对象范围，不能据此抹去原测试结果，也不能将原“已验证”扩展到收藏夹。

影响：可持续增加数据库记录，绕过账号空间配额；过多收藏夹还会放大列举、同步及清理成本。

代码依据：[配额统计表列表](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/model/gouo_cloud.go#L126-L144)、[无数量限制创建](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/controller/gouo_cloud.go#L534-L557)。

候选修复：[8b0faa88 的每账号500个限制](https://github.com/zhs1234/gouo-canvas/blob/8b0faa88c37da1af6e4f83cc6edb8317c82efea1/server/controller/gouo_cloud.go#L547-L569)，包含回收站。新增 TestGouoCollectionCountLimit 源码只覆盖顺序达到500后拒绝及已有项改名；计数与插入未在同一锁/事务中，不能声称并发严格限额已验证。

验收：499/500/501 个、回收站也占数量、已有项改名不受影响；并发创建不得跨越批准的上限；明确已有超量账号的迁移策略及收藏关系的规模约束。未通过并发验收前保持待验证。

**修复记录（2026-10-10，第三轮修复会话）**：[PR #25](https://github.com/zhs1234/gouo-canvas/pull/25)，单元测试 `TestGouoCollectionCountLimit` 撤掉修复后失败。

### GOUO-053 回收站清理单账号错误中止其余账号，并与全站出图共用锁

优先级：P2。处理状态：修复中（候选分支未合并）。验证状态：静态代码确认，未运行故障注入。

触发条件：清理某个账号遇到数据库/文件删除错误，或账号存在大量过期收藏夹、文档和素材。main 对任一用户的错误立即返回；收藏夹删除的 IN 列表未分批；清理与所有账号素材写入共用一个全局互斥锁。

影响：一个账号的清理失败可跳过本轮剩余账号；大量记录扫描期间所有账号的上传和已付费图片入库会等待同一把锁。原 GOUO-022 单账号顺序验收不证明跨账号故障隔离。

代码依据：[遇错退出和外层删除](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/model/gouo-trash.go#L54-L66)、[全局锁](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/model/gouo-trash.go#L69-L75)、[未分批收藏夹列表](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/model/gouo-trash.go#L102-L113)、[所有账号入库共用锁](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/model/gouo-asset-store.go#L39-L65)。

候选修复：[按用户锁](https://github.com/zhs1234/gouo-canvas/blob/8b0faa88c37da1af6e4f83cc6edb8317c82efea1/server/model/gouo-asset-store.go#L39-L48)、[继续其他账号和分批删除](https://github.com/zhs1234/gouo-canvas/blob/8b0faa88c37da1af6e4f83cc6edb8317c82efea1/server/model/gouo-trash.go#L54-L116)。TestPurgeGouoTrashContinuesAfterOneUserFails 已存在但本轮未运行。仍存在“数据库记录已删除、物理文件删除失败”的孤儿文件恢复问题，候选补丁只保障其他账号继续，不提供失败文件重试清单。

验收：固定先让账号A发生删除失败，再检查B/C仍被清理；大量收藏夹不超过数据库参数上限；A清理期间B正常生成/上传不被全局锁阻塞；验证失败物理文件的重试或巡检回收策略；原3天保留期与共享引用保护不变。

**修复记录（2026-10-10，第三轮修复会话）**：[PR #25](https://github.com/zhs1234/gouo-canvas/pull/25)，单元测试 `TestPurgeGouoTrashContinuesAfterOneUserFails` 撤掉修复后失败。

### GOUO-054 清空本地任务后，增量游标阻止旧云作品重新下载

优先级：P2。处理状态：修复中（候选分支未合并，仍有并发覆盖缺口）。验证状态：代码确认；本轮未运行测试或浏览器验收。

**触发场景**

平台云作品库已同步过任务，用户在数据设置中清空本地任务，再刷新云作品库。

**影响**

任务表和图片缓存被清空，但 `tasks:seen`、`tasks:hidden:seen` 保留。旧云作品更新时间不超过游标，被增量读取跳过；云端数据仍在，本地列表无法通过普通同步完整恢复。

**代码依据**

main 的[清空操作](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/src/store.ts#L2315-L2329)未清理同步游标；[增量读取](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/src/lib/serverLibrary.ts#L217-L238)跳过不晚于已见时间的作品。

**候选修复与剩余缺口**

候选提交 e6c292f116f48408797162fb578019188fa2ae71 在[清空后重置并刷新](https://github.com/zhs1234/gouo-canvas/blob/e6c292f116f48408797162fb578019188fa2ae71/src/store.ts#L2333-L2348)。

仍存在代码可推导的并发缺口：旧 `loadTasks` 已读到游标 N、正在等待响应时清空数据并重置为 0；新刷新因 `refreshing` 已存在而复用旧任务，旧任务随后仍按 N 过滤并写回 N。参见[旧游标读取及回写](https://github.com/zhs1234/gouo-canvas/blob/e6c292f116f48408797162fb578019188fa2ae71/src/lib/serverLibrary.ts#L218-L238)、[重置与刷新合并](https://github.com/zhs1234/gouo-canvas/blob/e6c292f116f48408797162fb578019188fa2ae71/src/lib/serverLibrary.ts#L258-L272)。应使清空后的全量同步排在旧同步之后，或通过同步代次使旧游标回写失效。

分支已有[顺序清空后恢复测试](https://github.com/zhs1234/gouo-canvas/blob/e6c292f116f48408797162fb578019188fa2ae71/src/lib/serverLibrary.test.ts#L132-L142)，未覆盖上述在途刷新。本轮仅阅读，未执行。

**验收检查**

正常清空后恢复全部可见作品及回收站作品；在云请求被延迟时清空，释放旧响应后仍完整恢复，且旧刷新不能覆盖重置后的游标。关闭云作品库时不产生错误恢复请求。

**修复记录（2026-10-10，第三轮修复会话）**：[PR #26](https://github.com/zhs1234/gouo-canvas/pull/26)，单元测试撤掉修复后失败。 补充修复：清空时递增游标代次，旧读取不再写回游标，重置后的刷新排在旧读取之后从头读取；新增并发测试，撤掉后失败。

### GOUO-055 已彻底删除的收藏夹被离线设备重新创建

优先级：P2。处理状态：修复中（候选分支未合并，已上传但未记录的收藏夹仍有缺口）。验证状态：代码确认；本轮未运行测试或浏览器验收。

**触发场景**

设备 A 保留收藏夹；设备 B 将该收藏夹隐藏，超过保留期后服务端彻底清除；A 此后重新同步。

**影响**

前端把“本地存在、服务端不存在”一律当作尚未上传的新收藏夹，重新 PUT，使用户已删除的收藏夹再次出现。

**代码依据**

main [缺失即补交的判断](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/src/lib/serverLibrary.ts#L241-L253)；服务端[实际删除收藏夹记录](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/server/model/gouo-trash.go#L102-L113)。

**候选修复与剩余缺口**

候选提交 e6c292f116f48408797162fb578019188fa2ae71 [记录并检查 `collections:seen`](https://github.com/zhs1234/gouo-canvas/blob/e6c292f116f48408797162fb578019188fa2ae71/src/lib/serverLibrary.ts#L241-L254)，避免重建此前读取过的服务端收藏夹。

但[订阅路径直接上传新收藏夹](https://github.com/zhs1234/gouo-canvas/blob/e6c292f116f48408797162fb578019188fa2ae71/src/lib/serverLibrary.ts#L286-L300)成功后没有更新 `collections:seen`。如果该夹在下一次刷新前已于别处删除并清除，仍会被当作本地新建而补交。升级时已有本地收藏夹、却没有这项新历史记录，也未被覆盖。应保存可靠的上传确认状态，并明确旧数据迁移与删除记录策略。

分支已有[“曾在刷新中读取过”的回归测试](https://github.com/zhs1234/gouo-canvas/blob/e6c292f116f48408797162fb578019188fa2ae71/src/lib/serverLibrary.test.ts#L144-L156)，未覆盖订阅上传后的情形。本轮未执行。

**验收检查**

分别覆盖刷新读取过的收藏夹、订阅上传成功但未再次刷新的收藏夹、升级前已有收藏夹；被服务端清除的旧夹不复活，真正未上传的新夹仍能补交。

**修复记录（2026-10-10，第三轮修复会话）**：[PR #26](https://github.com/zhs1234/gouo-canvas/pull/26)，单元测试撤掉修复后失败。 补充修复：本设备上传成功的收藏夹立即记入 collections:seen；新增测试，撤掉后失败。升级前已有、没有记录的本地收藏夹仍会补交（保守保留用户数据），属已知限制。

### GOUO-056 旧标签页持久化覆盖另一页的收藏夹变化

优先级：P2。处理状态：修复中（候选分支未合并，默认收藏夹单独变化仍未同步）。验证状态：代码确认；本轮未运行测试或浏览器验收。

**触发场景**

同一账号打开 A、B 两页。A 新建、改名或删除收藏夹；B 仍持有旧内存状态，随后发生任意会持久化 store 的操作。

**影响**

B 将旧收藏夹列表写回同一个 localStorage 项，覆盖 A 已保存的变化。重新打开时可能丢失新建或改名，也可能恢复已删除收藏夹。

**代码依据**

main [持久化完整收藏夹列表与默认项](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/src/store.ts#L477-L500)，[所有标签页使用同一账号存储项](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/src/store.ts#L983-L991)，尚无候选提交所加的跨页收藏夹监听。

**候选修复与剩余缺口**

候选提交 e6c292f116f48408797162fb578019188fa2ae71 [监听 storage 并接收收藏夹变化](https://github.com/zhs1234/gouo-canvas/blob/e6c292f116f48408797162fb578019188fa2ae71/src/store.ts#L996-L1011)。

监听器在收藏夹数组相同时直接返回，没有比较 `defaultFavoriteCollectionId`。因此 A 仅切换默认收藏夹时 B 不更新；B 下一次持久化仍可覆盖默认项。应将默认收藏夹也纳入等值判断，并验证双向事件不会反复写回。

分支已有[列表与默认项同时变化的测试](https://github.com/zhs1234/gouo-canvas/blob/e6c292f116f48408797162fb578019188fa2ae71/src/store.test.ts#L763-L779)，没有默认项单独变化的断言。本轮未执行。

**验收检查**

两页依次测试新增、改名、删除、仅更改默认收藏夹；另一页继续操作后重载，结果仍保持最新，且不出现无限 storage 写回。补测两页近乎同时编辑时的合并或冲突策略。

**修复记录（2026-10-10，第三轮修复会话）**：[PR #26](https://github.com/zhs1234/gouo-canvas/pull/26)，单元测试撤掉修复后失败。需在浏览器验证。 补充修复：只切换默认收藏夹也会同步；测试补充该场景，撤掉后失败。

### GOUO-057 图片清理忽略其他标签页的任务及内存引用

优先级：P2。处理状态：修复中（候选分支未合并，跨页内存引用保护范围有限）。验证状态：代码确认；本轮未运行测试或浏览器验收。

**触发场景**

B 新建任务引用已有图片，但 A 的内存任务列表尚未看到该任务；A 删除原任务或进行图片清理。另一触发路径是图片仅留在 B 的未保存编辑或撤销历史中，A 启动清理。

**影响**

图片可从 IndexedDB 中删除，造成另一页任务输入或可撤销编辑的素材丢失；无云端副本时无法靠刷新恢复。

**代码依据**

main [删除任务时只依据本页任务、输入计算引用](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/src/store.ts#L2221-L2234)；底层[只扫描画布与会话，不扫描任务表](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/src/lib/db.ts#L300-L324)；[启动清理](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/src/store.ts#L1435-L1443)也不能看到别页内存中的引用；[live 引用注册表是本模块内存集合](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/src/lib/documentAssets.ts#L1-L2)。

**候选修复与剩余边界**

候选提交 e6c292f116f48408797162fb578019188fa2ae71 在[同一删除事务中扫描任务表](https://github.com/zhs1234/gouo-canvas/blob/e6c292f116f48408797162fb578019188fa2ae71/src/lib/db.ts#L301-L326)，并在[发现其他标签页锁时跳过启动清理](https://github.com/zhs1234/gouo-canvas/blob/e6c292f116f48408797162fb578019188fa2ae71/src/store.ts#L1456-L1471)。

后者只保护启动清理；[手动任务清理仍直接调用 deleteImages](https://github.com/zhs1234/gouo-canvas/blob/e6c292f116f48408797162fb578019188fa2ae71/src/store.ts#L2290-L2312)，该函数只能看到本页 live 引用。其他页仅保留在撤销历史或未保存编辑中的图片仍需跨页引用保护。浏览器没有 Web Locks 时，候选代码也继续执行启动清理，应单独明确兼容策略。

分支已有[保护数据库中其他任务引用的测试](https://github.com/zhs1234/gouo-canvas/blob/e6c292f116f48408797162fb578019188fa2ae71/src/lib/db.documents.test.ts#L62-L71)。现有跨页锁测试只断言任务状态，不能视为图片清理验收。本轮均未执行。

**验收检查**

B 新任务引用 A 任务的图片，A 删除原任务，B 的素材仍可读取；B 删除画布图片但保留可撤销历史，A 新开或手动清理，B 撤销后图片仍在；真正孤立图片可删除。分别验证有、无 Web Locks 的行为。

**修复记录（2026-10-10，第三轮修复会话）**：[PR #26](https://github.com/zhs1234/gouo-canvas/pull/26)，单元测试撤掉修复后失败。 手动清理任务时仍只能看到本页的内存引用（其他页撤销历史或未保存编辑中的图片）；浏览器没有 Web Locks 时启动清理照常执行（与修复前一致）。两点未处理，保留为已知限制。

### GOUO-058 看门狗超时后丢弃迟到的已付费图片结果

优先级：P2。处理状态：修复中（候选分支未合并，待验证）。验证状态：代码确认；本轮未运行测试或浏览器验收。

**触发场景**

单请求任务的 store 看门狗先把任务标为超时，但请求自身稍后成功或取回原付费结果；也可能图片已返回，保存或后处理跨过看门狗截止时间。

**影响**

结果返回后被 `status !== 'running'` 检查丢弃，或图片保存后任务仍维持错误状态。用户明明已有结果却被引导恢复或重试；重新生成会增加付费风险。

**代码依据**

main [看门狗只改变任务状态](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/src/store.ts#L1046-L1072)；[返回结果后拒绝非 running 任务](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/src/store.ts#L1674-L1683)；[保存后再次检查，直到此处才停看门狗](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/src/store.ts#L1723-L1732)。

**候选修复**

候选提交 e5d9360a409abc61f7de16f29e6eaa02d3922297 [结果到达即停止计时，并接纳仍属于同一执行的看门狗迟到结果](https://github.com/zhs1234/gouo-canvas/blob/e5d9360a409abc61f7de16f29e6eaa02d3922297/src/store.ts#L1678-L1692)。执行标识检查继续排除已被新恢复过程替代的旧请求。

分支已有[超时后迟到结果测试](https://github.com/zhs1234/gouo-canvas/blob/e5d9360a409abc61f7de16f29e6eaa02d3922297/src/store.test.ts#L333-L354)、[保存跨截止时间测试](https://github.com/zhs1234/gouo-canvas/blob/e5d9360a409abc61f7de16f29e6eaa02d3922297/src/store.test.ts#L385-L410)、[新恢复开始后忽略旧执行结果的测试](https://github.com/zhs1234/gouo-canvas/blob/e5d9360a409abc61f7de16f29e6eaa02d3922297/src/store.test.ts#L412-L445)。本轮未执行，不能据此标记已验证修复。

**验收检查**

用 mock 分别延迟请求结果、延迟本地图片保存；最终只保存正确结果，任务变为完成并清空错误，不追加生成请求。超时后启动恢复时，旧请求成功或失败都不能覆盖恢复中的状态和最终结果。

**修复记录（2026-10-10，第三轮修复会话）**：[PR #27](https://github.com/zhs1234/gouo-canvas/pull/27)，单元测试撤掉修复后失败。

### GOUO-059 并发 fal 任务串用全局客户端配置

优先级：P2。处理状态：修复中（候选分支未合并，待验证）。验证状态：代码确认；本轮未运行测试或外部服务验收。

**触发场景**

同一页并发执行或恢复两个不同 API Key、不同代理地址的 fal 配置；A 配置全局 SDK 后等待异步步骤，B 改写全局配置，再由 A 继续取结果或提交。

**影响**

A 后续请求可能使用 B 的配置，出现鉴权失败、查不到已生成结果或请求发往错误配置地址。此处只确认配置隔离缺失，不据此推断已发生凭据泄露。

**代码依据**

main [直接修改全局 fal.config](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/src/lib/falAiImageApi.ts#L40-L48)；[等待状态后再次使用同一全局客户端取结果](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/src/lib/falAiImageApi.ts#L161-L170)；[提交前也存在配置后的 await](https://github.com/zhs1234/gouo-canvas/blob/a496a116fa75e7d7db1e316803a5551d5682894f/src/lib/falAiImageApi.ts#L184-L196)。

**候选修复**

候选提交 e5d9360a409abc61f7de16f29e6eaa02d3922297 [为每次调用创建独立客户端](https://github.com/zhs1234/gouo-canvas/blob/e5d9360a409abc61f7de16f29e6eaa02d3922297/src/lib/falAiImageApi.ts#L40-L48)，并在[恢复流程](https://github.com/zhs1234/gouo-canvas/blob/e5d9360a409abc61f7de16f29e6eaa02d3922297/src/lib/falAiImageApi.ts#L162-L171)和[正常提交流程](https://github.com/zhs1234/gouo-canvas/blob/e5d9360a409abc61f7de16f29e6eaa02d3922297/src/lib/falAiImageApi.ts#L185-L196)使用该实例。

分支已有[交错恢复请求的 Key 绑定测试](https://github.com/zhs1234/gouo-canvas/blob/e5d9360a409abc61f7de16f29e6eaa02d3922297/src/lib/falAiImageApi.test.ts#L70-L83)。其 mock 断言覆盖凭据，但未直接证明 SDK 的真实网络地址隔离；本轮未执行。

**验收检查**

用 mock 交错运行两个不同 Key、默认/自定义地址的提交与恢复；每个请求的凭据、地址、requestId 始终属于原配置。分别覆盖 A 等待状态期间 B 开始恢复，以及 A 准备输入期间 B 开始提交。

**修复记录（2026-10-10，第三轮修复会话）**：[PR #27](https://github.com/zhs1234/gouo-canvas/pull/27)，单元测试撤掉修复后失败。

## 2026-10-10 第三轮修复会话新增（GOUO-060 起）

以下条目来自同日第三轮深度检查的其余方向（数据库兼容、多实例、Agent、画布、前端安全、部署、文档一致性），编号接续 GOUO-059。修复已开 PR、未合并，按本清单惯例记为修复中；"本地运行环境"指会话容器中的 SQLite 与 PostgreSQL 16、mock 上游和模拟代理头，不等于实际部署验证。

### GOUO-060 回收站清理期间新引用的图片被删

优先级：P2。处理状态：修复中（PR 未合并，待验证）。验证状态：见修复记录。

**触发场景**：清理进行中，另一设备或实例把一张超过 3 天、当时无人引用的图片放进作品或文档。

**影响**：保存成功返回，但图片记录和文件随后被删，作品指向缺失图片；MySQL 可重复读下窗口覆盖整个清理事务。

**建议修复**：清理事务第一条语句锁用户行；删除时再按 updated_at 过滤；保存作品时在锁内重新确认图片归属。

**验收检查**：并发场景下要么保存失败提示图片不属于用户，要么图片保留。

**代码依据**：[gouo-trash.go](https://github.com/zhs1234/gouo-canvas/blob/a496a11/server/model/gouo-trash.go)、[gouo_cloud.go](https://github.com/zhs1234/gouo-canvas/blob/a496a11/server/model/gouo_cloud.go)（基线 main a496a11）。

**修复记录（2026-10-10）**：[PR #25](https://github.com/zhs1234/gouo-canvas/pull/25)，单元测试 `TestPurgeGouoTrashKeepsAssetTouchedDuringPurge`、`TestUpsertGouoTaskRechecksAssetsAndTrimsText` 撤掉修复后失败，并在 PostgreSQL 16 上运行通过。

### GOUO-061 作品提示词超出 MySQL TEXT 上限或含 NUL 时同步一直失败

优先级：P2。处理状态：修复中（PR 未合并，待验证）。验证状态：见修复记录。

**触发场景**：提示词约 2.2 万汉字（MySQL）或含 `\u0000`（PostgreSQL）。

**影响**：作品每次同步返回 500；付费生成的图片不进作品库。

**建议修复**：提示词和错误信息去掉 NUL 并截断到 60000 字节。

**验收检查**：超长提示词保存成功并被截断；含 NUL 的提示词在 PostgreSQL 上保存成功。

**代码依据**：[gouo_cloud.go](https://github.com/zhs1234/gouo-canvas/blob/a496a11/server/model/gouo_cloud.go)（基线 main a496a11）。

**修复记录（2026-10-10）**：[PR #25](https://github.com/zhs1234/gouo-canvas/pull/25)，单元测试撤掉修复后失败；本地运行环境 SQLite 与 PostgreSQL 通过。MySQL 未实际连接验证。

### GOUO-062 素材 ID 大小写在 MySQL 与清理逻辑间不一致

优先级：P2。处理状态：修复中（PR 未合并，待验证）。验证状态：见修复记录。

**触发场景**：客户端把 asset_id 写成大写。

**影响**：MySQL 归属检查不区分大小写而通过，清理时按原样比较，被引用的图片被删除。

**建议修复**：素材 ID 必须为 32 位小写十六进制。

**验收检查**：大写 ID 的作品和文档请求返回 400。

**代码依据**：[gouo_documents.go](https://github.com/zhs1234/gouo-canvas/blob/a496a11/server/controller/gouo_documents.go)（基线 main a496a11）。

**修复记录（2026-10-10）**：[PR #25](https://github.com/zhs1234/gouo-canvas/pull/25)，文档接口用例撤掉修复后失败。

### GOUO-063 多实例共享资产目录时付费图片结果保存失败

优先级：P2。处理状态：修复中（PR 未合并，待验证）。验证状态：见修复记录。

**触发场景**：多个后端实例挂载同一 GOUO_ASSET_DIR，同时保存图片结果。

**影响**：清理过程遇到另一实例刚删除的临时文件即报错，用户收到 500、额度进入待核对，上游已出的图丢失。

**建议修复**：清理时跳过已不存在的文件。

**验收检查**：并发创建删除临时文件时清理不报错。

**代码依据**：[gouo-image-result.go](https://github.com/zhs1234/gouo-canvas/blob/a496a11/server/model/gouo-image-result.go)（基线 main a496a11）。

**修复记录（2026-10-10）**：[PR #25](https://github.com/zhs1234/gouo-canvas/pull/25)，单元测试 `TestCleanupGouoImageResultsIgnoresVanishingTempFiles` 撤掉修复后失败。

### GOUO-064 Agent 历史附件每轮重发原图

优先级：P2。处理状态：修复中（PR 未合并，待验证）。验证状态：见修复记录。

**触发场景**：会话挂参考图后连续发送多条消息。

**影响**：请求中的原图数随轮数增长（2、4、6 张），视觉 token 费用线性增长，最终超出上游请求上限。

**建议修复**：只给最新一条用户消息附原图，历史消息只写图片 ID；附件仍保留在输入框，供未指定 inputImageIds 的生成使用。

**验收检查**：连发 3 条消息，每次请求都只有 2 张图。

**代码依据**：[agentStore.ts](https://github.com/zhs1234/gouo-canvas/blob/a496a11/src/stores/agentStore.ts)（基线 main a496a11）。

**修复记录（2026-10-10）**：[PR #28](https://github.com/zhs1234/gouo-canvas/pull/28)，单元测试撤掉修复后失败。

### GOUO-065 Claude 渠道一次返回多个工具调用时 Agent 必定中断

优先级：P2。处理状态：修复中（PR 未合并，待验证）。验证状态：见修复记录。

**触发场景**：Agent 模型走 Claude 渠道，模型一次调用两个工具。

**影响**：前端报"工具调用 ID 在流式响应中发生变化"，已付费的 LLM 请求白费。

**建议修复**：`parallel_tool_calls` 改为指针保留 false 并映射为 `disable_parallel_tool_use`；流式工具调用 index 递增；前端同一 index 出现新 ID 视为下一个调用。

**验收检查**：两个工具调用正确解析并依次执行。

**代码依据**：[claude/chat.go](https://github.com/zhs1234/gouo-canvas/blob/a496a11/server/providers/claude/chat.go)、[agent/api.ts](https://github.com/zhs1234/gouo-canvas/blob/a496a11/src/lib/agent/api.ts)（基线 main a496a11）。

**修复记录（2026-10-10）**：[PR #28](https://github.com/zhs1234/gouo-canvas/pull/28)，Go 与前端单元测试撤掉修复后失败。

### GOUO-066 新开标签页中断其他标签页正在运行的 Agent 会话

优先级：P2。处理状态：修复中（PR 未合并，待验证）。验证状态：见修复记录。

**触发场景**：标签页 A 的 Agent 正在运行时打开标签页 B。

**影响**：B 把会话改成中断并写回，A 下次保存版本冲突而停止，之后一直无法保存。

**建议修复**：运行期间持有 `gouo-agent-run:<id>` 锁；加载时锁被占用的会话保持原样不写回，任务回填也跳过。

**验收检查**：B 打开后 A 继续运行完成。

**代码依据**：[agentStore.ts](https://github.com/zhs1234/gouo-canvas/blob/a496a11/src/stores/agentStore.ts)（基线 main a496a11）。

**修复记录（2026-10-10）**：[PR #28](https://github.com/zhs1234/gouo-canvas/pull/28)，单元测试撤掉修复后失败。

### GOUO-067 画布逐项错误过长导致回填失败、一直显示生成中

优先级：P2。处理状态：修复中（PR 未合并，待验证）。验证状态：见修复记录。

**触发场景**：自定义服务商返回整页 HTML 错误，或一次回填中某张画布保存失败。

**影响**：超过元数据长度上限，整次回填失败，节点停在生成中；一张画布失败也阻断其他画布。

**建议修复**：逐项错误截断到 100 条、每条 10000 字符；按画布单独捕获保存失败。

**验收检查**：长错误回填为失败状态；其他画布照常回填。

**代码依据**：[generation.ts](https://github.com/zhs1234/gouo-canvas/blob/a496a11/src/lib/canvas/generation.ts)（基线 main a496a11）。

**修复记录（2026-10-10）**：[PR #29](https://github.com/zhs1234/gouo-canvas/pull/29)，单元测试撤掉修复后失败。

### GOUO-068 画布移入回收站和恢复进入撤销历史

优先级：P2。处理状态：修复中（PR 未合并，待验证）。验证状态：见修复记录。

**触发场景**：画布恢复后按撤销。

**影响**：画布被放回回收站，并还原为最初的删除时间。

**建议修复**：回收站操作不记入撤销历史。

**验收检查**：恢复后撤销不影响回收站状态。

**代码依据**：[canvasStore.ts](https://github.com/zhs1234/gouo-canvas/blob/a496a11/src/stores/canvasStore.ts)（基线 main a496a11）。

**修复记录（2026-10-10）**：[PR #29](https://github.com/zhs1234/gouo-canvas/pull/29)，单元测试撤掉修复后失败。

### GOUO-069 小图标和细长横幅插入画布被拒

优先级：P2。处理状态：修复中（PR 未合并，待验证）。验证状态：见修复记录。

**触发场景**：拖入 16×16 图标或 4000×100 横幅。

**影响**：节点尺寸低于校验下限 20，整批插入被拒绝。

**建议修复**：节点尺寸最小 20。

**验收检查**：小图和横幅正常插入。

**代码依据**：[nodeSize.ts](https://github.com/zhs1234/gouo-canvas/blob/a496a11/src/lib/canvas/nodeSize.ts)（基线 main a496a11）。

**修复记录（2026-10-10）**：[PR #29](https://github.com/zhs1234/gouo-canvas/pull/29)，单元测试撤掉修复后失败。

### GOUO-070 分组或解组时删除画布上无关的空分组

优先级：P2。处理状态：修复中（PR 未合并，待验证）。验证状态：见修复记录。

**触发场景**：画布上有预先建好的空画框，再对其他节点分组或解组。

**影响**：空画框被删除。

**建议修复**：只清理本次操作后变空的分组。

**验收检查**：分组解组后空画框仍在。

**代码依据**：[nodeGeometry.ts](https://github.com/zhs1234/gouo-canvas/blob/a496a11/src/lib/canvas/nodeGeometry.ts)（基线 main a496a11）。

**修复记录（2026-10-10）**：[PR #29](https://github.com/zhs1234/gouo-canvas/pull/29)，单元测试撤掉修复后失败。

### GOUO-071 生成配置节点可被"上传到此节点"替换

优先级：P2。处理状态：修复中（PR 未合并，待验证）。验证状态：见修复记录。

**触发场景**：在生成配置节点上点上传按钮。

**影响**：节点被替换为图片节点，提示词、模型等配置丢失。

**建议修复**：上传按钮只在图片节点显示。

**验收检查**：配置节点没有上传按钮。

**代码依据**：[canvasEditor.tsx](https://github.com/zhs1234/gouo-canvas/blob/a496a11/src/components/canvas/canvasEditor.tsx)（基线 main a496a11）。

**修复记录（2026-10-10）**：[PR #29](https://github.com/zhs1234/gouo-canvas/pull/29)；Playwright 验证：main 有 2 个上传按钮，修复后只剩图片节点的 1 个。

### GOUO-072 链接参数静默切换图片服务地址

优先级：P2。处理状态：修复中（PR 未合并，待验证）。验证状态：见修复记录。

**触发场景**：非平台部署下打开带 `apiUrl`/`apiKey`/`settings` 参数的链接。

**影响**：当前服务被切到链接地址，之后的提示词和参考图发给对方。

**建议修复**：地址变化时先确认并显示目标地址；不确认时只导入不切换。

**验收检查**：打开此类链接弹出确认框；不切换时当前服务不变。

**代码依据**：[App.tsx](https://github.com/zhs1234/gouo-canvas/blob/a496a11/src/App.tsx)、[urlSettings.ts](https://github.com/zhs1234/gouo-canvas/blob/a496a11/src/lib/urlSettings.ts)（基线 main a496a11）。

**修复记录（2026-10-10）**：[PR #30](https://github.com/zhs1234/gouo-canvas/pull/30)，单元测试与 Playwright 验证。

### GOUO-073 Service Worker 与发版缓存导致离线首页或脚本被错误缓存

优先级：P2。处理状态：修复中（PR 未合并，待验证）。验证状态：见修复记录。

**触发场景**：用户打开站内文本或图片链接、遇到 502；或发版后旧页面请求已删除的脚本。

**影响**：离线首页变成文本或错误页；HTML 被当作脚本缓存后白屏。

**建议修复**：SW 只缓存 HTML 应用页，不把 HTML 缓存为脚本；Nginx 入口页 no-cache，/assets/ 缺失返回 404。

**验收检查**：见 PR 中 Nginx 实测与 SW 模拟结果。

**代码依据**：[sw.js](https://github.com/zhs1234/gouo-canvas/blob/a496a11/public/sw.js)、[nginx.conf](https://github.com/zhs1234/gouo-canvas/blob/a496a11/deploy/nginx.conf)（基线 main a496a11）。

**修复记录（2026-10-10）**：[PR #31](https://github.com/zhs1234/gouo-canvas/pull/31)，`serviceWorker.test.mjs` 撤掉修复后失败；用 Nginx 1.24 实际加载配置验证。

### GOUO-074 HTTPS 部署文档未要求 Secure Cookie 与 HSTS

优先级：P2。处理状态：修复中（PR 未合并，待验证）。验证状态：见修复记录。

**触发场景**：按文档配好 HTTPS 后用户经 http:// 访问。

**影响**：30 天会话 Cookie 在跳转前以明文发送。

**建议修复**：文档与示例要求 HTTPS 部署设 `SESSION_COOKIE_SECURE=true` 并加 HSTS。

**验收检查**：登录响应 Set-Cookie 带 Secure。

**代码依据**：[docker.md](https://github.com/zhs1234/gouo-canvas/blob/a496a11/docs/zh-CN/deployment/docker.md)（基线 main a496a11）。

**修复记录（2026-10-10）**：[PR #31](https://github.com/zhs1234/gouo-canvas/pull/31)，仅文档和示例配置。

### GOUO-075 出图超时链不一致导致正常长任务进入待核对

优先级：P2。处理状态：修复中（PR 未合并，待验证）。验证状态：见修复记录。

**触发场景**：单张出图超过 600 秒。

**影响**：前端或代理先断开，后端取消上游请求，额度进入待核对。

**建议修复**：平台模式前端固定等待 960 秒，文档统一为 960 秒。

**验收检查**：长任务完成并结算。

**代码依据**：[openaiCompatibleImageApi.ts](https://github.com/zhs1234/gouo-canvas/blob/a496a11/src/lib/openaiCompatibleImageApi.ts)（基线 main a496a11）。

**修复记录（2026-10-10）**：[PR #31](https://github.com/zhs1234/gouo-canvas/pull/31)，单元测试撤掉修复后失败。后端与客户端断开解耦属产品决定，未改。

### GOUO-076 trusted_header 可被伪造

优先级：P2。处理状态：修复中（PR 未合并，待验证）。验证状态：见修复记录。

**触发场景**：设置 `trusted_header=CF-Connecting-IP` 且源站可被直连。

**影响**：攻击者自带该头伪造 IP，绕过限流与令牌 IP 白名单。

**建议修复**：文档写明源站必须只能经对应平台访问。

**验收检查**：—

**代码依据**：[backend.md](https://github.com/zhs1234/gouo-canvas/blob/a496a11/docs/zh-CN/backend.md)（基线 main a496a11）。

**修复记录（2026-10-10）**：[PR #31](https://github.com/zhs1234/gouo-canvas/pull/31)，仅文档。

### GOUO-077 缺少防嵌入等安全响应头

优先级：P2。处理状态：修复中（PR 未合并，待验证）。验证状态：见修复记录。

**触发场景**：跨站 Cookie 模式下攻击站点用 iframe 嵌入前端。

**影响**：可诱导点击触发付费操作。

**建议修复**：Nginx 加 X-Frame-Options、frame-ancestors、nosniff、Referrer-Policy。

**验收检查**：各路径响应带安全头。

**代码依据**：[nginx.conf](https://github.com/zhs1234/gouo-canvas/blob/a496a11/deploy/nginx.conf)（基线 main a496a11）。

**修复记录（2026-10-10）**：[PR #31](https://github.com/zhs1234/gouo-canvas/pull/31)，Nginx 实测。

### GOUO-078 多实例部署时改价和模型上下架不同步

优先级：P2。处理状态：修复中（PR 未合并，待验证）。验证状态：见修复记录。

**触发场景**：多实例部署，管理员在实例 A 改价或下架模型。

**影响**：实例 B 一直按旧价扣费，下架模型照常可用。

**建议修复**：所有实例每分钟重读价格表；文档写明主从设置。

**验收检查**：A 改价后 B 一分钟内生效。

**代码依据**：[main.go](https://github.com/zhs1234/gouo-canvas/blob/a496a11/server/main.go)（基线 main a496a11）。

**修复记录（2026-10-10）**：[PR #31](https://github.com/zhs1234/gouo-canvas/pull/31)；本地两实例共用 PostgreSQL：main 构建 75 秒内未同步，修复构建 32 秒同步。

### GOUO-079 管理面板复制失败时把用户内容按 HTML 渲染

优先级：P2。处理状态：修复中（PR 未合并，待验证）。验证状态：见修复记录。

**触发场景**：管理员经 http 访问面板（剪贴板不可用），点击令牌名、用户名或 MJ 提示词的复制。

**影响**：普通用户设置的 `<img onerror>` 令牌名在管理员页面执行。

**建议修复**：改为纯文本渲染。

**验收检查**：复制失败提示中 HTML 被转义。

**代码依据**：[common.jsx](https://github.com/zhs1234/gouo-canvas/blob/a496a11/server/web/src/utils/common.jsx)（基线 main a496a11）。

**修复记录（2026-10-10）**：[PR #23](https://github.com/zhs1234/gouo-canvas/pull/23)；面板无测试框架，用 esbuild 打包渲染对照验证。

### GOUO-080 文档与实现不一致（回收站、计费拆分、作品库同步、路由、配额、冒烟命令）

优先级：P2。处理状态：修复中（PR 未合并，待验证）。验证状态：见修复记录。

**触发场景**：用户或运营方按文档理解产品行为。

**影响**：以为回收站可无限恢复、导入的作品已上云、按请求而非按张计费；冒烟测试实际什么都没测。

**建议修复**：逐条修正中英文文档，详见 PR。

**验收检查**：—

**代码依据**：[backend.md](https://github.com/zhs1234/gouo-canvas/blob/a496a11/docs/zh-CN/backend.md)、[user-guide.md](https://github.com/zhs1234/gouo-canvas/blob/a496a11/docs/zh-CN/user-guide.md)（基线 main a496a11）。

**修复记录（2026-10-10）**：[PR #32](https://github.com/zhs1234/gouo-canvas/pull/32)，仅文档；数值与路由逐条对照代码。

### 只登记、暂不修复

### GOUO-081 退出登录不使会话失效，第三方登录无法撤销会话

优先级：P2。处理状态：暂缓。验证状态：代码确认。

**说明**：退出只清浏览器 Cookie，旧会话 Cookie 在 30 天内仍有效；改密码、封禁之外没有让其他会话失效的办法。

**暂缓原因**：需要在用户表加会话版本字段并在鉴权中比对，改动面大，只登记。

### GOUO-082 换绑邮箱、注册通行密钥不要求重新验证

优先级：P2。处理状态：暂缓。验证状态：代码确认。

**说明**：会话被盗后可直接换绑邮箱或添加通行密钥，进一步接管账号。

**暂缓原因**：属交互设计，需产品决定，只登记。

### GOUO-083 敏感接口共用 IP 限流桶，没有按账号的失败次数限制

优先级：P2。处理状态：暂缓。验证状态：代码确认。

**说明**：登录、注册、验证码共用同一 IP 桶；同一账号可从多个 IP 持续猜密码。

**暂缓原因**：需调整限流模型，只登记。

### GOUO-084 通用对话计费可透支

优先级：P1。处理状态：暂缓。验证状态：代码确认。

**说明**：对话请求按估算预扣，实际用量超出时仍完成结算，余额可透支；批量写入开启时更明显。上游 One Hub 设计。

**暂缓原因**：需改预扣模型，只登记；光构图片计费不受影响。

### GOUO-085 MySQL 上作品 content_bytes 前后算法不一致

优先级：P2。处理状态：暂缓。验证状态：代码确认。

**说明**：MySQL 的 JSON 列会重排键并加空格，写入时按原始字节计、补丁时按读回文本计，已用空间漂移，接近配额时无改动的补丁也可能报空间不足。

**暂缓原因**：需统一计量口径并迁移，MySQL 未实际验证，只登记。

### GOUO-086 大画布性能

优先级：P2。处理状态：暂缓。验证状态：代码确认。

**说明**：上千节点时部分操作整体重算，交互卡顿。

**暂缓原因**：属性能优化，只登记。

### 第三轮运行时回归（2026-10-10）

- 构建：13 个修复分支（PR #20 至 #32）试合并（无冲突）后的二进制；另用 main a496a11 构建做对照。
- SQLite 与 PostgreSQL 16 各跑一遍：`v_auth` 22、`v_image` 31、`v_claude` 6、`v_register` 11、`v_trash` 12、`v_pay` 6、`v_reset` 4、`v_admin_scope` 11、`v_round2` 13、`v_ip` proxy 4，全部通过；`v_ip` direct 模式（环境变量设空、config.yaml 设空）各 2 项通过。
- 新增 `v_round3`（9 项：MJ 图片代理 2 项、管理员令牌 2 项、支付网关、订单列表、删除日志、重复 n、改密码长度）：修复构建全部通过；main 构建 7 项失败，复现 GOUO-045、047、048、049 及两项策略待确认的权限收紧。
- 新增 `v_price_sync`：两实例共用 PostgreSQL，main 构建 75 秒内未同步价格，修复构建 32 秒同步（GOUO-078）。
- 脚本调整：`v_pay` 跨网关回调一项改为只检查不结算（GOUO-050 修复后外来订单会确认收到）；`v_image` 超额作品改用超大参数制造（GOUO-061 修复后提示词会截断），并新增截断检查。
- 浏览器（Playwright + Chromium）：GOUO-071 上传按钮、GOUO-072 链接确认框。
- 合并后 `npm test` 478 项、`npm run build`、`go vet ./...` 通过；`go test ./...` 仅 `common/image`、`common/notify/channel`、`common/storage`、`providers/ali` 失败，需要外网或凭据，main 上同样失败。之后 PR #22、#26 补充的提交单独跑过相关测试。
- GOUO-027 至 033 在本轮回归中再次全部通过，标记为已验证修复（本地运行环境）。

## 本地运行验证（2026-10-09，历史快照）

本节保留此前执行结果；表中“待合并”“待用户决定”描述的是当时状态。PR #15 至 #19 后已合并，方案 (a) 已选择，但合并本身不扩展验收范围，也不关闭本轮新场景；本轮未重跑测试。

按用户要求，把能在开发容器里运行的验收检查实际跑了一遍，其余交给用户。

**环境**

- 后端：main 0b9b54f 构建的二进制；GOUO-027、028 另用 PR #15 head cbfa082 构建的二进制。SQLite，单进程，不开 Redis，开启云端作品库。
- 上游：自写的 OpenAI 兼容 mock，记录收到的字段和文件哈希，可按提示词返回指向本机的图片地址，或让第一个请求失败；Claude 渠道也指向它。
- "内网"目标：本机 127.0.0.1:18900 上的服务，记录每一次访问，用来判断后端有没有去请求它。
- 邮件：自写的 SMTP 收件 mock（STARTTLS 与 AUTH），用于取验证码和重置链接。
- 客户端 IP：用 X-Forwarded-For 模拟反向代理追加真实地址；没有部署真实 nginx。
- 支付：本地生成的测试 RSA 密钥，不连支付宝；回调签名用本地"平台密钥"模拟。
- 回收站清理：用临时 Go 程序对同一个 SQLite 库调用 `model.PurgeGouoTrash`，并直接改库中的时间戳。
- 所有请求都通过后端 HTTP 接口发出。脚本和日志放在会话临时目录，没有提交到仓库。
- 同时重新运行了相关单元测试：`TestIsPublicIP`、`TestPublicHTTPClientRejectsLoopbackAndRedirects`、`TestCheckPublicHost`、`TestGouoImageBytesRejectsInternalURLsAndOversizedImages`、`TestGetImageFromUrlRejectsInternalAddresses`、`TestClientIPOnlyTrustsConfiguredProxies`、`TestPurgeGouoTrashAfterRetention`、`TestMoneyToFenRoundsDecimalAmounts`、`TestPayUsesCurrentMerchantConfig`、`TestDeleteUserResponse` 等，全部通过。`common/image` 包中原有的 `TestDecode`、`TestGetImageFromUrl` 需要访问维基百科，本容器无法联网，失败与本次修复无关。

**结果**

| 条目 | 结果 | 处理状态 |
|---|---|---|
| GOUO-001 | 验收场景全部通过 | 已验证修复 |
| GOUO-007 | 回环与 localhost 通过；其余场景由单元测试覆盖 | 已验证修复 |
| GOUO-015 | 验收场景全部通过 | 已验证修复 |
| GOUO-020 | 验收场景全部通过，含并发注册 | 已验证修复 |
| GOUO-021 | 验收场景全部通过 | 已验证修复 |
| GOUO-022 | 验收场景全部通过 | 已验证修复 |
| GOUO-023 | 后端场景全部通过；落地页按用户决定不在范围内 | 已验证修复 |
| GOUO-027、028 | PR #15 构建上全部通过，main 上原问题复现 | 待验证（待合并） |
| GOUO-006 | 下单与模拟回调通过；热更新换商户后旧订单回调被拒，待用户决定 | 待验证 |
| GOUO-024 | 代理场景、config.yaml 设空通过；环境变量设空不生效（GOUO-029） | 待验证 |
| GOUO-009、010、011、014、018、019 | 服务端部分通过，剩余前端或外网部分 | 待验证 |
| 其余 10 项 | 需要外部服务或浏览器操作，本地未验证 | 待验证 |

验证中新发现 2 项：GOUO-029（环境变量无法把 TRUSTED_PROXIES 设为空）、GOUO-030（管理端两个列表不按角色过滤），均为 P2，未修改代码。

### 交给用户验证

以下按条目列出操作步骤和预期结果。完成后在对应条目追加验证记录。

- **GOUO-002 GitHub 登录**：创建 GitHub OAuth App 并在后台开启 GitHub 登录。① 用未公开邮箱、从未登录过本站的 GitHub 账号登录：进入新用户注册，不能登录到 root 或任何已有账号；② 用主邮箱未验证的 GitHub 账号重复 ①；③ 本站账号已绑定邮箱 X，用主邮箱为已验证 X 的 GitHub 账号登录：关联到该账号；④ 后台关闭注册后重复 ①：提示无法注册。
- **GOUO-017 OIDC 登录**：配置任一 OIDC 提供方（如 Keycloak、Authentik），新建用户名分别为 root、某个管理员用户名、某个普通用户名的三个主体，逐个登录：都提示用户名已被占用，不能登录已有账号。已绑定的主体在提供方改名后，仍能登录原账号。
- **GOUO-005 微信支付**：在沙箱或用真实小额，分别充值 1.15 元、1.29 元，以及开启折扣或手续费后金额带小数的订单：下单金额（分）与订单金额一致，支付后入账；同一回调重放两次只入账一次。
- **GOUO-006 支付宝回调与多商户**：在支付宝沙箱建两个网关（不同 app_id），交替下单并完成支付，回调分别入账到正确订单；微信支付同样建两个商户交替验证。方案 (a) 已选择；按 GOUO-006 的 2026-10-10 更正补测停用/软删除网关的历史回调，不执行旧停用建议。
- **GOUO-003 Agent 草稿**：开启云同步，在 Agent 会话中引用一张只在云端的图片（换设备或清缓存后），开发者工具把网络限速为"慢速 3G"，素材下载期间修改输入框草稿：下载完成后草稿保留新输入，刷新后仍在。
- **GOUO-004 多标签页覆盖**：同一账号开标签页 A、B，打开同一画布；A 修改但先不保存，B 修改并等云保存完成，再让 A 保存：A 的旧内容不能覆盖 B 的，应出现冲突副本或提示；刷新后 B 的修改仍在。
- **GOUO-008 URL 换源**：在已保存 API Key 的页面上，用 URL 参数只换 apiUrl（不带 apiKey，指向 requestbin 之类的受控地址）打开：Key 被清空，受控地址收不到旧 Key；同源地址保留 Key；显式带 apiKey 参数时使用该值；锁定代理和平台模式各检查一次。
- **GOUO-009 切换账号**：标签页 A 以用户甲进入画布；在同一浏览器另一个标签页的后台面板退出并登录乙；回到 A 进行任意云操作（收藏、保存画布）：提示"当前登录账号已在其他页面切换，请刷新页面"并刷新，刷新后只看到乙的数据；甲未同步的收藏、文档和素材不会出现在乙的云端。
- **GOUO-010 删除界面**：在后台面板删除一个已在另一标签页删掉的用户，以及删除同级管理员：界面显示失败提示，列表与实际数据一致。
- **GOUO-011、019 收藏同步**：两台设备（或两个浏览器配置）登录同一账号；在 A 上收藏、取消收藏作品，隐藏、恢复收藏夹；B 刷新或等同步后，作品的收藏状态与 A 一致。
- **GOUO-012 画布导入**：在专用画布导入一个画布文件，不做任何编辑，刷新或在另一台设备打开：云端有该画布且图片正常；导入损坏的文件：不生成云文档。
- **GOUO-013 ZIP 导入**：准备压缩炸弹（体积小、解压后很大）、累计超限、条目很多、单个超大图片的备份文件，在"数据设置 - 导入"中导入：很快提示失败，页面仍可使用，已有作品和草稿不变。
- **GOUO-014 批量部分失败**：批量生成 3 张时让中间一张失败（例如在 mock 中控制或断网），以及一张生成成功但浏览器下载失败；清缓存或换设备后，作品库中每张图片、参数与原来一致。
- **GOUO-016 Agent 停止**：Agent 提交图片任务时开启网络限速，在"等待报价 / 准备图片"阶段点停止：网络面板中不再出现图片生成 POST，余额不变；已经派发的任务结果仍能恢复。
- **GOUO-018 公网图片**：在 Claude 或 Gemini 渠道的对话中发送一张公网图片 URL：能正常识别。
- **GOUO-024 nginx 部署**：按仓库 `deploy/nginx.conf` 部署后，从外部用 curl 带伪造的 X-Forwarded-For 连续登录 21 次：第 21 次返回 429；后台日志里的 IP 为真实客户端地址。GOUO-029 已合并；直连部署应在当前 main 分别验证环境变量 `TRUSTED_PROXIES=""` 与 config.yaml 中 `trusted_proxies: ""`，不再等待已合并修复。
- **GOUO-026 Agent 确认**：让 Agent 在一次对话中生成超过 4 张图片：超过时弹出确认框，取消不提交，确认后提交。PR #17 已合并金额显示；在当前 main 核对模型单价、本次预计扣费与实际扣费一致，价格读取失败仍需确认，确认后价格变动应拒绝而非按新价扣费。
- **GOUO-027、028**：PR #15 构建曾在本地通过全部验收，现已合并；应在当前 main 重新执行原验收并记录版本与结果，不能仅凭合并标记已验证修复。（2026-10-10 已用 main a496a11 构建在 SQLite 与 PostgreSQL 上重新执行并通过，见"第三轮运行时回归"。）
- **GOUO-043 GitHub 改名**：用 GitHub 账号 X 登录本站后，在 GitHub 把 X 改名为 Y；另一个 GitHub 账号注册用户名 X 并登录本站：进入新用户注册，不能进入原账号；用 Y 登录仍进入原账号。
- **GOUO-044 OIDC 邮箱**：在 OIDC 提供方建一个邮箱未验证的主体首次登录：新账号邮箱为空。
- **GOUO-046、050、006 Stripe**：Stripe 测试模式建两个网关；清空其中一个的 webhook 密钥后发测试事件：被拒绝；向另一网关推送不属于它的会话（含零金额会话）：返回 200 不入账；停用网关后补发已付款会话：正常入账。
- **GOUO-060 至 062 MySQL**：用 MySQL 8 跑一遍云端作品库：超长提示词作品能同步，大写 asset_id 被拒绝。
- **GOUO-054 至 057、066 多标签页**：同一账号开两个标签页，分别新建收藏夹、切换默认收藏夹、删除任务、运行 Agent，另一个标签页的收藏夹、图片和会话不受影响。
- **GOUO-073 至 078 部署**：按新的 `deploy/nginx.conf` 部署，`curl -I` 确认入口页 no-cache 与安全头；发版后旧页面不白屏；多实例时在一个实例改价，其他实例一分钟内生效。

## 维护与关闭标准

- 新发现从当前最大编号顺序追加（本轮最大编号 GOUO-059），已有编号不重用；同根因问题合并到原条目并保留来源与更新记录。

- 每次更新注明北京时间日期、适用提交、触发条件、影响范围及新增证据。若优先级变化，记录原级别与变更理由。

- 处理状态使用待修复、修复中、待验证、已验证修复、暂缓或不适用；验证状态独立记录待复现、已复现或已验证，避免把静态发现写成运行结果。

- 新提交包含疑似修复时，先核对修改是否覆盖原问题；未完成相关测试前只标记待验证。

- 标记已验证修复必须同时记录修复提交或 PR、验证版本、执行过的测试与结果，并覆盖条目列出的验收场景。仅代码变更、分支上的补丁、空 CI 状态或未运行的测试都不足以关闭。

- 无法复现时记录环境、步骤与结果，不能直接当作已修复。配置不适用时保留条件、证据及重新核查的触发点。

- 保留原发现、历史结论及更新记录；保留用户补充的负责人、计划与说明，不整页覆盖既有内容。

- 对线上配置调整、令牌轮换、实际支付、模型调用和代码修改，需另行确定执行范围；维护本清单本身不表示这些动作已获执行授权。

## 覆盖与边界

本轮覆盖身份权限、生成计费、Agent、持久化同步、画布核心操作、支付及部署测试配置。当前基线是 React 与 Go One Hub 架构；与 main 分叉的其他实现没有混入当前结论。供应商适配、真实并发数据库、跨设备竞态、线上开关和真实支付均仍需针对性验证；不保证不存在其他问题。 后续审查以 main 及面向 main 的活跃 PR 为准，排除旧 v2 及其历史派生开发线；v2 暂时废弃，用户明确重启前不继续验收或开发。

## 更新记录

| 日期 北京时间 | 变更 | 当前计数 |
|---|---|---|
| 2026-10-09 | 建立 main 1f3c463 基线清单，登记 GOUO-001 至 GOUO-016；全部待修复、待复现。 | 16 项，P1 8 项，P2 8 项，已验证修复 0 项 |
| 2026-10-09 | 按用户要求将 v2 路线标记为暂时废弃；后续审查以 main 及面向 main 的活跃 PR 为准，排除旧 v2 及其历史派生开发线，明确重启前不继续验收或开发。保留分支及历史，不做删除；main 1f3c463 基线的 16 项问题保持不变。 | 16 项，P1 8 项，P2 8 项，已验证修复 0 项 |
| 2026-10-09 | GOUO-001 至 016 提交修复 [PR #8](https://github.com/zhs1234/gouo-canvas/pull/8) 至 [PR #12](https://github.com/zhs1234/gouo-canvas/pull/12)，处理状态改为待验证，各条目追加修复记录及已运行测试；13 项单元测试撤掉修复后失败，GOUO-005 由脚本复现，GOUO-013、GOUO-015 待复现。新增 GOUO-017（OIDC 用户名回退绑定，P1）、GOUO-018（对话图片 URL SSRF，P1）、GOUO-019（隐藏收藏夹不推进游标，P2）。 | 19 项：待验证 16 项，待修复 3 项（P1 2 项、P2 1 项），已验证修复 0 项 |
| 2026-10-09 | GOUO-017 至 019 修复分别追加到 [PR #8](https://github.com/zhs1234/gouo-canvas/pull/8)、[PR #10](https://github.com/zhs1234/gouo-canvas/pull/10)、[PR #11](https://github.com/zhs1234/gouo-canvas/pull/11)，处理状态改为待验证；GOUO-019 的建议修复补充"下发收藏排除已隐藏收藏夹"。继续审查注册验证、云端存储、计费、支付、文档同步、管理端与前端渲染，新增 GOUO-020（验证码可重复注册，P2）、GOUO-021（文档与任务不计配额，P2）、GOUO-022（作品无法彻底删除，P2）、GOUO-023（管理员越级查看作品，P2）。 | 23 项：待验证 19 项，待修复 4 项（均为 P2），已验证修复 0 项 |
| 2026-10-09 | GOUO-020 至 023 提交修复 [PR #13](https://github.com/zhs1234/gouo-canvas/pull/13)，处理状态改为待验证。用户确定回收站保留期为 3 天，GOUO-022 按此实现。GOUO-020、023 单元测试撤掉修复后失败；GOUO-021、022 为新增功能，未做撤销对照。 | 23 项：待验证 23 项，待修复 0 项，已验证修复 0 项 |
| 2026-10-09 | 用户决定不修改落地页文案，PR #13 还原落地页改动（提交 e586aa1）。GOUO-023 中"落地页承诺与实际能力不符"部分不在修复范围内，GOUO-022 中落地页仍写"可以随时恢复"，均为用户保留原文的决定；其余修复不变。 | 23 项：待验证 23 项，待修复 0 项，已验证修复 0 项 |
| 2026-10-09 | 继续审查图片结果恢复、Agent 接口与运行、Playground 令牌、支付回调（易支付、Stripe）、兑换码、MCP、Telegram、Service Worker、会话与限流。新增 GOUO-024（伪造来源 IP 绕过限流与令牌白名单，P1，已本地复现）、GOUO-025（自定义服务商轮询不经代理，P2）、GOUO-026（Agent 付费任务无费用上限或确认，P2）。 | 26 项：待验证 23 项，待修复 3 项（P1 1 项、P2 2 项），已验证修复 0 项 |
| 2026-10-09 | GOUO-024、026 提交修复 [PR #14](https://github.com/zhs1234/gouo-canvas/pull/14)，处理状态改为待验证；GOUO-026 按默认上限 4 张实现弹窗确认，未显示金额。GOUO-025 复核为误报（开启代理时异步自定义服务商在提交前即被拒绝），改为不适用。 | 26 项：待验证 25 项，不适用 1 项，待修复 0 项，已验证修复 0 项 |
| 2026-10-09 | 复查 PR #13、#14 及 GOUO-017 至 019 的修复，未发现问题，仅删除清理函数中一个未使用的字段（提交 0ddf1b1）。PR #8 至 #14 按顺序合并到 main（[0b9b54f](https://github.com/zhs1234/gouo-canvas/commit/0b9b54f)），合并后测试与构建通过。各项仍为待验证，需部署后按验收检查验证。 | 26 项：待验证 25 项，不适用 1 项，待修复 0 项，已验证修复 0 项 |
| 2026-10-09 | 复查合并后的 main（0b9b54f）：复核各项修复之间的交互（同步、配额、回收站、账号头、可信代理），以及后台用户管理、图片中继重试与计费、密码重置、模型目录、账务接口，未发现已合并修复引入的问题。新增 GOUO-027（重置链接未编码邮箱，P2，已复现）、GOUO-028（管理员调整余额与核对账务无角色范围，P2）。 | 28 项：待验证 25 项，不适用 1 项，待修复 2 项（均为 P2），已验证修复 0 项 |
| 2026-10-09 | GOUO-027、028 提交修复 [PR #15](https://github.com/zhs1234/gouo-canvas/pull/15)（未合并），处理状态改为待验证。 | 28 项：待验证 27 项（其中 2 项未合并），不适用 1 项，待修复 0 项，已验证修复 0 项 |
| 2026-10-09 | 按用户要求在本地运行环境实际执行验收检查（main 0b9b54f，GOUO-027、028 用 PR #15 head cbfa082）：GOUO-001、007、015、020、021、022、023 全部场景通过，标记为已验证修复；GOUO-027、028 在 PR 构建上全部通过、main 上原问题复现，待合并；GOUO-006、009、010、011、014、018、019、024 记录已验证的服务端部分；其余项交给用户，新增"交给用户验证"步骤。GOUO-006 的"热更新换商户后旧订单回调"待用户决定。新增 GOUO-029（环境变量无法把 TRUSTED_PROXIES 设为空，P2）、GOUO-030（管理端两个列表不按角色过滤，P2）。 | 30 项：已验证修复 7 项，待验证 20 项（其中 2 项未合并），不适用 1 项，待修复 2 项（均为 P2） |
| 2026-10-09 | 按用户要求修复已知问题：GOUO-029、030 提交 [PR #16](https://github.com/zhs1234/gouo-canvas/pull/16)，处理状态改为待验证；GOUO-006 按方案 (a) 在部署文档中说明换商户须新建网关（同在 PR #16）；GOUO-026 补充确认框费用显示，提交 [PR #17](https://github.com/zhs1234/gouo-canvas/pull/17)。均未合并。 | 30 项：已验证修复 7 项，待验证 22 项（其中 4 项未合并），不适用 1 项，待修复 0 项 |
| 2026-10-09 | 按用户要求继续审查并修复。分后端计费与云端存储、前端同步与存储、画布与界面三个方向审查 main 0b9b54f，逐条核实后新增 GOUO-031 至 042（P1 3 项：光构图片模型可经其他入口免费调用，已本地复现；平台账号令牌留在本地存储和备份中；快速连续撤销丢失编辑）。均已提交修复：后端 [PR #18](https://github.com/zhs1234/gouo-canvas/pull/18)，前端 [PR #19](https://github.com/zhs1234/gouo-canvas/pull/19)，GOUO-039 并入 [PR #17](https://github.com/zhs1234/gouo-canvas/pull/17)。核实后排除 1 项误报（"清空任务和图片会删掉画布引用的图片"：底层删除已跳过画布和会话引用的图片）。另记 1 项低风险备注不单列：图片结果恢复缓存为全站共享的 4 GB 上限，单个用户大量付费请求可填满它，代价较高。 | 42 项：已验证修复 7 项，待验证 34 项（其中 16 项未合并），不适用 1 项，待修复 0 项 |
| 2026-10-09 | 按用户要求将 [PR #15](https://github.com/zhs1234/gouo-canvas/pull/15) 至 [PR #19](https://github.com/zhs1234/gouo-canvas/pull/19) 按顺序合并到 main（[a496a11](https://github.com/zhs1234/gouo-canvas/commit/a496a11)）。合并前已试合并确认无冲突（PR #16 的新测试移到单独文件，避免与 PR #15 冲突）；合并后 `npm test`（461 项）、`npm run build` 及相关 `go test` 通过。各项仍为待验证，需按验收检查验证；GOUO-027、028 已在 PR 构建上通过全部验收。 | 42 项：已验证修复 7 项，待验证 34 项，不适用 1 项，待修复 0 项 |


| 2026-10-10 | 对 main a496a116 与 8 条未合并候选分支静态复核；新增 GOUO-043 至 GOUO-059（P1 6 项、P2 11 项），均修复中、待验证；GOUO-006 更正停用网关回调前提，GOUO-034 补充清理/重传竞态；保留原 42 项验收范围和历史，澄清已合并与未合并状态、空 CI 与历史部署边界；私有 Page 待同步。本轮没有执行测试、浏览器验收或模型/支付请求。 | 59 项：已验证修复 7 项，待验证 34 项，修复中 17 项，不适用 1 项；本轮新增已验证 0 项 |
| 2026-10-10 | 第三轮修复会话：对 main a496a11 做 15 个方向的深度检查（账号与登录、计费、支付、管理端权限、中继与 SSRF、云端作品库、数据库兼容、前端同步、生成与恢复、Agent、画布、前端安全、部署与 CI、并发与多实例、文档一致性）。与同日静态复核登记的 GOUO-043 至 059 对齐编号：为这 17 项追加修复记录，并按复核意见补修 GOUO-050（无 payment_intent 的外来会话）、054（清空后并发同步）、055（已上传收藏夹）、056（默认收藏夹）；043 的未迁移旧账号、057 的手动清理跨页引用保留为已知限制。新增 GOUO-060 至 086：修复 21 项，只登记 6 项。开 [PR #20](https://github.com/zhs1234/gouo-canvas/pull/20) 至 [PR #32](https://github.com/zhs1234/gouo-canvas/pull/32)，未合并；13 个分支试合并无冲突，SQLite 与 PostgreSQL 上回归全部通过，GOUO-027 至 033 标记为已验证修复。更正：批量删除日志只删消费日志，PR #23 描述已改。排除的误报和上游设计：自动晋级分组按累计充值计算；渠道详情返回 key、日志与 MJ 任务对全体管理员可见、管理员可改价格与倍率；OIDC 注册不处理邀请码。低风险备注不单列：root 默认密码与账号可探测；后端容器以 root 运行、基础镜像未固定版本；`server/docker-compose.yml` 是上游遗留文件且带固定口令；GHCR 镜像只含前端；`/v1/realtime` 未配置 WebSocket；Agent 的 `get_canvas` 结果不截断、`maskImageId` 不在图片白名单、参考图未缩图；后端在客户端断开后取消上游请求（是否解耦需产品决定）；单模型售价校验规则未写入文档；用户指南未覆盖画布和 Agent；16 张参考图可能超过 32 MB 请求体上限；配额提示写死 25 MB。 | 86 项：已验证修复 14 项，待验证 27 项，修复中 38 项，暂缓 6 项，不适用 1 项 |
