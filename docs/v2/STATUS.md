# 实际交付与验证状态

## T1.5b 未知有限权限续用的私有核对（2026-10-01）

基于T1.5a `9ca25f97a2aa427cc3261412c165fec68601401a`，仍在 `codex/registration-trial`。三位gpt-6.1-sol子智能体分别实现API不可变批准/proof、只读恢复helper与反例、真实固定Native恢复合同，另做交叉只读审查。没有依赖或锁文件变化，没有上游/legacy/main改动、push/merge、生产部署、真实资金/安全配置或付费模型操作。

创建前先持久化严格v2 target（实例/owner/固定版本/旧元数据/NativeDate/完整有限权限/cap/lifetime/policyhash），取得旧退休证明后CAS保存proof，再执行唯一Native创建POST。旧v1不回填、不变成v2。新增私有 `scripts/reconcile-renewal.mjs` 的inspect/adopt/close-empty：Studio显式离线、连续Ledger锁、精确容器/二进制/私有SQLite拓扑、当前批准重核对，实际停止同一Native并确认Pid0后只读全部同名token（含软删除/跨owner），新boot/healthy/HTTPDate后取得相同元数据，最后Studio事务内再次CAS行/binding并写审计。Native卷只读、helper无网络、不读取完整key。详见 [TOKEN-RECOVERY.md](TOKEN-RECOVERY.md)。

adopt只接纳批准的唯一、本人、未用、未消费、未软删除、未到期且完整权限一致目标，首次默认旧权限可对真实null binding做CAS插入；close-empty只支持完整v2/proof且目标完全不存在。终态adopted/reconciled_empty的原key仍409，旧run/held/funding屏障不清除，不充值/续额/重领/重发。缺proof、旧v1、重复/软删除/跨owner、消费、漂移、配置变化均保守拒绝；政策变更或本人组模型只是目录子集暂不自动恢复。

审查修复并增加反例：首次续用没有binding而被误拒；恢复终态被混称普通完成；损坏JSON错误可能回显片段；旧表没有proof列导致只读inspect失败。旧表现在仅PRAGMA读取并SELECT NULL ASproof，工具不迁移。host错误报告Native running/stopped/state unknown，不承诺失败后自动开机；工具始终不启动Studio。两库核验不是跨库原子CAS，受控入口维护窗口和每次生成新鲜权限检查仍必需，不把旧handler终止当成结算或退款证明。

最终实际验证：

| 命令 | 结果与证据边界 |
| --- | --- |
| `npm run check` | 类型、领域、**150/150 API**与构建通过（11.91秒，既有第三方chunk警告）。其间领域49/49；helper后续旧schema/CLI反例加入后单独 `npm test` **51/51**通过，`.local/t1-5b-domain-final.log`。host失败状态文案更改后定向6/6再验通过。 |
| `npm run test:e2e -- --workers=1 --reporter=line` | **71/71**（1.8分钟），保留assistant-ui/原图/草稿/画布/手机与账号回归；`.local/t1-5b-browser-final.log`。没有新增UI功能或替换编辑器。 |
| `npm run test:stack` | **退出0**，真实固定Native未初始化边界、personal替身2/2及fresh user-token替身1/1；`.local/t1-5b-stack-final.log`，仅清理自身随机资源。 |
| `node tests/stack/renewal-recovery-native.cases.mjs` | **退出0，两例**：真实创建后丢响应的owner2→adopted/首次null binding→ready；创建未发出的owner3→reconciled_empty→expired/canRenew。原key409、错误哈希不重启、CLI仍保持Studio停止。Native token/key指纹/钱包/用量/订阅/日志前后相同，旧unknown run/held/funding不动，0模型/真实费用。`.local/t1-5b-renewal-native-evidence.json`保留安全stdout与断言总结，不导出完整数据库快照；HTTP写0依据已执行只读路径，不冒称独立方法计数器。 |
| `node tests/stack/token-native.cases.mjs` | **退出0，两例**：新版v2/proof到期old1→new2、启用零额old3→new4；各创建1、重放0，旧key/quota/expiry/used及钱包/订阅/日志保持。零额退休仅Native `/v1/models`鉴权1次，模型0/真实费用0。`.local/native-token-iEJnvE/evidence.json`。 |
| `node --check`、交叉只读review、`git diff --check` | 脚本/差异通过；领域覆盖audit失败事务回滚、持续锁、nonce/哈希/CAS、秘密字段/损坏JSON/超长输入、同名/软删除/跨owner/使用/模型期限漂移与旧key拒绝。 |

真实恢复测试全部使用随机独立卷、合成账号/有限批准/fixture资金，无Native或Studio宿主端口，无可调用供应商；不能冒称公开部署排他性、真实支付或付费模型验证。真实源额外核对固定main.go的BATCH_UPDATE_ENABLED与进程退出实现，未升级/修改上游。后续helper输入白名单/旧表反例及host失败状态提示不改变已执行Native主路径，单独反例复验通过，没有重新制造或重交旧unknown。

本机默认Compose仅重构建web/Studio并 `up --wait --no-deps studio-api web` **退出0**，三个服务healthy、仅web回环8080发布、health200；Native ID与原StartedAt完全相同，未重启、setup仍status=false/root_init=false。实际Studio loadConfig generation/trial/renewal全false，Nginx容器模板SHA256与默认模板相同（prepared未应用）。`.local/t1-5b-preview-refresh.log`与`.local/t1-5b-preview-evidence.json`；恢复未在日常卷执行。预览 `http://localhost:8080/studio/`。

下一任务 **T1.6 综合用户验收与问题修复**：按QA_ACCEPTANCE四角色、28场景执行独立浏览器实操，F/N/P分别统计，先准备隔离真实Native＋明确本地供应商替身，真实配置/付费未批准场景列门槛。此轮局部恢复测试不计作最终28场景已完成，整体成熟产品目标继续进行。

## T1.5a 原生费用记录证据与旧历史兼容（2026-10-01）

在T1.4 `cc498a0d3c048f2594891d2cda20353c06753ce8` 上继续，分支仍 `codex/registration-trial`，三位gpt-6.1-sol子智能体分别实现API证据/历史兼容、中文UI/原图浏览器回归、固定Native主源与stack/真实日志复验。没有新增依赖、lockfile/上游源码/main改动、push/merge、生产或真实资金操作。

修复已证实P2：固定Native文本路径在SettleBilling错误后仍可能写消费日志、累计used_quota更早已增加，原Studio只凭日志标settled会误称成功。`recordedUsage`现在只在每个本人request_id都有完整唯一Nativepage1/size2/total1/items1/type2匹配、quota非负safe整数且聚合无溢出时返回recorded，缺失/重复/异常为pending；两者settlementState=unconfirmed，不确认资金和token双步提交。保留原金额/IDs/调用数/输出，不补扣/退款/重发。真正settled须Native提供请求级提交成功凭据，不能用钱包差额、日志或GET稳定代替，见 [BILLING-EVIDENCE.md](BILLING-EVIDENCE.md)。

旧settled/pending结果、历史事件及完成幂等重放在对外DTO只读规范化；旧SQLite JSON原样保留，不重新查询模型或改旧金额。assistant-ui消息显示记录说明，Loomic及账号账单区把spent改称累计用量折算，recentCalls为记录折算/实扣待核对，余额仍Native当前本人余额。pending不承诺稍后必然结算成功；原图下载、历史刷新与输出仍保留。

最终实际验证：

| 命令 | 结果及证据边界 |
| --- | --- |
| `npm run check` | 类型、**22/22**领域/探测/恢复、**147/147**API、构建通过（12.00秒），既有第三方chunk警告。`.local/t1-5a-check-final.log` |
| `npm run test:e2e -- --workers=1 --reporter=line` | **71/71**（1.9分钟）；新增recorded/旧settled/pending三例，真实点击fixture原图下载、reload后证据/输出保留、0自动发送；旧完整UI/草稿/画布/手机回归保留。`.local/t1-5a-browser-final.log` |
| `npm run test:stack` | **退出0**：真实固定Native未初始化边界；显式personal替身2/2与fresh user-token替身1/1。fixture分页/type/total与固定Native主源同步，实际Nginx/SDK/browser验新状态；仅随机测试资源清理。`.local/t1-5a-stack-final.log` |
| `node tests/stack/trial-native.cases.mjs` | **退出0**：五个既有即时成功DTO实际pending/unconfirmed；原生日志和SQLite快照完成后，以原request IDs调用真实recordedUsage做有界只读核验，5组recorded/unconfirmed，quota524/524/500/12/12。严格Native分页/type/total保持，0新增模型操作。`.local/native-trial-WnvyRt/evidence.json` |
| 额外定向API/浏览器、`node --check`、`git diff --check` | API定向14/14；中文金额回归2/2及三状态原图用例3/3；脚本/差异通过，无依赖变化 |

真实Native正常快照保持：零钱包owner消费6条560、订阅560、token499440；混合owner消费10条1096、订阅548、钱包9452、token498904且ID/期限不变。原wallet→subscription→wallet与试用关闭/更换后wallet明确授权路径保留，旧grant/次数未变。共13chat/3image全部供应商为loopback替身，真实供应商调用/费用0。记录可见性只是recorded证据，金额一致另由Native SQLite快照核验，不宣称完成Native结算故障注入。

保留一次验收失败：首版新增Native断言误要求即时响应recorded，实际日志尚未可见、pending/unconfirmed正确，测试失败后只清理自己的随机栈、未重交旧请求。修正测试假设，用全新隔离栈验证即时pending与后续只读recorded，保护未放宽。本轮API/完整浏览器/整栈最终均通过。

日常预览再次以原默认Compose重构建/`up --wait`退出0，Studio/web更新，原Native未重启。仅三个服务healthy、web回环8080发布，Native setup仍status=false/root_init=false；Studio实际generation/trial/renewal全false，prepared=false。没有录入真实账户、计划、渠道或安全配置。`.local/t1-5a-preview-refresh.log`，预览 `http://localhost:8080/studio/`。

下一任务 **T1.5b**：未知有限权限续用的私有停服核对恢复。只读方案审查确认当前旧target仅name/quota/expiry，不足安全adopt；需版本化批准快照、真实旧Native handler终止与只读SQLite（含soft-deleted/重复/跨owner）、原key仍拒绝的独立恢复终态、CAS/binding/audit同事务，并保留旧run/held/funding屏障。方案尚未实现、工具不可用；不由当前政策填补旧operation并自动解锁。真实计划/入口/生成/续用仍关闭，最终28场景四角色QA未执行，目标继续进行。

## T1.4 有限权限明确续用与真实原生账户浏览器路径（2026-10-01，默认关闭）

在 `codex/registration-trial`、T1.3 `2793093` 上完成，仍含合并V2基线 `abe46c4`。三位 gpt-6.1-sol 子智能体分别做有限token安全实现/审查与真实Native验证、账号真实CLI/edge验收、薄UI与浏览器反例；全部开发留当前项目。没有新增依赖/修改lockfile、push/merge/main改动或生产部署，本轮远程CI未执行。

