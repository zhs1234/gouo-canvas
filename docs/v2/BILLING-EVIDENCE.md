# T1.5a 原生用量记录与实际扣费证据

New API 继续独立负责账号、钱包、订阅资金、模型令牌、预扣与结算。Studio 没有金额账本、补扣或退款接口。本任务修正费用证据的表达，不修改固定上游、任何真实资金或生成行为。

固定 Native `0aec08fee811ec6136828fda790551b49e410301` 的资金来源与模型token调整是两步操作。资金失败可在第一步返回；资金已完成而token调整失败也可返回错误。文本用量路径记录这个错误后仍继续写consume log，`used_quota` / request count 更早已增加。因此消费日志、HTTP200、累计used_quota及一次钱包查询，都不能独立证明资金和token两步均完成。源代码依据：[BillingSession](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/service/billing_session.go#L40)、[文本计量/错误处理及日志](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/service/text_quota.go#L451)、[本人消费日志](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/model/log.go#L560)。这项审查发现的是Studio误称状态，没有证据表明Studio因此重复扣费或改动资金。

## 返回与显示

- `usage.state=recorded`：本次全部成功HTTP调用拥有合法且互不重复的request_id；每个ID的本人Native type2日志查询都有完整、唯一且精确匹配的记录，quota非负安全整数且合计无溢出。返回记录quota、按当前Native兑换配置折算的cost、requestCount和requestIds。
- `usage.state=pending`：缺ID、重复ID、非成功HTTP、缺记录、重复/截断/异常列表、异常金额或查询失败，尚无完整记录证据；不虚构0成本，也不保证将来结算必然成功。
- `usage.settlementState=unconfirmed`：上述两态均不确认实扣或两步结算。不能仅有consume log就升级settled。
- 历史旧 `settled` 的对外读取、完成结果重放和事件按recorded/unconfirmed解释，金额与request IDs保留；不重写金额库、不重新收费。浏览器也兼容旧响应，但不显示“已结算/实扣成功”。

本人钱包 `balance` 仍来自当前Native本人quota，是当前余额快照；不是某个请求的扣款回执。兼容字段 `spent` 是Native累计used_quota的当前人民币折算，界面称“累计用量折算”；recentCalls.cost是consume log折算，界面称“最近用量记录”。价格、倍率与兑换率仍读取Native，不能把这种当前折算当历史固定兑换率、供应商采购成本或资金硬限额。

本人日志请求必须由Native按owner过滤，Studio不信任客户端owner或request_id归属。固定GetUserLogs返回page/page_size/total/items，type字段保留；用户列表的展示id会被上游重新编号，不用它充当全局唯一财务回执。查询不是模型请求，失败不发模型、不补扣、不退款，不改变旧unknown、权益占用或幂等执行状态。

## 验证范围与真正结算门槛

测试覆盖“consume日志存在但结算不明”“缺失或重复记录”“旧历史settled兼容”，以及成功输出/原图在费用待核对时仍可恢复与导出。资金失败、资金完成而token失败都可能提供同一公开日志DTO，测试不会由它推导任一种成功结果；输入是明确fixture，不能称真实Native故障注入已经执行。固定源码证明错误分支存在，真实Native合同另验正常本人日志DTO；本次没有对日常Native注入故障、调用真实供应商或改真实资金。

若未来需要 `settled` 状态，必须先取得固定Native按精确request_id暴露的资金来源与token提交成功凭据及失败边界，并验并发、预扣和退款。不使用钱包前后差额、日志次数、延时或单次一致GET代替。跨用户并发、其它充值与异步退款会混入余额变化；当前不编造缺失凭据。

真实注册试用仍默认关闭，未知有限权限续用恢复另列T1.5b；详细命令、实际数量、提交与未执行门槛见 [STATUS.md](STATUS.md)。

## T1.6 实际丢响应后的原生预扣门项 G2

四角色隔离实操使用真实固定Native＋明确本地供应商，不是日常卷或真实付费测试。owner6第三次聊天在供应商实际接收后socket丢响应，Native返回HTTP500，唯一requestID `202610010953095354276208268d9d6fP8hDe5W`。随后新的独立第四次聊天完成；本人三个正常consume日志各12，user.used_quota36/request_count3，钱包0；但subscription5 amount_used56、本人token5 used56/remain499944。第四次正常日志也记录subscription_pre_consumed20/post_delta−8/subscription_used56，差额并非只有UI显示。

私有只读核对该HTTP500对应的本人预扣record21：request_id匹配、user_id6、user_subscription_id5、pre_consumed20、status=consumed、created_at=updated_at1790848389。本次读时该记录未标refunded，与20差额相符。原生tail2000行经脱敏类别筛选有两条refund-error包含SQLite lock，但没有requestID；无法把这两条错误严格归因该请求。保留安全 `.local/t16-g2-evidence.json`，没有导出rawlogs、key、完整数据库或凭据。

固定源码 [controller/relay.go](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/controller/relay.go#L144)、[relay/request_billing.go](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/relay/request_billing.go#L71) 在失败defer调用Refund；[service/billing_session.go](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/service/billing_session.go#L85) 先标内存refunded，再gopool异步依次处理资金/token，失败只SysLog，不能更新已返回HTTP。订阅Refund最多尝试3次，见 [funding_source.go](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/service/funding_source.go#L121)。[model/subscription.go](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/model/subscription.go#L1402) 的退款交易内调用另开交易的PostConsumeUserSubscriptionDelta，是需要隔离重现的SQLite锁风险线索，尚未证明就是此次根因。

当前已证实“失败请求的持久预扣20仍为consumed”，**未证明真实采购、成功结算、退款完成或特定退款错误的请求级根因**。稳定GET、等待、无consume日志、HTTP500、用户累计用量均不能代替原生资金/token退款的原子提交凭据。Studio历史failed和requests.completed只表明错误已存；trial reservation unknown/held继续保留，同键只读重放不再模型，新的独立请求也不清旧占用。

T1.7需在新随机隔离环境准备最小可复现失败退款、原生前后持久记录/token/sub两步证据和审查方案，定位事务与请求日志关联，再按明确维护批准处理。不能用Studio另造退款账本、手工改原生金额、释放held、重交失败模型或静默升级固定pin修饰结果；日常注册试用和生成保持关闭。详见 [QA_ACCEPTANCE_REPORT.md](QA_ACCEPTANCE_REPORT.md)。

## T1.7 独立候选的实际证据（旧G2未改）

已提供同一固定来源的可审查退款事务补丁和显式opt-in新隔离重现，详见 [NATIVE_REFUND_TRANSACTION_GATE.md](NATIVE_REFUND_TRANSACTION_GATE.md)。补丁将订阅金额delta与预扣record退款marker放进同一个交易；SQLite/MySQL/Postgres的同六合同合18/18通过，对照基线实际失败，完整model包另仅SQLite通过。没有用Studio金额表补退款或修改日常固定pin。

最终新基线请求 `202610011040395314524828268d9d6vFzgpxyd` 只有一次本地供应商实际到达，HTTP500；在线查询busy，停止仅其自身随机Native/Pid0后的持久证据 consumed20/sub20/token20。最终新候选请求 `202610011057269047304928268d9d6YRmcAFuU` 同样一次到达/HTTP500，396ms首次在线只读核实record refunded/sub0/token0/remain500000、钱包/本人用量/次数0、tokenID和期限不变；镜像/补丁/二进制摘要均由案例核验。两例不同随机账号/卷，不能由候选结果推断旧G2已退款；原旧request/run/reservation/held保持。

该在线完整一致快照证明本次失败退款的实测结果，不提供所有成功生成的请求级原子结算凭据。Native资金与token仍分两步异步执行；进程中断、重置窗口、迟到清理、所有渠道与真实采购等边界未全覆盖，`settlementState=unconfirmed` 保留。日常generation/trial/renewal仍关闭，候选部署、真实金额和安全入口都待独立明确启用请求。
