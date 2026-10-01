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
