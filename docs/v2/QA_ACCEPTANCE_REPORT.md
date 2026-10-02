# V2 系统验收与历史四角色报告

## 系统主线最新证据（2026-10-02）

系统分支 `codex/system-integration` 整合UI799ad3b，应用源码截至 `3c69835`，隔离测试配置截至 `ad3f844`。独立worktree交付，没有替换原日常8080或修改旧QA/生产数据。当前最终完整回归及整栈结果以STATUS顶部为准，以下不把旧T1.11快照当作最终源码的新执行。

| 当前角色/能力 | 本轮实际证据 | 结果与边界 |
| --- | --- | --- |
| A 新普通账号 | 全新owner11/12实际Native注册；owner12加密UI登录到默认首页，真实meta-only create后唯一文本发送 | completed、试用4→3、Native唯一12合成quota/request ID；刷新同thread/run，无模型重发。商户支付/MFA/真实权益未验 |
| B 回访/断网 | owner7文本、owner4图片真实offline/online；owner8原图成功后总结丢响应、失败GET/完整reload；owner12首页完成后reload | 部分文本/同PNG保留；原GET恢复0新调用；owner8真实run.failed+chat/image unknown held保留，不把Ledger completed称模型成功 |
| C 商品画布 | 新E1三入口10F；真实dist游客导入明确本地PNG、可编辑版式/PNG及文档/reload验收单列 | 原bytes/比例/裁剪/翻转保留，精确frame PNG、文档可编辑；短文案范围，无真实AI质量/Logo素材库/自动长文案适配声明 |
| D 授权/费用/任务 | 连续B3N2 owner11/foreign7、原job GET/asset本人200、异户404/匿名401；独立backend报告复核 | IDB sequence1→原fetch2、参数hash一致、唯一POST202，同API ticks739关页继续；原占用held/reserved→used。费用recorded/unconfirmed |
| 原任务与原图 | B3N2新tab真offline GET失败保占位→online同ID GET插一次；实际导出文档和reload；B3N1私有项目revision2分段补验 | B3N2完整连续passed，image+1/chat0、恢复业务写0；导出为文档内嵌PNG，不冒称独立PNG下载。B3N1分段仍明确noncontinuous |
| 运行恢复 | OPS-N1实际配对冷备份→全新空目标恢复→ordinary读取 | 冷态双库logical/schema/hash相同；原项目rev2/PNG/failed/unknownheld恢复。源冷停止，目标启动后两轮本人/异户/匿名读，保护投影不变，供应商0调用 |

私有证据索引：`.local/t112-text-continuous-offline-report.json`、`t112-image-offline-report.json`、`t112-image-unknown-offline-report.json`，`.local/native-image-jobs-resumed-report.json`（分段），`.local/native-image-jobs-ui-continuous-report.json`（连续），`.local/system-default-chat-native-report.json`，`.local/system-ops-native-read-report.json`。原PNG SHA256 `796624ad4af7f93c4be52b243483386321deb37279c054bfa6921b16908261f3`。报告脱敏，账号manifest/数据库/原始secret不提交；详细时间、命令、失败及边界见SYSTEM-INTEGRATION-STATUS。真实供应商调用与采购0，F/N/P不相加。

本轮首次整栈发现meta/detail创建崩溃，新增3F并修正应用；首失败trace/screenshot保留。第二次整栈遭并行PW共用test-results导致trace ENOENT，保留失败日志，随后ad3f844将stack/完整fixture输出隔离；不把设施失败归为新资金/模型成功。旧Native429、首次frame缓存、offline reader、summary失终止标记、N202脚本误读平铺result和/proc尾换行等失败均保留，受理后只有原请求查询/继续，没有重试模型补绿灯。

最终QA-FINAL已通过本地首交付：应用3c69835的check为110领域/205API/类型/build12.42秒exit0；配置ad3f844的`npm run test:e2e:isolated -- --workers=1 --reporter=line` **206/206，5.3分钟**；三阶段stack exit0（真实固定未初始化Native边界，明确假New API合同2/2 12.4秒，fixture资金普通账号闭环1/1 4.7秒）。设施40F和实际Native专项分别记录，准确命令/日志见STATUS顶部。

隔离双worker首次205/206历史分页5秒未见“最新回答”，原因未证实；原日志另存`.local/system-pagination-original-205-of-206.log`，独立12次定向及最终单worker全量通过，没有改应用/断言/超时。保留失败，不将后续通过视为根因证明。真实dist游客报告`output/playwright/dist-guest-5a715e5-20261002/report.json`初始11/11、fresh当前3c69835另8/8，通过商品PNG导入、640×480原生版式、PNG/文档导出、原bytes及重开像素一致；模型POST0，3次匿名refresh401如实保留。旧tab在live dist更新后chunk404真实失败，fresh最终四入口/390px/设置及键盘路径另验，生产需原子版本切换并保留旧hash资产。原生文件选择器CLI AbortError及严格连续焦点锁定不计通过，完整限制见LOCAL-SYSTEM-HANDOFF/STATUS。

## 原28场景的新增子项与保留门（2026-10-02）

B5核心F/N“提交→浏览器真实断网→恢复→只读刷新，未知保held/零重发/零退款”已由T1.12连续文本、图片和丢总结响应补齐，改为核心通过。其真实供应商P仍未执行。其他9个partial不因新增自动测试或单条图片任务通过而整体升级；原场景与新增B3/E1/OPS不是同一计数单位。