新增 `/api/studio/access` 本人只读状态，以及严格版本摘要、UUID幂等键、明确confirm的 `/api/studio/access/renew`。默认关闭；需要固定版本、同网关/实例、人工核验studio-only relay/token写入/完整模型key和关闭Redis/batch的严格政策。只支持旧权限严格Native Date到期，或耗尽status4；启用零额内部GET `/v1/models`取得明确拒绝并核对status4，不发供应商请求。先持久intent，再创建新的有限token，不PUT/DELETE旧token，不充值/改偏好/重新领取。成功结果与新owner binding同事务，key仅本次服务器内存。unknown创建/读取、重启pending与旧未核对生成/held阻止续用；unknown续用也阻止新生成。金额仍只在New API；详见 [TOKEN-RENEWAL.md](TOKEN-RENEWAL.md)。

assistant-ui/Loomic账号区接入只读权限与明确续用；续用清本人旧余额授权、保留另一owner，不自动生成或重交。新增Studio显示名称薄表单，精确Native PUT后本人GET确认成功再更新缓存，unknown/换owner清理状态。真实固定Native profile没有名字控件、注册丢redirect、Native SPA导航Studio停404，以及 `/studio` 301附容器端口均已发现并修复：prepared Native HTML注入自有导航脚本、认证目标保留、跨SPA完整同源document加载、相对slash跳转。显式security目标与外部redirect安全边界保留；账号链接间距也已修正。邮件/MFA/passkey/真实支付没有由这次密码流程证明。

prepared edge关闭公有 Native模型token所有写入、删除及单个/批量完整key；masked读与Native本人账号PAT路径分列。PAT不是model relay key，原生security proof保护保持。所有relay/管理入口仍私有；人工JSON和准备模板不证明真实部署排他性，本轮日常栈未应用该override。

本轮最终实际验证：

| 命令 | 结果及证据边界 |
| --- | --- |
| `npm run check` | 类型、**22/22**领域/探测/恢复、**142/142**API、生产构建通过（10.62秒）；既有第三方chunk警告。`.local/t1-4-check-final.log` |
| `npm run test:e2e -- --workers=1 --reporter=line` | **68/68**（1.7分钟），含新增6续用/显示名与6跨SPA导航，以及既有聊天/画布/移动/旧稿/原图；明确fixture。`.local/t1-4-browser-final.log` |
| `npm run test:stack` | **退出0**：真实固定Native未初始化边界、personal契约替身2/2、fresh user-token契约替身1/1；当前构建及实际Nginx/SDK/browser。仅清理随机测试项目。`.local/t1-4-stack-final.log` |
| `node tests/stack/token-native.cases.mjs` | **退出0**：真实固定Native到期ID1→2、enabled零额ID3→status4后新ID4，每例1次POST、同key重放0POST、0PUT/DELETE；旧key/ID/额度/期限/used保持、钱包/订阅/消费日志不变；0模型/费用。`.local/native-token-Q263Xh/evidence.json`，明确未证明prepared排他入口 |
| `node tests/stack/account-browser-isolation.mjs start|refresh-web|stop` + Playwright skill CLI真实UI | 注册、加密登录、Native安全proof改密、当前Cookie刷新200/另一context旧会话401、旧密码拒绝/新密码成功、Studio恢复；新注册保留redirect并自动完整加载同隔离53174Studio；显示名实际PUT200/GET200与NativeSQLite一致。显式security仍Native；0channels/subscriptions/tokens/consume/model/费用。`.local/native-browser-T0RoAH/security-evidence.json`；脱敏截图 `output/playwright/` |
| `node tests/stack/trial-edge.cases.mjs` | **退出0**：真实固定Native空库＋authenticated echo分列；所有模型token写入/key错误method/query/编码/路径变体404，protectedTokenCalls0；metadata/账号PAT路由reachable且匿名401、Bearer保留；相对301与NativeHTML仅一次script注入、精确profile桥仍通过。echo不是Native安全proof验收 |
| prepared Compose `config --quiet`、新增脚本`node --check`、`git diff --check` | 通过；示例续用政策operatorVerified=false有意不能启用 |

保留验收问题：首次原生跨SPA跳转缺陷曾短暂只读加载日常8080 Studio，立即返回隔离端口，无日常账号/配置/模型变更；修复后同隔离origin保持。长CLI流程遇明确Native429，等待默认窗口自然到期后显式登录成功，未重启Native/改安全设置或重发未知请求。一次失败登录snapshot输出合成测试密码，后续已抑制填充密码的snapshot输出；原始CLI文件只留忽略目录，不进入commit。初次语法检查误加v2路径、准备Compose校验误写文件名属于本地命令路径错误，正确路径检查通过；不是放宽保护或应用成功。最终完整测试一次通过。

日常开发预览已用同一默认 Compose 重构建并 `up --wait`，退出0；只更新 Studio/web，Native保持原running实例。三个服务healthy，仅127.0.0.1:8080发布；health200、匿名access401、Native setup `status=false/root_init=false`。当前Studio实际加载generation=false、trial=false、renewal=false，Nginx prepared=false；没有初始化账号/渠道、换用受控入口、启用试用或真实收费。日志 `.local/t1-4-preview-refresh.log`。访问 `http://localhost:8080/studio/` 可查看当前界面。

下一项 **T1.5**：原生费用记录的证据语义，以及未知token续用的私有停服核对恢复。独立只读审查已确认固定Native在资金/token结算失败后可能仍写consume log，而Studio只凭该日志标settled；当前没有证据显示Studio因此额外扣款/退款，但日志不能证明实扣成功。需要改为用量已记录并兼容历史，再单独完成可审查unknown恢复；不要用钱包差额/一次GET/原funding恢复冒充确认。真实资金/配置/供应商仍待明确批准，最终28场景四角色多智能体用户模拟尚未执行，本阶段不能声称产品或公开收费完成。

## T1.3 安全账户桥接、未知偏好核对恢复与独立钱包生命周期（2026-10-01，默认关闭）

在 `codex/registration-trial`、T1.2 `2cbfd90` 上完成本轮，仍包含合并V2基线 `abe46c4`。三位 gpt-6.1-sol 子智能体分别实现/验收固定Native账户与edge、私有恢复流程和钱包合同，并做独立安全审查；全部文件与忽略的证据留在当前项目。没有push、merge、部署或main改动，本轮远程CI尚未执行。

精确 PUT `/api/user/self` 在 prepared edge 下只路由 Studio 白名单：独立显示名，或原生password/original_password。保留原生安全proof、单次PUT、原状态/code与access旋转bundle；setting/language/sidebar、owner/权限/余额/组、登录密文和混合字段422不达Native，路径别名404。同owner资料操作与生成互斥，另一个owner独立；Cookie和共享key不转发，密码/proof/旋转token不落Studio账本。未知网络或不完整成功不自动重交。实际原生密码HTTP证明与完整浏览器流程分列，见 [ACCOUNT-CONTRACT.md](ACCOUNT-CONTRACT.md)。

所有 user-token 钱包发送现在都要求本次 true，包含试用关闭/不符合/从未领取成熟账号。耗尽类别的钱包权威只来自本人历史receipt、稳定实例、fresh启用状态/组/正余额，不读取现行plans；合法过期/退役/关闭后的明确钱包使用保留未用次数。缺失/重复/跨owner/unknown旧receipt或免费计划查询异常仍拒绝，不自然回退。账号实例UUID绑定独立于试用开关，关闭后缺失/改UUID拒绝启动。TrialPanel以可选preservedRemaining展示旧grant余量当前不可用，不虚构新发放。

新增 `scripts/reconcile-funding.mjs` 和无网络helper，只支持固定本机单Native/Studio、独立Docker SQLite卷、原生无宿主端口。操作员先显式停Studio，inspect只读；reconcile必须精确row hash和明确Native重启，连续持有Studio进程锁，实际stop/Pid0/同container新healthy boot/固定binary/topology核验后CAS+审计。仅设 `reconciled`，不确认Native偏好或收费，不动旧unknown/held，不启动Studio。任何中途失败屏障仍保留。逐段stdin在拼接前限32KiB，即使不发换行/EOF也拒绝；无JWT、账号设置或金额接口。使用与批准边界见 [FUNDING-RECOVERY.md](FUNDING-RECOVERY.md)。

独立审查发现一项P2：关闭试用时GET先返回disabled，隐藏未知付款偏好原因；已把屏障检查放首位，补关闭后的pending状态及409拒绝，验证只读无新写。其余未发现已证实P0/P1，但不能由代码审查推导公众部署已验收。追加仅用一次免费聊天后保留3chat/1image的disabled/rotated/closed正反例，以及wallet preflight后账号禁用/改组/归零/撤销会话的gateway前拒绝，均无新模型intent/权限。

本轮最终实际验证：

| 命令 | 结果及证据边界 |
| --- | --- |
| `npm run check` | 类型、**22/22**领域/探测/恢复、**123/123**API、生产构建通过（10.60秒）；既有chunk警告，无依赖/lockfile变更。`.local/t1-3-check-final.log` |
| `npm run test:e2e -- --workers=1 --reporter=line` | **56/56**（1.6分钟）；明确fixture，完整聊天/画布/移动/旧草稿/原图/恢复及保留试用余量。`.local/t1-3-browser-final.log` |
| `npm run test:stack` | **退出0**：实际固定Native未初始化安全边界、personal契约替身2/2、fresh user-token契约替身1/1，实际Nginx与Studio SDK/browser，只有随机测试资源清理。`.local/t1-3-stack.log` |
| `node tests/stack/account-native.cases.mjs` | **两次退出0**：真实固定Native独立账号、显示名、禁止setting字段、真实verify proof/密码旋转、旧JWT/其它会话拒绝、当前Cookie刷新和新旧密码登录；0模型。`.local/native-account-QzGIP4/evidence.json` |
| `node tests/stack/recovery-native.cases.mjs` | **退出0**：实际Docker停止/新boot、持久卷、锁、hash/CAS审计、重启后失败保留unknown、旧请求/次数不变、CLI不启动Studio；Native未初始化、0账户/模型 |
| `node tests/stack/trial-native.cases.mjs` | **扩展后两次退出0**：真实固定Native＋当前Studio＋本机模型替身，原混合来源与政策关闭/更换后wallet均真实结算。`.local/native-trial-s4CXmO/evidence.json` |
| `node tests/stack/trial-edge.cases.mjs` | **退出0**：实际固定Native空库及明确echo合同；exact/query PUT白名单、invalid0次Native PUT、valid1次、Bearer保留/Cookie不转发，aliases及relay拒绝、nginx -t通过；echo不是MFA验收 |
| prepared Compose `config --quiet`、新脚本`node --check`、`git diff --check` | 通过，仅校验，不启用 |

扩展真实Native数据：第一位用户6条订阅消费560；第二位用户四次纯聊后的未用图片，在原混合wallet→subscription→wallet中使用，后续付费图wallet；新增Studio试用关闭和批准计划更换时默认402、true纯聊各wallet_only消费12。第二位最终10条消费1096：subscription548/wallet548，钱包9452，原finite token498904、ID/期限不变，HTTP与Native SQLite一致。old grant和reservations完整快照不变，原receipt仍唯一，替换计划未领取。两户16次真实Native relay＝13chat＋3image，provider每次到达即核验Studio模型意图先落盘；供应商均loopback替身，真实采购成本0。合成voucher/价格/合规标记不代表商户支付或现实声明确认。

