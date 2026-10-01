# UI 改版逐页进度

计划见 [UI-REDESIGN-PLAN.md](UI-REDESIGN-PLAN.md)。日期 2026-10-02，起点 `6e8c4c8`。本文件属于 UI 任务；系统功能和真实收费验收继续以其专属记录为准。

| 任务 | 当前状态 | 当前证据/剩余工作 |
| --- | --- | --- |
| U0 公共壳与规范 | 已完成 | 中性色、36px导航、低噪音页头、焦点/跳过导航、统一 next-themes；跳过导航不改 query/hash/history |
| U1 聊天首页 | 已完成 | 原 Thread/runtime 的居中输入；首次明确发送才创建一次会话；访客登录保输入、创建未确认禁重复、聊天/图片所选模型重新核权 |
| U2 会话界面 | 已完成 | 输入圆角/消息宽度与中文动作；余额同意默认未勾，完整规则可展开；同线程刷新失败保文本/原图/草稿与运行屏障 |
| U3 账号设置 | 已完成 | 五分类图标双栏、简短描述、辅助外链；手机版分类横向滚动、正文独立滚动；常驻 Dialog/资金屏障未替换 |
| U4 项目库 | 已完成 | 统一列表，两种存储范围明确；读取中/失败/空态区分；Base UI重命名弹窗保真实revision和失败，取消/同名零PATCH |
| U5 官方画布 | 已完成 | 中性工具条、中文项目范围/本机保存、可滚动手机更多菜单；SDK主题统一、暗色失败文字；原始文档与保存逻辑保留 |
| U6 Loomic 工作台 | 已完成 | 创作助手/模型提示中文化、输入区统一；标题随画布容器约束，重复账号入口按空间隐藏；助手宽度保至少320px画布 |
| U7 最终验收 | 已完成 | 最新完整173/173、check51领域/157API exit0；当前截图及改前对照已查看，结果见下表 |

本轮参考边界：已实际读取 ChatGPT 公共页面；内置浏览器模块不可用，Windows 浏览器工具因不能可靠确认网址停止。没有本轮新 ChatGPT 登录态截图，不继续操作被停止的工具。Gouo 的当前截图将由已有授权的本地自动浏览器测试捕获。

并行边界：用户批准一次直接分工消息，已协调。系统任务使用独立工作树 `C:/Users/56161/.codex/worktrees/system-integration/gouo-canvas` / `codex/system-integration`，UI 保留当前 `codex/registration-trial`。UI 拥有本轮 `ChatLab.tsx` 和页面呈现；系统任务拥有 API/adapter/认证/试用/导航守卫及其专属系统计划。不自动整合分支，不运行日常容器或更改 Native 配置。

## 当前命令与过程证据

