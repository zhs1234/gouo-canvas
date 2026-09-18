# 实际交付与验证状态

## Starter 已提交内容

- 独立 npm workspace、React/Vite 应用壳、路由与可复用 UI 包。
- TanStack Query 账号接口桥接；使用旧登录接口，不获取浏览器 relay token。
- Fabric 本地图片/文字/变换/多选删除/PNG 导出；不上传、不生图、不收费。
- 共享 TypeScript 领域契约、能力校验、任务状态转换约束。
- 显式付费开关的 OpenAI Images operator probe 与脱敏摘要。
- Node 测试、Playwright smoke、初始化脚本、只读权限 CI、架构/数据/模型/订阅/迁移文档。
- 已提交真实 npm package-lock.json，初始化直接使用 npm ci。

这不表示 Job/Worker、云端 Project/Asset API、会员支付、所有模型适配或完整编辑器已完成。它们仍按 TASKS.md 的 B1/B2/B3/E1/S1/W1 实施。

## 已执行的验证（2026-09-18）

本地 Node 22.16.0：共享契约 TypeScript 编译通过，14 个 Node 测试通过。由于本地环境网络/DNS 限制，完整依赖与浏览器检查改由 GitHub Actions 执行。

GitHub Actions：Ubuntu runner，Node 22.23.2，npm 10.9.8。

| 检查 | 实际结果 |
| --- | --- |
| npm install（首次生成依赖锁） | 通过 |
| npm run typecheck | 通过 |
| npm test | 14 passed，0 failed |
| npm run build | 通过 |
| npm run test:e2e | 1 passed；工作台、文字编辑/PNG 下载、模型清单导航 |

成功记录：
- 应用起点提交 `948cf4d481a8ed283c3c277056fa5703885b450b`，运行 https://github.com/zhs1234/gouo-canvas/actions/runs/35325115628 。
- 依赖锁生成/复核运行 https://github.com/zhs1234/gouo-canvas/actions/runs/35325554586 ，依赖锁提交 `0c9199bc96752529f9fb0ed836980fe749bdb57b`。

临时依赖锁写回任务已完成并从正式 CI 移除；正式 workflow 仅 contents: read，不部署、不自动提交业务改动。后续 CI 使用 npm ci 复验锁文件。历史上一次临时 workflow 的 YAML 条件语法错误已修正，不是应用测试失败。

首次已验证依赖：React/React DOM 19.3.0、Fabric 7.4.0、React Router DOM 7.18.4、TanStack Query 5.103.1、Vite 7.3.6、TypeScript 5.9.3、Playwright 1.63.0。以仓库锁文件为准；升级后必须重新验证。

## 尚未验证

没有真实模型/支付凭据测试，GPT Image 2.5 和其他模型在本平台均待真实渠道验证。未启动现有 Go 后端做账号/支付/数据库集成回归。1 个浏览器 smoke 不是完整图像编辑器或商业平台的端到端覆盖。

未改变 main、部署、生产数据库、额度或账号权限。P0 仍需在 Codex 环境复验，并建立旧 Go 后端的可用开发基线，然后实施 B1。Image 2.5 参数/模型映射诊断是 B2 的最高优先级，不以旧网关限制为永久关闭理由。