| 角色 | 核心通过 | partial | 未执行 | 原计划 |
| --- | ---: | ---: | ---: | ---: |
| A | 3 | 4 | 0 | 7 |
| B | 6 | 1 | 0 | 7 |
| C | 7 | 0 | 0 | 7 |
| D | 3 | 4 | 0 | 7 |
| 合计 | 19 | 9 | 0 | 28 |

原标记F19/9/0（28）、N16/9/0（25）、P0/0/13（13）。B2/C5/C6本来只标F；Native身份参与不升级它们为N模型验收。此计数是已有证据加新子项，**不是最终版本重新实操全部28项**。

保留partial：A1首次原生注册完整默认返回成本；A5全部类别/不可用变体；A6充值/余图与下一同意完整生命周期；A7各政策生命周期；B7当前/全部旧session失效直接观察；D4未知key的全部重放变体；D5其它token/订阅失效组合；D6其它503/素材保存/续用unknown变体；D7混合钱包→订阅→钱包逐笔资金链。已有合同/局部Native证据不当完整N操作。公开安全G1、资金修正/请求级实扣G2、具体供应商质量成本P、商户支付/SMTP/MFA、生产容量/加密/保留仍另门；独立授权/Worker为B3-II/III，后续产品范围不冒称完成。

下方所有“当前/下一”和18/10等均为当日历史，不覆盖本页最新证据。

## T1.11 双账号完整地址隔离与费用记录（2026-10-01）

当前项目 `codex/registration-trial` 基于 `f7a0fe5`；三位 gpt-6.1-sol 子智能体独立操作与复核，新随机55075真实固定Native/Studio，两个普通合成账号各仅准备一次用户发送、本地供应商成本0。准备完成后4chat/2image，Native6消费日志，Studio2run/2request/2asset/2project；后续读取、换户、地址与接口负例不新增生成。日常Native/API身份及业务数据、旧QA53238/58438、原unknown/held和资金未操作；日常仅更新web和guest只读验收，真实供应商/商户支付0。

| ID | 严重度 | 实际发现、修正和复验 |
| --- | --- | --- |
| Q26 | P2 | 双真实账号已存画布仅重开，GET revision2后无编辑PATCH为3；首次SDK hydration建立已读基线、no-op不写/不虚报保存，实际source插入及真实编辑仍CAS保存。原版F reopen writes1→2失败，新F真实编辑/恢复/原图与N双方rev3/1800ms无PATCH、导出PNG hash不变通过 |
| Q27 | P2 | bare `/studio?thread=...` 重定向丢参数；普通stack另发现外部端口被写成内部8080。两份Nginx保留query，默认相对Location。实际N slashless301→200保留thread/extra/hash并恢复原会话；normal/prepared真实边界反例通过，未修改鉴权/安全参数 |
| Q28 | P2 | 近期费用记录缺调用时间，相同模型/金额无法UI唯一核对本人记录。复用Native Unix秒展示中文日期/秒/本机时区，无效值明确不可用；金额仍recorded/unconfirmed。旧组件实际F时间断言失败，新两项换户/晚响应/五种非法值通过；不伪造日期/账单或扩大金额接口 |

累计去重 **28项修正（P1 10/P2 18，未证实P0）**。Q28不是已发生跨户费用泄漏；它是实际发现的核对能力缺口。更完整合同见 [OWNER-ISOLATION.md](OWNER-ISOLATION.md)，命令、过程失败和原图hash见STATUS顶部。

D2核心范围已通过：两独立profile双向8/8完整thread/project/project+asset/本人project+异户asset地址实际404、本人身份不变/无内容原图；最后一项先429，保留profile自然窗口后一次本人恢复200才取得真正asset404。单次52HTTP真实普通Native JWT和binary核验，双向directthread/run/project/asset、异户PATCH/三种asset引用/重复物化/foreignthread生成均拒绝，本人DTO/幂等ID/revision不变；24×200/28×404不是52个生成或全部负例。两条DELETE404只表示不支持路由。被拒新ID跨全owner五表各0；根Native完整四表与users安全投影、Studio十一表/provider对象准备完成到HTTP最终精确不变。正常login的last_login/session元数据不在资金不变主张中。

D1核心范围通过：同一浏览器A正常保存/列出命名本机草稿→共享logout200→B原生login；4/4异户地址拒绝，B不列出/自动打开A本机草稿，B会话/私有项目rev3/不同原PNG/试用3聊0图恢复。B本人run三个Native requestIDs只读映射owner3消费DB6/7/8、排除A；界面费用日志ID1/2/3是Native按页展示重编。两户费用数值相同，首UI未展开记录，原限定步骤保留。Q28后实际同浏览器再次A登录/展开22:07:10→logout200→B登录/展开22:10:31，六元组id/model/createdAt/cost/input/output与相应本人RO记录精确匹配，B排除A的Unix/ISO/可见时间。两次登录/两次真实logout200，无429/自动重试；最终after-billing根全保护哈希/provider仍等prepared，无新模型/权益/资金变化。F不同owner时间与晚响应不替代该N展示步骤，二者分别通过；用量折算仍不是钱包实扣回执。