保留失败与修复：本轮早期user-token旧测试缺实例UUID及计划轮换旧409断言失败，补固定隔离实例和已知退役402合同；没有放宽missing receipt409。新增preserved余量初次误对exhausted0/0保留，改为仅存在active旧grant且有余量。浏览器首跑54/56，新增文字断言漏“次”单位，修断言后完整56/56；界面行为未改。新增financial SQLite断言初次null-prototype对象误比较，归一化后22/22。account Native测试首次未启用测试密码加密，补仅隔离env；恢复实际显式启动首次缺测试实例UUID，补同实例env后通过；未解除实例保护。Native新增wallet验收首次key端点429（固定CriticalRateLimit 20/IP/20分钟），在原账单settled后明确停/重启隔离Native、保留DB、fresh run ID，未改限流/安全或重发失败run。恢复helper未终止行限长隐患已修并真实子进程验证。

最终日常栈复核：`gouo-v2-web/studio-api/new-api`均running/healthy，仅web发布 **127.0.0.1:8080**，内部无宿主端口。Studio health200，Native setup `status=false/root_init=false`；generation=false、trial=false，当前Nginx没有prepared `studio_self`路由。未初始化日常账户/渠道、未修改安全设置、真实余额、真实计划或支付。仍不能称零余额正式用户已注册即用或真实供应商live-verified。

下一任务 **T1.4**：有限token到期/耗尽的可审查续用流程，以及原生profile/security完整浏览器路径；SMTP/MFA/passkey、真实计划/入口/费用上界/供应商仍按用户暂不启用决定与独立授权处理。完整产品及最终28场景多智能体用户模拟尚未完成，QA_ACCEPTANCE仍是待执行计划。下文T1.2“资料/密码/恢复/独立钱包待实现”保留为当时状态，以本节为准。

---

## T1.2 充值后单次余额授权与严格资金来源（2026-10-01，默认关闭）

在 T1 `7195190` 上继续当前 `codex/registration-trial`，包含合并基线 `abe46c4`。三位 gpt-6.1-sol 子智能体分别负责前端、固定 Native 合同/实际隔离验收和独立安全审查；开发文件与证据留在本项目。没有 main 改动、push、merge 或部署。

三个实际发送入口新增默认未选的「本次允许使用本人 New API 余额」：assistant-ui、Loomic Agent 和独立图片面板。一次发送捕获后清除，账号/会话切换清除，不持久化。服务端仅 true 参与 hash；false/省略兼容旧请求，同 ID 改付款意图409。聊天和图片分别优先剩余试用，耗尽类别只有明确本次授权及本人正原生余额才用钱包；免费图片继续保留。聊天工具循环固定本次聊天来源，不会占到最后一次后转付费；付费调用不占试用次数。

每个真实 fetch 前核验资金，并选择/确认严格 subscription_only 或 wallet_only。Native 固定源码确认：请求开始时从账号缓存读取 setting，再把所选 funding 对象留在该调用中完成结算/退款，不在结算时重新读取全局偏好；因此单 API/同 owner 串行的混合 wallet→trial→wallet 可行。偏好依然是账号全局状态，不能让其它内部消费者并行改变。新增 `model_submissions` 持久化调用前类别/模型/来源意图，响应 `fundingSelection` 只表示选择，不假称已扣费；实际消费以 Native request_id 日志为准。

新增 `funding_writes` 是非货币安全屏障：写前 pending，单次 PUT 后读确认才 confirmed；未知写/确认失败/重启 pending 均 unknown，阻止本人所有新 ID/类别的生成。即使 GET 一致也不解锁，旧超时处理器仍可能晚到。旧 ledger 首次升级保守导入 unknown claim 或没有响应证据的 unknown run；可能包括旧纯模型失败，明确列为保守阻断。建表/导入/恢复已同事务，初始化失败释放进程锁。当前没有对外解锁或自动解锁，后续操作员恢复须先证明旧写已结束。未知模型继续同 ID 禁重试，不退款。

源码审查发现原生 PUT `/api/user/self` 的 language/sidebar 全 setting 快照能覆盖付款偏好；prepared edge 拒绝全部公开该 PUT，包含 query/规范化/编码别名。资料/密码提交暂待安全适配，读取保留。该 prepared override 没有应用到日常8080。现有有限本人token不会因充值自动续额/续期；计划禁用/变更也会保守阻断当前付费路径，独立钱包生命周期仍待后续合同。

本阶段实际命令与结果：

| 命令 | 结果 |
| --- | --- |
| `npm run check` | 类型检查、**14/14**领域/探测、**102/102**API、生产构建通过（10.97秒）；既有chunk大小警告，无新增依赖/锁文件变更。日志 `.local/paid-continuation-check.log` |
| `npm run test:e2e -- --workers=1 --reporter=line` | **56/56**（1.6分钟），新一次同意/键盘/退出隔离/三入口省略false与无重试，以及完整旧聊天/画布/恢复回归。日志 `.local/paid-continuation-browser.log` |
| 独立 `funding-state.cases.mjs` | **7/7**，含PUT前持久化、写/确认异常、restart、晚到写/read不解锁、双户隔离、strict值与迁移事务失败重试 |
| `node tests/stack/trial-native.cases.mjs` | **两次完整退出0**。真实固定 Native＋当前Studio＋明确本机模型替身，14次真实Native relay/0真实供应商费用；最终 `.local/native-trial-2H4N1n/evidence.json` |
| `node tests/stack/trial-edge.cases.mjs` | **退出0**，真实Nginx＋固定Native空库和明确echo契约，公开PUT self及变体不达上游，旧拒绝/凭据剥离/内部401继续通过 |
| `npm run test:stack` | **退出0**，固定真实Native未初始化安全边界、personal契约替身2/2、fresh普通用户契约替身1/1。日志 `.local/paid-continuation-stack.log`；仅清理本次随机资源 |
| prepared Compose `config --quiet` /脚本 `node --check`/`git diff --check` | 通过；不是启用/部署 |

真实隔离 Native 结果：第一个钱包0用户原T1六条subscription日志560quota不变；第二用户四次纯聊天后image仍1，第五次未授权402。仅本次Native SQLite seed明确合成兑换码，再通过真实 `/api/user/topup`兑换10000quota；随后付费chat→免费image→付费summary实际日志来源为wallet→subscription→wallet，后续付费image为wallet。第二用户八笔消费1072，其中订阅548、钱包524，最终钱包9476、有限token498928，原token ID/有效期不变。Native HTTP与SQLite余额/订阅/token/日志/兑换码归属一致。每次provider收到请求即只读检查Studio意图已持久化；重放不增加调用、改同意409、跨户404。wallet日志缺失wallet_quota_deducted，未误当0，以实际钱包减少和真实账单核验。

保留本轮失败及修复：旧试用单测首次23/24，是原断言允许未知偏好GET恢复；按新安全合同改成409后通过，再新增5项集成反例16/16。独立审查发现首升级CREATE之后/seed之前崩溃会跳过导入，改同事务并增加中断回滚测试。前端一次误在根运行typecheck得到无script，回到v2通过；未改根package。新Native付费验收首次即通过，补调用前意图证据后第二次完整通过。没有删除失败测试或放宽资金/令牌条件。

主 `gouo-v2` 三容器仍healthy，只发布127.0.0.1:8080；Studio health200，真实Native setup仍未初始化(status/root_init=false)，生成及试用默认关闭。没有真实账号、余额、渠道、合规或安全设置改动。隔离资金/价格/兑换码是合成测试数据，供应商是本机替身，不能当作商户支付、真实渠道质量、成本上界或完整账户修改验收。

下一任务 **T1.3**：安全资料/密码适配、未知偏好人工核对恢复和独立钱包生命周期；真实计划/入口按用户决定暂不启用。完整产品与最终28场景多智能体用户模拟尚未完成，QA_ACCEPTANCE仍是待执行计划。下文T1“付费续用未实现”和历史验证数字保留为当时状态，以本节为准。

---

## T1 原生试用资金与四聊一图（2026-10-01，默认关闭）

用户确认 4 次聊天按用户发送计，有限工具循环仍占一次；生图工具另占 1 次图片。批准实现 New API 原生一次性零价有限试用计划与隔离测试，真实金额/期限/入口暂不启用。功能分支 `codex/registration-trial` 由 `codex/local-environment-p0` 派生，包含 `codex/new-api-v2` 的合并基线 `abe46c4`。无 main 改动、push、merge 或部署。

新增 `trial-funding.mjs` 严格核验本人原生计划/订阅，零钱包可使用原生有限订阅，而不是删除 402 后借共享 admin 令牌。领取及 subscription_only 偏好变更保存意图；未知只读 receipt 恢复、不重新购买。新增 `trial.mjs` 保存非货币 4/1 次数，每次真正模型提交前记录意图；同发送内聊天工具循环复用聊天权益、图片另计；重放/并发/重启/跨户/原生 receipt 缺失及实例/计划变化保持保护。New API 仍负责全部资金和账单。Ledger 新持久进程独占锁阻止第二实例误伤 running。

现有聊天和画布账号弹窗新增本人 TrialPanel，保留完整 assistant-ui、Excalidraw、原图、旧草稿、账号原生入口与金额 BillingPanel。新增 prepared Studio-only Nginx/Compose，固定账户 method/path 白名单、禁止公开 relay/未知插件/偏好写入，UI/static 不传调用者凭据或 query；**未应用到日常 8080 服务**。金额/期限政策示例都是不能直接启用的占位值，真实 `.env` 未改。

本阶段实际命令：

| 命令 | 结果 |
| --- | --- |
| `npm run check` | 类型、14/14 领域探测、82/82 API及生产构建通过；后续审查新增3项恢复/轮换反例并修正配置字段，最终重跑见下续记 |
| `npm run test:api`（恢复与轮换修复后） | **85/85**，含8资金合同、11试用路径、3真实子进程锁测试及全部旧断言 |
| `npm run test:e2e` | **53/53**，含3新试用UI测试；聊天、画布、移动、旧草稿副本、原图裁剪/重开与恢复回归通过 |
| `node tests/stack/trial-edge.cases.mjs` | 退出0：实际隔离 Nginx＋固定 Native空库账户HTML/JS/CSS、外部路径拒绝、内部匿名模型路由401；另一个明确echo契约验证凭据/query剥离 |
| `npm run test:stack` | 退出0：真实固定Native未初始化安全边界，personal契约替身2/2，fresh普通用户契约替身1/1；仅清理本次随机测试资源 |
| 最终 `npm run check`（恢复/轮换与入口政策字段后） | **类型、14/14、85/85、生产构建均通过**，构建11.04秒；完整本机日志 `.local/trial-check.log`，只有既有chunk大小警告 |
| prepared Compose `config --quiet` / `git diff --check` | 均通过；不是启用或部署 |
| `node tests/stack/trial-native.cases.mjs` | **退出0**：真实固定Native＋当前Studio＋本地模型替身。普通用户wallet0；唯一原生订阅500000合成quota消耗560；token499440；六笔日志、used_quota及Native SQLite一致；4次发送计4chat/1image，第5次402，第二次原生购买失败。真实供应商调用0/采购0 |

一次新图片校验测试初次7/8：预期400但既有StudioError实际422；修正断言而不放宽校验，最终通过。Ledger独占修复初次65/66：旧测试在同持久库同时建两个服务；改成不同owner依次关闭/重开，保留全部原隔离/重放断言，66/66通过，再接入试用增量。上述失败不隐去。

