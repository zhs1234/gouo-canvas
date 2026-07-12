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

## Docker 部署

```powershell
Set-Location deploy
Copy-Item .env.example .env
# 修改 .env 中的全部密码和密钥
docker compose up -d --build
```

公开入口默认为 `http://服务器:8080`。Nginx 在同一个域名下提供光构前端，并将 `/api/*` 与 `/v1/*` 转发给后端，因此登录 Cookie、普通请求和 Responses SSE 流都无需跨域。

生产环境还应在容器前增加 HTTPS 入口（Caddy、Nginx Proxy Manager 或云负载均衡均可），只公开 80/443。后端管理端口在 Compose 中绑定到 `127.0.0.1`，远程管理建议使用 SSH 隧道，不要直接暴露公网。

## 当前边界

- One Hub 的 Responses API 已支持 SSE；图片端点当前按非流式响应接入，所以前端自动将 `streamImages` 设为 `false`。
- 光构已提供原生用户中心、额度显示、兑换码充值和最近使用记录，普通用户无需进入 One Hub 面板。在线支付订单与支付结果页仍需在配置正式支付渠道后接入。
- `/v1/images/generations`、`/v1/images/edits` 和 `/v1/images/variations` 按成功请求次数固定计费，默认 ¥0.10/次；失败请求退回预扣。生产环境通过 `GOUO_IMAGE_PRICE_CNY` 调整单价。
- 固定售价不等于上游成本。上线前仍需核对实际 API 账单，确保 ¥0.10 能覆盖不同尺寸、质量和编辑请求的成本。
