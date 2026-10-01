# 双账号地址、晚响应与只读画布

2026-10-01 T1.11。New API 是唯一账号、模型网关和金额权威；Studio 的 thread、run、project、asset 都以经 New API 校验的本人 ID 查询，客户端地址里的 ID 不是归属证明。当前结果以 [STATUS.md](STATUS.md) 和 [QA_ACCEPTANCE_REPORT.md](QA_ACCEPTANCE_REPORT.md) 顶部为准，F、真实 Native 和付费供应商的范围分别记录。

## 访问合同

- 有效 B 身份访问 A 的 thread/run/project/asset 返回 data-free 404，既不能取得内容，也不能由错误信息探测对方 revision。
- `assets/from-run` 先读取本人 run；`projects/from-asset` 先核验本人 asset。混合本人 project 和他人 asset 的 files、element 或 customData 引用在 CAS 写入之前拒绝。
- foreign thread 生成请求先于 ledger、试用和资金选择被拒绝。拒绝的重复请求不增加素材、项目、模型调用或权益占用；本人已物化的图片和项目重复请求返回同一对象。
- 当前没有 thread/project DELETE 路由。它的 404 只表示不支持，不能称为已实现删除授权。
- 客户端换户移除旧查询，私有编辑器按 owner 重挂并中止旧请求；普通请求还有 identity epoch 校验。F 故障反例移除指定旧 GET 的 AbortSignal、延迟成功响应，真实界面退出和登录另一 F 身份后释放；DOM MutationObserver 检查旧标题、消息、项目和不同原图没有闪现。它不是现实网络故障或 Native 撤销证明。
- 本机 Loomic 草稿与官方对照草稿仍按 owner 分区，未改写、迁移或删除旧库；不能将浏览器本机数据库称为安全的共享设备存储。

## 画布重开与入口

Q26 的实际基线：两个真实 Native 测试账号的已保存画布单纯 reload，均由 GET revision2 后无编辑 PATCH 为 revision3。根 F 回归也先观察到写入数1→2。根因是 `ServerCanvasEditor` 首次 SDK hydration 的 `lastSaved` 尚为空。

现在首次 SDK 规范化文档只建立已读基线；新 source 实际插入仍需要首次保存，真正编辑仍执行 revision CAS。no-op 保存不增加 revision，不虚报发生新服务器写入。本机备份、既有未存恢复副本、失败暂停、unknown 不重放和原图保留继续走原合同。回归覆盖真实插图初次保存、重开/手动 no-op、真实矩形编辑、裁剪原图、冲突、拒写和保存中继续编辑。纯读空画布或视觉样本显示“项目已打开”，不会靠无意义 PATCH 制造“已保存”。

Q27 的实际基线：`/studio?thread=...` 在 Nginx 跳到 `/studio/` 时丢查询，canonical `/studio/chat?thread=...` 正常。新增普通整栈反例另实际暴露默认模板把重定向写成内部8080端口，外部随机端口不能正确跟随。默认与 prepared 两份模板的 exact `/`、`/studio` 重定向都保留 `$is_args$args`；默认也采用 prepared 已有的相对地址，保持浏览器当前 origin/外部端口，无参数仍按原路径。不更改其它账户、token、admin、网关访问规则。原生边界和普通整栈分别核验 relative Location 与 encoded query。Hash 是浏览器重定向合同，不是服务器可读取的字段。

## 费用记录的唯一识别

Q28：原近期记录只显示模型和金额，两户相同用量时不能在界面辨认本人记录。现复用既有 Native `createdAt` Unix秒，以 `<time datetime>` 保留ISO值，可见中文时间包含本机时区和秒，窄屏可换行；未新增费用接口或金额来源。无效/缺失时间只显示“调用时间不可用”，不伪造当前时间，也不改变 recorded/unconfirmed 语义。F 反例实际展开 A/B 不同时间的费用记录，换户后排除 A 时间并观察晚响应闪现；五种非法时间不使面板崩溃。

真实 Native `/api/log/self` 的固定版 `formatUserLogs` 按页将展示 `id` 重编为1/2/3；它们不是数据库行主键，也不能单独证明归属。根以 B 本人 run 的三个 Native request IDs 只读核对真实 consume rows owner3，排除A；同浏览器实际费用明细补验已把每户 billing 的模型、时间、金额、输入/输出与本人RO记录精确匹配，并在展开的界面观察A 22:07:10、真实退出换户后B 22:10:31，B没有A时间，ISO值同样匹配。两个Native DTO没有requestId，不伪造该字段。两户余额、调用次数或金额相同不能替代这个识别步骤，记录折算也不成为钱包实扣证明。

保护快照对 tokens、原生订阅、预扣和消费日志取完整表哈希；users只取id/username/display_name/role/status/group/quota/used_quota/request_count安全投影，正常登录的last_login_at及认证会话元数据不纳入“资金不变”。Studio十一张保护表取完整哈希，供应商完整安全stats前后比较；另全owner核查被拒新ID在requests/run/reservations/submissions/gateway_attempts均不存在。不把这种限定保护快照说成整个Native数据库每字段未变。

## 隔离验收的重现边界

使用既有 opt-in `user-acceptance-environment.mjs start` 创建新的随机 loopback 项目。普通合成 A/B 经真实固定 Native UI 各发一次 `T111-A 本地验收生图`、`T111-B 本地验收生图`；provider 明确本地成本0，两种标记/颜色产生不同原 PNG，均640×480。默认旧 T16 和未标记 fixture 的图片合同保留，没有真实模型采购。

测试人员在本人 UI 打开并保存私有画布，再保存 `.local` 非敏感资源 manifest 和另一个只含合成身份的私有清单。资源 manifest 包含 version1、origin、stateFile、A/B owner、username、marker、threadId、runId、projectId、assetId、toolCallId、artifactIndex、projectRevision、sha256；身份清单包含 version1 与 A/B owner/username/password，不能含 JWT、Cookie、model key 或 security proof，不能输出或提交 Git。执行人员不能把真实用户密码写入这个测试清单。

```sh
node tests/stack/owner-isolation-native.cases.mjs --state .local/<random>/state.json --fixtures .local/t111-fixtures.json --identities .local/t111-identities.json --report .local/<fresh-report>.json --confirm-isolated-native
```

该脚本只接受 `.local` 的同实例 random compose/env、固定 source/binary、loopback 非日常/旧 QA 地址、普通合成身份和不同 PNG hash；执行前实际核验 Native binary。缺确认、日常8080和管理员身份三个反例均在 live binary/HTTP 前拒绝。报告存在防误重跑；JWT只在Node内存，遇429、无响应或非法DTO即停，无自动重试。约52个HTTP的有效异户矩阵、本人前后DTO hash和幂等验证仍需配合根只读完整 Native/Studio/provider 前后证据，单一HTTP报告不能证明不存在资金写入。

独立 profile 的完整 thread/project/project+asset/本人project+异户asset 地址双向核验，以及同浏览器 A退出→B登录的本机草稿/账号/费用/试用核验，按实际执行记录。冷访问会消耗原生共享账户 CT；本轮实际限流后保留浏览器和自然倒计时，不重启 Native、换来源、改安全参数或自动恢复。不能把身份门禁阻挡、访客401或丢 query 的空页计为已登录异户404。

本轮不操作日常8080初始化/真实开关、旧QA请求、unknown/held、原生旧资金或安全配置。真实 supplier、商户支付、公开容量和其它剩余门项仍独立验收，不以本章的限定隔离结果宣称成熟产品完成。