Native新增试验初次失败记录：restart随机端口重分配导致旧地址ECONNREFUSED，修正为重查composeport；根新增relayIngress必填后临时policy被Zod拒绝，补明确测试字段；SDK content为数组、供应商替身仅识别字符串未触发生图，修正替身识别后验证首发送2chat＋1image。随后补本人usedquota/token、只读SQLite落盘poll和每条日志资金归属断言完整通过。最终证据 `.local/native-trial-3un3gM/evidence.json`，六条日志都为subscription/only、钱包扣除0、本人plan/subscription；临时容器全清理，日常主栈不变。

真实供应商调用 **0**。单位/SDK/浏览器使用明确fixture；新增实际Native验收使用合成价格/资金/账号和仅本机模型替身，证明固定原生资金与预扣结算实现，不代表真实私人渠道已live-verified。合规true/v1只seed在本次测试SQLite，不代接受现实声明，不改变日常实例。MFA/商户充值/动态插件仍不是真实验收结果。试用用完提示原生充值，**充值后明确付费续用仍未实现**；完整政策、资金成本上界和真实启用门槛见 [TRIAL.md](TRIAL.md)。下一项 T1.2；最终多智能体用户模拟计划见 [QA_ACCEPTANCE.md](QA_ACCEPTANCE.md)，尚未将计划当作产品整体验收通过。

---

## 当前项目内缓存与真实服务复核（2026-10-01，暂不改功能）

用户重新提供环境交接并要求先准备环境。本机实际仍在 `codex/local-environment-p0`，包含 `abe46c4` 和上一轮环境提交 `1545e25`，工作树起初干净；`codex/new-api-v2` 指向 `abe46c4`，没有从 main 开发。与交接描述不同，当前 Docker 已安装且真实 8080 三服务仍运行，因此本轮没有安装系统组件、改安全设置或替换服务。并行只读复核指定 gpt-6.1-sol，所有命令、缓存和开发日志留在当前项目。

- 新建并验证 `v2/.local/npm-cache`、`v2/.local/npm-logs` 可写，`npm ci --cache .local/npm-cache --logs-dir .local/npm-logs --no-fund` 成功：876 包/881 审计包、0 漏洞，没有再出现 Exit handler never called，根/V2 锁文件未变。已有 `.env` 保留，生成关闭、无 relay 值。
- 使用命令级 npm_config_cache/npm_config_logs_dir 跑 `npm run check`：类型、14/14 领域/探测、63/63 API、生产构建通过；完整日志在忽略的 `.local/environment-recheck.log`。只有既有 chunk 大小警告。本轮不重新引用上一轮 50/50 为本轮新浏览器结果，也未运行 fixture 整栈。
- `npm run dev` 实际启动 Vite 7.3.6 与 Studio，保留运行；`127.0.0.1:5174/studio/`、`/studio/chat`、`127.0.0.1:3001/api/studio/health` 与 Vite 代理健康接口均 200。默认热更新账号目标 3000 尚未公开，完整账号/网关集成使用已有 `localhost:8080`，不将独立进程启动当作已认证集成。
- Docker Desktop 4.93.0、Engine 29.8.1、Compose 5.5.1、WSL 2.7.10.0；docker-desktop WSL2 正在运行。主 Compose 三服务 healthy，仅 `127.0.0.1:8080` 发布。真实 New API 容器 `/usr/local/bin/new-api` SHA-256=`a5fd598cc77e26ab2709305049fdd5fbbff722111be79f0ad89a493c3e094529`，与固定 rc.40 官方资产一致，不是 fixture。
- 真实 HTTP：`/api/setup` 200 且 status/root_init=false，edge/Studio health 200；匿名 `/api/user/self`、Studio projects 为 401，浏览器 `/v1/models` 为 404。stack-status 报 edge/studio/newApi ready，accountInitialized=false、generationEnabled=false。未初始化账号、录入渠道/token或调用付费模型；真实登录/注册/结算仍未验收。

本轮仅更新 STATUS、LOCAL_ENVIRONMENT 与 TASKS。下一任务 **T1 注册试用 4 次聊天＋1 次生图** 已记录，功能未改；当前零/负原生余额路径在 Studio/token 获取前返回 402，次数与真实原生资金来源需接通后单独验收，不能由替身或前端计数证明。

---

## Windows 本机 P0 环境准备（2026-10-01）

从已经合并 PR #3 的 `abe46c4` 接手，干净工作树派生 `codex/local-environment-p0`；本轮没有切回旧 QA 分支、改 main、推送或部署。团队通读 V2 全部 19 份文档及根/中英旧产品/旧服务文档，并与实际路由和配置核对；旧“待合并”、Go 新业务位置和早期云项目边界按最新实现理解。当前为 Loomic 默认画布、assistant-ui 正式聊天、官方 Excalidraw 私有项目、Fastify/SQLite 和固定 New API rc.40；完整云库生命周期、Worker、订阅与生产门禁仍未完成。

- 本机 Node **24.15.0** / npm **11.12.1**，Git **2.54.0.windows.1**；已有 Go **1.26.5** 不参与 V2 构建。只执行 V2 setup/npm ci，安装 876 包、审计 881 包，根/V2 锁文件未变。已有 `.env` 保留，核对生成关闭、无 relay 值，未读取或录入真实密钥。
- 安装锁定 Playwright **1.63.0** 的 Chromium **1243 / 153.0.8010.12**。WSL **2.7.10.0**、虚拟化已就绪；官方 Docker Desktop **4.93.0** 安装器通过 SHA-256 与 Docker Inc. Authenticode，当前用户安装成功，WSL 数据根在 D 盘。正确用户路径已启动，Linux Engine **29.8.1**、Compose **5.5.1** 实际可用；没有自动接受协议、加入未知证书或关闭 TLS。
- 干净 V2 构建首次误读根旧 PostCSS 配置并失败；Vite 增加内联空 PostCSS，保留已有 Tailwind 4 Vite 插件，独立构建恢复。API 首次 **61/63**，两项历史 SQLite 测试先删目录后关闭服务触发 Windows EPERM；调整 teardown 顺序，定向 **5/5**、全量 **63/63**。保留全部授权/重启/幂等断言。
- 整栈脚本的 Windows `spawn('npx')` 可复现 ENOENT；改为 Node 直接调用现有 Playwright CLI 公开导出，版本/语法检查成功，参数与随机隔离/清理范围不变。
- 完整浏览器前三轮分别 **49/50、48/50、49/50**，保留失败：裁剪在图片仍为占位符时执行、角手柄边缘命中不稳；Stop 提示先渲染而历史未写完；裁剪成功后重开又过早匹配旧自动保存提示。测试等待实际像素渲染、中心手柄 cursor、模式退出、本次裁剪只读落盘，以及流式终态写入完成。画布单文件 **9/9**，最终完整串行 **50/50**；生产交互/保存逻辑与原图、尺寸、恢复、隔离断言未变。落盘观察器曾有一轮括号语法错误，修正后实际运行通过；失败/成功 trace 在本机忽略的 `.reports/crop-debug/`。

| 本机实际命令 | 结果 |
| --- | --- |
| `node v2/scripts/setup.mjs` | 成功，按现有锁文件 npm ci |
| `npx playwright install chromium` | 成功 |
| `npm run check` | 类型、14 领域/探测、63 API、生产构建全部通过 |
| `npm run test:e2e -- --workers=1 --reporter=line` | 最终 **50/50** |
| `npm ls --all` | 依赖树有效 |
| `npm audit` / `npm audit --omit=dev` | 均 **0 vulnerabilities** |
| `node scripts/check-model-config.mjs` | 非秘密目录全部 pending/disabled，通过；未连接模型 |
| Docker 主栈/隔离 fixture+users `compose config --quiet` | 均通过 |
| `npm run test:stack` | 三阶段通过：真实固定 New API 未初始化安全边界；personal 契约替身 **2/2**；fresh 普通用户契约替身 **1/1**。仅回收本次随机测试资源 |
| 主 Compose `up --build --wait` / `node scripts/stack-status.mjs` | 三服务健康并保留运行；edge/studio/newApi ready，accountInitialized=false、generationEnabled=false |
| `git diff --check` | 通过 |

本机 Git 作者身份未配置，普通 `git commit` 首次被拒绝；本轮使用只对命令生效的 `Codex <codex@local.invalid>` 临时身份提交，没有代填用户姓名/邮箱。

本机入口 **http://localhost:8080/studio/** 已启动，主服务仅回环发布，New API/Studio 使用各自新的命名卷；测试 fixture 未接入这个日常栈。安装路径、D 盘数据位置、日常启动/停止及热更新限制见 [LOCAL_ENVIRONMENT.md](LOCAL_ENVIRONMENT.md)。真实模型调用 **0**，未初始化真实账号、创建 token/渠道、设赠额/价格/支付；本轮环境准备不替代真实 New API 已初始化账号/供应商费用验收。下一任务：**B2 本机真实账号、普通用户路由与模型/费用验收收尾**，先由用户在原生界面安全录入，采购成本及付费测试需单独授权；B3 后续安排。

---

## 新普通用户、原生账号和计费收尾（2026-09-30）

先修复旧 UI CI：`569449c67eba4ea01b04af81df6e7dec518c0bdc` 的 push `36748136445`、PR `36748146849` 均 success。随后按用户新增要求完成默认关闭的每用户模式，未放开共享管理员 owner 限制，未升级 New API。

- 固定 SHA 原生账号入口/sign-in 返回、Strict HttpOnly refresh 路径、X-Auth-Session、cookie_cleared 已核对；链接原生注册/恢复/资料/安全/令牌/钱包/用量/管理。保留明确受限的基础登录，不另写 MFA/密码恢复/IAM。
- 新 user-token 模式使用本人 JWT→本人组模型→本人有限原生令牌→本人钱包，读取 key 仅本次服务端内存。创建 success-only 后查询 ID/key，无管理员渠道后缀、无第二余额、不存/返回 key；额度上限和有效期须明确批准设置，没有商业默认值。
- 令牌失效/禁用/无权限明确拒绝；已完成同 ID 结果在余额耗尽或模型权限变化后仍可本人读取，不重新创建令牌或收费。明确未执行的零余额/模型校验拒绝释放本地请求占位，未知外部操作仍禁止同 ID 重放。
- SQLite 只新增 owner/run/调用序号/request_id/HTTP 状态关联及只读核对；扣费后素材失败/重启保留 unknown 执行与原生 settled 费用。无自动退款/续额，未承诺跨进程 exactly-once。本人“模型测试”消费不再隐藏，原生负余额可显示；人民币额度折算不是供应商成本硬预算。
- 类型/构建通过；API **63/63**，完整串行浏览器 **50/50**。整栈三个阶段：真实固定 New API **未初始化边界**；原 personal 模式内存替身 **2/2**；fresh 普通用户内存替身 **1/1**，真实 edge/Studio/SDK/SQLite 浏览器路径验证零额度拒绝→明确 fixture-only 加额→聊天与图片→本人三笔账单→画布重开、第二用户独立费用与隔离、组禁用与注销。
- 上述注册、余额、令牌、模型输出和账单均为 **契约替身**；没有初始化真实 New API 账号、创建真实凭据、发送邮件、支付或供应商调用，真实费用 **0**。真实注册验证/安全/渠道/费用验收仍待批准，赠额/售价/支付与令牌授权参数未决定，生成默认关闭。具体方案与阻塞见 [USER-BILLING.md](USER-BILLING.md)，简明计划见 TASKS.md。
- 保留失败过程：fresh 新测试首轮登录窗口/新会话/保存状态文案定位器不正确，按真实 UI 修正；完整浏览器初轮49/50一项画布重载等待超时，定向带 trace 与后续串行全量通过。Docker VFS 多轮构建缓存耗满32GB根分区，回收可重建闲置缓存后恢复25GB；未删源码、账号数据或批准的 Library 截图。最终隔离栈自动清理自身资源。

