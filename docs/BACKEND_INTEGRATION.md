# 光构后端接入说明

光构采用 [One Hub](https://github.com/MartialBE/one-hub) 作为统一 API、账户与计费底座。本仓库中的 `server/` 保留其 Apache-2.0 许可证和版权声明，并在前端增加了光构专用的登录适配层。

## 已接通的请求链路

1. 用户通过 `POST /api/user/login` 或 `POST /api/user/register` 建立服务端会话。
2. 前端通过 `GET /api/token/playground` 获取当前用户独立的 `sys_playground` 令牌。
3. 图片请求发往同域的 `/v1/images/generations`、`/v1/images/edits` 或 `/v1/images/variations`。
4. One Hub 根据令牌找到用户和渠道，转发至平台统一配置的上游 API，并扣减该用户额度、记录调用日志。

浏览器里不会出现平台的上游 API Key。前端仅持有当前用户的中继令牌；即使令牌泄露，影响范围也被限制在该用户账户和额度内。

## 本地联调

后端首次运行可直接使用 SQLite：

```powershell
Set-Location server
$env:SESSION_SECRET = '<至少 32 位随机值>'
$env:USER_TOKEN_SECRET = '<至少 32 位随机值>'
go run .
```

复制根目录 `.env.example` 为 `.env.local`，本地前后端不同端口时填写：

```dotenv
VITE_GOUO_BACKEND_ENABLED=true
VITE_GOUO_BACKEND_URL=
VITE_GOUO_BACKEND_DEV_TARGET=http://127.0.0.1:3000
VITE_GOUO_IMAGE_MODEL=gpt-image-2
```

然后在仓库根目录运行 `npm run dev`。Vite 会将同域的 `/api` 和 `/v1` 转发到后端，登录 Cookie 不需要跨域；生产环境则由 `deploy/nginx.conf` 承担相同的转发职责。

## 首次后台配置

One Hub 管理后台默认监听本机 `http://127.0.0.1:3000`。空数据库第一次启动会创建管理员 `root`，初始密码为 `123456`。该密码只能用于本地初始化；任何联网部署都必须在开放访问前立即修改。随后完成：

1. 在“渠道”中新建 OpenAI 或你的 OpenAI 兼容上游，API Key 只填写在这里。
2. 给渠道加入 `gpt-image-2` 模型；如果你的上游模型名不同，设置模型映射，或修改 `VITE_GOUO_IMAGE_MODEL`。
3. 实测 `/v1/images/generations`、`/v1/images/edits` 和 `/v1/images/variations` 三条路由。
4. 在“定价”中为 `gpt-image-2` 设置真实价格和倍率。未配置价格前不要开放付费充值，避免按回退倍率错误扣费。
5. 设置新用户赠送额度、最低充值、支付回调地址和支付渠道。
6. 将系统名称改为“光构”，并关闭暂未接入前端的登录方式。

当前光构注册页支持用户名/密码，并预留邮箱和验证码字段。若后台开启 Turnstile，需先在光构注册页接入 Turnstile token，再强制启用；否则注册请求会被拒绝。

## 生产部署

生产环境支持两条互相独立的部署路线：

- [Docker Compose 部署](./DEPLOYMENT_DOCKER.md)：由仓库中的 Compose 同时管理公开前端、后端、MySQL、Redis 和持久卷。
- [传统服务器手动部署](./DEPLOYMENT_MANUAL.md)：自行使用 Nginx、systemd、MySQL 和 Redis 管理每个服务。

请先阅读[部署方式选择与共同要求](./DEPLOYMENT.md)，选定一种方式后完整执行对应教程。不要只复制启动命令；密钥固定、HTTPS、管理端隔离、数据库与图片成套备份、升级回滚和上线验收都是生产部署的一部分。

## 云端作品库

登录用户的画廊任务、输出图、参考图、遮罩、缩略图和收藏夹会自动同步到后端。浏览器 IndexedDB 继续作为缓存和断网队列，云端记录决定作品与收藏夹的最终状态。

```dotenv
GOUO_CLOUD_LIBRARY_ENABLED=true
GOUO_ASSET_DIR=/data/gouo-assets
GOUO_ASSET_USER_QUOTA_BYTES=2147483648
GOUO_ASSET_MAX_FILE_BYTES=26214400
GOUO_ASSET_MAX_TASK_FILES=32
```

- 默认每个用户 2 GB，单文件最大 25 MB，单任务最多关联 32 个图片资产。
- 相同用户的相同图片按 SHA-256 去重；不同用户之间不共享鉴权记录。
- 图片通过 `/api/gouo/assets/:id/content` 鉴权读取，不能把 `GOUO_ASSET_DIR` 配成 Nginx 静态目录。
- 删除作品只会移入回收站，不会物理清理文件，隐藏作品仍占用空间。
- Docker 部署已把 `/data` 挂载到 `backend-data` 卷。必须同时备份数据库和该卷，否则无法完整恢复作品库。
- 本地文件模式仅适合单后端实例。多实例部署必须挂载同一个共享文件系统，或后续切换到 S3 兼容存储。

管理后台的“运营 → 光构存储”页面可查看用户用量并调整单用户配额。配额不能低于当前已使用空间。

## 当前边界

- One Hub 的 Responses API 已支持 SSE；图片端点当前按非流式响应接入，所以前端自动将 `streamImages` 设为 `false`。
- 光构已提供原生用户中心、额度显示、兑换码充值和最近使用记录，普通用户无需进入 One Hub 面板。在线支付订单与支付结果页仍需在配置正式支付渠道后接入。
- `/v1/images/generations`、`/v1/images/edits` 和 `/v1/images/variations` 按成功请求次数固定计费，默认 ¥0.10/次；失败请求退回预扣。生产环境通过 `GOUO_IMAGE_PRICE_CNY` 调整单价。
- 固定售价不等于上游成本。上线前仍需核对实际 API 账单，确保 ¥0.10 能覆盖不同尺寸、质量和编辑请求的成本。
