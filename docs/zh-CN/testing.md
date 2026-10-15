# 测试与本地模拟 API

[English](../en/testing.md) · [文档中心](../README.md)

## 1. 前端验证顺序

修改完成后优先执行：

```powershell
npm run build
npm test
```

`npm run build` 会先运行 TypeScript 项目构建，再执行 Vite 生产构建。`npm test` 使用 Vitest 单次运行全部测试。

开发期间可监听：

```powershell
npm run test:watch
```

人工检查生产构建：

```powershell
npm run preview
```

不要手动修改 `dist/`；需要更新预览时重新构建。

## 2. 后端冒烟检查

本仓库常用的低成本检查：

```powershell
Set-Location server
go test ./controller -run '^$'
go test ./relay ./model -run Gouo
```

第一条只编译 `controller` 包而不运行测试，适合发现路由或类型编译问题；第二条验证光构固定图片额度计算。涉及其他后端包时，应按 `server/AGENTS.md` 运行对应包测试，必要时再运行更大范围测试。

## 3. 本地模拟服务

`scripts/mock-workspace-api.mjs` 只监听本机，模拟账号、模型目录、图片生成和 Agent 工具调用，不转发上游请求也不真实扣费。启动方式和测试账号见[根目录说明](../../README.zh-CN.md#免费本地模拟)；独立自检命令为 `node scripts/mock-workspace-api.mjs --self-test`。

## 4. 人工回归清单

功能改动至少选择相关项验证：

- 注册、登录、退出和重新登录。
- 文生图、参考图编辑和遮罩编辑。
- 成功扣费、失败退款和余额不足。
- 多图、部分失败、重试和参数复用。
- 搜索、筛选、收藏夹、批量下载和数据导入导出。
- 同步中断、恢复、跨浏览器恢复、回收站和配额不足。
- 深色模式、移动端输入框、弹窗滚动和 PWA 安装提示。

记录问题时保留请求 ID、HTTP 状态、复现路径和经过脱敏的响应结构。不要粘贴真实 API Key、Cookie、完整中继令牌或用户私密图片链接。
