# T1.7 Native 订阅退款事务候选启用门

状态（2026-10-01）：**当前冻结新版三数据库定向回归、SQLite 全包、构建与 396ms 在线退款合同全部通过。实际启用待明确请求；当前继续不开启。** 正式 Native pin、默认 Docker、试用/续用政策、安全限流参数和真实资金配置均未改变。G1 原生限流仍是独立门项；本项不代表公开服务 ready，不处理旧 G2 金额，也不解除其 unknown/held。

## 固定身份与修复范围

基础源码为 New API `0aec08fee811ec6136828fda790551b49e410301`。当前冻结候选 [refund-transaction.patch](../../v2/patches/new-api/refund-transaction.patch) SHA-256：`f17e8c2cd9a603ed8bd2024a006d1fd2fa74deff44251665c201fe979c2da9e5`。下列 18/18、全包及构建身份属于当前冻结版；下文历史 Native 表保留前版 patch `902ce69d0ea97028e527081bf290ac4bc14c42b5b428e2b1b62ed2816cb586f7` 的证据，随后单列当前冻结版 396ms 在线实证。候选镜像本地 tag 为 `gouo-native-refund-candidate:t17`，实际镜像 ID 为 `sha256:713a5ca07697b5ab4d34059d864f8728f50528471c4d0aaebb60e71eebc9c3fb`；Linux amd64 二进制 SHA-256 为 `eda77079be207ebdc505ba0540ffd359074397d28853819029a0bc9d02b38e75`。身份核验必须使用这些内容哈希，不能只信可变 tag。

