# V2 整体系统打通计划

日期：2026-10-02。用户目标：先做全面计划，再逐步把已有前端、账号、网关和业务 API 打通为真正可运行、可恢复、可验证的系统。本文件是当前系统开发主线；旧 TASKS/STATUS 中的历史描述不能代替最新源码和阶段结果。

## 交付目标与边界

首个目标是可独立启动、普通账号隔离、创作与保存闭环、请求结果可恢复、故障不重复调用、原图不丢失的本地完整系统。公网收费准备另有明确的安全、资金、供应商和运营验收门；本地测试通过不等于这些门已通过。

继续采用 New API 唯一账号/模型网关/金额权威、`v2/apps/api` 业务适配、assistant-ui 默认聊天、Loomic/官方 Excalidraw 画布、TanStack Query 账号及服务器状态。保留原图、旧草稿、现有许可证和已认可布局。月度订阅、视频生成及视频剪裁不纳入当前实施主线；不因“整个系统”自行启用支付、真实试用、生产渠道或部署。

## 并行分工

UI chat 为“规划并逐页优化 ChatGPT UI”（`01a0f99c-2a6b-7f01-8fc3-38414a8d3477`）。其专属计划是 `docs/v2/UI-REDESIGN-PLAN.md`，负责公共布局、样式、展示组件、项目卡片、设置/画布呈现以及 ChatLab 首页输入交互。

系统工作采用独立 worktree `C:/Users/56161/.codex/worktrees/system-integration/gouo-canvas`，分支 `codex/system-integration`，基线 `6e8c4c8`。原工作区 `codex/registration-trial` 不切换。系统拥有 API、业务合同、原请求恢复、执行可靠性、运行维护和新增系统测试；不在 UI chat 正修改的 ChatLab/Account/CanvasLab/ServerCanvasEditor 中直接改布局或逻辑。交叉问题先协调文件归属；每次只提交本任务文件，不用 `git add .`。

UI 浏览器测试使用 5186。系统检查使用自己的端口或新随机 Compose 项目，不复用它的启动器、dist、测试数据库或截图目录。两边的 STATUS 增量在各自分支记录，整合时保留两者；不自动合并、推送 main 或更新日常服务。

## 规划时的已核验现状（历史基线）

三位独立子智能体只读核验实际实现；本次原基线 `npm run check` 已通过：51 领域、157 API、类型检查、build 13.74 秒。历史 T1.11 浏览器 146/146 和整栈通过是既有证据，本次未把它称为新复验。

| 能力 | 实际实现 | 尚缺什么 |
| --- | --- | --- |
| 账号与权限 | Native Cookie 恢复，access token 内存，逐请求 owner 校验；本人组模型/有限 token；共享账户与换户隔离 | 部分真实撤销变体、公网安全/限流容量 |
| 聊天 | 默认 assistant-ui、真实 SSE、按 owner 的 SQLite 历史/事件、服务端上下文、工具图片 | 实际浏览器离线验收；刷新失败保留当前内容；持久执行 |
| Loomic/独立生图 | 现有画布和本地草稿、服务端幂等请求和终态结果 | 无 threadId 请求没有统一 GET 结果恢复；本地占位不能说明后台结果 |
| 项目与原图 | 私有 BLOB/hash、幂等物化、项目 CAS/revision、冲突暂停与导出 | 输出自动保存、容量、保留/删除政策与恢复演练 |
| 试用与金额 | 4 次发送＋1 图、保守 held；Native 实际用量记录与实扣未确认表达 | Native 请求级结算证据和正式资金修正/启用门 |
| 运行 | 三服务同源 Compose、独立 Native/Studio 数据卷、回环入口、固定 upstream | Worker、备份恢复、任务/存储可观察性、公网部署验证 |

两项 B3 结构问题必须先解决：当前 Ledger 长期持有 API 单进程 EXCLUSIVE 锁，构造即将 running/reserved 转 unknown；不能简单让 worker 再打开同一 Ledger。user-token 执行又依赖本次账号 Bearer 读取本人模型/token/key/用量；不能把账号 Bearer/Cookie 保存到 job/outbox，或借管理员 token 在用户离线后执行。

独立授权设计审查后，将B3分为同进程持久图片任务B3-I、权威后台授权/资金约束B3-II、成熟队列与独立Worker B3-III。首阶段未提交任务重启后needs_authorization、已提交未知不重发；不持久Bearer，不把加密relay key冒称完整授权。细节见 [B3-JOBS.md](B3-JOBS.md)，完整B3验收条件仍保留。

