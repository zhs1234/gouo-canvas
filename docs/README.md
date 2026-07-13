# Gouo Canvas documentation / 光构文档中心

[返回中文项目说明](../README.zh-CN.md) · [Back to the English README](../README.md)

Project documentation is maintained in matching Simplified Chinese and English trees. Choose a language below; documents with the same path cover the same topic.

项目文档按简体中文和英文两套目录同步维护。请选择语言；两种语言中路径相同的文件描述同一主题。

## 简体中文

- [用户指南](./zh-CN/user-guide.md)：从注册登录到生成、编辑、收藏、同步和排障
- [开发指南](./zh-CN/development.md)：运行模式、本地环境、目录结构和开发工作流
- [后端接入说明](./zh-CN/backend.md)：请求链路、管理后台、计费与云端作品库
- [测试与本地模拟 API](./zh-CN/testing.md)：构建、测试命令和异常场景模拟
- [部署总览](./zh-CN/deployment/index.md)：选择 Docker Compose 或传统手动部署
- [Docker Compose 部署](./zh-CN/deployment/docker.md)
- [传统 Linux 手动部署](./zh-CN/deployment/manual.md)
- [生产上线检查清单](./zh-CN/deployment/checklist.md)

## English

- [User guide](./en/user-guide.md): accounts, generation, editing, collections, synchronization, and troubleshooting
- [Development guide](./en/development.md): runtime modes, local setup, repository layout, and workflow
- [Backend integration](./en/backend.md): request flow, admin setup, billing, and cloud library
- [Testing and local mock API](./en/testing.md): build checks, tests, and failure simulation
- [Deployment overview](./en/deployment/index.md): choose Docker Compose or a manual deployment
- [Docker Compose deployment](./en/deployment/docker.md)
- [Manual Linux deployment](./en/deployment/manual.md)
- [Production checklist](./en/deployment/checklist.md)

## Documentation scope / 文档边界

Files under [`server/docs/`](../server/docs/) come from the upstream One Hub backend and are kept for upstream reference. Gouo-specific setup, deployment, routes, storage, and pricing are documented here.

[`server/docs/`](../server/docs/) 下的文件来自上游 One Hub，仅作为上游参考保留。光构专用的配置、部署、路由、存储和计费说明以本目录为准。

Release history is maintained in the bilingual [CHANGELOG](../CHANGELOG.md).

版本历史统一记录在双语 [CHANGELOG](../CHANGELOG.md) 中。