[固定退款函数](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/model/subscription.go#L1402-L1426) 在外层事务锁预扣记录，却调用全局 DB 开启的 [另一金额事务](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/model/subscription.go#L1510-L1533)。候选让锁记录、锁订阅、减订阅 amount_used、更新 refunded 标记在同一真实 Gorm 事务提交/回滚。公开 delta 函数保留其独立事务、校验、零增量、上限与下限截断语义；没有新增退款重试、金额账本或公共退款接口。

全源码调用点核对包含同步计费、额外预扣回退和异步任务计费。只有退款函数需要复用外层事务；其他 delta 调用不持有 Gorm 事务。相关缓存仅包含套餐元数据，不缓存 amount_used，候选未添加缓存写；其他钱包/组缓存原有成功提交后更新顺序保持不变。

## 已执行的红绿证据

Windows 已有 Go 1.26.5，未安装系统组件。使用同一组公开函数回归测试，在真实数据库运行：

| 数据库版本 | 原版负向对照 | 候选 |
| --- | --- | --- |
| SQLite 3.50.4 | 3 fail / 3 pass，退款路径产生锁失败 | 6/6 pass |
| MySQL 8.4.11 | marker 写失败后的金额回滚反例 1 fail / 5 pass | 6/6 pass |
| PostgreSQL 16.15 | 同一原子回滚反例 1 fail / 5 pass | 6/6 pass |

MySQL/PostgreSQL 原版反例中，金额实际为 36，预期回滚值为 56；外层 marker 更新失败未回滚已提交的内层金额变更。候选 **18/18** 通过。测试在真实事务中先读到金额已变为 36，再用 Gorm callback 注入 marker 写失败，随后外部读取验证回滚。非 SQLite 并发重复退款两次都成功且只有一次金额效果；SQLite 允许冲突方锁失败，事务结束后显式验证幂等调用。

候选 upstream `model` 全包仅在 SQLite 执行并通过，耗时 7.600s；194 个 top-level pass、4 个 top-level skip，另有 external database nested subtests 跳过。不能称全 upstream 包在三数据库全部验证。

前版 patch `902ce69d0ea97028e527081bf290ac4bc14c42b5b428e2b1b62ed2816cb586f7` 的最终真实 Native 隔离对照均为独立随机项目、合成账号/订阅/有限 token、明确本地 response-lost provider fixture。每个最终 case 只发一次模型请求、provider 计数 1、Native HTTP 500，不重交：

| 观察 | 原版 | 候选 |
| --- | --- | --- |
| 请求中预扣 | subscription/token 各 20；record consumed | 同左 |
| 在线失败后只读 | 有界约 30s 窗口内 SQLite busy，最后一次读调用在约 35s 返回；无在线终态证据 | 402ms 首次在线只读观察 record refunded、subscription/token used=0、token remain=500000 |
| 停机持久证据 | 停止该随机测试 Native，确认 running=false/PID=0 后，仍 record consumed20、subscription/token used20 | 不需要停机才能观察退款 |
| 钱包/资金声明 | wallet=0；settlement unconfirmed | wallet=0 保持；settlement unconfirmed |

原版停机后快照只证明那时的持久内容，不能当作在线退款终态。前两次原版实验的读取失败/锁只能提供 inflight 或不完整证据，历史记录保留，不计为退款成功。T1.7 累计 **5 次独立 synthetic model call（3 baseline、2 candidate）、0 次 paid provider call、真实采购成本 0**。最终两个随机栈已清理；原 QA `53238`、daily Native 未重启/未修改；旧 G2 record 和 held 保持。

当前冻结版最终 Native case：`.local/subscription-refund-native-CCHIk9/evidence.json`，request ID `202610011057269047304928268d9d6YRmcAFuU`，严格匹配当前 patch/image/binary 哈希。唯一 1 次 fixture supplier response-lost、Native HTTP 500、inflight 预扣 20。**396ms 首次在线只读**观察 record refunded、subscription/token used=0、token remain=500000；wallet/user used/request_count 均为 0，token ID/expiry 保持。`nativeStopObservation:null`，不靠停机才读取退款结果；没有重交，`settlementState:unconfirmed`。该随机栈已清理，原版 baseline 未重跑，旧证据保留。此项证明指定本地故障合同通过，未扩大为任意 provider 的实际结算保证。

本地证据位置（ignored，包含脱敏元数据，不是公共凭据导出）：

- `.local/t17-refund-sqlite-baseline.log`、`.local/t17-refund-sqlite-candidate.log`。
- `.local/t17-refund-matrix/baseline-evidence.json`、`candidate-evidence.json` 和对应数据库日志。
- `.local/t17-model-candidate-all.log`。
- `.local/subscription-refund-native-cLMwzl/evidence.json`：最终原版在线锁与停止/PID0后的持久快照。
- `.local/subscription-refund-native-iD3LNd/evidence.json`：前版候选 402ms 在线观察（历史保留）。
- `.local/subscription-refund-native-CCHIk9/evidence.json`：当前冻结版 396ms 在线退款合同。
- `.local/t17-native-candidate-meta.json`、`.local/t17-native-candidate-build-proof.json`。

## 可执行复验与最小构建步骤

以下步骤属于新的明确授权隔离实验，不是当前环境的自动操作。使用独立固定源码 checkout，先核对 HEAD 与 patch hash。原版负向对照只加入 patch 中的新测试文件，保留原 model/subscription.go；候选再应用 source diff。不要覆盖原 QA 的数据库或工作目录。

分别选择 `REFUND_TEST_DIALECT=sqlite`、`mysql`、`postgres`，在源码目录执行：

```sh
go test ./model -run '^TestRefundTransaction' -count=1 -timeout=120s -v
```

MySQL/PostgreSQL 分别由操作者私下设置 `TEST_MYSQL_DSN`、`TEST_POSTGRES_DSN`，只指向新隔离空库；不要将密码填进报告或命令输出。未设外部 DSN 应 fail，不能算 skip-pass。每项使用唯一表前缀，只清理自身两表，迁移前注册 cleanup；Native 显式 `idx_user_sub_active` 索引在 PostgreSQL schema 共享，因此仍要求空库与串行执行。根代理实际本地 orchestration 为 `node .local/t17-refund-matrix.mjs start|baseline|candidate|stop`，各 mode 分别显式执行，不自动切源码。SQLite 全包复验命令为 `go test ./model -count=1 -timeout=120s -v`。

候选镜像的实际构建使用：

1. 固定源码 Dockerfile 的 `builder` target，以固定 Bun 1.4.0 digest 执行 `bun install --frozen-lockfile` 和真实 frontend build，再复制 `/build/web/dist` 到候选源码 `web/dist`。没有 placeholder UI。
2. Windows Go 1.26.5 交叉构建 Linux amd64：`GOOS=linux`、`GOARCH=amd64`、`CGO_ENABLED=0`、`GOWORK=off`、`GOEXPERIMENT=greenteagc`，执行 `go build -trimpath -ldflags "-s -w -X github.com/QuantumNous/new-api/common.Version=v1.0.0-rc.40+gouo-refund-candidate" -o <candidate-context>/new-api`。
3. 单独 runtime context 使用现有 `gouo-v2-new-api:latest` 基础镜像（实测 ID `sha256:cc9358b2ebf83142e2c10a73205d9e1599bf998f43cae58a41eff269ed483b1c`），只复制候选二进制至 `/usr/local/bin/new-api`。保留原 LICENSE/NOTICE/THIRD-PARTY-LICENSES，另加入固定 base source tar 和 frozen patch；镜像 labels 记录 base SHA、patch SHA 与 isolated scope。重建时必须重新检查 image/binary hash，不因同 tag 自动接受新内容。
4. 脱敏 metadata 严格记录 version/image/imageId/baseSourceCommit/patchDigest/patchFile/binarySha256。脚本核验 canonical patch、镜像 labels 与容器二进制后才运行隔离 case。从 `v2` 显式设置 `GOUO_RUN_SUBSCRIPTION_REFUND_REPRO=1`、`GOUO_NATIVE_TEST_DOCKER` 为 Docker 路径，原版执行 `node tests/stack/subscription-refund-native.cases.mjs`；候选执行同命令并附 `--candidate-meta .local/t17-native-candidate-meta.json`。这些命令会创建合成数据和一次 fixture 模型请求，不能作为常规 setup。

实测 frontend builder image ID 为 `sha256:ee61ba88bcf35f3bf5703d4e1d5ac1ed1e34dfc990661cac16a5bb5b5ebe69f3`；base source archive SHA-256 为 `39ece77e60aea96268755e36b19aae063e5d09663e70f92150b84282104d3cd2`。最终 model/subscription.go SHA-256 为 `0b5adb68b8794e23396d06f20c59fbba3ce88746333f1b9452d2612bc1fac11e`，测试文件 SHA-256 为 `a5ae67199b299bae00bffbd846f8b161068bed53a6187ff8106ff496ab62e930`；前版 metadata/proof 保存在 `*prior.json`，不覆盖历史。本项只记录 build proof，不发布镜像、issue 或 PR。

## 启用前仍需审查的边界

候选不使 Native subscription 与 token 两步退款原子化，也不改变 [异步 Refund](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/service/billing_session.go#L85-L128) 的生命周期。退出/崩溃、另一资金写失败、跨周期 reset、预扣 record 清理、完整 provider 资金结算以及任意第三方渠道仍未被本实验覆盖。HTTP 错误、consume log、等待时间或稳定 GET 都不能单独证明退款/实扣终态。

公有 delta 和当前候选内部 helper 均保留非正 ID 校验及原错误文本 invalid userSubscriptionId。既有第六项测试补充持久非正 ID 关联及负 ID 订阅行的反例：必须拒绝，金额与 marker 均不变；当前新版三数据库定向回归已包含并通过此反例。补丁不是数据库腐化修复。amount clamp、整数运算、record owner 与 subscription owner 依赖持久关联的既有边界保持，本项未声称解决全部计费问题。

正式启用必须是下一次明确请求，审查目标 image/binary/patch 内容哈希、变更后的原生 evidence/policy 身份、只在维护窗口替换该实例以及可执行回滚方案。回滚应恢复原已批准镜像/二进制与原配置；不能通过回滚重交模型或清除未知占用，旧金额处理需独立请求级只读对账与授权。G1 限流、公开 edge、商业价格和资金配置分别保留门槛。当前不请求开启，因为已有暂不开的决定。

New API 仍为 [AGPL-3.0](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/LICENSE)。修改版本分发/对外提供服务需保留 notices，并履行对应修改源码与网络用户源码提供义务；MIT 前端许可不覆盖它。