## 原实施顺序与验收

每阶段先完成 coherent scope，再运行相关负授权/幂等/故障检查，写实际结果并单独提交。不能把接口骨架、字段、测试替身或计划标成完整功能。

| 顺序 / ID | 实施内容 | 完成条件 |
| --- | --- | --- |
| 1 / SYS-R1 | 统一 owner-scoped agent/image 原请求只读结果查询；复用已有 Ledger，不新增生成或重放 | running/unknown/completed 分明；无 threadId 的已完成原请求也能读；异户/匿名/非法 kind/key 拒绝；查询不写资金/权益/事件、不模型，重启仍可读终态 |
| 2 / T1.12 | 新随机 Native＋明确本地供应商，真实 browser offline/online；分客户端停止、后台完成、上游结果丢失 | 原 runId 恢复文本/工具/原 PNG；恢复只 GET，0 新模型 POST；unknown/held不释放、不退款；失败的读保留已有内容；原key与资金/续用全owner屏障分别验 |
| 3 / SYS-R2 | 前端三个入口接统一恢复合同；与 UI chat 交接，先默认聊天，再 Loomic/独立生图 | 请求ID在本人作用域保留；refresh/重连不新生成；部分工具结果可保存/下载；换户不见前户结果；不把Stop称取消供应商 |
| 4 / B3.1 | 持久任务授权/锁/数据方案，并实现真实可用的接受事务与独立读取边界 | 固定 model/capability/本人付款同意；job/reservation/outbox同事务；不持久账号Bearer；授权期限/撤销/重新核验明确；旧unknown/held不迁移 |
| 5 / B3.2 | 首先独立图片任务：202+jobId、成熟队列能力、单worker、lease/fencing和私有结果 | 关页后继续；新子进程重启只续未外发任务；外发结果未知进入unknown/reconciling；重复投递/重放不重复模型；queued取消不外发，提交后不假称退款 |
| 6 / B3.3 | 原图先验证/落盘后发布完成事件；聊天工具的部分成功；下载/持久化故障恢复 | 同原图hash/asset恢复；保存重试只保存不模型；资产、结果和项目归属一致；工具图成功、总结失败仍保图；受限大小和容量有明确错误 |
| 7 / OPS-1 | Native＋Studio一致备份/同实例恢复、健康与可观察性、容量/保留操作 | 隔离环境恢复账号归属、项目/revision、原图hash与unknown/held；备份不含日志明文密钥；只读诊断不暴露内容；操作手册从干净环境可执行 |
| 8 / B2/E1 | 精确模型协议/能力版本、电商尺寸/模板和代表商品质量回归 | 不静默丢参数/换模型；每渠道/版本单列合同与live证据；可编辑文案/价格层；正确尺寸导出，原主体/Logo保留质量人工核验 |
| 9 / G1/G2/P | 将已准备的安全、Native资金修正和真实供应商方案做成具体可审查门项 | 用户另行批准后才改正式pin、安全参数/真实资金配置或付费探测；实扣凭据不足仍unconfirmed；保持真实费用预算，未知不重发 |
| 10 / QA-FINAL | 与最终 UI 合并后，多角色独立浏览器完整验收与文档收口 | 原28场景逐项统计F/N/P，通过/partial/未验明确；同数据复验；新注册→发送→图→画布→保存重开→本人费用及故障闭环；reviewable commits |

## 恢复与费用合同

1. 客户端断网或 Stop 只表示接收终止。后台当前进程可能完成；GET 读取真实服务端状态，不把客户端断流强行写成后台 unknown。
2. 同 owner/kind/key 的未知生成请求不得再次 POST；成功终态可读取已有结果。查询、刷新、重新登录和项目物化均不是模型重试。
3. 模型结果 unknown 的试用 held 继续占用，不能退回次数。现合同允许其他剩余次数用于新会话中的明确新发送，不将所有模型 unknown 擅自升级成全 owner 禁发。
4. 资金偏好或 token 续用 pending/unknown 则保持本人全新ID/跨类别发送屏障；读取到相同 Native 配置不能自动解除。
5. Native消费日志是 recorded；没有请求级两步结算证明仍为实扣 unconfirmed。失败/取消/图片保存失败不等于退款，不自行修旧金额、token、subscription或held。
6. Worker仅对能够证明未外发的任务恢复执行；同步上游接收后丢响应没有安全自动重发路线。未来异步供应商已有taskId时只查询同任务。