最终精确分支提交的 push/PR CI 和合并兼容结果在交付回复/PR，父线程负责合并 `codex/new-api-v2`；不切默认入口、不部署。批准的 assistant-ui/Excalidraw 视觉方向保留。

---

## UI 视觉通过后的 CI 收尾（2026-09-30）

用户已于 16:53 UTC 查看桌面聊天/官方画布截图并确认“可以”。沿该视觉方案继续，合并由父线程在最终核验后执行；不切默认入口、不部署、不调用真实供应商。

`eb6740e56d108e58ea0bf2d13309c0245cd18150` 的 push run 36746968065 与 PR run 36746975472 首次 CI 均在 Browser smoke 失败：新增截图测试将路径写死为 `/workspace/scratch/...`，GitHub runner 创建 `/workspace` 报 EACCES。两路类型/领域/API/构建通过，整栈因浏览器步骤失败而被跳过；PR 另有裁剪和旧会话恢复测试时序失败，不把这些失败冒称为整栈成功。

- 截图输出改用 Playwright `testInfo.outputPath('ui-review')`，与运行机器路径无关。此前用户已批准的 Library 截图保持原版本。
- 裁剪测试等待 SDK 图片选中后的原生 Crop image 控件，并确认裁剪提示出现再拖拽，避免键盘事件早于选择状态生效。
- 旧会话错误恢复测试等待“停止接收”控件移除后再刷新；组件 finally 在完成 IndexedDB 保存后才移除控件，错误文本先出现不能证明写入完成。
- 改动仅测试及文档，产品代码/视觉/持久化逻辑不变。三项受影响测试各重复三次 **9/9** 通过；不重复已通过的本地域/API/构建。新精确 SHA 的完整 push/PR CI 另行核验并在交付回复/PR 状态记录。

---

## 官方完整 UI 样板：首阶段交付（2026-09-30）

新云端环境终端、文件与 Chromium 可用；从授权分支远端 `124117340134af5ca3463863ba454ccc2e1878d2` 接手，PR #3 核验仍 draft、目标 `codex/new-api-v2`，未在默认 work/main 修改。

- 用户拒绝旧自拼页面后，直接复用 assistant-ui 仍维护的主仓库 default starter 完整侧栏/消息/输入框/主题。固定来源 `f008537f39f0936992b0f6d2433c092935df5faf`，与现有 React 0.15.22 匹配，MIT 完整许可与来源注释保留。必要 Studio/New API 数据适配与精确来源清单见 [UI-STARTER.md](UI-STARTER.md)。
- 既有 Studio transport、私有历史、账号费用、GeneratedImage 源定位与打开/插入项目保留；不引入 AI SDK 后端/第二套账号/云服务。新增同源配套 Markdown 包 0.14.17，未升级 LangGraph、React 或画布。
- 官方 Excalidraw 外壳精简为项目条，其他操作收进“更多操作”。保存/冲突/本机恢复/离页提醒和原图数据逻辑不改；修复窄屏标题被挤成竖排。默认 Loomic 仍保留。
- 实际 Chromium 截图：桌面聊天、暗色主题、移动聊天/抽屉、桌面和移动画布，共 6 张，已实际查看并保存 Library。账号、模型、文本和项目均明确 Playwright fixture；商品图为测试 SVG 经 Sharp 输出，不是 ImageGen，也不是真实生成。视觉替身不证明真实供应商验收。
- `npm run check`：类型、14 领域、53 API、构建通过；冻结 UI 后类型/构建再通过。完整串行浏览器 **46/46**（含新增 1 项视觉验收、桌面/暗色/移动及窄屏标题断言）。先前相关 29 项也全部通过；首轮旧工具折叠/提示重复/欢迎文案测试差异已修正，不遗漏失败过程。
- 隔离整栈 **2/2**：真实固定 New API 未初始化安全边界 + 实际 Nginx/Studio/SDK/SQLite→内存 New API 替身联调通过。本环境首次 Docker 内 npm 报 Exit handler never called；使用已有系统受信任 CA 的只读 BuildKit secret 后成功，override 仅在 /tmp，不改信任/TLS、不入仓库。随机测试容器/卷/镜像已自动回收。
- `npm ls --all` 有效，完整/omitdev 审计均 0，`git diff --check` 通过。真实供应商调用 **0**，未创建真实凭据、合并或部署。

此阶段交官方成品视觉样板及后端薄适配。用户已确认视觉；默认入口保持 Loomic，合并待最终检查并由父线程执行；不要把本地 localhost 当共享预览。Library 文件 ID 及最终分支 SHA 在本任务交付回复；截图本机目录为 `/workspace/scratch/gouo-ui-review/`，父线程应使用 Library 读取而非假设共享目录。

---

## 接手增量：保存失败后的编辑与恢复副本保护（2026-09-30）

从远端授权分支 `codex/qa-relay-owner-idempotency` 的 `bdff3de9d4f86239e5821039ec4cd31bfe5b8b3f` 接手；核验 PR #3 仍为 draft、目标 `codex/new-api-v2`。工作区最初在环境默认 `work` 分支，未在那里或 main 编辑。仓库及 `/workspace/.agents` 没有额外技能文件；已读根/V2 AGENTS 与交接文档，复用第三阶段既有证据。

- 修复失败后继续编辑时恢复下载仍返回首次失败场景的问题：自动远端写入继续暂停，本机恢复副本更新，立即下载会等待最新本机写入。没有重试生成或远端失败请求。
- 修复带素材参数重新打开时，再次初始化/保存失败覆盖先前未保存修改的问题：仅打开服务器场景不覆盖既有恢复副本，实际编辑后才更新。旧 Loomic 草稿与服务器原图不修改。
- 保存状态区分待保存、保存中和确认完成；较早响应不能把新修改标成已保存。未确认编辑提供浏览器离页提醒，但浏览器强制关闭/忽略提醒仍不保证落盘。本机容量失败暂停远端保存，当前场景可直接导出。
- 新增 3 项项目浏览器回归，该文件共 9 项。最终串行 `studio-projects.pw.mjs` + `chat-lab.pw.mjs` + `canvas-lab.pw.mjs` **28/28** 通过；覆盖失败后继续编辑及立即下载/刷新、QuotaExceededError 导出与离页处理器、请求期间编辑及后续失败、账号隔离/聊天图片/裁剪/删除不复活/旧文档副本保护。
- 复查补充：本机备份下载只等待本机写入，不等待远端保存队列；测试在首个 PATCH 尚未返回时下载包含新编辑的副本，然后再验证后续远端失败的恢复。该补充提交按项目浏览器与最终 SHA CI 重新验收；旧 SHA 的运行中 CI 主动取消以避免重复消耗。
- 收尾项目浏览器 **9/9** 通过；隔离整栈在首增量 `1f8f08f1ebe5d293a9848fe5c0d14686eadded2c` 构建通过真实未初始化 New API 边界和替身 **2/2**，自动回收自身容器/卷/本地镜像。最后的纯本机下载补充由最终 SHA CI 再覆盖完整浏览器/整栈，不把较早构建的本地结果冒称为最后提交的整栈结果。
- `npm ci` 按原锁文件成功；`npm run check` 的 14 领域、53 API、类型和构建通过；最终代码补充 `npm run typecheck` 与 `npm run build` 再次通过。Node 24.19.0/npm 11.9.0；无依赖或锁文件改动、没有无关旧包复测。

环境默认 npm 缓存和 Docker buildx 配置目录只读，分别改用本任务 `/tmp/gouo-v2-npm-cache` 与 `/tmp/gouo-docker-config`；不修改安全设置。新增测试首轮拖拽落在原生属性面板、请求闸门被 StrictMode 两次 GET 消耗，修正操作区域及只拦截首个 PATCH 后通过。刷新覆盖恢复副本是测试发现并修复的实际产品缺口。

默认入口仍为 Loomic：真实渠道/复杂旧文档视觉比较/系统剪贴板与文件选择器/移动端完整交互/容量与生命周期验收尚未达标。本执行器没有可提供给用户接管的受保护预览或原生密钥输入能力；`localhost` 不是用户共享地址。最小真实联调前置仍为用户在线本机或明确授权私有测试主机、安全原生录入、准确模型能力与两模型合计 ¥5 保守硬上界确认。当前真实供应商调用 **0**，没有创建真实账号/token/渠道、合并或部署。隔离整栈与最终 SHA 的 CI 结果见本轮交付回复。

---

## 第三阶段：持久项目、原图与聊天画布联动（2026-09-30）

保留 New API/Studio/前端服务边界，新增 owner-scoped 项目与不可变原始素材。assistant-ui 图片可打开新项目或插入已有项目；项目库新增服务器区，旧本机草稿和 Loomic 默认入口保留。官方 Excalidraw 使用稳定素材ID、独立已处理标记、revision CAS及失败恢复副本，裁剪不改原字节、删除后刷新不复活。

普通模型路由为显式可选：需要固定 New API 版本、RetryTimes=0及准确网关的人工核验记录，普通受限owner token不追加管理员渠道后缀；默认pinned兼容不变。非秘密checker和全禁用Feng双模型示例已提供，真实配置必须用户原生录入。记录不能实时保证网关重试设置，不能当作生产费用硬保护。

最终验证：类型、14领域、53API、构建；42/42完整串行浏览器；完整及omitdev审计0、依赖树有效、差异检查通过。完整服务真实未初始化 New API 安全边界及明确替身联调2/2通过（2026-09-30 14:33 UTC）。最终精确SHA与CI见交付回复及 draft PR #3 的当前head检查。失败过程及证据边界见 [STAGE3_QA.md](STAGE3_QA.md)。无新依赖、真实凭据、付费请求、合并或部署。

本轮仅收尾第三阶段，新显式gpt-6.1-sol对话从 [HANDOFF.md](HANDOFF.md) 恢复。真实供应商/账号渠道、采购价与5元硬上界仍未验证；默认画布切换、系统选择器/复杂旧文档/移动端、存储额度与生命周期等限制见交接及CANVAS_COMPARISON。当前适合隔离测试与演示，不能直接宣称可上线收费。

---

## 持久聊天、官方画布验证与空间恢复（2026-09-30，第二阶段）

正式入口 `/studio/chat` 已接 assistant-ui 与 Studio SQLite 历史，默认画布菜单可进入；旧 `/studio/chat-lab` 兼容跳转。New API 仍是唯一账号与网关权威，未新增账号服务或财务账本。详情见 CHAT-LAB.md、API-DATA.md。

