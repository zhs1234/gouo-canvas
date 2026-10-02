# 模型选择、权限刷新与账号归属

2026-10-01 T1.10：New API 仍是账号、模型权限、网关和金额的唯一权威。本次修正客户端选择意图，不增加模型路由、账号、钱包或自动退款。

## 聊天页

`ChatLab` 初次读取可用目录时选一个聊天模型和一个图片模型，随后固定这两个 ID。本人可以明确更换；目录倒序、部分失权或缓存重新读取不能改成另一个模型。

- “刷新可用模型”只读当前账号目录。读取中、读取失败、生成关闭或已选模型不可用时禁止发送。
- 聊天 B 失权而 A 仍可用时，选择器显示待选择，说明不会自动切换；只有本人重新选择或原 B 恢复可用才继续。
- 先前已有图片选择失权时暂禁整次发送，避免省略该字段触发服务端默认图片模型。多个图片模型或旧图片选择失权时提供图片选择器。初次没有图片模型仍支持纯聊天。
- 失权清除本账号本次余额同意；模型恢复不会自动恢复同意或发送。
- 原地刷新不重挂 assistant-ui runtime，保留未发送输入、历史、原图和正在执行的原请求。页面导航依然遵循已有画布保存闸；未发送聊天输入没有新增跨路由持久化。

选择记录是本人 QueryClient 内存键 `['chat-lab-selection', owner]`，包括本人 ID；只对此键关闭五分钟自动回收，长时间去画布后仍保留选择。账号变更和成功退出沿用现有查询清理。完整 document reload 后重新建立初次默认；这不是跨浏览器偏好或服务端配置。

浏览器目录可能已过期。实际提交仍由 Studio fresh New API 权限读取校验；拒绝不自动改模型或重放。已在执行的请求不因下一次选择改变而换路由。

## 原 Loomic 工作台

Agent picker 不再因所选 ID 离开可用列表调用 `setModel(null)`。该操作以前把明确 B 变为 Auto，随后 transport 的默认选择会改用 A。现在保留原 ID，重新打开 picker 读取当前目录并显示不可用原因；transport 继续在 POST 前读取 fresh 目录，明确失权 ID 被拒绝。本人主动点击 Auto 仍是明确选择默认策略。

Agent 和图片偏好沿用既有 hook/localStorage，只保存非秘密模型 ID 与模式，按 `:local:<New API ID>` 或 `:local:guest` 分键。旧无 owner 的 `loomic:agent-model` / `loomic:image-model-preference` 保留原值，但不会被自动归入任何用户。没有读取或存储 JWT、refresh Cookie、供应商 key、security proof 或密码。

图片偏好 JSON 必须先成功解析，再一次更新 key/raw/对象缓存。损坏值返回固定默认对象，重复读取也不会返回上一账号的选择；原损坏值不被脚本清除。此缓存修正在独立代码复核中发现并在发布前补反例。跨标签页 preference 实时同步仍沿用原模块内 listener 的范围，没有新增 `storage` 事件合同。

图片候选不可用时禁止新选，标签显示“不可用”，不暗示未实现的 PRO 套餐。已有失权 manual 选择保持原意图，服务端拒绝；本人可明确切 Auto 或重新选择。独立图片生成面板原本保留非空模型并检查 accessible，本次未更换其参数或编辑器。

## 实际证据与范围

两套全新随机环境分别使用固定 Native `0aec08fee811ec6136828fda790551b49e410301`，二进制 SHA256 `a5fd598cc77e26ab2709305049fdd5fbbff722111be79f0ad89a493c3e094529`。模型供应商明确为本地验收替身，普通新用户未预领取试用，真实采购为 0；未对日常 8080、旧 QA 或真实资金配置操作。

`user-acceptance-environment.mjs start-selection` 只为独立验收创建 A/B 聊天和图片候选；`model-permission <state> fixture-chat-b|fixture-image-b enabled|blocked` 仅允许这个明确 fixture，拒绝普通环境、A 模型及未知状态。操作前检查无运行任务；仅改其合成 abilities 行，事务内核对 users/tokens/subscriptions/preconsume/logs 哈希不变。它不是生产权限或恢复工具。

独立实际浏览器先复现旧版选 B 后正常工作区往返 fresh 目录静默改 A；该基线路径同时卸载组件，不能单独证明仍挂载组件的刷新竞态。正式 bundle 的原地按钮刷新分别证明聊天/图片失权不换 A、保留输入、清同意和禁止发送；随后旧目录单次真实发送返回 403、不重放。本人重新选择后控件恢复；没有成功供应商请求。

根只读持久证据确认该环境供应商 chat/image 都为 0，Native 模型消费、token、subscription、Studio grant/reservation/submission/funding/renewal 都为 0；Studio 只有一个空 thread，run/request 都为 0。这证明本次已知权限拒绝在生成前完成，不能推广为所有未知请求的结算证明。

真实 Native UI 使用主选择修复的构建；其后的损坏偏好缓存和五分钟回收增量由最终 F 浏览器回归验证，没有再次登录 Native 重做已完成步骤。截图不能单独证明这些后续缓存边界。

报告 `.local/t110-selection-report.json`、`.local/t110-evidence-summary.json`，截图 `output/playwright/t110-selection-*`；权限事件链及原准备失败保留。浏览器自动反例另覆盖目录 pending、缓存往返、同 ID 恢复、倒序、390px、Loomic 显式失权、owner 切换、损坏偏好以及虚拟时钟跨五分钟缓存回收。虚拟时钟是 F 故障测试，不称实际等待五分钟。

最终命令及问题计数见 [STATUS.md](STATUS.md) 和 [QA_ACCEPTANCE_REPORT.md](QA_ACCEPTANCE_REPORT.md)。D5 的其它 token/订阅/资金子项、完整双用户地址矩阵、真实模型采购和真实支付仍未全部验收，不把本次限定子项算成整个成熟产品完成。
