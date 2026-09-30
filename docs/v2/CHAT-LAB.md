# assistant-ui 独立聊天实验

入口 `/studio/chat-lab`，通过现有画布账号窗口登录后打开。原画布与 IndexedDB 草稿完全保留。

本实验使用 npm `@assistant-ui/react` **0.15.22** (MIT)，peer React `^18 || ^19`，与当前 React 19.3 兼容。依赖由 package-lock integrity 固定，未复制上游实现源码。许可证全文见 `licenses/assistant-ui-MIT.txt`。API 参考来自已安装同版本的 core `runtime/utils/chat-model-adapter.d.ts`，thread-history 接口暂未接入。

来源：https://github.com/assistant-ui/assistant-ui ，React package https://www.npmjs.com/package/@assistant-ui/react/v/0.15.22 。新增 326 个 lockfile package 路径（含嵌套依赖），没有更新既有 package 版本，新增包的 lockfile license 全为 MIT。主要直接子依赖 core 0.3.21、store 0.3.15、tap 0.9.19、assistant-stream 0.3.45、assistant-cloud 0.2.3、radix-ui 1.6.7、safe-content-frame 0.0.31。虽然上游打包依赖 assistant-cloud，本实现没有云配置、账号、网络服务或新账单依赖。独立路由 lazy load，避免把实验 UI 放入主入口同步加载。

## 已接入

- 官方 local runtime、线程列表、新会话、消息/输入/停止 primitives。
- 自定义适配 Studio `/api/studio/runs/stream` SSE DTO，不使用原始 OpenAI SSE 或 AI SDK UIMessage SSE。
- New API 同源身份由原 api.ts requestStream 复用；浏览器不持有上游 key。
- 文本增量、图片工具状态与内嵌 PNG/JPEG/WebP 结果；每个 run 唯一幂等 ID，仅发送一次，终态缺失报告未知。
- Stop 为“停止接收”，保留本页已接收部分，不代表后端取消或取消计费；错误不自动重试。

## 明确边界

会话仅内存，刷新或离开实验页面即清空，不冒充云历史或可恢复任务。工具消息不是后端工具定义，不能触发客户端执行。未接附件、编辑重试、持久会话、主动后端取消、用量明细展示；终态 usage 只保留在消息 metadata。后端、新API、账单仍是原产品，实验不是新auth/Mongo/服务栈。

本分支依赖主集成分支提供的 `requestStream` 和 `readEventStream`，这两个文件由原流式任务所有者负责，不能用本实验覆盖。

## 验证

- `npm run typecheck`、`npm run build` 通过；独立 ChatLab chunk 410.96 kB，gzip 122.53 kB（另有共享依赖）。
- `npx playwright test tests/chat-lab.pw.mjs --workers=1`：3项通过，全部显式协议 fixture，覆盖工具图片/线程隔离、错误不重试、Stop费用提示。
- `npm audit --json`：0告警。无真实模型或费用验证。

这是用于产品选择的可运行 spike；326 个新增路径的成本较大，是否推广到正式工作区应在画布与聊天布局对比后决定，不能因库成熟就替换现有业务。