- 会话、消息事件和运行状态按已验证 owner 保存；首次实际发送自动命名，列表及记录支持分页。刷新、退出重登、快速切线程可恢复记录；正常完成只读刷新后继续对话。客户端伪造历史不作为模型上下文。
- GET 读取运行不调用模型；断线/停止接收不重发。运行在当前进程可继续，重启时 running 变 unknown；费用保持真实查询/待确认，不宣称取消供应商。忙碌前拒绝不产生历史记录，重放不重复消息或费用。
- 官方画布完成 9 项浏览器验收，包括文字、撤销重做、图片缩放/旋转/裁剪、拖放/合成粘贴、PNG/文档导出、保存重开原图完整性。旧 Loomic 导入仅当前账号只读副本，完整 sourceDraft/Blob 另存，旧数据库不写入；缺图/Fabric/不支持元素拒绝。
- 默认仍保留 Loomic：官方候选可独立编辑，但真实生成素材、聊天引用、项目列表联动尚未完成。默认切换与回退门槛见 CANVAS_COMPARISON.md，不静默覆盖历史草稿。

| 命令/验证 | 实际结果 |
| --- | --- |
| `npm run check` | 类型、14 领域测试、42 API 测试、构建通过 |
| `npm run typecheck`（代码冻结后） | 通过 |
| `npm run test:e2e -- --workers=2 --reporter=line` | 33/33；含 7 聊天、9 官方画布、既有流式/账号/画布回归 |
| `npm run test:stack` 最终完整重跑 | 官方未初始化 New API + Studio + Nginx 健康/边界通过；随后明确内存网关替身联调 2/2，通过断线持久结果、重放不计费、跨账号404、UI刷新/换账号/重登 |
| `npm ls --all`、全量及 `--omit=dev` audit | 依赖树有效，均 0 告警；无包或锁文件变更，保留现有许可归属 |
| 差异/环境 | `git diff --check` 通过；无真实账号、token、渠道创建或供应商调用 |

本地完整联调曾因磁盘 99% 再次中断，未计为通过。只读定位后清理本任务旧 spike 的可再生成依赖/输出、专用 npm 缓存、明确归属的测试镜像与逐 ID 构建缓存；未使用全局 prune，未删未知目录、数据卷或凭据。满盘一度阻止沙箱启动，通过自动审查通过的精确测试缓存清理恢复执行，最终可用空间恢复到 24 GB 后重跑成功。构建过程仅使用既有受信任 CA 的只读 secret，无新增根信任或 TLS 绕过。

API 镜像改为只安装锁定的后端生产依赖（88 包），大小约 917 → 357 MB；测试每阶段回收自身自动命名镜像和临时容器/卷，不全局删缓存。前端构建仍保留完整所需依赖，基础镜像与上游校验值不变。

剩余：历史图片仍内嵌，分页条数不等于字节限额，尚无自动保留期限；服务端上下文仅最近 6 次完成任务。无持久 Worker、自动续流、主动上游取消或历史编辑/删除。系统文件选择器、跨应用剪贴板、多标签并发、候选移动端仍待专项验证。真实 New API 已初始化账号/渠道→Feng（gpt-6.1-sol/gpt-image-2）未验证，仍等待安全录入与价格/额度确认，总付费上限 ¥5。本阶段没有付费调用、合并或部署；CI 以最终提交为准。

## 一体化运行、真流式与成熟组件对照（2026-09-30，最新）

按用户最新目标保持三服务边界，完成可复现 V2 Compose 与同源入口，不改旧后端、不合库。仓库外临时 New API helper 已不再是启动前提；官方固定二进制与基础镜像使用校验值，保留上游许可。必要配置、原生安全初始化、健康检查及部署边界见 RUNNING.md。

- 现有画布采用真实 SSE 文本/工具流，原批次端点兼容保留；同一 runId 的授权、busy、去重和费用边界不变。终态先落 SQLite 再发送；停止接收/断线不承诺取消供应商，部分回复节流保存，未知结果不自动重交。
- 新增 `/studio/chat-lab`：assistant-ui 0.15.22 的隔离自定义 runtime，对接同一 Studio/New API。支持线程列表、文本流、工具图片、错误及停止接收；目前历史仅内存，费用仅 metadata，不宣称已完成默认聊天替换。
- 新增 `/studio/canvas-lab`：同版本官方 Excalidraw 直接组件对照，独立 IndexedDB；导入副本保留原 payload，拒绝把 Fabric 当作原生文档，不覆盖旧草稿。不是新增第二个引擎或完成数据迁移。
- 代码审查发现原包装层图层锁定/显隐为空操作、复杂复制关联存在风险；本轮未盲目重写。对照用于定位下一阶段的薄适配修复。

| 验证层 | 实际结果 |
| --- | --- |
| `npm ci` / `npm ls --all` | 成功、依赖树有效 |
| `npm run check` | 类型检查、14 领域/探测、37 API、生产构建通过 |
| `npm run test:e2e -- --workers=2 --reporter=line` | 24/24；含 4 流式、3 assistant-ui、4 官方画布对照，以及既有回归 |
| `npm run test:stack` 第一轮 | 实际官方 New API + Studio + Nginx 三容器健康；账号未初始化且无 root，生成关闭，匿名拒绝、Origin 和 `/v1` 边界通过；未初始化账号 |
| `npm run test:stack` 第二轮 | 内存 New API 契约替身，真实反向代理/Studio/SDK；浏览器 1/1，登录刷新/退出、工具图和草稿保存、费用归属、重放、账号隔离均通过 |
| `npm audit` / `--omit=dev` | 均 0 告警 |

本地 Node 24.19.0，构建镜像 Node 22.23.3；CI 按最终 SHA 再验。环境构建代理使用既有受信任 CA 的只读 BuildKit 挂载，未增加根信任或关闭 TLS 校验。首次容器运行发现源码权限不足，已修复非 root Studio 读取；隔离测试自动清理自己创建的容器/卷。

尚未验证：真实 New API 账号/渠道配置后的供应商端到端、gpt-6.1-sol 与 gpt-image-2 的新组合、真实费用 <=¥5；无 key，未调用供应商。官方画布系统文件选择器在 headless 下未完成自动化，已验证拖放 PNG；未验证全部裁剪/旋转/跨引擎迁移。assistant-ui 增加 326 个锁文件路径，lazy chunk 约 123 kB gzip，暂保留实验入口评估成本。无持久 Worker、服务器 GET 恢复接口、云历史或完整生产门禁。下一阶段优先对照体验决定默认聊天与画布薄适配，不丢弃原始历史。

## LangGraph 升级与未知费用回归（2026-09-30，此前）

用户批准扩大 SDK 升级测试，保持同一草稿 PR：LangGraph 1.2.0 → 1.4.18、SDK 1.6.5 → 1.12.0，新增 protocol 0.0.19；实际依赖树不再包含 LangGraph 链的 UUID 10/13，未加入强制 UUID 覆盖。此前 relay 所属账号、busy 前拒绝及 Sharp/NanoID 安全更新均保留。

新增 8 项真实 SDK + 本地 HTTP 网关回归。过程中复现总结或图片请求断线时漏计未知调用的问题：此前会把已知部分费用标记为整次 settled；现在记录未知调用，显示 pending，不自动重试、不丢失已生成图片、不解除幂等保护。两项费用状态回归修复前失败、修复后通过。

| 本地检查（Node 24.19.0 / Linux x64） | 结果 |
| --- | --- |
| `npm ci` / `npm ls --all` | 成功，无 invalid 依赖；LangGraph/core/Zod peer 范围兼容 |
| `npm run check` | 类型检查、14 个领域/探测测试、33 个 API 测试、生产构建通过 |
| `npm run test:e2e -- --workers=2 --reporter=line` | 13/13；含画布、账号/草稿隔离、取消后晚到结果及 Mermaid 兼容 |
| `npm audit` / `npm audit --omit=dev` | 均为 0 项告警 |
| SDK 新增回归 | 工具→图片→总结的三次费用归属与重放、纯文本历史、无工具、HTTP/参数错误、重复工具、图片/总结断线，以及真实客户端 abort 后幂等/busy 保护 |

客户端 abort 不代表服务端或供应商任务已经取消；服务端可能继续完成并保存结果，测试确认相同 ID 不重复执行，未执行的 busy ID 可稍后重试。所有请求指向本地 fixture，无真实模型、费用或生产账号修改。仍需真实渠道联调、特殊平台验证及生产部署安全审查；零审计告警不等于完成这些门禁。远程 Node 22 验证见 PR 最新 SHA 的 CI。

## 依赖高危后续修复（2026-09-30，此前）

在同一独立 QA 修复分支，保持业务实现、Excalidraw 0.18.1 和 LangGraph 1.2.0 不变：Sharp 0.34.5 → 0.35.5；只为 mermaid-to-excalidraw 2.2.2 覆盖 Nano ID 4.0.2 → 5.1.16。具体运行时路径、兼容边界和剩余决策见 DEPENDENCIES.md。

| 本地检查（Node 24.19.0 / Linux x64） | 结果 |
| --- | --- |
| `npm ci` / `npm ls --all` | 干净安装成功，无 invalid 依赖 |
| `npm run check` | 类型检查、14 个领域/探测测试、25 个 API 测试、生产构建通过 |
| `npm run test:e2e -- --workers=2 --reporter=line` | 13/13；新增四类 Mermaid 图表、连接绑定和 SVG 素材 ID 兼容回归 |
| 新增图片解析回归 | 5/5；PNG/JPEG/WebP 编辑上传及生成输出，格式伪装、损坏、大小和像素边界 |
| `npm audit` / `npm audit --omit=dev` | 均 2 moderate / 0 high，剩余 LangGraph → UUID 10.0.0 路径；未使用 force |

所有测试使用本地 fixture/mock，无真实 API 或费用。本轮未重跑下方历史的额外 10 项独立浏览器 helper，不将其计入本轮 13 项。特殊本机平台未验证；构建大分包告警仍存在。远程 Node 22 CI 结果以草稿 PR 最新 SHA 为准。建议下一项单独评审 LangGraph 1.4.18 的 SDK/protocol 升级；两项中危尚未解决，不作为生产安全门禁通过。

## 独立 QA 问题修复（2026-09-30，此前）

基于 `c8fcce0` 的独立测试复现两项问题，本次在独立修复分支处理，没有修改实际账号、渠道、凭据或部署：

- 个人 relay 开启生成且提供 key 时必须配置有效 `GOUO_RELAY_OWNER_ID`；缺省时启动报错，直接构造无有效 owner 的服务也会在目录和图片/Agent 路由拒绝生成。其他账号仍 403，个人账单读取与禁用生成的本地预览不受影响。此服务仍非多租户 token 分配系统。
- 同账号忙碌时，新请求在写入 SQLite 之前返回“尚未执行”，空闲或服务重启后可用原 ID 重试。既有完成结果仍可重放，参数冲突、处理中/未知结果继续阻断；没有解除历史 unknown 或自动重试可能扣费的调用。
- 定向更新 Fastify 5.12.5、lodash-es 4.18.1，并仅将 Nano ID 3.3.3 覆盖到 3.3.19。审计 13 → 6 项（2 high / 4 moderate）；剩余 Sharp、Mermaid/Nano ID、LangGraph/UUID 的升级选择见 DEPENDENCIES.md，不声称生产安全检查全部通过。