当前原28 **18通过/10partial/0未执行**；A3/4/0、B5/2/0、C7/0/0、D3/4/0，F18/10/0、N15/10/0、P0/0/13。F/N重叠不能相加。B5浏览器断网、B7剩余旧会话、A6/A7剩余权益与钱包生命周期、D4unknown重放、D5其它token/订阅失效、D6续用unknown与素材故障、D7混合逐笔资金链及G1/G2/真实启用门项保留。下方T1.10及更早计数都是阶段历史。

最终包含Q28的check51/157/build12.42秒、146/146浏览器4.2分钟和三阶段stack exit0（personal2/2 12.6秒、fresh1/1 4.6秒）；prepared edge独立exit0。主要报告 `.local/t111-{dual-profile,same-browser,same-billing,owner-native}-report.json`、`.local/t111-protected-{prepared,after-dual,after-same,before-http,after-http,after-billing}.json`、`.local/t111-final-negative-proof.json` 与 `output/playwright/t111-*`。旧组件baseline、定位错误及真实失败全部保留，不删除保存/授权/资金断言，也不把本轮叫作成熟产品已完成。下一T1.12浏览器断网/只读重连恢复与unknown屏障。

## T1.10 模型失权与原生安全子项（2026-10-01）

三位 gpt-6.1-sol 子智能体分别只读审查、实现/独立复核和实际浏览器验收，全部留在当前项目。两套全新随机 Native 环境为 57659 安全路径、57675 两模型选择路径；固定 SHA/binary 与日常相同，明确本地供应商/合成账户，真实采购 0。旧 53238/58438、日常 Native、旧 unknown/held 和资金未操作。报告 `.local/t110-{security,selection}-report.json`，根只读最终 `.local/t110-evidence-summary.json`；本轮新随机容器/卷和 CLI sessions 已自行清理，证据留存。

| ID | 严重度 | 触发、修正与证据 |
| --- | --- | --- |
| Q23 | P1 | 明确选 B 后目录部分失权或页面卸载丢选择，ChatLab fallback 和 Loomic selector 清 null 使界面静默改 A。保留本人选择 ID，失权提示/禁发、不换模型，原地只读刷新保输入/历史/原图，清本次余额同意；五分钟 Query 回收反例先实际失败为 A，再以专门 gcTime 保留本 SPA 意图。真实 Native UI baseline→修复及一次旧目录 POST403、0 provider/模型/资金写证据；F pending/倒序/恢复/长画布停留/旧输入/移动用例 |
| Q24 | P2 | Loomic Agent/图片偏好使用无 owner 全浏览器 key，换户沿用上一户选择。沿用原 hooks 但按 owner 分键；旧无归属键保留但不迁入。独立复核发现新增 scoped 图片缓存先写 key/raw、JSON 失败后第二次 snapshot 可返回上一户对象，先解析再一次提交缓存修正；absent/corrupt 两个换户反例及保留旧 key 通过，未称真实凭据或跨户原图泄漏 |
| Q25 | P2 | 图片偏好仍可新选失权候选，原标签暗示未实现 PRO 套餐。按钮按 accessible 禁用，显示不可用；可用候选仍可本人选择，0 POST 反例。不更换编辑器或扩模型权限 |

本轮 3 项与此前 22 项去重合 **25 项修正，P1 10 项/P2 15 项，未证实 P0**。独立复核和五分钟缓存发现均在本轮提交前修正；自动回归的虚拟时钟不能充当实际等待五分钟。实际 Native UI 验证主选择构建，随后 cache/GC 增量由最终 F 回归验证，没有再登录 Native 重做。更完整选择合同见 [MODEL-SELECTION.md](MODEL-SELECTION.md)。

D5 限定新子项直接通过：旧版明确 B 经正常项目库往返 fresh 目录变 A；新 bundle 同页面按钮刷新聊天/图片失权保持空占位、不替 A，输入保留、发送与同意禁用/清除，本人重选恢复。fresh 目录后选 B，再只撤销权限且不刷新，实际只点一次发送，Studio `/runs/stream` 403，仍 B/无自动重放。根持久证据确认 Native/provider 模型调用 0、token/subscription/grant/reservation/submission/funding/renewal 均 0，只有一个空 thread、0 run/request。不能从这次已知拒绝推广所有未知请求已结算。

B7 限定新子项：真实 Native UI 注册/登录，Studio profile 唯一显示名提交且本人名一致；第一次独立旧 context refresh401、旧密码拒绝/新密码接受。首次提交附近 CLI browser 关闭，原当前 Cookie 子项没有证据，不重放。确认第一次实际改密后，第二个明确不同的新密码意图取得新 proof，实际 verifyPOST200/selfPUT200 各一次；同一当前 context 完整 document reload refresh200/self200，恢复 Studio 身份。第二旧 context refresh429、最终额外登录429，停止不重试/不改限流；不能称这两个 HTTP401/最终旧新密码配对已验。原生 RO metadata auth_version3，旧 version1 一条/version2 两条均 password_changed revoked，current3 active1，quota/used/request_count0。仍 **partial**，不以 metadata 或新登录代替未直接观察的原 context。

原 28 核心场景计数保持 **16 通过/12 partial/0 未执行**；F16/12/0、N13/12/0、P0/0/13，真实商户支付未验。D1/D2 全地址双向矩阵、D5 其它 token/订阅/资金补充、B5 浏览器断网、D6 续用未知与素材故障等仍未全部执行；本轮不填满原场景。G1/G2 和真实配置/供应商启用仍受原批准门项约束，整体目标继续。

