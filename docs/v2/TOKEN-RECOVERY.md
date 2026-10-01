# T1.5b 未知有限权限续用的私有核对

New API 仍是账号、模型令牌、额度和结算的唯一权威。此工具只核对已经批准的未知续用，写 Studio 的非金额绑定、操作终态与审计；不调用 Native 创建/修改/删除令牌接口，不读取完整 key，不改资金、试用次数、付款偏好或旧模型请求，不执行模型。真实日常配置仍关闭，工具未在日常数据卷执行。

## 创建前的持久证据

新续用保存严格 v2 target：固定 Native sourceCommit、gatewayOrigin、稳定 instanceId、owner、旧绑定/白名单元数据、Native Date、完整有限 POST 权限、额度上限/有效秒数和批准政策摘要。先落 pending，再取得退休证明，并通过 CAS 持久化 proof，最后才允许唯一一次创建 POST。proof 包含 Native Date、退休种类和旧令牌白名单；允许 status/accessed_time 的原生证明变化，其他权限/额度漂移拒绝。SQLite 新增 nullable proof 列，旧 v1 target 原样保留，不以当前配置回填旧批准。

证明丢失、创建响应丢失或确认失败均保留 unknown，重启不自动重试。恢复工具对旧无 proof 列的表只读使用 NULL AS proof，不迁移数据库；v1、缺 proof、损坏 JSON 拒绝恢复，不清屏障。

## 支持的动作

| 动作 | 证据与结果 |
| --- | --- |
| `inspect` | Studio 必须已由操作员停止。只读返回脱敏 target/proof、真实旧 binding、当前配置批准摘要与完整行哈希。首次续用没有 binding 时如实返回 null，不虚构已有绑定。不会重启 Native、查询 key 或改账本。 |
| `adopt` | 完整 v2/proof、旧令牌已退休、新目标在持久库中唯一且本人持有、未软删除、启用/有限/未到期、全部权限与批准精确相等、used_quota=0、没有任何 type=2 消费记录，且未被任何 Studio owner 绑定。事务写审计、新绑定和 `adopted` 终态。首次默认 `gouo-studio` 旧权限允许对真实 null binding 做 CAS 插入。 |
| `close-empty` | 同样要求完整 v2/proof；持久库中批准目标名称完全不存在，包含其他 owner 和软删除行的查询仍为空。只写审计与 `reconciled_empty`，旧 binding 原样保留。下一次须本人重新查询并明确确认，不能重交旧 key。 |

重复、软删除、跨 owner、已有消费/已用量、权限/期限/旧 proof 漂移、已有绑定、缺证据、过期目标、行哈希/实例/配置变化都保留屏障。两种恢复终态的原幂等键永久返回 409，不能被普通 completed 重放逻辑当成成功。旧 run、held、资金偏好未知记录不清除；解除续用屏障不承诺本人已经能生成。

## 操作窗口与部署限制

仅支持固定二进制的单 Native 容器、同一 SQLite 文件存账号与日志、无 Redis、无批量更新、Native 无宿主发布端口、唯一 Compose 私有网络/别名、独立持久 Native/Studio 卷。当前 Studio 必须是同 instance 的已批准 user-token/model/有限续用模式，不接受共享令牌或固定 owner。配置文件必须独立只读挂载。Native RetryTimes 的持久值必须明确为 0。

操作员先停止 Studio，并检查所有外部域名、代理、隧道、插件、后台和可信内部消费者，确保恢复期间模型 key、token 写入和 relay 入口排他。`--confirm-private-token-ingress` 是操作员确认，不能代替实际网络证明。工具检查容器/卷写入者，但不宣称排除所有 Native 管理员并发写入。

工具持有与 Ledger 相同的连续进程锁，在隔离 helper 中先读批准行；明确停止同一 Native 并确认 Running=false/Pid=0 后，通过只读卷读取全部同名 token（含软删除/跨 owner）、旧 token、owner 状态/组和消费记录。重新启动同一容器，确认不同 boot、固定二进制、healthy 和真实 HTTP Date，再次只读取得相同持久元数据。随后重核对拓扑和当前批准配置，在 Studio 事务中重新核对行/binding 哈希，写审计、终态和绑定。Native 卷只读，helper 无网络，原生表不会被修复或迁移。