| 本地检查 | 结果 |
| --- | --- |
| 锁文件安装与依赖树 | `npm ci` 成功，`npm ls --all` 无 invalid 依赖 |
| `npm run check` | 类型检查、14 个领域/探测测试、20 个 API 测试、生产构建通过 |
| 新增回归 | 5 项；旧实现 4 失败 / 1 通过，修复后 5/5；覆盖两个生成端点、owner 缺省/非法/配置、并发拒绝后跨重启重试、完成重放与参数冲突 |
| `npm run test:e2e` | 12/12，通过认证、模型选择、画布恢复、费用 fixture、移动端与中断流程 |
| 独立浏览器 QA | 10/10，通过文字编辑/PNG、图片删除/撤销重做、快速刷新、导航保存、访客/双账号草稿隔离、重复回车、延迟图片取消、损坏文件和存储失败提示 |
| `npm audit` / `--omit=dev` | 均剩 6 项（2 high / 4 moderate），未执行 force 升级 |

本地使用 Node 24.19.0；仓库 CI 使用 Node 22，最终远程提交及检查结果以草稿 PR 为准。测试全部为合成账号、本地 mock/临时 SQLite，无真实模型、扣费、支付或生产数据库。现有构建仍有较大分包告警。此前已写为 unknown 的请求仍需核对网关；不自动删除账本记录。

## 恢复 Loomic 原版 Agent 选择器（2026-09-30，此前）

用户要求去除此前添加的 Agent 图片模式，恢复原版。选择器的界面与上游固定版本一致，只列出可用对话模型和 `Auto (workspace default)`；图片模型保留在原生独立 `Image model` 偏好设置与“AI 生成图片”面板。没有回滚 New API 认证、跨渠道工具调用或原生用量计费。

目录成功加载后清除失效的 Agent 偏好（含旧图片选择），保留有效对话模型及独立图片偏好。聊天提交显式使用对话模型；无可用对话模型时提示配置渠道并停止，不自动转为直接生图。服务端历史图片模式协议兼容保留。访客登录提示和跨项目取消保护继续通过现有流程验证。

| 检查 | 实际结果 |
| --- | --- |
| `npm run check` | 类型检查、14 个领域/探测测试、15 个 API 测试、生产构建通过 |
| `npm run test:e2e` | 12 passed；覆盖混合目录仅显示对话模型、旧图片选择清理、独立图片偏好/工具结果/账单、有效选择刷新保留、仅图片渠道零生成提交，以及既有账号/草稿/移动端/取消流程 |
| `verify-agent-selector.mjs`（环境 helper） | 当前公网生产构建检查通过：原版选择器、独立图片偏好与刷新保留；不登录、不发起付费模型调用 |
| 密钥检查 | 全部 369 个前端构建文件与当前源码 diff 不含真实本地账号密码、provider / relay 凭据 |

公网检查发现旧画布 tunnel 进程已退出，本地预览与业务 API 均为 200；已恢复新的临时入口，实际 URL 以环境 `state/public-url.json` 为准。新 origin 的 IndexedDB 草稿独立，旧已打开页面需先导出备份。本次没有新增付费验证，也没有变更渠道、价格或余额。下一项仍为 B2 的其余模型/参考图协议验证；视频、云库、Worker 与订阅不在本次范围。

## 对话 / 生图跨渠道与 New API 原生计费（2026-09-30，此前）

用户新增对话渠道后，旧启动 helper 仍把整个 relay token 固定到图片渠道 1，导致对话渠道 2 无法用于画布。现按每个模型的 `channelId` 分别固定路由，基础 token 留在服务端内存；每次请求同时使用原生 `PinRetrySingleAttempt` 和 SDK 零重试。启动只读既有账号/token/渠道元数据，以实际 `/v1/models`、渠道启用状态和独立验证状态生成 active 配置。

- 已接通同一个 LangGraph 请求里的对话 → 图片工具 → 对话总结。聊天模型需明确 `toolCalling`，本实例最多两次对话、一张图片；未验证视觉/参考图/编辑能力仍拒绝。上游错误展示脱敏 HTTP 状态，不传回密钥或原始供应商错误。
- 新增认证 `GET /api/studio/billing`，读取当前账号真实余额、累计用量、原生价格和自己的消费日志。右上角显示人民币余额，账号窗口提供单价、最近调用和刷新；创作结束后自动刷新。修正账号弹窗的 stacking context，避免画布工具栏遮住余额/价格。
- 创作响应通过原生 request ID 汇总实际费用；三个模型调用都纳入同一创作消费。同请求重放复用已保存结果，不重复生成或查账。账单未到账、ID 缺失/重复或失败请求返回 pending，不伪造零费用；已经产生的图片不会因查账失败丢失。
- 用户确认“保留现有单价，1 倍计费”。通过 New API 原生管理 API 的乐观版本校验持久化既有 `gpt-6-astra` / `gpt-image-2` 有效表达式，保留 `gpt-5.6-sol` 的既有 USD 5/30 每百万输入/输出 token。default 倍率仍为 1，显示改 CNY，沿用配置汇率 7.3；前后 effective pricing 全部一致。未手工修改余额、创建凭据、变更订阅或改上游实现。其他对话别名缺乏可靠价格，未猜价启用。

第一次单独授权的完整链路探测在首个 `gpt-5.6-sol` 对话请求返回 HTTP 503（上游连接超时），没有调用图片模型，也没有该 request ID 的原生消费记录。只读供应商 `/v1/models` 为 200，包含该模型。保留失败报告 `state/gpt-5.6-agent-probe.json`，没有自动重试。

用户再次明确授权额外一次复验后，完整链路成功：**渠道 2 的 gpt-5.6-sol → 渠道 1 的 gpt-image-2 → 渠道 2 的 gpt-5.6-sol**，一张 1254×1254 PNG，合计三次调用。原生账单为 **34473 quota = ¥0.5033058**，账号 used_quota / balance 同量变化、request_count 增加 3。真实业务请求重放返回同一结果，没有再次执行模型。脱敏报告 `state/gpt-5.6-agent-recheck.json` 和真实图片 `state/verified-agent-cup.png` 留在仓库外环境私有 state；两个探测都有独立 wx 一次性守卫，授权已用完，setup/CI/重启不得重跑。

本实例仅这两个模型启用；`gpt-6-astra` 虽有既有价格，工具协议仍未实测，其余对话别名价格/能力不足，保持不可用。仓库示例仍 pending/disabled，不能把结果套用到其他渠道或新环境。视频、月度订阅、云库和可恢复 Worker 不在本次交付。

| 检查 | 实际结果 |
| --- | --- |
| `npm run check` | 类型检查、14 个领域/探测测试、15 个 API 测试和最终生产构建通过 |
| `npm run test:e2e` | 12 passed；含原生工具图片进入画布、人民币单价、自动刷新余额/本次创作费用、手动刷新、直接图片面板消费、认证/草稿/移动端/跨项目迟到结果保护；最后补齐直接图片费用传播后，两项创作流程复验通过，类型/构建再次通过 |
| API 负向/费用检查 | 跨账号查询只取自己的日志、生成 token 仍 owner bound；匿名/伪造身份/未知能力拒绝；幂等重放、不确定费用保留图片；未知定价表达式不伪造单价；渠道分别固定、受限工具循环、503 不重试且不泄露原始错误 |
| New API 配置 | 原生配置前后有效单价一致；default 1 倍、CNY、汇率 7.3，脱敏审阅记录 state/billing-configuration.json |
| 密钥检查 | 全部 369 个前端构建文件与 staged 源码不包含真实账号密码、provider / relay key；Vite 子进程不继承 relay key |
| 公网真实账号与计费 | 恢复后的公网登录、Secure/HttpOnly/Strict Cookie、内存 token、真实 CNY 余额/单价、匿名 billing 拒绝、刷新恢复和退出撤销通过；该浏览器检查阻止所有生图/对话 POST |
| 真实授权复验 | 首次 503 无该请求消费记录；用户另行授权的一次复验成功，3 次模型调用、1 张图片、费用 ¥0.5033058、重放无重复调用 |

原临时画布 tunnel 已断开并重新建立；URL 以环境 state/public-url.json 为准，不再使用旧地址。浏览器 IndexedDB 随 origin 隔离，用户原已打开页面的草稿需导出备份；临时链接变化不表示云同步。进程/连接仍不随环境休眠保存。这是开发实例接通和原生用量计费，不是公众销售/订阅权益完成；下一项仍为 B2 其余模型与参考图协议验证，公众销售需 B3/S1。

## 画布登录与实际图片渠道接通（2026-09-30，此前）

原外网画布 helper 只提供静态页面和模型状态，拒绝账号/生成接口；业务服务也没有读取用户新配置的渠道令牌，并且对话入口强制要求聊天模型。因此“New API 渠道测试成功”没有接通画布。

- 当前临时公网画布同源转发真实登录、profile、refresh、logout 和 Studio API。登录写入检查精确 Origin，认证 Cookie 为 Secure/HttpOnly/Strict；管理后台和 `/v1` 继续使用独立 New API 入口。helper 位于云环境 `/workspace/gouo-public-preview/`，可重用启动说明已保存到环境配置草稿。
- 新增图片模式：只有图片渠道时，对话栏直接发送图片需求，不要求额外聊天模型；有聊天模型时仍可使用 LangGraph 工具循环。选择器、输入提示与按钮区分这两种行为，图片结果沿用 Loomic 事件契约进入原生画布。画布参考图的 `canvas-ref` 类型已与业务请求对齐。
- `GOUO_RELAY_OWNER_ID` 可将开发 relay token 的生成权限限定到其原账号；其他真实账号及伪造 `New-Api-User` 不能消费该 token。Vite 子进程不继承 relay key。
- 云环境启动 helper 只读现有开发 New API 数据库，在内存复用用户已创建的 token，不生成新 token、不复制 provider key。根据实际 `/v1/models` 可见列表生成服务器模型配置，并固定渠道 1，利用 New API `PinRetrySingleAttempt` 阻止内部重试。既有账号、权限、配置、余额和订阅没有被手工修改。

用户单独授权一次真实 `gpt-image-2` 图片验证。实际 `POST /v1/images/generations`，`n=1`、`response_format=b64_json`、未指定质量/尺寸；HTTP 200 返回一张通过 Sharp 格式/像素校验的 **1254×1254 PNG**。耗时约 37 秒；New API 日志为同一次 attempt 的 channel_selected/request_completed，消费日志总数从 5 增至 6，没有第二次请求或失败重交。脱敏报告和测试图片保存在环境私有 state，未提交图片或凭据。

仅环境中的 `gpt-image-2`、渠道 1、固定 New API `v1.0.0-rc.40` 的本次默认参数生成操作标为 live-verified 并启用。其余图片别名保持不可用；`gpt-image-2-4k` 未出现在该 token 的实际目录中。编辑、质量、比例参数、其他模型和一般文字聊天均未因此获得验证。仓库示例配置继续 pending/disabled；不能将本次结论套用到其他渠道或新安装环境。

