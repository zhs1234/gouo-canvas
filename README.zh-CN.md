# 光构 · Gouo Canvas

**简体中文** · [English](./README.md) · [文档中心](./docs/README.md)

AI 创作工作台，包含生成图片、无限画布和 Agent 三个工作区。基于 One Hub 的 Go 后端管理账号、积分（1 元 = 100 积分）和云端作品库。平台 API Key 保存在服务端，管理后台仅限管理员。

- **生成图片**：文生图、参考图编辑、局部遮罩编辑和作品管理。
- **画布**：复用 Infinite Canvas 的界面与交互，组织图片、文字和连线，支持多个项目。
- **Agent**：会话开始前使用居中输入框，开始后切换为消息流和底部输入框；通过平台 API 聊天、提交图片任务和操作关联画布，用户无需安装本机 Codex 或 Claude。

<img src="./public/gouo-logo-512.png" alt="光构 Logo" width="192" />

[在线演示](https://canvas.wcnmb.top/) · 需要账号登录，图片生成按积分结算。

## 预览

截图来自 2026 年 10 月的本地演示环境，账号和数据均为演示数据；作品图片是为文档绘制的示意图，不是模型输出。更多截图见[用户指南](./docs/zh-CN/user-guide.md)和[后端说明](./docs/zh-CN/backend.md#3-管理后台)。

| 创作 | 我的作品 |
| --- | --- |
| ![创作页](./docs/images/screenshots/client-create.webp) | ![我的作品](./docs/images/screenshots/client-works.webp) |
| **画布** | **Agent** |
| ![画布](./docs/images/screenshots/client-canvas.webp) | ![Agent](./docs/images/screenshots/client-agent.webp) |
| **用户中心** | **后台：光构模型** |
| ![用户中心](./docs/images/screenshots/client-user-center.webp) | ![光构模型](./docs/images/screenshots/panel-gouo-models.webp) |

## 开始使用

需要 Node.js 22、npm、Git 和 Go 1.25。本地启动、部署和检查见下面的指南。

- [开发指南](./docs/zh-CN/development.md)：本地启动和前端变量
- [部署总览](./docs/zh-CN/deployment/index.md)：[Docker Compose](./docs/zh-CN/deployment/docker.md)、[Linux 手动部署](./docs/zh-CN/deployment/manual.md)、[上线检查清单](./docs/zh-CN/deployment/checklist.md)
- [用户指南](./docs/zh-CN/user-guide.md) · [后端说明](./docs/zh-CN/backend.md) · [测试与模拟 API](./docs/zh-CN/testing.md) · [变更记录](./CHANGELOG.md)
- 环境示例：[`.env.example`](./.env.example) · [`deploy/.env.example`](./deploy/.env.example)

`server/docs/` 是上游 One Hub 文档。本项目请用上面的光构指南。

## 许可与来源

前端基于 [GPT Image Playground](https://github.com/CookSleep/gpt_image_playground)（MIT）。后端基于 [One Hub](https://github.com/MartialBE/one-hub)（Apache-2.0），原始声明保留在 [LICENSE](./LICENSE) 和 `server/`。画布复用 [Infinite Canvas](https://github.com/basketikun/infinite-canvas)，固定提交 `dab19adc0847e32e39b7fc8ff90cb392561fb826`（[许可证](./src/lib/canvas/LICENSE.infinite-canvas)、[适配说明](./src/lib/canvas/UPSTREAM.md)）。发布包包含[第三方声明](./public/third-party-notices.txt)。