最终命令见 STATUS 顶部：check51/157/build、完整143/143；整栈和主实例证明单列。保留首定向23例22通过/1误按钮名称失败、复验3/3，完整141例83通过/58失败（首控件缺失、随后5174 connection refused，监听已终止，未确定根因）；明确管理自身 dev session 后141/141，再补 corrupt 142/142、GC baseline1失败→fixed1通过，最终143/143。未删除授权/保存/资金断言，也不把服务监听终止或 CLI 关闭计入产品去重数。

## T1.9 账号共享、真实访客补验与问题统计（2026-10-01）

三位gpt-6.1-sol子智能体在当前项目的独立访客浏览器使用真实8080，根另CUA核对截图。四页菜单/设置原地打开与关闭、手机390drawer/焦点/无溢出、Enter/Arrow/Escape与20次Tab限制通过。另1440真实本地fixturePNG导入→设置→聊天→原URL返回→导出，1图/1file、96×64原图bytes哈希完全一致，详见STATUS。没有提交主实例注册/登录/MFA/模型/资金；主Native未初始化，实际真实账号成功不能计入此访客补验。

| ID | 严重度 | 触发、修正与证据 |
| --- | --- | --- |
| Q16 | P2 | 各页账号入口两步跳聊天/重复弹层，改同一底部menu/settings分栏。实际四页、键盘/手机与路由不变验收 |
| Q17 | P1 | logout先改会话再reload绕保存guard，可能丢pending/内存副本；先共享真实保存check，失败0logout可导出，成功无document导航。故障PW和真实本地scene导出 |
| Q18 | P2 | 关闭旧面板清profile/renewal未确认状态，再开可重复提交；常驻内容、按owner隔离，profile单tab意图预写与显式只读确认，拒写/损坏0PUT。跨关闭/页面/刷新负例，金融unknown持久闸保持原样 |
| Q19 | P1 | pending原生logout/login晚响应可清/发布新身份；响应和取消查询后epoch fence。实际延迟/广播PW验证旧logout不成功、不再次广播、gate保留 |
| Q20 | P2 | 新dialog未继承旧表单CSS，输入/按钮缺清楚边界且横排；scoped竖向控件/中性样式，root实际截图发现，子智能体临时CSS视觉尺寸验证，正式bundle冷读42px输入/边框/中性分类通过，最终135浏览器回归通过 |
| Q21 | P2 | 996px原工作台“对话”覆盖顶部账号，普通点击超时；chat折叠时预留右侧空间。实际原失败、996/390正式bundle普通点击/保图/hash回归，不使用force |
| Q22 | P2 | 矮996×500设置滚整个popup，关闭按钮滚出；固定header/分类，内部body滚动。子智能体真实发现/996与390临时CSS验证，正式bundle390冷读/内部滚动复验和996/390短视口用例通过 |

本轮7项与此前15项去重合 **22项修正，P1 9项/P2 13项，未证实P0**；最终source完整135/135、check51/157、三阶段stack与正式bundle冷读通过；命令和范围见STATUS，临时CSS证据保留且不充当正式部署。首两轮新测试的fixture同步/角色/URL/中文匹配失败保留，不计作产品问题；旧界面定向49/49、初版132完整通过后，新增实际问题推动最终复验，不能拿初版结果替代最终。

独立真实固定Native私有profile新路线exit0，setting/资金偏好/权限与用量哈希保留，禁止字段0PUT；原密码proof/旋转/撤销/refresh保留，token空列表范围明说。是N合同，访客操作及浏览器故障是F，两者不扩大原28计数。当前仍16通过/12partial/0未执行；P和真实商户0验，G1/G2与其他partial子项保留，真实费用0。

## T1.8 导航实际补验与问题统计（2026-10-01）

实际内置浏览器未登录 ChatGPT、Edge 已登录首页/账户菜单/设置已查看并保存本机截图；本机 8080 真实新版页面的默认聊天、官方画布、项目库、原工作台和返回入口亦已截图。子智能体独立做桌面996px/手机390px真实往返，报告 `.local/t18-review-report.json`；没有登录/初始化主实例或调用模型。保存故障、跨owner和旧URL由明确浏览器fixture反例补充，不能称为实际磁盘坏损/付费账户验收。详细路线与截图目录见 [WORKSPACE-NAVIGATION.md](WORKSPACE-NAVIGATION.md)。

| ID | 严重度 | 触发与修复 | 证据范围 |
| --- | --- | --- | --- |
| Q10 | P1 | 用户实际报告画布缺乏互通出口、默认进入画布；默认聊天及四工作页共用固定侧栏/手机抽屉 | 主任务实际本机截图、子智能体桌面/手机往返、根/旧alias/返回测试 |
| Q11 | P1 | 新共享壳初版移动抽屉挂载即触发关闭，无法选择入口；关闭逻辑移至稳定外层且仅实际导航关闭 | 实际 PW 操作，保存失败仍保留抽屉、成功才关闭 |
| Q12 | P1 | 待存草稿显式删除成功后 guard 仍尝试写已删除id，困住导航；仅成功删除精确通知并清pending | 真实 IndexedDB 删除/写失败反例，禁止删除复活，失败保留导出 |
| Q13 | P1 | owner强制卸载前pending丢失/SDK卸载空回调覆盖；冻结最新scene到原owner/id并忽略卸载回调 | owner7→8→7、拒写/晚写、原图/未知sessions/messages保存反例；内存副本不保证整页关闭 |
| Q14 | P2 | Loomic会话URL更新重建search丢未知query/hash；基于最新URL仅调整id/session/prompt | 实际新会话动作、未知字段/hash/旧alias保留测试 |
| Q15 | P2 | 996px宽屏加侧栏后官方SDK素材库按钮右侧裁切；编辑器容器查询收紧原顶部间距 | 子智能体实际发现/临时预览；最终源码真实bounds/点击/无溢出回归 |

