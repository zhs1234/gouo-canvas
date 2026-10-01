# 默认聊天与共享工作区导航

2026-10-01，用户要求默认进入聊天，主要入口固定侧栏，并实际参考 ChatGPT 的未登录、登录及账号管理界面。这项优先于历史“默认画布”描述。完整 assistant-ui 和 Excalidraw/Loomic 继续复用，没有更换编辑器、账号系统或费用权威。

## 实际参考与布局

主任务在内置浏览器实际打开 `https://chatgpt.com/`，取得未登录首页截图；在用户指定的 Edge 已登录标签查看首页、展开侧栏、个人资料菜单及设置常规页。没有把 CLI 独立 profile 的403挑战页称为实际界面，也没有登录另一账号、提交消息或更改账号设置。设置页看完返回原首页。

未登录参考为固定左侧主要入口与底部登录区，右侧聊天标题和输入区居中。当前 Edge 登录界面为左侧图标导航，可展开项目/最近聊天区域；右侧默认聊天，个人资料菜单通往设置，设置页有分区导航及右侧内容区。本项目采用已经认可的 assistant-ui 左侧栏、线程、账号底栏与居中聊天区，所有工作区共用同一入口位置；画布内部工具继续由原编辑器负责。

本机参考和实际结果在被忽略的 `v2/output/playwright/t18-navigation/`：

- `chatgpt-reference.jpg`：内置浏览器真实未登录首页。
- `chatgpt-edge-logged-in.jpg`、`chatgpt-edge-sidebar.jpg`：Edge 登录首页及展开侧栏。
- `chatgpt-edge-account-menu.jpg`、`chatgpt-edge-settings.jpg`：真实账号菜单和设置页，未执行设置写入。
- `gouo-default-chat.jpg`、`gouo-canvas-sidebar.jpg`、`gouo-projects-sidebar.jpg`、`gouo-original-workspace-sidebar.jpg`：更新后日常8080真实页面。

这些截图是本机证据，未上传登录后的私人内容。具体命令、最终回归数量和剩余问题以 [STATUS.md](STATUS.md) 与 [QA_ACCEPTANCE_REPORT.md](QA_ACCEPTANCE_REPORT.md) 的最新章节为准。

## 入口与旧地址

| 地址 | 行为 |
| --- | --- |
| `/studio/` | 默认打开完整assistant-ui聊天。带旧`id`或`session`时兼容转入原工作台。 |
| `/studio/chat?thread=<id>` | 本人会话；侧栏继续提供聊天、画布、项目库与原工作台。 |
| `/studio/canvas-lab?project=<id>&asset=<id>` | 官方Excalidraw私有项目；没有项目参数时为独立本机副本。 |
| `/studio/canvas?id=<id>&session=<id>` | 原Loomic工作台和原本机草稿，保留已认可的画布与Agent能力。 |
| `/studio/projects` | 本人Studio项目和当前浏览器的本地项目入口。 |
| 旧root、`/editor`、`/board` | 转到`/canvas`并保留全部query/hash；不覆盖旧草稿。 |

Loomic实际选择/新建会话时，从当前URL克隆参数，仅设置`id/session`并删除既有`prompt`，保留未知参数和hash。`prompt`删除用于保留原来的防刷新重复发送行为；导航测试不会调用模型。旧本地ID校验仍严格，不为URL编码测试放松本人/草稿标识。

## 离开、失败与恢复

使用已安装React Router的DataRouter和单个`useBlocker`，编辑器通过`useWorkspaceLeaveGuard`注册真实保存检查。侧栏、品牌、菜单、query/hash变化及浏览器POP走同一检查，不手工改写history。检查完成后还核对guard版本、owner和身份epoch，旧异步结果不能放行新账号。移动抽屉仅在地址真正改变后关闭，保存拒绝时入口仍留着。

- 原Loomic取消debounce并等待已有写入，最多追加一轮最新场景保存；只有真实IndexedDB成功且没有更新的pending内容才离开。失败留页、提示、重试和导出可用。
- 本机官方画布等待最新场景写入；失败留页，可导出原图与完整files。
- 私有官方项目正常保存后离开；409或响应丢失后暂停自动保存，不因再次导航重发PATCH。暂停后须明确确认并成功写入本人本机恢复副本才能离开；备份失败或期间又有修改仍留页。
- 明确删除只有IndexedDB删除成功后才向精确owner/id通知编辑器，清除pending并允许离开；删除失败不放行，成功删除不会被旧保存复活。
- 账号强制换代前捕获已序列化的最新场景，按原owner/id保留副本并尝试一次本机排队写入；不读取SDK卸载时的空场景，不延迟旧私有界面清屏。新账号不读取旧副本。同账号回访仅合并`canvas.content`，名称、sessions、messages、未知字段保留。

IndexedDB拒写时，账号换代的副本只在当前页面进程内存中。界面明确提示尚未保存，可显式重试或导出；关闭或刷新浏览器后不保证恢复。若IndexedDB读取本身失败，仍明确拒绝，不能声称所有存储故障均可持久恢复。beforeunload保持未保存提醒；站内守卫不替代跨域离开/关闭页的浏览器限制。

New API继续唯一管理账号、模型网关和金额；这次导航没有改日常原生数据库、余额、试用、安全参数或上游pin。真实生成/试用/有限续用仍遵从暂不启用决定。账号管理的全局一致入口和设置分区作为下一连贯增量，复用已有资料、试用、权限与账单组件，原生安全/充值功能保持原生服务负责。
