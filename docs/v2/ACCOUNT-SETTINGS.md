# T1.9 共享账号菜单与设置

2026-10-01，基于导航提交 `e0b205d`。所有 Studio 工作页使用同一底部身份菜单和设置面板，参考实际内置浏览器未登录 ChatGPT、Edge 已登录的底部账户菜单与设置分类截图。图片位于被忽略的 `v2/output/playwright/t18-navigation/`；本轮实际新版界面证据另列 STATUS/QA报告。完整 assistant-ui 和两种既有 Excalidraw 编辑器继续保留。

## 实际入口与内容

- 底部“New API 账号”打开菜单；已登录提供账号与设置、余额与用量、安全与会话，访客提供登录账号与安全入口。
- 设置在当前工作页打开，地址、项目、会话和未保存画面不变。Loomic顶部原账号按钮也直接调用同一面板，原本地保存按钮仍保留。
- 分栏为账号资料、余额与用量、新用户试用、生成权限、安全与会话。复用已有 Account/TrialPanel/GenerationAccessPanel/BillingPanel 和按 owner 的 TanStack Query；没有第二套身份或财务模型。
- 密码、MFA、通行密钥、会话、充值及原生用量功能仍由 New API 提供；固定同源链接用新标签页和 noopener/noreferrer 保留当前画布。未实现的订阅升级/支付/个性化项目不作为菜单展示。
- 移动账号菜单先关闭导航抽屉，再打开设置；关闭后焦点回到可见的侧栏按钮。桌面返回身份按钮。使用已安装 BaseUI Menu/Dialog 的菜单、焦点限制、Escape与语义。

设置 Provider 常驻 Routes 外，只有账号内容按 owner 换代。同 owner 的面板关闭、分类和页面切换不卸载资料/权限组件，保留未知写入阻断；旧账号变化关闭旧面板和内容，新账号不展示旧费用、意图或结果。登录成功后资料面板保留并显示本人。

## 显示名是严格业务适配

客户端改用 `PUT /api/studio/profile`，精确请求 `{display_name}`。服务器 trim后校验1–20Unicode字符、本人fresh身份、共享owner busy，再复用已有原生profile桥做唯一固定 `/api/user/self` PUT和本人/名称只读确认。只返 `{id,display_name,confirmed:true}`；禁止owner/id/setting/role/quota/group/password/计费偏好等字段。写后网络、非JSON、cache错误或确认不匹配统一待确认，不自动重放或暴露原始错误。

当前prepared edge原本就将精确 Native `PUT /api/user/self` 转给Studio现有资料/密码proof白名单，并非直接Native全量更新；本轮不改此规则。新业务路由让默认edge也经严格Studio通路。固定Native UpdateSelf构造cleanUser，Updates(struct)不更新省略字段，不发送整setting快照，避免覆盖计费偏好。实际固定Native隔离验证和字段范围见 STATUS。

请求前先写入并读回当前标签页sessionStorage的严格三字段保护记录：owner、预期显示名称、pending/unknown；不含JWT、密码、cookie或token。写入保护失败或记录损坏则0 PUT并保守阻断。未知后同标签关闭面板、切页或reload不解锁；只有显式读取确认同owner、同预期名称才能清记录，没有自动写重试。只读不匹配继续保持unknown。

这是当前origin与owner的**标签页保护**，不跨独立标签页/浏览器或新安装形成全局profile事务；关闭整个标签页后sessionStorage生命周期结束。显示名写不是充值/扣费或令牌创建，原金融unknown持久闸仍由服务端负责，不能用此保护声称所有商业操作可安全再提交。界面状态与异步结果另核对mounted/owner/身份epoch；旧身份晚到响应不能发布。

## 退出先保存

账户退出先调用共享imperative leave check，复用 Router 的真实本地/私有保存guard及owner、epoch、generation、生命周期核验；同时到来的检查保守拒绝。失败时0logout POST，留页且可导出；成功再调用已有原生logout和AuthProvider.signOut，不reload整页、不过早清整个QueryClient。Native cookie_cleared:false、网络或失败不冒称退出成功。

原生退出响应返回前及登录响应返回前检查启动epoch，退出取消查询后再次核对完成epoch。广播失效或另一登录发生期间，晚到旧响应不能清除或发布新身份。跨标签只发送已有静态失效信号，token只在内存；身份恢复不重放业务。

日常真实generation/trial/tokenRenewal仍关闭，Native未初始化，不自动造用户/资金/模型。真实账号安全设置、商业计划、公开入口G1/G2和付费供应商门项继续保留。实际命令、故障日志、截图和问题统计以 STATUS.md / QA_ACCEPTANCE_REPORT.md 为准。