## 验证分层

- 领域/API：真实临时 SQLite、真实 HTTP SSE、负授权、同键参数漂移、重启、并发、事务回滚、私有输出。
- 浏览器：本地明确替身测试只称 F；真实 browser `setOffline`、独立登录/换户与真实HTTP，不只用 route.abort 代替断网。
- Native：固定source及binary checksum、新随机项目、新合成账号/资金/本地供应商；分别保存准备→提交→恢复三个只读快照，合法发送变化不混入“恢复期间不变”。
- P：真实供应商、商户支付和正式生产安全另门；历史付款测试授权不自动延伸到本轮。

原28场景18通过/10partial，N15通过/10partial，P13未验是T1.11历史快照；分层重叠不可相加。新T1.12/B3/E1/OPS证据按子项补在QA报告顶部，不把新自动测试数量加到28场景。剩余B7、资金生命周期和供应商P的未验变体继续明确。报告保存原失败和测试限制，不删除失败断言换取通过。

## 当前进度与首交付截止线（2026-10-02）

| ID | 当前结果 | 验证及边界 |
| --- | --- | --- |
| SYS-R1 | 已实现 | 统一本人agent/image原请求GET结果，坏数据/匿名/异户拒绝，查询零生成 |
| T1.12 | 核心离线恢复通过 | 真实Native文本/图片offline、失败GET和丢总结响应；原PNG/partial/held保留；P未执行 |
| SYS-R2a/b | 已接入 | Loomic原消息UUID先IDB，默认聊天已有持久thread，重连只GET；换户/删除/迟到guard |
| UI-I1 | 已整合 | UI计划和799ad3b已进入系统分支；原工作区仍独立，日常服务未替换 |
| B3-I/B3.3 | 已实现并有连续N | 接受事务、唯一提交屏障、解码前raw暂存/仅本地恢复；Loomic直接图片UI202关页→同API完成→新tab原GET恢复passed |
| OPS-1/OPS-N1 | 合成私有冷恢复通过 | 固定同实例/配置/源码、双库WAL/原图/revision2/unknownheld恢复；目标启动只读本人/异户/匿名验证；生产方案另门 |
| E1本地增量 | 已实现 | 三画布可编辑版式/指定像素PNG/原商品bytes保留；10F；自动长文案排版、Logo素材库/批量后续 |
| B2/G1/G2/P | 合同与方案保留 | 当前渠道能力需批准，公开安全/真实实扣/付费质量未由本地替身验收 |
| QA-FINAL | 本地首交付完成 | 最终源码3c69835：check110领域/205API/type/build12.42；ad3f844隔离浏览器206/206、5.3分钟，三阶段stack exit0；fresh Native首页首次发送及真实dist本地E1复验通过。首次meta/detail错误已修复，原失败与一次未复现分页失败保留，见STATUS顶部 |

本地首交付以注册/认证、默认聊天、创作、本人画布保存重开、原结果恢复、关页图片任务、故障保图/held、隔离与合成冷恢复为截止线。B3-II权威后台授权、B3-III独立Worker、月度订阅、公开支付、全部供应商质量和生产运维不因为这一阶段通过就标完成；后续任务保持原明确门项。

## 整合与下一动作

系统专属实际进度记录在 `SYSTEM-INTEGRATION-STATUS.md`，同时按仓库契约更新本分支 `STATUS.md`。UI布局方案以UI chat为准；恢复/后台合同以本文件及实际接口为准。独立分支的代码可审查，但尚未整合到用户日常入口时必须明确说明。

QA-FINAL已完成上述本地首交付。完整启动、验证、证据及限制见 [LOCAL-SYSTEM-HANDOFF.md](LOCAL-SYSTEM-HANDOFF.md) 和 [QA_ACCEPTANCE_REPORT.md](QA_ACCEPTANCE_REPORT.md)。原28扩展场景只把B5核心补齐，当前19通过/9partial，P13未验；不是最终版本再操作全部28项。已完成阶段不重复列为下一实现项。下一公开启用ID为 **G1→G2→P**，后台持续授权为 **B3-II**，之后才能做独立Worker；本轮不自行部署或付费。