与 T1.6 的8项和T1.7 Q9去重后合计 **15项修正（P1 7项、P2 8项）**，未证实P0。保存/owner负例是实现与故障测试发现，严重度表示潜在用户损失，不冒称已发生跨户泄漏。最终测试结果见 STATUS；原115例109通过/6旧fixture与同步失败、定向与后续完整复跑日志均保留，无移除断言或模拟成功。

原28场景当时计数保持 **16通过/12partial/0未执行**，F16/12/0、N13/12/0、P0/0/13；导航自动测试和参考截图不扩大这组计数。真实支付/供应商仍未验，G1/G2未启用。当时下一T1.9已识别全页面账号入口不一致、退出前缺保存和面板卸载清除未知状态风险，尚未修正，不计入以上15项；后续完成状态见本文T1.9段。

## T1.7 最新补验（2026-10-01）

基于 T1.6 提交 `8f51853`，继续在当前项目和 `codex/registration-trial`。三位 gpt-6.1-sol 子智能体分别负责 Native 源码与事务回归、真实 Native 失败预扣对照、剩余账号状态的实际浏览器补验。旧 QA 53238 的请求、原图、unknown/held 与资金证据保持原样；新 UI 环境为独立随机卷的 `http://127.0.0.1:58438`，profile `t17-ui`，owner 2。真实供应商、商户支付和采购仍为 0。

T1.7当时原28场景的F/N核心范围统计如下，当前结果以本文T1.11顶部为准。A7从未执行变为partial；当时没有增加整项通过数，未验补充条件和所有P门槛保留。

| 角色 | 核心范围通过 | partial | 未执行 | 计划 |
| --- | ---: | ---: | ---: | ---: |
| A 新用户 | 3 | 4 | 0 | 7 |
| B 回访聊天 | 5 | 2 | 0 | 7 |
| C 电商画布 | 7 | 0 | 0 | 7 |
| D 双账号与异常 | 1 | 6 | 0 | 7 |
| 合计 | 16 | 12 | 0 | 28 |

证据层仍重叠，不能相加：F 为 16/12/0（28），N 为 13/12/0（25），P 为 0/0/13（13 个未执行模型门槛）；真实商户充值另列未验。

本轮实际完成五个限定 UI 子验：A7 的 ineligible、disabled、unavailable、expired，以及 D5 的无分组模型权限。四种 A7 状态均通过实际 Panel 查询与未同意余额的发送拒绝；没有领取试用或调用模型。过期是明确 seed 的旧原生订阅 fixture，不是自然时钟到期/worker 生命周期证明；unavailable 是合成计划合法价格不匹配。A7 的剩余聊天/图片保留和试用退休后显式钱包生命周期仍未验。D5 无组模型权限真实读取后停止发送，但既有选中模型失权竞态等补充条件仍未验，整项维持 partial。

发现并修复 **Q9 / P2：无可用聊天模型时没有解释**。ChatLab 现在用既有 notice 显示安全中文原因，区分目录失败、生成关闭、本人权限不足和未配置/验证；不显示内部 channel/group/价格字段。目录失败时也清空缓存中的可用聊天与图片选择，保留旧历史。6 个定向浏览器反例/正常例通过，其中一例实际保留同一 SPA 文档，经过真实缓存过期后目录 503，验证历史仍在、模型/消息/发送/余额授权禁用且业务 POST 为 0。新 bundle 在 58438 真实 groupblocked 页面复验通过；前后 Native/Studio 安全快照哈希完全一致，provider chat/image 均为 0。证据为 `.local/t17-ui-report.json`、`output/playwright/t17-ui/D5-group-blocked-fixed-checks.json` 与新环境 `evidence-1790851347564.json`。原缺少说明的截图保留。

G2 已推进为有原版负向对照的**隔离退款事务候选**，不是正式修复启用。原版 SQLite 锁冲突与 MySQL/PostgreSQL 的金额/退款标记不原子回滚已复现；候选、测试、实际二进制与精确资金证据见 [NATIVE_REFUND_TRANSACTION_GATE.md](NATIVE_REFUND_TRANSACTION_GATE.md)。旧 G2 请求和 held 不退款、不重发、不释放，Studio 仍不负责金额。G1 共享 IP 限流方案尚未实施，用户“真实配置暂不启用”的决定继续有效。

以下 T1.6 数量、旧“未执行”与测试结果是保留的历史快照；当前数量以上表为准。

## T1.6 原阶段记录

2026-10-01，在 `codex/registration-trial` 上基于 `0350f75` 执行。此报告记录一个开发阶段的限定验收，**整体成熟产品仍未验收完成**。四角色通过各自浏览器 profile 操作真实网页；三位子智能体使用 gpt-6.1-sol，角色 A 由当前主任务执行。实现和报告均留在当前项目。

