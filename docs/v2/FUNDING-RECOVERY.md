# 未知付款偏好：本机操作员核对恢复

T1.3 的 `v2/scripts/reconcile-funding.mjs` 只服务于当前固定 Native、单 Studio、独立 Docker SQLite 卷的本机私有部署。没有公开 HTTP 解锁接口、后台自动重试或外部 receipt 导入。日常实例没有执行过此恢复，真实启用配置仍关闭。

未知偏好 PUT 可能在 HTTP 超时后继续写入。读到期待偏好、等一段时间、重启 Studio 或手工改 SQLite 状态均不能证明旧 Native handler 已结束。此工具在持续持有 Studio `.process-lock` 独占事务的同一 helper 会话中，实际停止原 Native 容器、确认进程 Pid=0、启动同 ID 的新健康 boot并核对固定二进制，再以精确旧行 hash 做 CAS。helper 无网络、无 Docker socket、只读根文件系统，只挂载 Studio 卷和此脚本；只接受每行最多32KiB的私有stdin协议。

前置范围：由操作员明确批准 Studio 停机和 Native 重启，确认只允许 Studio 生成、其它内部消费者不并行写该账号设置，备份对应 Native/Studio 数据卷。工具不会自动停止/启动 Studio或启用 prepared edge。生产、外部 SQL/Redis、多个 Native/Studio、浮动二进制、Native宿主端口、非标准启动器或其它进程写 Native 卷均拒绝；不能为了通过工具临时绕过这些检查。

操作员先取得同一 Compose project 的完整64位 container ID（包括已停止 Studio）、稳定账号实例 UUID及本人 Native owner ID。以下变量须由操作员填写已核实的目标；不填写密码、JWT、relay key或金额。

```powershell
$taskDocker = 'C:/Users/56161/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe'
$taskProject = 'gouo-v2'
$taskStudio = '<已停止 Studio 的完整64位 ID>'
$taskNative = '<运行中 Native 的完整64位 ID>'
$taskInstance = '<该业务库绑定的稳定 UUID>'
$taskOwner = '<本人 Native 账号 ID>'

node v2/scripts/reconcile-funding.mjs inspect --docker $taskDocker --project $taskProject --studio-container $taskStudio --native-container $taskNative --instance $taskInstance --owner $taskOwner
```

`inspect` 只读本人现有 `funding_writes` 行与 hash，不重启、不修改主 SQLite、不运行 Ledger 的重启恢复、不查询模型。已有活跃 Ledger 进程即拒绝取得锁。完整 Docker inspect只在工具内用于核验，不打印容器环境。

审查 inspect 的 owner、instance、preference/status及hash后，使用该精确 hash 和显式 `--restart-native`。这一命令会中断目标 Native，必须有该目标的重启授权；不接受“我已重启过”的外部 JSON 证明。

```powershell
$taskExpectedHash = '<inspect 输出的完整64位 hash>'
node v2/scripts/reconcile-funding.mjs reconcile --docker $taskDocker --project $taskProject --studio-container $taskStudio --native-container $taskNative --instance $taskInstance --owner $taskOwner --expected-row-hash $taskExpectedHash --restart-native
```

错误 hash 在停止 Native 之前拒绝。停机/启动/二进制/健康/拓扑/锁/行CAS任一步失败，屏障保持未解除；Native可能已经停机或重启，操作员核对目标状态后决定后续，不自动再次执行命令。成功只把同一行设为 `reconciled` 并新增 `funding_recoveries` 审计（旧行hash/偏好/状态、实例、container/image/binary、前后boot和锁会话证据）。不会写 Native偏好、账户、金额、grant、request或reservation，也不把状态设为confirmed。

恢复后操作员另行批准/执行 Studio启动。新的发送仍须当前登录权限、本人 receipt/资金核验、本次余额同意和严格来源选择读确认；已恢复屏障不提供资金。旧模型 `unknown`、领取 `unknown`和held次数仍按原保护处理；此工具不能退款、释放次数、重新领取或把同一旧请求变成可重放。

实际隔离验证：`node --test v2/tests/recovery.cases.mjs` 8/8，含未终止超长输入在EOF之前拒绝/锁释放；`node v2/tests/stack/recovery-native.cases.mjs` 退出0，验证真实单容器 stop→Pid0→新healthy boot、持久卷、CAS审计、bad hash不重启、活跃Ledger拒绝及restart后失败不解除。原请求/次数unknown保持、工具从不启动Studio。Native仍未初始化，没有账户、模型或金额操作。该证据只覆盖上述本机拓扑，不能推广到分布式后台。
