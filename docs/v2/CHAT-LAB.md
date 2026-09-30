# 聊天页面与服务端会话

入口 `/studio/chat`，复用 New API 原账号组件登录、退出及费用面板。旧 `/chat-lab` 为兼容跳转。原画布与 IndexedDB 草稿保留，聊天历史单独由 Studio SQLite 按 New API owner 保存。

## 实现及边界

assistant-ui `0.15.22` 官方 local runtime 和 message/composer primitives 对接自定义 Studio `/api/studio/runs/stream` SSE，而不是原始 OpenAI SSE。浏览器仅使用已有内存账号 Bearer，不接触上游密钥。SQLite 服务端会话列表、详情、任务事件可在刷新、退出后重新登录恢复；这不是持久 Worker 或自动续流。

- GET/POST `/api/studio/threads` 管理当前账号会话；GET `/threads/:id` 返回任务和事件。
- 每次 POST stream 提交 `threadId` 与唯一 `runId`；上下文在后端按 owner 读取，客户端不提交拼接历史。
- 文本增量、结构化图片工具及图片结果渲染。正常完成自动只读刷新，下一条消息可继续发送。
- Stop 为“停止接收”，保留已接收部分；后端可能继续生成及计费。断开/切换不会自动重发生成请求。回到会话可读取服务端保存的部分或完整结果。
- running/unknown 显示待确认并禁发，提供仅 GET 刷新；进程重启的 unknown 不能冒充已取消、失败未扣费或可安全重试；界面明确告知无法自动恢复，需另开会话继续，原任务费用仍需核对。
- owner 或 thread 切换卸载旧 runtime 并中止其接收；迟到事件不会写入新会话。账号目录 query 按 owner 隔离，服务端才是访问控制权威。
- 列表“更多会话”、详情“查看更早记录/返回最新记录”分页；较早页只读。模型上下文仅最近 6 次成功任务，页面明确提示，不声称完整无限上下文。
- 费用通过原 New API 费用面板读取，不把客户端事件或本地任务表当作最终账本。

缺失的产品能力包括附件交互、会话重命名/删除、主动服务端取消、持久队列与自动恢复订阅。默认画布保留，未迁移原草稿或引入新账号服务。

## 依赖及归属

npm `@assistant-ui/react` **0.15.22** (MIT)，peer React `^18 || ^19`，与 React 19.3 兼容。package-lock integrity 固定包，未复制上游实现源码。许可证全文 `licenses/assistant-ui-MIT.txt`。接口参考同版本 core `runtime/utils/chat-model-adapter.d.ts`。

来源：https://github.com/assistant-ui/assistant-ui 、https://www.npmjs.com/package/@assistant-ui/react/v/0.15.22 。新增 326 个 lockfile package 路径（含嵌套依赖），没有升级原依赖版本，新增包 lockfile license 全为 MIT。主要子依赖 core 0.3.21、store 0.3.15、tap 0.9.19、assistant-stream 0.3.45、assistant-cloud 0.2.3、radix-ui 1.6.7、safe-content-frame 0.0.31。未配置或使用 assistant-cloud 服务、账号或外部费用。聊天路由 lazy load；第一阶段构建独立 chunk gzip 122.53 kB，后续大小以构建输出为准。

## 验证

第二阶段类型检查通过；浏览器 fixture 验证工具/图片、错误不重试、Stop费用提示、刷新恢复pending、切线程旧流隔离、退出重登恢复、分页。测试使用明确替身，不等于真实供应商联调或生产安全认证。无真实模型调用。