F 是明确本地供应商与测试数据；N 是真实固定版 New API 的注册、会话、令牌、网关和资金配置；P 是真实付费供应商。以下通过只表示已执行的 F/N 子范围，不能等同 P、支付商户或公开生产验收。真实供应商调用及采购支出均为 **0**。

## 环境与数据边界

- 日常环境 `http://localhost:8080/studio/`：三个服务 healthy，仅 web 发布 `127.0.0.1:8080`。Native 未初始化，generation/trial/renewal 全 false，仍为默认 Nginx 模板。只更新 Studio/web，没有重启 Native 或启用真实试用。
- 独立验收环境 `http://127.0.0.1:53238`，随机项目 `gouo-user-acceptance-36296-mup9mm60`，独立 Native/Studio 命名卷、私有 fixture-provider、独立 loopback web。与日常 8080 无共同数据库。
- 固定 Native 源码 `0aec08fee811ec6136828fda790551b49e410301`，运行二进制 SHA256 `a5fd598cc77e26ab2709305049fdd5fbbff722111be79f0ad89a493c3e094529`；没有修改或升级上游。
- 合成新用户钱包初始为零；第一次合格发送使用真实原生一次性零价格计划，有限额 500000、一天、不重置、最多购买一次、无钱包溢出。Studio 只限制 4 次用户发送和 1 次图片；工具循环最多 3 次聊天模型调用，不另造账号、钱包或真实费用账本。
- 模型目录和回复明确标注“本地验收替身·成本0”。原始 PNG 为 640×480，SHA256 `796624ad4af7f93c4be52b243483386321deb37279c054bfa6921b16908261f3`；不作为真实 AI 图片质量证据。
- 角色 A / B / C 分别 owner 5 / 6 / 3；D 使用 owner 2 与 4。账号、兑换码、原生合规标志和价格均是独立环境测试数据。Native UI 实际兑换合成码不代表商户支付成功。
- B 的 56 会话与 60 条运行是明确标注“分页验收样本·未调用模型”的数据，不是实际生成记录。所有角色静默且无 running 后，仅停止独立 Studio，连续持有 `.process-lock` 并在事务内写入；保护表哈希前后相同，Native 不重启。

安全限流保持原值。Native 注册、登录、刷新、退出，以及 token key 获取使用共享来源 IP 的 CT 20 次／1200 秒；Studio 的 `/api/log/self` 不使用 CT，而受 GA 全局 API 限流。没有降低阈值、轮换地址、重复重启或代用户修改可信代理。详细源码结论和启用决策见 [NATIVE_RATE_LIMIT_GATE.md](NATIVE_RATE_LIMIT_GATE.md)。

## T1.6 的 28 场景状态（历史快照）

计数单位是 [QA_ACCEPTANCE.md](QA_ACCEPTANCE.md) 的原 28 场景。一个场景有未验子项时计 partial，不把自动测试、局部成功或已执行故障注入当成整项通过。P 不计入 F/N 通过率。

| 角色 | F/N 核心范围通过 | partial | 未执行 | 计划 |
| --- | ---: | ---: | ---: | ---: |
| A 新用户 | 3 | 3 | 1 | 7 |
| B 回访聊天 | 5 | 2 | 0 | 7 |
| C 电商画布 | 7 | 0 | 0 | 7 |
| D 双账号与异常 | 1 | 6 | 0 | 7 |
| 合计 | 16 | 11 | 1 | 28 |

按原计划的F/N/P标记分别统计如下，层级重叠，**不能相加为场景总数**。B2/C5/C6原计划为F，因此不计入25个N场景；这些场景使用真实原生身份并不将本地导出或合成分页升级为原生模型验收。

| 证据层（原标记） | 核心范围通过 | partial | 未执行／门槛 | 计划 |
| --- | ---: | ---: | ---: | ---: |
| F 本地业务／供应商替身 | 16 | 11 | 1 | 28 |
| N 固定Native原生路径 | 13 | 11 | 1 | 25 |
| P 真实付费供应商 | 0 | 0 | 13 | 13 |

A6真实商户充值另需授权，本次0实际支付、2合成兑换；不并入13个模型P场景。此计数保留补充要求未完成时的partial，不能用实现阶段自动测试填满用户验收。

