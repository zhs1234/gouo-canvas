# 光构待修复清单

截至 2026 年 10 月 9 日（北京时间），光构共登记 30 项问题：7 项已在本地运行环境验证修复；22 项待验证（其中 GOUO-027、028 的修复 PR #15，GOUO-029、030 的修复 PR #16，以及 GOUO-026 补充费用显示的 PR #17 未合并）；GOUO-025 复核为误报，不适用。优先处理身份权限、文档覆盖和支付入账风险，再补齐跨账号、跨标签页及部分失败场景的回归测试。

审查基线为 main 提交 [1f3c463](https://github.com/zhs1234/gouo-canvas/commit/1f3c463d4f5d5b51ede64622fab20cef265770b6)。原始结论均为静态代码发现；各条目的单元测试及复现情况见其"修复记录"；用户于 2026 年 10 月 9 日说明该项目没有线上运行；此部署状态为用户提供，尚未独立核实，实际部署版本及功能开关未核验。P1/P2 是修复优先级，不表示相关条件已在生产环境成立。

## 当前状态

- v2 路线：暂时废弃。用户明确重启前，不继续验收或开发；保留分支及历史，不做删除。

- 已验证修复：7 项（GOUO-001、007、015、020、021、022、023），2026-10-09 在本地运行环境按验收检查验证，见"本地运行验证"一节

- 待验证：18 项已合并（GOUO-002 至 006、008 至 014、016 至 019、024、026），修复见 [PR #8](https://github.com/zhs1234/gouo-canvas/pull/8) 身份权限、[PR #9](https://github.com/zhs1234/gouo-canvas/pull/9) 支付、[PR #10](https://github.com/zhs1234/gouo-canvas/pull/10) 图片中继、[PR #11](https://github.com/zhs1234/gouo-canvas/pull/11) 云同步、[PR #12](https://github.com/zhs1234/gouo-canvas/pull/12) 前端安全、[PR #13](https://github.com/zhs1234/gouo-canvas/pull/13) 存储与账号（叠加在 PR #11 之上）、[PR #14](https://github.com/zhs1234/gouo-canvas/pull/14) 来源 IP 与 Agent 确认，均已于 2026-10-09 合并到 main（合并后提交 [0b9b54f](https://github.com/zhs1234/gouo-canvas/commit/0b9b54f)）

- 待验证（未合并）：4 项：GOUO-027、028（[PR #15](https://github.com/zhs1234/gouo-canvas/pull/15)，PR 构建已在本地通过全部验收）；GOUO-029、030（[PR #16](https://github.com/zhs1234/gouo-canvas/pull/16)）。另有 GOUO-026 的费用显示（[PR #17](https://github.com/zhs1234/gouo-canvas/pull/17)）、GOUO-006 的换商户说明（PR #16 文档）未合并

- 待修复：0 项

- 不适用：1 项（GOUO-025，复核为误报）

- 验证状态：19 项已由单元测试复现（撤掉修复后失败），GOUO-005 由脚本复现，GOUO-024 已用本地请求复现，GOUO-027 已用前端解析复现，GOUO-028 已由单元测试复现，GOUO-013、GOUO-015、GOUO-021、GOUO-022 待复现；2026-10-09 本地运行环境的验证结果见"本地运行验证"一节，支付沙箱和实际部署环境均未验证

- 已完成并验证的修复：7 项（本地运行环境：SQLite、mock 上游、模拟代理头，未在实际部署环境验证）

- 仓库没有在 PR 上运行的 CI；以上测试均为本地运行，不代表 CI 或线上验证通过

- GOUO-003、GOUO-004、GOUO-011、GOUO-014 为既有 PR #6 问题的独立复核，其余 12 项为本轮新增

## 优先处理顺序

1. 先确认 GOUO-001 和 GOUO-002 的部署条件，修复身份边界；评估限制 GitHub OAuth 入口及轮换可能暴露的管理令牌。

2. 修复 GOUO-003 至 GOUO-006，优先保护草稿、云文档和已付款订单。

3. 根据实际配置核查 GOUO-007、GOUO-008，并修复其下载目标和凭据绑定限制。

4. 完成其余 P2 问题及回归覆盖，尤其关注跨账号同步和停止后的付费派发。

5. PR #8 至 #14 已全部合并到 main（0b9b54f），合并后本地重新运行 `npm test`（452 项）、`npm run build` 及相关 `go test` 均通过。下一步部署到测试环境，按各条目验收检查完成验证后再标记为已验证修复。PR #13 上线后会立即删除回收站中已超过 3 天的内容，部署前评估是否先备份。

6. 反向代理不在本机或私有网段的部署，升级前配置 `TRUSTED_PROXIES`。

7. 修复 GOUO-029、030，决定 GOUO-006 中换商户后旧订单回调的处理方式；其余待验证项按"交给用户验证"中的步骤完成。

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

**待用户决定**：网关 A 热更新为另一个商户（换 app_id 和平台公钥）后，热更新前创建的订单再收到原商户签名的回调会被拒绝，因为回调总是按网关当前配置验签。这与验收检查"旧订单仍按原商户正确验签与结算"不符。可选：(a) 作为使用约束写进文档：更换商户时新建网关，旧网关保留到其订单全部完成；(b) 下单时保存网关配置快照，回调按订单快照验签。同一商户轮换平台公钥不受影响。

剩余：支付宝沙箱真实回调、微信支付多商户部分，见"交给用户验证"。

**修复记录（2026-10-09，换商户后旧订单回调）**

用户要求修复已知问题，按此前推荐的方案 (a) 处理：在部署文档中说明支付回调按网关当前配置验签，更换商户时新建网关并停用旧网关，旧网关保留到其订单全部完成或关闭（[PR #16](https://github.com/zhs1234/gouo-canvas/pull/16)，`docs/zh-CN/backend.md`、`docs/en/backend.md`）。代码行为不变；如需让改配置后的旧订单仍能按原商户入账，需改为下单时保存配置快照（方案 b），另行决定。

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

Agent 交互需要在浏览器中验证，见"交给用户验证"。确认框目前不显示金额，验收检查中的"费用显示与实际扣费一致"尚未实现。

**修复记录（2026-10-09，费用显示）**

[PR #17](https://github.com/zhs1234/gouo-canvas/pull/17)，提交 [6f7472f](https://github.com/zhs1234/gouo-canvas/commit/6f7472f)，基于 main 0b9b54f。确认框按所选模型的当前目录价格显示单价和本次预计扣费；读取价格失败时仍要求确认，只是不显示金额；提交时照旧校验价格版本，确认后价格变动会被拒绝而不是按新价扣费。已运行：`tools.test.ts` 新增金额显示与读取失败两种情况，`npm test`（453 项）、`npm run build` 通过。合并并按上方验收检查完成验证前，不标记为已验证修复。

### GOUO-027 重置密码链接未编码邮箱，含"+"的邮箱无法通过链接重置

优先级：P2。处理状态：待验证。验证状态：已复现（`new URLSearchParams('email=a+b@example.com').get('email')` 得到 `a b@example.com`），尚未在运行环境复现。

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

优先级：P2。处理状态：待验证。验证状态：已复现（单元测试，撤掉修复后失败），尚未在运行环境复现。

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

优先级：P2。处理状态：待验证。验证状态：已复现（本地运行环境，main 0b9b54f），尚未在实际部署复现。

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

优先级：P2。处理状态：待验证。验证状态：已复现（本地运行环境，main 0b9b54f 与 PR #15 head cbfa082），尚未在实际部署复现。

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

## 本地运行验证（2026-10-09）

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
- **GOUO-006 支付宝回调与多商户**：在支付宝沙箱建两个网关（不同 app_id），交替下单并完成支付，回调分别入账到正确订单；微信支付同样建两个商户交替验证。另请决定上面"待用户决定"中的处理方式。
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
- **GOUO-024 nginx 部署**：按仓库 `deploy/nginx.conf` 部署后，从外部用 curl 带伪造的 X-Forwarded-For 连续登录 21 次：第 21 次返回 429；后台日志里的 IP 为真实客户端地址。直连部署请先等 GOUO-029 修复，或在 config.yaml 中设置 `trusted_proxies: ""`。
- **GOUO-026 Agent 确认**：让 Agent 在一次对话中生成超过 4 张图片：超过时弹出确认框，取消不提交，确认后提交。确认框目前不显示金额，"费用显示与实际扣费一致"需要先决定是否在确认框中加金额。
- **GOUO-027、028**：PR #15 已在本地通过全部验收，合并到 main 后即可标记为已验证修复。

## 维护与关闭标准

- 新发现按 GOUO-017 起顺序追加，已有编号不重用；同根因问题合并到原条目并保留来源与更新记录。

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
