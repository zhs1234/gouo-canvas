# 两模型最小安全配置：普通 owner token

此文是用户执行的步骤。助手没有创建账号、渠道、token、密码或真实运行时配置，未发起付费请求。当前环境没有用户接管/Vault 预览能力；在自己的电脑或明确授权的私有测试主机按照 [RUNNING.md](RUNNING.md) 启动，再在浏览器使用原生 `/setup`、`/sign-in`、`/security`、`/wallet`。不能临时公开后台来传递密钥。

## 固定版本证据与适用条件

New API `v1.0.0-rc.40` / commit `0aec08fee811ec6136828fda790551b49e410301`：

- [middleware/auth.go：SetupContextForToken](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/middleware/auth.go) 只有管理员账号的 relay token 能使用 `token-channelId` 后缀，普通账号被拒绝；后缀同时添加 `PinRetrySingleAttempt`。
- [controller/relay.go](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/controller/relay.go) Chat/Images 循环从 retry=0 开始，条件 `retry <= common.RetryTimes`。实例 `RetryTimes=0` 时只进入一次；包括 channel error 分支也无法进入第二次循环。
- [service/relay_error.go](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/service/relay_error.go) 普通错误在剩余预算为零时停止。[model/option.go](https://github.com/QuantumNous/new-api/blob/0aec08fee811ec6136828fda790551b49e410301/model/option.go) 持久化设置更新运行时 RetryTimes；源码默认零不是已运行实例的证明。

私有测试可以使用普通账号的受限 token，模型 ID 由 New API 选择对应渠道，前提是用户核验该固定版本实例的 `RetryTimes=0`。不要为渠道后缀提升账号角色。Studio Chat SDK `maxRetries=0`，Images 单次 fetch；本地 mock 测试仅证明 Studio 不重试，不能证明供应商或第三方中转内部不重试。

既有默认 pinned 模式保留，channelId 仍追加后缀。切换使用独立模型目录；model 模式遇到任何 channelId 或 token 后缀直接拒绝，不能静默删 pin 后继续收费。

## 用户原生设置与停止条件

1. 用户在 New API 原生页面输入密码；管理员仅用于初始化及原生设置，日常画布登录使用独立普通测试账号。
2. 用户为 Feng 聊天 `gpt-6.1-sol` 与图片 `gpt-image-2` 各录入独立渠道密钥，核对供应商基址、准确别名、协议和权限。测试账号可用分组里每个模型应只匹配预期渠道；不要开放同名备用渠道、自动分组或跨组重试。保存时不要顺带触发付费测试。
3. 在原生请求策略/重试设置中核验 **RetryTimes=0**，保存后重新打开页面确认当前有效值。此设置是实例级，目标应为私有测试实例；不能据本文擅改已有生产实例，也不能根据源码默认值跳过核验。
4. 普通测试账号创建 relay token：仅允许上述两个准确模型 ID，关闭跨组重试、不使用 auto 分组、设置有限额度与有效期；确认它属于画布登录 owner 的数字 ID。token 不需要管理员权限；原生限制项缺失时先停止核对。
5. 核对两模型采购价格、New API 原生价格、输入/输出上界及所有预定调用的总上界。当前付费测试总预算 **¥5**；示例 128 输出 token、一次聊天与图片 n=1 是调用上界，不是金额上界。供应商图片默认质量/尺寸也需确认。价格、换算或已扣费结果未知，或无法设置足够低硬额度时，停止付费步骤。token 额度不能单独证明第三方采购成本低于 ¥5。

## 非秘密文件与验证命令

复制 `v2/config/loomic.models.normal.example.json` 到用户本机忽略的 runtime/models.json。示例 `gpt-6.1-sol` / `gpt-image-2` 全部 pending/disabled，聊天 maxTokens=128、maxChatCalls=1、toolCalling=false，图片仅 generate、一次一张。这不是渠道支持或价格验证。实际能力验证后才逐项调整并记录证据。两次聊天加一张图的工具循环需要另外验证 toolCalling、调用上界及价格，不能为跑流程直接改成 live-verified。

复制 `v2/config/normal-routing.evidence.example.json` 到本机 runtime/normal-routing.json。示例 operatorVerified=false、空时间，**不能启用普通路由**。仅在步骤 3 完成后，由用户填写实际核验 UTC 时间并改为 true。gatewayOrigin 必须匹配 Studio 所连接网关：Compose 内部为 `http://new-api:3000`，不是浏览器 `http://localhost:8080`。这是人工核验声明，不是自动读取设置或实时证明。版本、实例、路由或重试设置变化后先关闭生成，再重新核验、更新记录并重启 Studio；记录不能阻止管理员之后改变网关设置。

仓库根运行不收费检查：

```sh
node v2/scripts/check-model-config.mjs
node v2/scripts/check-model-config.mjs --models v2/deploy/runtime/models.json --evidence v2/deploy/runtime/normal-routing.json --gateway http://new-api:3000/v1
```

命令只读明确指定的非秘密 models/evidence JSON，不读取 .env、继承环境变量、密码或 key 文件，不连接服务，不打印文件内容。第二条对未核验示例失败是预期保护。通过仅证明字段和禁用状态，不能证明实时设置、token owner/权限、模型可用或费用上界。

用户将基础 relay token 安全写入本机受保护 runtime/relay-key，不在聊天、命令参数、前端变量或仓库提供。只有该 owner 可生成。本机 .env 非秘密配置：

```dotenv
GOUO_RELAY_ROUTING_MODE=model
GOUO_NORMAL_ROUTING_EVIDENCE_FILE=/run/gouo/normal-routing.json
GOUO_RELAY_OWNER_ID=<普通测试账号数字ID>
GOUO_STUDIO_MODELS_FILE=/run/gouo/models.json
GOUO_RELAY_API_KEY_FILE=/run/gouo/relay-key
GOUO_ENABLE_GENERATION=false
```

runtime 目录只读挂载。完成核验及另行获准的实际测试后由用户启用；无渠道、价格或用户配置时保持关闭。未知结果不得自动重试、更换渠道或删除去重账本。真实验证记录脱敏 request ID、原生费用及能力子集，不记录 key/token。
