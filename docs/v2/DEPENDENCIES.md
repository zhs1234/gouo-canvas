# 依赖与上游资料

## 当前实际导入的包

| 项目 | 用途 | 接入位置 |
| --- | --- | --- |
| React / React DOM | 应用渲染 | v2/apps/studio |
| React Router | 页面路由 | main.tsx/App.tsx |
| TanStack Query | 账号及后续服务端状态 | main.tsx/Account.tsx |
| Fabric.js | 本地设计画布引擎 | Editor.tsx |
| TypeScript / Vite / React plugin | 类型与构建 | v2 workspace |
| Playwright | 浏览器回归 | v2/tests/studio.pw.mjs |
| node:test | 无框架依赖的领域/探测测试 | v2/tests/*-cases.mjs |

`@gouo/ui` 和 `@gouo/contracts` 是本仓库内部包，不是声称成熟外部产品的自研替代品；前者只含少量展示组件，后者定义业务契约。不要手写 Canvas 引擎、复杂上传调度或分布式队列。

## 按任务引入，不提前堆依赖

Asynq：B3 使用 Go/Redis 队列时引入 `hibiken/asynq`，并检查匹配 Redis 版本和部署拓扑。Uppy：W1 确实需要批量/恢复上传时引入。rembg：需要服务端抠图时作为隔离 worker，并分别核查 Python 包和权重许可证。ComfyUI：后期复杂图像流程可评估，不是首发必需。

现有微信/支付宝/Stripe SDK、GORM、Redis、OSS/S3 驱动优先复用，但要验证业务安全，不再重复引入 GoPay 或第二套认证平台。Fabric 与 Filerobot/tldraw/Konva 不同时引入；更换编辑器需要新 ADR 和真实收益证据。

## 许可证与供应链

查看所锁版本的 LICENSE/NOTICE、传递依赖、模型权重、字体和模板的独立条款。保留原著作权与要求的声明。MIT/Apache 等标签不是对全部部署素材的统一商用授权。AGPL/GPL/商业 SDK 在集成/修改/分发方式明确前不作为闭源核心默认依赖；独立服务不是自动免责。

本交付不复制 node_modules，不携带字体文件。已提交来自成功 GitHub Actions 的真实 package-lock.json，使用 npm ci。版本变更与 npm audit 告警由 P0 记录，不用 `--force` 无差别升级。

## 原始参考（2026-09-18 查阅；实现前复核变更）

- Fabric 仓库：https://github.com/fabricjs/fabric.js；安装：https://www.fabricjs.com/docs/getting-started/installing/
- React：https://github.com/facebook/react
- Router：https://github.com/remix-run/react-router
- Query：https://github.com/TanStack/query
- Vite：https://github.com/vitejs/vite
- Playwright：https://github.com/microsoft/playwright
- Asynq：https://github.com/hibiken/asynq
- Uppy：https://github.com/transloadit/uppy
- rembg：https://github.com/danielgatis/rembg
- One Hub：https://github.com/MartialBE/one-hub
- Codex AGENTS：https://developers.openai.com/codex/guides/agents-md/
- Codex 环境：https://developers.openai.com/codex/cloud/environments/

Codex 云环境可将 `node v2/scripts/setup.mjs` 用作初始化命令；这不是已经替用户设置了云环境。依赖下载需要相应网络访问。脚本不会下载模型权重、初始化生产库或发起付费生成。
