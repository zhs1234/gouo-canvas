# 光构待修复清单

截至 2026 年 10 月 9 日（北京时间），光构共有 16 项待处理问题：8 项 P1、8 项 P2。优先处理身份权限、文档覆盖和支付入账风险，再补齐跨账号、跨标签页及部分失败场景的回归测试。

审查基线为 main 提交 [1f3c463](https://github.com/zhs1234/gouo-canvas/commit/1f3c463d4f5d5b51ede64622fab20cef265770b6)。以下均为静态代码发现，尚未运行复现、构建或测试；用户于 2026 年 10 月 9 日说明该项目没有线上运行；此部署状态为用户提供，尚未独立核实，实际部署版本及功能开关未核验。P1/P2 是修复优先级，不表示相关条件已在生产环境成立。

## 当前状态

- v2 路线：暂时废弃。用户明确重启前，不继续验收或开发；保留分支及历史，不做删除。

- 待修复：16 项，其中 P1 8 项、P2 8 项

- 验证状态：16 项均待复现，仅有静态代码证据

- 已完成并验证的修复：0 项

- 本清单不代表已修改代码，也不代表 CI 或线上验证通过

- GOUO-003、GOUO-004、GOUO-011、GOUO-014 为既有 PR #6 问题的独立复核，其余 12 项为本轮新增

## 优先处理顺序

1. 先确认 GOUO-001 和 GOUO-002 的部署条件，修复身份边界；评估限制 GitHub OAuth 入口及轮换可能暴露的管理令牌。

2. 修复 GOUO-003 至 GOUO-006，优先保护草稿、云文档和已付款订单。

3. 根据实际配置核查 GOUO-007、GOUO-008，并修复其下载目标和凭据绑定限制。

4. 完成其余 P2 问题及回归覆盖，尤其关注跨账号同步和停止后的付费派发。

## P1 待修复

### GOUO-001 普通管理员响应暴露管理令牌

优先级：P1。处理状态：待修复。验证状态：待复现，仅静态证据。

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

### GOUO-002 GitHub OAuth 空邮箱匹配本地账号

优先级：P1。处理状态：待修复。验证状态：待复现，仅静态证据。

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

### GOUO-003 远端素材下载覆盖新的 Agent 草稿

优先级：P1。处理状态：待修复。验证状态：待复现，仅静态证据。

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

### GOUO-004 旧标签页借用共享版本覆盖云文档

优先级：P1。处理状态：待修复。验证状态：待复现，仅静态证据。

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

### GOUO-005 微信支付金额截断与订单金额不一致

优先级：P1。处理状态：待修复。验证状态：待复现，仅静态证据。

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

### GOUO-006 全局支付客户端串用商户配置

优先级：P1。处理状态：待修复。验证状态：待复现，仅静态证据。

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

### GOUO-007 供应商图片 URL 可触发后端内网请求

优先级：P1。处理状态：待修复。验证状态：待复现，仅静态证据。

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

### GOUO-008 URL 换源继承已有前端 API Key

优先级：P1。处理状态：待修复。验证状态：待复现，仅静态证据。

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

## P2 待修复

### GOUO-009 面板切换账号后本地与云身份不一致

优先级：P2。处理状态：待修复。验证状态：待复现，仅静态证据。

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

### GOUO-010 用户删除接口返回值不准确

优先级：P2。处理状态：待修复。验证状态：待复现，仅静态证据。

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

### GOUO-011 收藏变化被增量同步跳过

优先级：P2。处理状态：待修复。验证状态：待复现，仅静态证据。

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

### GOUO-012 专用画布导入未触发云保存

优先级：P2。处理状态：待修复。验证状态：待复现，仅静态证据。

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

### GOUO-013 全量 ZIP 导入缺少解压限制

优先级：P2。处理状态：待修复。验证状态：待复现，仅静态证据。

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

### GOUO-014 批量部分失败导致云图片 ID 错绑

优先级：P2。处理状态：待修复。验证状态：待复现，仅静态证据。

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

### GOUO-015 模型映射后图片编辑参数丢失

优先级：P2。处理状态：待修复。验证状态：待复现，仅静态证据。

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

### GOUO-016 Agent 停止后仍可派发待提交图片任务

优先级：P2。处理状态：待修复。验证状态：待复现，仅静态证据。

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