| 本次检查 | 实际结果 |
| --- | --- |
| `npm run check` | 类型检查、14 个领域/探测测试、10 个 API 测试及构建通过；随后补充跨创作模式复用请求 ID 的防重复消费检查，最终 `npm run test:api` 为 11 passed |
| `npm run test:e2e` | 12 passed；新增仅图片渠道的模式选择、发送及结果进入画布检查；初次因两个生图按钮同名导致定位歧义，明确对话按钮名称后全套通过 |
| 最终 `npm run build` | 通过，临时外网入口已使用更新后的生产构建 |
| 公网真实账号 | 原生画布登录、内存 token、Secure/HttpOnly refresh、刷新恢复、退出撤销、匿名/外站拒绝、畸形图片请求拒绝通过；此账号检查没有发起模型调用 |
| 密钥检查 | 实际 relay key 不在全部 128 个前端构建文件中；代码/测试/文档不包含真实密钥 |
| 真实图片验证 | 用户授权后恰好一次 Images 调用成功；结果为 1254×1254 PNG |

下一项仍为 B2：按用户选择验证其他模型及参考图编辑能力；视频、可恢复 Worker、云库、订阅权益仍未接入。临时 tunnel URL 随重启变化，环境休眠后服务需要按启动说明恢复；这不是生产部署。

## Loomic 集成：此前交付（2026-09-30）

- 用户选择成熟 Loomic 前端，图片优先、视频生成后续接入、不做视频剪裁；没有旧数据迁移，云项目/素材库继续暂缓。
- 复用上游 `fancyboi999/Loomic` 提交 `bdb47a5adf900b48615af0bd914336e3770021b5` 的原生画布/工具栏/图层/文件/聊天/项目组件与样式。V2 的 Fabric starter 已替换；不是另写一个 Excalidraw 外壳。MIT LICENSE、原文件哈希和第三方声明随源码保留，见 LOOMIC.md。
- `/studio/` 直接进入无限画布，`/studio/projects` 为本地项目列表。PNG/JPEG/WebP 导入、图形/文字编辑、PNG/Excalidraw 文档导出、项目新建/再打开/删除、本地画布与聊天恢复已接入。移动端聊天覆盖层和图片生成面板适配视口。
- IndexedDB 分类保存访客/账号草稿；登录即切换本地 scope，不迁移访客数据。显式保存显示“正在保存”并在写入结束后提示成功；会话加载期间禁用输入，生成期间仍可准备下一条消息。修正初始化/卸载时 SDK 空场景覆盖草稿的问题，并在账号/项目切换时卸载旧 transport，防止迟到结果插入另一画布。
- 新增 `v2/apps/api` Fastify 服务：New API Bearer 身份校验、脱敏模型目录、Images JSON/multipart、LangGraph Chat Completions/图片工具与本地 SQLite 请求去重。relay key 不进入浏览器；未验证配置不能生成，未知结果不自动重复提交。
- 原生图片面板使用渠道质量/比例/编辑能力；模型切换更新参数，支持任意已验证 quality 字符串，不用旧全局枚举。引用图片经过边界检查，实际结果保持宽高比。
- 未接入 Supabase/PGMQ/积分/支付/品牌库。视频入口禁用，仅保留渲染/事件扩展结构。HTTP 返回事件批次，不是 WebSocket/token 流式服务；SQLite request guard 不是 durable Worker、权益或用量预留。

### 本次实际验证

环境：Node 22.22.0、npm 11.9.0。新增依赖有意更新 V2 锁文件，随后 `npm ci` 重装成功（553 packages）。旧 root 依赖/锁文件、src/、server/ 未修改。

| 检查 | 实际结果 |
| --- | --- |
| `npm run check` | 类型检查、14 个领域/探测测试、7 个 API 测试、生产构建通过 |
| `npm run test:e2e` | 11 passed：4 个认证流程 + 7 个 Loomic 画布/聊天/项目/能力/移动端流程 |
| 关键时序复验 | 生成结果保存/恢复与项目切换中止旧等待各重复 3 次，6 passed |
| API 协议检查 | 匿名/伪造身份拒绝、未验证禁用、owner scoped 重放/参数冲突、未知失败重启后阻止重交、JSON/multipart 保留字段、异常图片/URL-only/错误不成功、本地 LangGraph 工具循环通过 |
| 图片面板与草稿 | 导入→保存→刷新→PNG/文档导出、项目再打开/新建/确认删除且不被卸载保存复活、登录切换草稿、图片工具结果/聊天恢复、xhigh/max 模型切换及参考图参数、图片比例保留、切项目中止旧等待通过 |
| 真实 New API 浏览器联调 | 登录、内存凭据、HttpOnly refresh Cookie、刷新恢复、退出后再刷新仍退出通过；实际业务 API 匿名 401、认证未配置 503；没有模型调用 |
| 启停 | `npm run dev` 同时启动 3001/5174；停止联合进程后两个子服务端口关闭，可重新启动 |
| 预览 | 实际桌面/移动端/本地项目截图已捕获，无页面异常；图片为本地绘制示例，不是 AI 输出 |

构建保留 Excalidraw 同源字体和第三方声明；废弃 Liberation 字体资源排除。Vite 提示部分第三方编辑器 chunk 超过 500 kB，构建成功，首屏/资源裁减需后续性能评估；Node 22 的内置 SQLite 有 experimental warning，当前仅作为开发阶段去重底座。

**下一项 B2：实际 New API 模型渠道验证。** 当前示例模型全部 pending/disabled，没有配置 relay key，没有真实付费生图或视频调用。模板商品字段、批量、Responses/Gemini/fal/视频适配、持久化 Job/Worker、云库、生产身份/HTTPS/CSRF、订阅权益仍有对应任务。不能把 UI 与本地协议检查当成完整可收费 SaaS。配置与接入边界见 LOOMIC.md。

---

以下是 Loomic 接入前的验证历史，Fabric starter 内容不代表当前界面。

## 接入 Loomic 前的后端与范围（2026-09-30，历史）

- 用户选择 New API 替换 One Hub；新开发无历史数据迁移，云项目/素材库暂缓。旧 src/ 和 server/ 保留作参考，默认不启动。
- 开发固定官方 `v1.0.0-rc.40`，源码提交 `0aec08fee811ec6136828fda790551b49e410301`；校验官方 Linux amd64 发布资产与 SHA-256，未修改上游源码。使用独立本地 SQLite，随机管理员凭据不进入仓库或日志。
- V2 已适配 New API 登录、Bearer profile、HttpOnly Cookie 刷新和 POST 退出。访问令牌仅留内存；读请求遇 401 最多刷新重试一次，写请求不自动重交。失败退出保留账号显示并报告错误，缺少有效会话的响应不能标为登录成功。
- 云环境安装/启动配置草稿已保存。运行检查完成不表示配置已发布或未来任务已经重新验证。当前工作在 v2 派生任务分支，不修改 main，不部署。
- 实际页面预览时修正了 Fabric 7 新文字默认居中原点造成的左侧裁切；显式使用左上原点，文字初始完整显示在画布内。页面截图使用本地示例文字，未调用 AI。

## 接入 Loomic 前的验证（2026-09-30，历史）

Node 22.22.0、npm 11.9.0；按已有锁文件 `npm ci` 安装，没有新增 npm 依赖或变更锁文件。New API 运行官方预编译发布资产，不声称完成上游源码构建或完整测试套件。

| 检查 | 实际结果 |
| --- | --- |
| `npm run check` | 类型检查、14 个 Node 测试、生产构建通过 |
| `npm run test:e2e` | 5 passed：本地编辑导出、账号恢复/退出、错误密码/退出失败、读刷新/写不重交、异常登录响应 |
| 本地 New API HTTP 检查 | 控制台、初始化、匿名 401、登录/profile、刷新、退出后令牌撤销、无凭据图片生成/编辑 401 通过 |
| 真实浏览器联调 | V2 → New API 登录、内存凭据、HttpOnly Cookie、页面刷新恢复、退出后再刷新保持退出通过 |
| New API 重启后重复检查 | 沿用独立开发数据库，HTTP 检查与真实浏览器登录流程再次通过 |

New API 控制台和账号可用不表示模型工作流已接通。未配置上游模型渠道，未发起真实付费生图或支付；GPT Image 2.5 等仍未 live-verified。MFA/额外登录验证尚未在 V2 实现；当前仅本地 HTTP 开发，生产 HTTPS、安全 Cookie 与 Origin/CSRF 策略仍需配置验证。下一项为 B2 模型目录/协议兼容，B1 云库继续暂缓。

## Starter 已提交内容

- 独立 npm workspace、React/Vite 应用壳、路由与可复用 UI 包。
- TanStack Query 账号接口桥接；当前已换为 New API 会话协议，不获取浏览器 relay token。
- Fabric 本地图片/文字/变换/多选删除/PNG 导出；不上传、不生图、不收费。
- 共享 TypeScript 领域契约、能力校验、任务状态转换约束。
- 显式付费开关的 OpenAI Images operator probe 与脱敏摘要。
- Node 测试、Playwright smoke、初始化脚本、只读权限 CI、架构/数据/模型/订阅/迁移文档。
- 已提交真实 npm package-lock.json，初始化直接使用 npm ci。

这不表示 Job/Worker、会员支付、所有模型适配或完整编辑器已完成。按 TASKS.md 当前范围继续 B2/B3/E1；云端 Project/Asset API 暂缓。

## 已执行的验证（2026-09-18）

本地 Node 22.16.0：共享契约 TypeScript 编译通过，14 个 Node 测试通过。由于本地环境网络/DNS 限制，完整依赖与浏览器检查改由 GitHub Actions 执行。

GitHub Actions：Ubuntu runner，Node 22.23.2，npm 10.9.8。

| 检查 | 实际结果 |
| --- | --- |
| npm install（首次生成依赖锁） | 通过 |
| npm run typecheck | 通过 |
| npm test | 14 passed，0 failed |
| npm run build | 通过 |
| npm run test:e2e | 1 passed；工作台、文字编辑/PNG 下载、模型清单导航 |

成功记录：
- 应用起点提交 `948cf4d481a8ed283c3c277056fa5703885b450b`，运行 https://github.com/zhs1234/gouo-canvas/actions/runs/35325115628 。
- 依赖锁生成/复核运行 https://github.com/zhs1234/gouo-canvas/actions/runs/35325554586 ，依赖锁提交 `0c9199bc96752529f9fb0ed836980fe749bdb57b`。

临时依赖锁写回任务已完成并从正式 CI 移除；正式 workflow 仅 contents: read，不部署、不自动提交业务改动。后续 CI 使用 npm ci 复验锁文件。历史上一次临时 workflow 的 YAML 条件语法错误已修正，不是应用测试失败。

首次已验证依赖：React/React DOM 19.3.0、Fabric 7.4.0、React Router DOM 7.18.4、TanStack Query 5.103.1、Vite 7.3.6、TypeScript 5.9.3、Playwright 1.63.0。以仓库锁文件为准；升级后必须重新验证。

## 初始交付时尚未验证（历史记录）

没有真实模型/支付凭据测试，GPT Image 2.5 和其他模型在本平台均待真实渠道验证。未启动现有 Go 后端做账号/支付/数据库集成回归。1 个浏览器 smoke 不是完整图像编辑器或商业平台的端到端覆盖。

初始交付未改变 main、部署、生产数据库、额度或账号权限。当时计划先实施 B1；当前已复验 V2 并选择 New API，云库暂缓，以本页最新范围为准。Image 2.5 参数/模型映射诊断仍是 B2 的最高优先级。
