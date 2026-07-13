# 光构后端接入说明

[English](../en/backend.md) · [文档中心](../README.md)

光构使用基于 One Hub 的 Go 服务统一处理账号、额度、API 中继和云端作品库。`server/` 保留上游许可证、管理端和通用服务商能力；光构公开前端只调用当前产品已接入的接口。

## 1. 请求链路

```text
注册/登录
  POST /api/user/register
  POST /api/user/login
          ↓ 服务端 Cookie
获取用户中继令牌
  GET /api/token/playground
          ↓ 用户专属 token
图片请求
  POST /v1/images/generations
  POST /v1/images/edits
  POST /v1/images/variations
          ↓
One Hub 选择渠道、转发上游、记录用量并结算额度
```

浏览器不会收到平台上游 API Key。它只持有当前用户的中继令牌，因此泄漏影响范围被限制在该用户账号、权限和余额内。令牌仍属于敏感信息，不应写入日志或公开分享。

## 2. 本地接入

后端可直接使用 SQLite：

```powershell
Set-Location server
$env:SESSION_SECRET = '<至少 32 位的随机值>'
$env:USER_TOKEN_SECRET = '<另一段至少 32 位的随机值>'
go run .
```

前端 `.env.local`：

```dotenv
VITE_GOUO_BACKEND_ENABLED=true
VITE_GOUO_BACKEND_URL=
VITE_GOUO_BACKEND_DEV_TARGET=http://127.0.0.1:3000
VITE_GOUO_IMAGE_MODEL=gpt-image-2
```

本地 Vite 和生产 Nginx 都应保持同一路由语义：`/api` 负责账号与作品库，`/v1` 负责模型中继。生产环境优先同域部署；只有明确需要跨域时才设置 `VITE_GOUO_BACKEND_URL`，并同时正确配置 Cookie、CORS 和 HTTPS。

## 3. 首次管理后台配置

管理后台由后端提供，默认地址为 `http://127.0.0.1:3000/panel`。空数据库首次启动会创建 `root` / `123456`，必须在开放网络访问前修改。

建议按以下顺序配置：

1. 新建独立日常管理员账号。
2. 添加 OpenAI 或兼容图片渠道，API Key 只保存在渠道中。
3. 配置 `gpt-image-2` 或 `VITE_GOUO_IMAGE_MODEL` 对应的实际模型与映射。
4. 验证 generations、edits 和 variations 三条路由。
5. 核对固定售价、成功扣费、失败退款和余额不足拒绝。
6. 设置新用户额度、兑换码、注册策略和限流。
7. 若计划使用在线支付，完成支付渠道、回调验签、异常订单和对账测试后再开放入口。
8. 在“运营 → 光构存储”确认资产目录可写并检查用户空间。

注册页支持用户名和密码，并会根据后端状态显示邮箱验证码相关字段。若管理员强制启用额外验证码或 OAuth 流程，必须先确认光构登录/注册页已经提供对应参数。

## 4. 固定图片计费

当前光构图片生成、编辑和变体接口按成功请求次数使用固定人民币价格：

```dotenv
GOUO_IMAGE_PRICE_CNY=0.10
```

- 提交时检查并预扣额度。
- 服务端确认失败后退回预扣。
- 一次请求要求多个输出时，当前仍按一次成功请求结算。
- 用户中心显示当前价格、余额和最近使用记录。
- 固定售价与上游成本无关；运营方必须按模型、尺寸、质量、图片数量和编辑请求核对真实账单。

不要同时依赖 One Hub 通用倍率和光构固定售价做主观推断，应使用真实请求进行成功、失败和余额不足回归。

## 5. 云端作品库

主要配置：

```dotenv
GOUO_CLOUD_LIBRARY_ENABLED=true
GOUO_ASSET_DIR=/data/gouo-assets
GOUO_ASSET_USER_QUOTA_BYTES=2147483648
GOUO_ASSET_MAX_FILE_BYTES=26214400
GOUO_ASSET_MAX_TASK_FILES=32
```

默认含义：

- 单用户空间 2 GiB。
- 单文件最大 25 MiB。
- 单任务最多关联 32 个资产。
- 同一用户内按 SHA-256 去重；不同用户仍保持独立鉴权关系。

同步内容包括任务元数据、输出图、参考图、遮罩、缩略图、流式中间图和收藏夹关系。图片通过鉴权接口读取，`GOUO_ASSET_DIR` 不能直接暴露为 Nginx 静态目录。

删除已同步任务会把它隐藏到回收站，文件继续占用空间。当前实现没有面向用户的物理清理流程，运营方需自行制定保留和清理策略。

本地文件资产模式只适合单后端实例。多实例必须挂载同一个共享文件系统；否则数据库记录可能指向另一实例看不到的文件。对象存储尚未在光构专用作品库中完成接入。

## 6. 数据库、Redis 与备份

- 本地开发可使用 SQLite。
- 公开生产环境使用 MySQL 或 PostgreSQL。
- 多实例共享同一数据库、Redis、签名密钥和资产存储。
- Redis 是缓存与协调层，不能代替数据库备份。
- 数据库与 `GOUO_ASSET_DIR` 必须在同一维护窗口成对备份和恢复。
- `SESSION_SECRET`、`USER_TOKEN_SECRET` 和生产环境文件要加密备份。

只恢复数据库会得到缺失图片的作品记录；只恢复资产目录会得到没有归属关系的文件。

## 7. 关键接口

| 接口 | 用途 |
| --- | --- |
| `GET /api/status` | 后端状态与可用能力 |
| `GET /api/user/self` | 当前用户信息、额度和价格 |
| `POST /api/user/login` | 登录 |
| `POST /api/user/register` | 注册 |
| `GET /api/token/playground` | 当前用户专属图片中继令牌 |
| `POST /api/user/topup` | 兑换码充值 |
| `GET /api/log/self` | 当前用户使用记录 |
| `GET /api/gouo/storage` | 云端空间信息 |
| `POST /api/gouo/assets` | 上传账号资产 |
| `GET /api/gouo/sync` | 拉取任务与收藏夹增量 |
| `PUT /api/gouo/tasks/:clientId` | 写入或更新任务 |
| `PUT /api/gouo/collections/:id` | 写入或更新收藏夹 |

所有用户数据接口都必须在服务端校验登录身份和资源所有权，不要仅依赖前端隐藏按钮。

## 8. 当前边界

- 光构公开前端已经提供登录、注册、用户中心、兑换码、使用记录和云端作品库。
- 在线支付只有在 One Hub 侧配置完成并经过回调、重复通知、失败和对账测试后才可作为正式能力。
- 图片端点当前按非流式响应接入产品后端配置；纯前端模式仍保留流式兼容测试能力。
- `server/docs/` 描述的是上游 One Hub 通用能力，不自动代表光构前端已经开放对应入口。