- 改前视觉基线：专属 `playwright.ui.config.ts` 的 `ui-starter-visual.pw.mjs` **1/1**。Gouo当前页面真实渲染，输入/素材来自明确UI fixture；原图和模型标识不代表真实供应商。保留在 `v2/output/ui-redesign/baseline/`。
- 改前全页基线：桌面全页和手机五页面已保存到 `baseline-pages/`；手机设置初始定位未打开抽屉导致失败，不能称该改前设置已捕获。之后修正测试手势。
- 第一次混合源代码回归 **25通过/10失败**：运行期间子任务正在新增项目库CSS，Vite短暂不能解析该文件造成9个后续overlay失败；不作为最终证据。日志 `v2/output/ui-redesign-first-pass.log`。
- U1首次验证 **32通过/7失败**：首次创建到新URL之间曾卸载runtime，导致首次请求/草稿丢失；已加入限定创建交接和in-flight保护。两个失败为多个合法alert的定位，另一个是已更新的访客提示定位。日志 `ui-home-validation.log`。
- 第二次定向 **20通过/4失败**：首次发送、失权、partial/unknown/换户关键路径已通过；剩余为目的页alert过渡定位、modal遮蔽下旧标题定位、手机收起助手后标题/保存重叠、SDK radio图标挡住input的测试手势。分别修正具体问题/定位，保留原断言目的。日志 `ui-targeted-validation.log`。
- 首次 `npm run check` **exit0，51领域/157API、类型与build通过**。源码收尾后另跑完整check，最终以 `ui-check-final.log` 为准。
- 首次完整浏览器 **170通过/1失败**：深色保存失败用例的绘图坐标落入SDK原生左侧样式面板，没有生成元素；移动到既有绘图回归使用的位置后，UI专属 **11/11** 通过，实际出现一次503、自动保存暂停和导出备份可用。日志 `ui-e2e-final.log` / `ui-visual-final.log`；原完整运行证据保留于 `full-run-171/`。
- 独立复核补两个负例：首次create响应暂停后进入另一thread、首次fresh catalog响应暂停后退出A并登录B。定向 **2/2**，未产生旧账号stream或第二次创建。完整回归另发现目标URL提交早于React目标composer挂载的测试等待竞态，已先等目标sidebar的aria-current，再等新composer并标记DOM，释放前后验证新草稿与同一runtime；未削减隔离/次数断言。
- 一次173项完整运行 **102通过/71失败**：第25项为上述等待竞态；第104起专属5186前端进程已不在监听，其余70项ERR_CONNECTION_REFUSED，不能算页面行为失败或绿灯。未观察到足以确定退出原因的日志；不归因于另一任务。证据 `ui-e2e-interrupted-173.log` / `interrupted-173/`。新完整复验开启Playwright原生 `pw:webserver` 诊断，仍只管理自有端口。
- 新增两份浏览器文件及 `tests/stack/fresh-user.pw.mjs` 的 `node --check`、`git diff --check` **exit0**。stack文件仅同步首页首次发送时才有thread的定位/时序，本轮未启动Docker重复整栈验收。

运行边界：专属前端端口5186，不启动/重启API或Native；原日常8080健康读取未连通，页面验证使用明确本地fixture。没有付费模型调用。现有测试部分未拦截只读 trial/access 查询，因此隔离Vite日志会有3001未连接提示；不代表真实服务或真实账号验收。

## 最终结果（当前源码冻结后）

| 实际命令 | 结果 | 证据 |
| --- | --- | --- |
| `npm run check` | **exit0；51/51领域、157/157API、TypeScript、build 12.17秒** | `v2/output/ui-check-final.log`；保留已有第三方大chunk提示 |
| `npx playwright test --config playwright.ui.config.ts --workers=1 --reporter=line` | **173/173，4.7分钟，exit0** | `v2/output/ui-e2e-complete.log`；包含原146与新增16首页/刷新/owner、11UI场景 |
| `node --check` 三个新增/定位同步测试；`git diff --check` | **exit0** | 无新增依赖；stack仅语法/时序同步，未称完整整栈已执行 |

当前截图固定保留在 `v2/output/ui-redesign/final/`，不会被下一次专属测试清理 `current/` 覆盖。`baseline/` / `baseline-pages/` 保留已实际捕获的改前证据。完整173复验期间5186监听保持；结束日志确认测试工具正常终止自有前端。

完成范围：本轮U0–U7 UI目标与其当前源码回归。下一任务 **UI-I1**：系统任务在独立分支接入UI提交后复核新的原ID结果读取/离线合同与stack路径；不把当前UI绿灯替代那一分支的系统验收、真实供应商或商业验收。

## 已查看的视觉对照

相同1440×1000视口查看了首页、项目库、设置的改前/改后；390×844工作台也并排检查了标题/保存重叠。首页从标题+新建按钮变为实际居中输入区；项目库从混合品牌/卡片变为统一列表和明确范围；设置分类及正文层级更清晰。另实际查看手机版首页、项目库、设置、带图会话/官方画布以及深色设置、画布与保存失败。图片是当前应用真实渲染及明确界面fixture，未把本轮ChatGPT公共页面读取描述成登录态截图。

浏览器断言还覆盖320×568和1024×768：短屏五分类可达、canvas更多菜单在视口内；1024宽助手最大化后画布≥320px，标题/保存不重叠，重复账号入口隐藏。主题到私有画布等待800ms仍0PATCH；真实fixture编辑才发一次失败PATCH。没有修改文档背景、原始文件或CAS保存机制。
