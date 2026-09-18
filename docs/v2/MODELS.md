# 多模型与 Image 2.5 接入

核查日期：2026-09-18。以下将“官方文档存在接口”和“本项目真实渠道能用”分开。未使用生产密钥或执行真实付费生图。

## 1. image2.5 的识别

用户提供的是 `image2.5` 简称，没有渠道名称或完整错误。OpenAI 当前官方文档列出 `gpt-image-2.5-sunburst` 与 `gpt-image-2.5-flare`，可走 Images API；Responses 使用主模型 + image_generation 工具中的图片模型 ID。不能把简称硬编码成 `image2.5`，也不能与 `gemini-2.5-flash-image` 混淆。实际渠道可能有自己的 alias，必须由管理员配置准确映射。

来源：https://developers.openai.com/api/docs/guides/image-generation

Image 2.5 文档包括 low/medium/high/xhigh/max 质量选项，因此不能沿用老模型的全局三值枚举。每个选项仍须通过实际渠道验证后才向用户开放。

## 2. 已检查的代码与排查顺序

- `src/lib/gouoBackend.ts` 的 createBackendSettings 使用环境变量，否则默认 gpt-image-2；这只是旧前端默认值，不是后端能力证明。
- `server/providers/openai/image_generations.go` 将 ImageRequest 交给 GetRequestTextBody；要继续检查类型字段、路由/渠道权限、模型列表和成本逻辑，不能只改前端下拉菜单。
- `server/providers/openai/image_edits.go` 的 getRequestImageBody 在 OriginalModel 与 request.Model 不同时重建 multipart。所查看的 imagesEditsMultipartForm 只写 image(s)、prompt、model、mask、response_format、n、size、user；没有重建质量、输出格式等更多字段。该路径可能造成参数丢失，**不是已证实的 Image 2.5 故障根因**。修复必须覆盖 mapped 与 unmapped 两条路径。
- `server/controller/order.go` 的旧充值结算思路不适合作为新模型成本/会员额度的直接耦合点。新模型接入与订阅结算分离。

B2 核对链路：真实模型 ID → 上游账号权限 → URL 与协议 → 渠道 route → JSON/multipart 字段 → 输出解析 → usage → 超时/结果恢复 → 权益与成本。将 request-id 与 HTTP 状态保存到脱敏报告，严禁打印 Key。

## 3. 协议而不是模型名硬编码

| 协议族 | 代表接入方向 | 必须独立处理 |
| --- | --- | --- |
| openai-images | GPT Image、实际声明兼容 Images 的渠道 | JSON generation、multipart edit、b64/URL、版本字段 |
| openai-responses | 支持 image_generation tool 的 API | 主模型与工具模型分离，output blocks、拒绝、流事件 |
| gemini-content | Gemini generateContent 图片路径 | parts/inlineData、text+image 混合返回、多轮上下文 |
| gemini-interactions | 当前 Gemini Interactions 路径 | interaction ID、output image/multiblock、会话状态 |
| fal-queue | fal 图片 endpoints | 提交/状态/结果，保存 request ID，参数按 endpoint schema |
| provider-native | Seedream/FLUX/Qwen/其他原生渠道 | 厂商 endpoint、认证、字段与异步模型，不能套统一 JSON |

目标是覆盖主流协议族，使新增模型尽量成为配置 + 能力测试，而不是改 UI。不是承诺“任何模型无需适配都能工作”。SDK 可复用，但模型 ID、用途、区域和渠道 schema 必须实时核对。

Google：https://ai.google.dev/gemini-api/docs/image-generation
fal：https://fal.ai/docs/documentation/model-apis/inference/queue
Black Forest Labs：https://docs.bfl.ai/quick_start/introduction
阿里云：https://help.aliyun.com/zh/model-studio/qwen-image-api

## 4. 模型目录字段

server-only：modelKey、upstreamModelId、protocol、adapterId、channelId、secretRef、baseURLAllowlist、region、routePolicy、capabilityRevision、价格版本、verification evidence。

public：模型标签、业务 modelKey、已验证操作、参考图上限、输出张数、质量/尺寸/格式、透明底等能力；不能包含 keys、内部 URL 或管理员配置。

`v2/config/models.example.json` 只是非生产配置示例。默认全 disabled/pending；不能通过导入示例直接开放付费模型。共享校验在 `v2/packages/contracts/src/index.ts`，服务端还需验证数据库、配额和资产归属。

## 5. 网关不支持时

先用最小 JSON 请求区分上游与 One Hub 故障；通过下面的 operator probe 可分别配置官方端点和经过授权的中转端点。网关路径暂不具备新字段时，可由 Go Worker 内的 direct adapter 访问批准的上游；仍经过统一身份、素材、Job、权益与审计。禁止在浏览器直接调用，禁止自动转送到未经批准的第三方。

不得以关闭所有校验、放开任意 URL、忽略 quality/mask 字段或统一把模型名替换成 gpt-image-2 的方式“修好”。

## 6. 最小付费探测（仅管理员手动）

在有明确付费测试授权和开发密钥的环境设置 IMAGE_PROBE_BASE_URL、IMAGE_PROBE_MODEL、IMAGE_PROBE_KEY。Key 用环境管理器或安全输入，不写仓库/提示词/命令历史。

```sh
node v2/scripts/image-probe.mjs --allow-paid
```

本工具仅验证 HTTPS `/v1/images/generations`，固定一张图，无自动重试；不验证 edit/mask/stream/Responses/所有质量档。报告位于忽略的 `v2/.reports/image-probe.json`。没有 flag 或缺配置立即失败。不要把一次返回有图片当成完整集成认证；上线前还需要逐项测试与实际图片质量审查。

## 7. 必须有的测试矩阵

各 channel + model + capabilityRevision：文本生成、参考图、mask、张数、每种公开质量与尺寸、透明背景、usage、429、401/403、非法字段、5xx、超时、上游成功后下载失败、返回 URL 过期、部分成功、重复提交、退订/到期竞争、素材越权。

`contract-tested` 表示本地/模拟协议测试，不是实际模型可用。`live-verified` 记录测试日期、渠道、请求 ID、能力子集与实际观察；变更渠道、模型别名或能力版本后重新审核。
