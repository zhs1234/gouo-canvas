# 光构待修复清单

截至 2026 年 10 月 9 日（北京时间），光构共登记 26 项问题：25 项已提交修复 PR、待验证；GOUO-025 复核为误报，不适用。优先处理身份权限、文档覆盖和支付入账风险，再补齐跨账号、跨标签页及部分失败场景的回归测试。

审查基线为 main 提交 [1f3c463](https://github.com/zhs1234/gouo-canvas/commit/1f3c463d4f5d5b51ede64622fab20cef265770b6)。原始结论均为静态代码发现；各条目的单元测试及复现情况见其"修复记录"；用户于 2026 年 10 月 9 日说明该项目没有线上运行；此部署状态为用户提供，尚未独立核实，实际部署版本及功能开关未核验。P1/P2 是修复优先级，不表示相关条件已在生产环境成立。

## 当前状态

- v2 路线：暂时废弃。用户明确重启前，不继续验收或开发；保留分支及历史，不做删除。

- 待验证：25 项（GOUO-001 至 024、GOUO-026），修复见 [PR #8](https://github.com/zhs1234/gouo-canvas/pull/8) 身份权限、[PR #9](https://github.com/zhs1234/gouo-canvas/pull/9) 支付、[PR #10](https://github.com/zhs1234/gouo-canvas/pull/10) 图片中继、[PR #11](https://github.com/zhs1234/gouo-canvas/pull/11) 云同步、[PR #12](https://github.com/zhs1234/gouo-canvas/pull/12) 前端安全、[PR #13](https://github.com/zhs1234/gouo-canvas/pull/13) 存储与账号（叠加在 PR #11 之上）、[PR #14](https://github.com/zhs1234/gouo-canvas/pull/14) 来源 IP 与 Agent 确认，均已于 2026-10-09 合并到 main（合并后提交 [0b9b54f](https://github.com/zhs1234/gouo-canvas/commit/0b9b54f)）

- 待修复：0 项

- 不适用：1 项（GOUO-025，复核为误报）

- 验证状态：19 项已由单元测试复现（撤掉修复后失败），GOUO-005 由脚本复现，GOUO-024 已用本地请求复现，GOUO-013、GOUO-015、GOUO-021、GOUO-022 待复现；均未在运行环境、支付沙箱或真实并发下复现

- 已完成并验证的修复：0 项

- 仓库没有在 PR 上运行的 CI；以上测试均为本地运行，不代表 CI 或线上验证通过

- GOUO-003、GOUO-004、GOUO-011、GOUO-014 为既有 PR #6 问题的独立复核，其余 12 项为本轮新增

## 优先处理顺序

1. 先确认 GOUO-001 和 GOUO-002 的部署条件，修复身份边界；评估限制 GitHub OAuth 入口及轮换可能暴露的管理令牌。

2. 修复 GOUO-003 至 GOUO-006，优先保护草稿、云文档和已付款订单。

3. 根据实际配置核查 GOUO-007、GOUO-008，并修复其下载目标和凭据绑定限制。

4. 完成其余 P2 问题及回归覆盖，尤其关注跨账号同步和停止后的付费派发。

5. PR #8 至 #14 已全部合并到 main（0b9b54f），合并后本地重新运行 `npm test`（452 项）、`npm run build` 及相关 `go test` 均通过。下一步部署到测试环境，按各条目验收检查完成验证后再标记为已验证修复。PR #13 上线后会立即删除回收站中已超过 3 天的内容，部署前评估是否先备份。

6. 反向代理不在本机或私有网段的部署，升级前配置 `TRUSTED_PROXIES`。

## P1 待修复

### GOUO-001 普通管理员响应暴露管理令牌

优先级：P1。处理状态：待验证。验证状态：已复现（单元测试，撤掉修复后失败），尚未在运行环境复现。

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

### GOUO-007 供应商图片 URL 可触发后端内网请求

优先级：P1。处理状态：待验证。验证状态：已复现（单元测试，撤掉修复后失败），尚未在运行环境复现。

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

### GOUO-015 模型映射后图片编辑参数丢失

优先级：P2。处理状态：待验证。验证状态：待复现；修复后行为有单元测试覆盖，旧实现函数签名不同，未做撤销对照，尚未在运行环境复现。

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

### GOUO-020 注册验证码可重复使用，同一邮箱可注册多个账号

优先级：P2。处理状态：待验证。验证状态：已复现（单元测试，撤掉修复后失败），尚未在运行环境复现。

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

### GOUO-021 云文档与任务记录不计入云端空间配额

优先级：P2。处理状态：待验证。验证状态：待复现；修复后行为有单元测试覆盖，测试依赖新增的数据列，未做撤销对照，尚未在运行环境复现。

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

### GOUO-022 云端作品无法彻底删除，回收站一直占用空间

优先级：P2。处理状态：待验证。验证状态：待复现；修复后行为有单元测试覆盖，清理功能为新增，未做撤销对照，尚未在运行环境复现。

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

### GOUO-023 普通管理员可查看 root 与其他管理员的作品

优先级：P2。处理状态：待验证。验证状态：已复现（单元测试，撤掉修复后失败），尚未在运行环境复现。

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