实际结束旧 handler 只用于关闭晚到 token 创建的进程边界；不证明已扣款请求结算完成，不承诺退款或计费成功。Native 读取与 Studio CAS 不是跨库原子事务，受控维护窗口与之后每次生成的新鲜 Native 权限检查仍必需。

当前配置核验要求完整启用且 live-verified 的非视频模型目录与 target 模型精确相等。如果本人的有效组模型只是当前目录的子集，工具会保守拒绝；尚未提供本人当前组权限的额外只读证明，不能放宽模型匹配绕过此门槛。政策、cap 或 lifetime 已改变时也拒绝，不能用新政策追认旧写入。

## 私有 CLI

从 `v2` 执行；所有身份必须由操作员核对，容器参数使用完整 64 位 ID。以下是运维模板，未对日常实例执行。生产/真实实例的停服与 Native 重启须另获明确授权。

```powershell
node scripts/reconcile-renewal.mjs inspect `
  --project <精确Compose项目> `
  --studio-container <完整Studio容器ID> --native-container <完整Native容器ID> `
  --instance <已批准UUID> --owner <本人正整数ID> `
  --docker <Docker可执行文件路径>
```

审查输出后选择 `adopt` 或 `close-empty`，不能自行改 target。重新执行相同身份参数，添加 inspection 返回的完整哈希和两个明确确认 flag：

```powershell
node scripts/reconcile-renewal.mjs adopt `
  --project <精确Compose项目> `
  --studio-container <完整Studio容器ID> --native-container <完整Native容器ID> `
  --instance <已批准UUID> --owner <本人正整数ID> `
  --expected-row-hash <inspection返回的64位哈希> `
  --restart-native --confirm-private-token-ingress `
  --docker <Docker可执行文件路径>
```

不接受外部 receipt、unlock、force、直接写 SQL 或自动重交 flag。哈希变化须重新 inspect 并审查。工具始终不会启动 Studio；成功后由操作员审查 `renewal_recoveries`，明确启动 Studio，再做本人只读权限查询。继续发送仍须原来的资金授权与其他屏障通过。

失败会保留 unresolved 屏障，事务失败同时回滚审计与绑定。如果停止 Native 后的 SQLite 读取、启动或证据核验失败，Native **可能仍停止**；错误会报告 running/stopped/state unknown。操作员必须核对实际容器状态后决定下一步，不能把错误当成恢复完成，也不能假设服务已被自动启动。清理只删除本次 helper，不删除数据卷。

## 可重复证据

`npm test` 包含 helper 23 个领域反例与 host 6 个流程反例；`npm run test:api` 覆盖证明持久化先于 POST、v1 保留、写一次及 unknown/重放/授权边界。完整实际数量见 STATUS。

```powershell
$env:GOUO_RECOVERY_TEST_DOCKER='<Docker可执行文件路径>'
node tests/stack/renewal-recovery-native.cases.mjs
```

随机独立 Compose、真实固定 Native HTTP/SQLite、合成账户与有限批准策略、无可调用供应商，两例实际通过：owner2 的真实创建响应丢失后 adopt 首次 null binding；owner3 的创建未发出后 close-empty。错误哈希没有重启；两例原 key409，恢复不启动 Studio，显式重启后分别 ready/expired。Native token 元数据和 key 指纹、用户额度/用量、订阅与日志前后相同，旧未知 run/held/funding 保留。恢复期间 Native 写与模型调用为 0，真实费用 0，不能据此声明公开入口排他性或真实供应商验收。

另以 `node tests/stack/token-native.cases.mjs` 复验真实到期与启用零额路径，旧 key/额度/期限/已用量、钱包/订阅/日志保持。两个正常续用各创建一次，原 key重放不创建；零额证明只访问 Native `/v1/models`，不调用供应商。固定源依据：[批量更新开关与进程退出](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/main.go)、[token 持久状态](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/model/token.go)。