- A2/A3/A4 通过：首次资格查询不领取；零钱包首次文字经过真实 Native；一次生图用户发送只占一个聊天权益，图片另占一个。A1 是明确 redirect 的真实注册/登录，默认入口操作成本未验。A5 验过第五聊/第二图拒绝，但分类与不可用变体尚不完整；第二图拒绝的运行记录为failed，对应聊天权益unknown/held，不能合称run unknown。A6 实际合成兑换、未同意拒绝、明确一次余额使用、完成后勾选清除及下一独立发送未同意拒绝通过；新版冷恢复旧原图/失败原因也通过。实际支付及剩余图片保留变体未验。A7 未执行。
- B1/B2/B3/B4/B6 通过。原分页及更早记录操作完成；Q8 新版冷载后不点“更多”直接搜原未加载01命中。完成后刷新最初429，但自然到期一次手动恢复保持原消息与费用、无重发。Stop 保留已接收1–34段，上游后来实际completed，只读刷新得到完整原任务，不称取消。新线程最后一次发送完成，旧held保留。B5 是明确上游socket丢响应的子项通过，未验浏览器断网/重连，整项partial；B7只撤销已知非当前原生会话后该profile恢复401/访客、primary仍正常，通过子项，profile/proof密码旋转及全部旧会话撤销未验，整项partial。
- C1–C7 在 F/N 范围通过：原图 hash；编辑和素材失败时保留原图；本人既有项目插入与他人素材拒绝；改名保存重开；旧库只读、副本和未知字段/Blob 保留；文档/PNG 实际导出重导入；真实两标签 200/409 冲突、失败暂停、独立恢复副本导出与明确重载。失败截图保留，修复后同数据复验。P 图片质量与生产容量未验。
- D3 的最后一次并发通过：两标签真实点击，只新增一笔 Native 调用，另一笔 409，聊天剩 0、图片剩 1。D1/D2/D4/D5/D6/D7 均 partial：换户与跨户部分地址、已确认完成键重放、停用 token、资金 unknown、新 ID 屏障和部分本人日志已验；完整互换地址、组/订阅失效、unknown 重放变体、503/素材失败、续用 POST unknown、混合资金逐笔链未验。
- D6 实际 Native `wallet_only` PUT 成功后被验收层丢失响应，UI 保留资金 unknown、已完成聊天的 recorded/unconfirmed 记录与 chat held；不同新 ID、不同类别发送在 provider 前被拒。独立 Studio 重启后只读持久证据相同；最初冷启动auth429阻断，自然到期后一次手动恢复并通过新 ID 的实际 UI 屏障复验，owner4 request_count5和taggedD provider8均不增。D6其余变体仍partial。

最终业务统计来自脱敏 `evidence-1790849037348.json` 与 `.local/t16-final-statistics.json`：17个唯一实际模型提交的用户发送键、provider实际到达23次（chat20/image3，含1次response-lost）；Native22条消费日志、本人request_count合计22、日志与累计used_quota合1728。HTTP500的那一次有实际请求但没有consume日志，不能把22当全部模型请求数。试用chat13 used＋3 unknown/held，image3 used，另有owner4资金偏好unknown1。没有次数超用、旧key模型重放或自动资金处理；不把held当成功使用或退款。各角色：A5次用户发送/7 provider调用，B4/4，C1/3，D7/9。合成兑换仅A与D实际原生UI两笔，真实商户支付0，P和真实采购0。

明细和原始证据留在被忽略的本机目录：`v2/.local/t16-{a,b,c,d}-report.json`、`v2/.local/user-acceptance-BS7s9Z/evidence-*.json` 与 `v2/output/playwright/`。不提交账号凭据、Cookie、JWT、完整 token key 或带密码的截图。

## 发现与修复

去重后 **8 个已修产品问题：P1 三个，P2 五个，未证实 P0**；另有两个未解决的真实启用门槛G1/G2，后者为原生计费预扣证据问题。严重度依据用户可见影响与源码风险，不把服务器已拒绝的跨户地址称为泄漏。

| ID | 严重度 | 触发、原现象 | 修复与证据 |
| --- | --- | --- | --- |
| Q1 | P2 | 保存项目后进入项目库或冷刷新，Native 空/非 JSON 429 被当成访客，私有入口消失；内部整页导航额外消耗刷新预算 | 区分 401、403、429、网络错误，显式身份恢复与 Retry-After 倒计时，无自动业务重放；gate 保留挂载草稿。内部导航改为 SPA 并等待保存。C 原数据实际复验及 auth/navigation PW 通过 |
| Q2 | P2 | 导入缺图文档被正确拒绝，但自动保存覆盖了拒绝提示 | 独立持久导入错误，直到下一次导入才清除；当前场景与原文件不替换。C 实际导入/后续导出 hash 和 PW 通过 |
| Q3 | P2 | assistant-ui 只显示通用失败，隐藏次数耗尽、资金 unknown 和新 ID 拒绝原因 | 只公开明确服务器消息，保留部分回复/已完成工具和原图；试用/402 引导原生 `/wallet`；历史恢复保留错误。D6 实际可读 unknown 与屏障、PW 通过，不改变费用或重试语义 |
| Q4 | P1 | 同浏览器 A 标签退出后登录 B，另一个旧 A 标签仍显示旧私有内容及可发送界面 | 成功退出仅广播静态失效信号，另一标签立即 gate，手动读取当前 Cookie；恢复新 owner 前取消并清除旧查询缓存。D 同路径实际复验和双标签 PW 通过。原生页面直接退出的同步仍待验 |
| Q5 | P2 | Loomic 官方画布菜单把 `/canvas-lab` 当作旧 `/canvas`，进入错误路径 | 只匹配完整旧路径边界；C 实际菜单与旧草稿副本复验，导航 PW 通过 |
| Q6 | P1 | 独立审查发现本地草稿 IndexedDB 拒写时，内部 Link 可先卸载编辑器、丢失未保存画面 | 先确认保存成功且 pending 清空再导航；失败留页、可导出，保留 beforeunload 提醒。拒写图像导出与停留 PW 通过；这是源码/故障测试证据，未冒称多人实际磁盘故障 |
| Q7 | P1 | 独立审查发现业务请求等待 refresh 时收到跨标签退出，仍可能发送尚未开始的旧身份写入 | 请求开始、刷新后和响应后检查身份 epoch；旧身份异步结果不能发布/清 gate。保持刷新中并广播的 ordinary/stream 两种请求测试确认业务发送 0 |
| Q8 | P2 | B 的 56 条实际列表中搜索 01 无结果，点击更多才出现；搜索只过滤已加载 50 条 | 本人范围的服务器标题搜索，100 字符限制、绑定 LIKE 且 `%/_/\\` 为字面、300ms debounce、AbortSignal、隔离搜索分页。8 项定向 API、新增 PW 及B原数据实际同路径复验通过 |

