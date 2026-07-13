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
go test ./relay/relay_util -run '^TestGetFixedImageQuota$'
```

第一条只编译 `controller` 包而不运行测试，适合发现路由或类型编译问题；第二条验证光构固定图片额度计算。涉及其他后端包时，应按 `server/AGENTS.md` 运行对应包测试，必要时再运行更大范围测试。

## 3. 模拟 API 的用途

`scripts/mock-image-api.mjs` 用于复现浏览器中的图片接口异常，包括：

- API 或图片 URL 的 CORS 失败。
- HTTP 错误、非法 JSON、空响应和错误响应结构。
- 图片下载 404 或重定向后 CORS 失败。
- 慢请求和交替失败。
- SSE 流式事件格式、失败事件和缺少最终图片。
- 自定义同步和异步服务商的提取与轮询错误。

它是开发工具，不是生产图片服务。

## 4. 启动模拟 API

```powershell
npm run mock:api
```

默认地址为 `http://127.0.0.1:8787`。修改端口：

```powershell
$env:MOCK_IMAGE_API_PORT = '8788'
npm run mock:api
```

## 5. 使用纯前端模式测试

产品模式会隐藏 API 设置并强制使用用户中继令牌，因此测试模拟 API 前应在 `.env.local` 中关闭产品后端：

```dotenv
VITE_GOUO_BACKEND_ENABLED=false
VITE_GOUO_BACKEND_URL=
VITE_GOUO_BACKEND_DEV_TARGET=
```

重启 `npm run dev` 后，在“设置 → API”新建 OpenAI 兼容配置：

- API 地址：例如 `http://127.0.0.1:8787/url-ok`
- API Key：任意非空测试值，例如 `mock`
- API 模式：`Images API`
- 模型：任意值，例如 `mock`

模拟服务读取请求中的 `n`，最多返回 10 条结果。测试多输出和部分失败时，将应用输出数量设置为 2 或更大。

## 6. OpenAI 兼容场景

| 路径 | 预期行为 |
| --- | --- |
| `/url-ok` | 返回带 CORS 头的图片 URL，任务成功 |
| `/b64` | 返回 `b64_json`，任务成功 |
| `/url-cors-block` | API 成功，但图片下载因 CORS 失败 |
| `/url-404` | 返回的图片 URL 下载为 404 |
| `/url-redirect-cors-block` | 重定向目标缺少 CORS 头 |
| `/wrong-shape` | JSON 结构不是 OpenAI `data[]`，应显示原始响应 |
| `/no-recognizable` | `data[]` 中没有 URL 或 base64 |
| `/empty` | 空 `data[]` |
| `/http-error` | API 返回 HTTP 500 |
| `/invalid-json` | API 返回非法 JSON |
| `/slow` | 延迟响应，用于超时测试 |
| `/api-no-cors` | API 请求本身因 CORS 失败 |
| `/alternating-http-error` | 每隔一次请求返回 HTTP 500 |

对无法提取图片的响应，任务详情应保留“查看原始响应”或原始图片链接，方便诊断，而不是只显示笼统失败。

## 7. 流式场景

在 API 配置中启用流式传输后可测试：

| 路径 | 预期问题 |
| --- | --- |
| `/stream-unsupported` | 服务端拒绝流式请求 |
| `/stream-invalid-json` | SSE `data:` 不是合法 JSON |
| `/stream-no-data` | 没有有效 `data:` 事件 |
| `/stream-failed-event` | 收到 `*.failed` 事件 |
| `/stream-error-object` | 收到错误对象 |
| `/stream-no-final` | 只有中间图，没有最终图 |
| `/stream-no-usable` | 完成事件中没有可用图片 |

Responses API 模式也可使用同一组路径验证提取失败和流式解析。

## 8. 自定义服务商测试

模拟服务提供：

- `custom/random-image`：同步自定义 JSON 响应。
- `custom/async-submit` 与 `custom/tasks/{task_id}`：提交后轮询的异步流程。

推荐直接在“设置 → API → 自定义服务商”使用界面生成或导入 Manifest，再把基础地址设为 `http://127.0.0.1:8787`。当前应用内置的“复制 LLM 提示词”始终与实际 Manifest schema 一起维护，避免文档复制出另一份容易过期的长提示词。

异步模型值可使用：

- `mock:url-ok`
- `mock:b64`
- `mock:async-failure`
- `mock:async-no-task-id`
- `mock:async-empty`

分别检查成功轮询、base64 提取、失败原因、缺少任务 ID 和成功状态无图片等分支。

## 9. 人工回归清单

功能改动至少选择相关项验证：

- 注册、登录、退出和重新登录。
- 文生图、参考图编辑、变体和遮罩编辑。
- 成功扣费、失败退款和余额不足。
- 多图、部分失败、重试和参数复用。
- 搜索、筛选、收藏夹、批量下载和数据导入导出。
- 同步中断、恢复、跨浏览器恢复、回收站和配额不足。
- 深色模式、移动端输入框、弹窗滚动和 PWA 安装提示。

记录问题时保留请求 ID、HTTP 状态、复现路径和经过脱敏的响应结构。不要粘贴真实 API Key、Cookie、完整中继令牌或用户私密图片链接。
