# B3 持久图片任务：授权与恢复方案

2026-10-02，系统打通计划的B3设计审查。本文件是可实施方案，不是已实现接口。当前SYS-R1只有原请求结果GET，没有202任务或Worker。

## 先交付的 B3-I

采用现有SQLite和同一API进程中的runner，先实现一张图片任务。浏览器明确POST一次、收到202后仅读取任务；关页不取消该次授权。账号Bearer与本人relay key只在该次任务的API内存中，不写job/outbox/日志/磁盘，不借管理员token。数据库保存任务及结果，重启不重复付费调用。

这是持久任务和后台有限执行的第一阶段，不能称为完整B3独立Worker或无人值守重启续跑。后者需要单独完成后台授权、Native请求级资金/组约束和多进程恢复所有权。

## 必须复用的合同

- New API验证owner/账号状态/本人模型/有限token并负责所有金额；Studio不复制钱包或结算金额。
- 保持原`(owner,image,idempotencyKey)`去重域，同一个key不能从同步接口绕到job入口重复生成。body参数、模型能力版本及本次付款同意不可变；漂移409。
- 接收事务保存job、非金额reservation、通知意图；不能以202声称已预扣资金/生图完成。gateway fetch前持久化唯一提交屏障，外发后结果未知不能自动再次提交。
- 原unknown/held不迁移或清空。新job仅在有明确未提交证明且不存在未知Native写时，允许取消/释放本次未使用业务占用。
- 原图收到后先有界保存，验证格式/完整解码/像素/字节/hash，私有asset与终态同事务。恢复保存、打开项目或下载只操作已有bytes，不再模型。

```mermaid
stateDiagram-v2
    [*] --> accepted
    accepted --> ready
    ready --> submission_started: 先持久提交意图
    ready --> needs_authorization: 授权失效或API重启
    ready --> cancelled_before_submission: 明确未外发且无未知Native写
    submission_started --> output_saved
    submission_started --> unknown: 已外发意图且结果不明
    output_saved --> completed: 仅本地保存和验证
    needs_authorization --> ready: 本人明确重新授权同一未提交任务
    completed --> [*]
```

启动恢复：accepted/ready且无提交标记转needs_authorization；submission_started转unknown；output_saved仅恢复本地处理；completed只读返回。未知提交不得重新授权再生成。lease到期不证明供应商停止，TTL不自动退回权益或资金。

现有`Trial.remaining()`统计全部reservation；实现新released_before_submission时只排除这种具有证明的新状态，历史reserved/unknown保留。对未领取试用的用户也必须按现有严格资金receipt流程，不悄悄改为钱包。新增任务owner并发守卫应与现有同步生成/资料/领取/续用统一，不能只新增另一个busy Set。

## 为什么不能只持久化加密 relay key

固定Native的relay-only读取能获得有限信息，但不完整。usage DTO不含精确owner/tokenID/组/cross-group/IP；模型列表中的owned_by不是账号组；token日志不具备现有按request_id严格分页合同。资金选择来自用户setting及订阅receipt，不能通过token key冻结。依据固定版 [auth.go](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/middleware/auth.go)、[token.go](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/controller/token.go)、[model.go](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/controller/model.go) 和 [log.go](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/model/log.go)。

因此第一阶段在凭据失效/丢失、组或模型变化、Native资金写待核对时停止外发。需要用户对同一确定未提交job重新授权。不能持久账号Bearer或用后台万能管理员账号填补缺证据。

未来加密relay凭据需要新的明确服务器储存政策、独立私有主密钥、AEAD绑定instance/owner/job/token/policy、撤销/期限/备份生命周期。还需要权威的新鲜token/owner/组/资金/receipt检查，以及实际模型请求中的expected-group/funding绑定；较早只读快照不能消除读后并发变化。登出/改密撤销会话和撤销模型token是不同事件，应明确已接受任务的授权生命周期。此扩展不能暗改固定Native pin或prepared安全入口。

Native资金和token结算仍是不同步骤；成功输出可以completed同时费用recorded/unconfirmed。B3不会自动解决G2或补退款。依据 [billing_session.go](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/service/billing_session.go)。

## 独立队列阶段 B3-II/III

保持SQLite时BullMQ是候选，但增加独立Redis持久化/备份、outbox、运维和许可记录；不能与Native的禁Redis政策混用。其stalled任务可能再执行，业务提交CAS仍不可省，[官方生产要求](https://docs.bullmq.io/guide/going-to-production) / [stalled行为](https://docs.bullmq.io/guide/workers/stalled-jobs)。只有决定采用Postgres时再评估[pg-boss](https://github.com/timgit/pg-boss)，不能为了队列先迁整个数据库。

现Ledger长期process-lock不能直接由第二进程复用，也不能删除锁后宣称安全。独立worker必须统一启动恢复所有权、durable owner gate、claim/CAS/fencing和晚到结果保护。SQLite事务不跨模型等待；队列消息只带jobID，不带Bearer/key/用户原图。完整B3仍需这一阶段的实际实施与验收。

## 实施验证

测试用新随机Native＋本地零采购供应商；真实模型另门。真实子进程崩溃分别覆盖接收事务前后、提交屏障前后、供应商收到未回包、原图保存前后、终态事务前后。核对实际调用次数、原key、reservation、原图hash与异户404。再覆盖202丢响应、并发同步入口、失权/过期/禁用、未知资金写、磁盘满、本地保存重试和晚到CAS。未经验证的窗口不能写为通过。

顺序：T1.12/SYS-R2 → B3-I真实任务增量 → B3-II权威后台授权/资金约束 → B3-III独立成熟队列/Worker。具体命令与结果仍写SYSTEM-INTEGRATION-STATUS/STATUS，每项可审查提交；保留默认关闭和日常实例边界。