启用门槛 G1：Native 的 CT 按共享来源 IP 限流，多浏览器经 web 共用预算，Studio 各 owner 的 key 获取也共用另一来源预算，当前真实环境频繁触发 429。这是公开多用户架构与安全审查问题，不能用 fixture 成功或提高一个未经批准的阈值解决；当前值完全保留。候选方案、可信代理与回滚前置列在独立 gate 文档，尚未实施。

启用门槛 G2：B第三次上游丢响应后，消费日志和Native user.used_quota为36，订阅与token used为56，差额20保持不明。同故障key `ba82c603-f177-446f-9b5a-90382083b04e` 唯一映射NativeID `202610010953095354276208268d9d6fP8hDe5W`/HTTP500；只读核验找到本人sub5的唯一preconsume记录21、pre_consumed20、status=consumed、created_at=updated_at1790848389，说明本次读取时未标refunded。Studio历史failed/requests.completed是已存错误；trial.unknown是权益保留，不能把二者合称run unknown。Native脱敏tail2000中两条refund-error含SQLite lock，但没有requestID，无法严格关联至此请求；固定源码的异步退款和嵌套交易是调查线索，未证明此次根因。安全证据 `.local/t16-g2-evidence.json`；原Native不修改，held不释放、无退款或模型重发，不把20称真实采购/已结算。具体证据和后续私有核对门槛见 [BILLING-EVIDENCE.md](BILLING-EVIDENCE.md)。

## 已完成的自动验证

| 命令 | 实际结果 | 边界 |
| --- | --- | --- |
| `npm run check` | exit 0；51/51 领域、151/151 API、类型与 build（11.71 秒） | 新搜索和权限反例已包含；第三方 chunk 警告仍在，未新增依赖或改锁文件 |
| `npm run test:e2e -- --workers=1 --reporter=line` | 87/87，2.2 分钟，exit 0 | 独立默认 fixture 回归，涵盖新身份竞态/草稿失败/错误/搜索；不称真实供应商验收 |
| `npm run test:stack` | exit 0；真实固定 Native 未初始化边界、personal fixture 2/2、fresh user-token fixture 1/1 | `.local/t1-6-stack-final.log`；仅清理其自身随机项目。本轮 stack 在 Q8 搜索增量前运行，Q8 后由完整 API/PW/build 验证；未重复计为新版整栈 |
| 定向检查 | 17/17 auth、27/27 chat/navigation、8/8 history API、1/1 search PW；`node --check` 与 diff 检查通过 | 完整最终回归为主要基线，定向数字不与其相加 |

过程中的失败保留：本地 legacy 草稿下载 path 一次取消，单项原样复跑通过；全套一次访客刷新次数异常发现 knownAnonymous 缺口，修复后通过；另一次跨户模拟错误把合法新 owner SID 刷新当作旧 SID，修正 fixture 后定向及最终全套通过。没有删除测试、弱化业务权限、调整 Native 限流或重复未知生成请求。

日常 Native 的 ID `fcf367b723cac61cfa1a79546242c382ea3d50308faebe4278890871f0224806`、StartedAt `2026-10-01T04:26:19.489050028Z` 前后一致；只重构建 Studio/web，真实试用/生成/续用均关闭。验证结果保存 `.local/t1-6-preview-evidence.json`。没有 push、merge、production deploy、系统安装、安全参数修改或日常数据迁移。

## 可继续执行的隔离验收

从 `v2` 运行 `node tests/stack/user-acceptance-environment.mjs start` 会创建全新合成数据环境并打印专属 state 文件；需要既有已构建默认镜像。该入口只可用于明确本地 fixture 验收，不引用用户 `.env` 或真实供应商。

`status/evidence <state.json>` 是脱敏只读证据；`refresh-api/refresh-web <state.json>` 只重建该随机项目对应服务，不构建前端，必须先 `npm run build`；API refresh 前所有角色静默，避免 running 恢复成 unknown。`fault <state.json> funding|renewal <owner>` 只对该合成账号实际 Native 一次成功写丢失响应，不重发。`voucher` 是合成资金、需实际原生 UI 兑换。`seed-history` 必须所有角色静默，不能作为实际生成记录。

`stop <state.json>` 会删除该随机测试项目和专属卷，先保留所需导出和 evidence；不能将此命令用于日常项目。state 验证限制随机项目名、`.local`、compose/empty.env 路径、固定源码/hash和 loopback 非8080；仅管理该明确随机项目。当前验收环境保留以便自然限流恢复和后续复测。

下一具体任务 **T1.7 隔离剩余场景与启用门槛核验**：优先准备G2请求级原生预扣/退款的可复现调查与可审查修正方案，补未完成F/N UI子项；G1公开入口安全diff、真实计划金额/期限及供应商付费预算由用户决定后再独立验P与商户支付。不能通过手改Native钱、释放held、重发旧key或自动升级pin来绕过G2；未获批准时日常配置保持关闭。当前结果不代表成熟 SaaS 或可公开收费。
