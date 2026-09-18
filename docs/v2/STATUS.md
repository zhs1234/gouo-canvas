# 实际交付与验证状态

## Starter 已提交内容

- 独立 npm workspace、React/Vite 应用壳、路由与可复用 UI 包。
- TanStack Query 账号接口桥接；使用旧登录接口，不获取浏览器 relay token。
- Fabric 本地图片/文字/变换/多选删除/PNG 导出；不上传、不生图、不收费。
- 共享 TypeScript 领域契约、能力校验、任务状态转换约束。
- 显式付费开关的 OpenAI Images operator probe 与脱敏摘要。
- Node 测试、Playwright smoke、初始化脚本、CI 配置、架构/数据/模型/订阅/迁移任务文档。

这不表示 Job/Worker、云端 Project/Asset API、会员支付、所有模型适配或完整编辑器已完成。它们仍按 TASKS.md 的 B1/B2/B3/E1/S1/W1 实施。

## 已执行

环境：Node 22.16.0；全局 TypeScript 编译共享契约。

```text
tsc -p v2/packages/contracts/tsconfig.json
node --test v2/tests/contracts-cases.mjs v2/tests/probe-cases.mjs
14 tests passed, 0 failed
```

## 尚未证实的项目

本地环境无法解析 github.com/npm registry，无法在此完成完整依赖安装、React/Fabric 构建、浏览器测试与旧 Go 后端回归。只有上述共享契约编译与 14 项测试有执行证据。CI 若返回结果，应在后续提交补充实际 run 链接；不能仅因为存在 workflow 就宣称 CI 已通过。

V2 初始 package-lock.json 需联网安装生成并提交；setup 会在无锁时 npm install、有锁时 npm ci。P0 必须完成 lockfile、完整 typecheck/build/Playwright，并记录确切版本。

没有真实模型/支付凭据测试，GPT Image 2.5 和其他模型在本平台的状态均为待验证。未改变 main、部署、生产数据库、额度或账号权限。

## 下一个任务

P0 → B1。Image 2.5 参数/模型映射诊断为 B2 的最高优先级，不能以“老网关不支持”为由把需求永久关闭。
