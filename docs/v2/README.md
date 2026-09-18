# Gouo Canvas V2 开发索引

本目录取代早期草案中“直接搬全部后端”和“最后才补任务队列”的表述：复用的是经验证的能力，异步任务、权限与幂等需要在真实收费前建立。

- [Codex 入口](../../START_HERE_V2.md)
- [任务顺序与验收](TASKS.md)
- [交付/验证状态](STATUS.md)
- [架构与代码迁移地图](ARCHITECTURE.md)
- [API、表和状态机设计](API-DATA.md)
- [多模型与 Image 2.5](MODELS.md)
- [安全、订阅和数据迁移](SECURITY-MIGRATION.md)
- [页面与工作流](DESIGN.md)
- [依赖与上游资料](DEPENDENCIES.md)

工程入口：`v2/package.json`；Studio：`v2/apps/studio`；共享包：`v2/packages`；Go 新业务：`server/internal/studio`。

`main` 不修改、不部署。基线 V2 文档提交为 `6f597dde10320fa26d4cb82c5e0f506d04b22edf`。后续任务以当前分支实际代码为准，而不是历史聊天里的文件行数或星标数。
