# 光构传统服务器手动部署

本教程适用于不使用 Docker、直接在 Linux 主机运行 Node.js、Go、MySQL、Redis、Nginx 和 systemd 的部署方式。示例目录和命令以 Ubuntu/Debian 系服务器为基准；其他发行版需要替换软件安装命令，但目录、环境变量和服务关系不变。

手动部署包含三个独立产物：

1. 根目录 React 前端，构建到 `dist/`，由 Nginx 提供。
2. `server/web` 的 One Hub 管理端，构建到 `server/web/build/`，随后嵌入 Go 后端。
3. `server/` Go 后端二进制，由 systemd 运行在 3000 端口，并由主机防火墙限制公网访问。

必须先构建管理端，再构建 Go 后端，否则后端会嵌入旧的管理页面。

## 1. 准备系统软件

需要安装：

- Git。
- Node.js 22 和 npm。
- Corepack 与 Yarn 1.22.22，用于 `server/web`。
- Go 1.25。
- GCC 和 C 标准库开发包。后端包含 SQLite 驱动，即使生产使用 MySQL，构建时仍需要 CGO 工具链。
- MySQL 8。
- Redis 7。
- Nginx。
- OpenSSL。

安装完成后检查：

```bash
git --version
node --version
npm --version
corepack --version
go version
gcc --version
mysql --version
redis-server --version
nginx -v
```

版本建议与仓库 Dockerfile 保持一致。不要在生产服务器使用来源不明的 Node.js 或 Go 二进制。

## 2. 创建系统用户和目录

```bash
sudo useradd --system --home /var/lib/gouo --shell /usr/sbin/nologin gouo
sudo mkdir -p /opt/gouo/src /opt/gouo/bin /var/lib/gouo/assets /var/lib/gouo/logs /var/www/gouo /etc/gouo
sudo chown -R "$USER":"$USER" /opt/gouo/src
sudo chown -R gouo:gouo /var/lib/gouo
sudo chmod 750 /var/lib/gouo /var/lib/gouo/assets
sudo chmod 750 /etc/gouo
```

目录用途：

| 目录 | 用途 | 所有者 |
| --- | --- | --- |
| `/opt/gouo/src` | Git 源码和构建目录 | 部署用户 |
| `/opt/gouo/bin` | 已发布的后端二进制 | root 可写，运行用户只读 |
| `/var/www/gouo` | 光构公开前端静态文件 | root 可写，Nginx 只读 |
| `/var/lib/gouo/assets` | 用户云端图片 | `gouo` 可读写 |
| `/var/lib/gouo/logs` | 后端日志目录 | `gouo` 可读写 |
| `/etc/gouo/gouo.env` | 后端密钥和连接串 | root 管理，`gouo` 只读 |

不要让 Nginx直接读取或公开 `/var/lib/gouo/assets`。

## 3. 获取代码

```bash
git clone https://github.com/zhs1234/gouo-canvas.git /opt/gouo/src
cd /opt/gouo/src
git rev-parse HEAD
git status --short
```

记录提交号，并确保 `git status --short` 没有输出。生产服务器不应成为开发工作区。

## 4. 初始化 MySQL

进入 MySQL 管理终端：

```bash
sudo mysql
```

执行以下 SQL，并替换密码：

```sql
CREATE DATABASE gouo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'gouo'@'127.0.0.1' IDENTIFIED BY '替换为数据库强密码';
GRANT ALL PRIVILEGES ON gouo.* TO 'gouo'@'127.0.0.1';
FLUSH PRIVILEGES;
```

验证业务账号：

```bash
mysql -h 127.0.0.1 -ugouo -p gouo -e 'SELECT 1;'
```

注意事项：

- 不要让后端使用 MySQL `root` 账号。
- MySQL 应只监听本机或私有网络。
- 数据库密码会出现在 `SQL_DSN` 中，建议使用长随机字母数字字符串，避免 DSN 解析歧义。
- 如果数据库位于另一台主机，只允许后端私网 IP 连接，并启用传输加密和数据库防火墙。

## 5. 配置 Redis

单机部署建议让 Redis 仅监听 `127.0.0.1`，开启 AOF，并由 systemd 管理：

```bash
sudo systemctl enable --now redis-server
redis-cli ping
```

预期返回 `PONG`。如果 Redis 设置了密码，后续使用：

```dotenv
REDIS_CONN_STRING=redis://:你的Redis密码@127.0.0.1:6379
```

Redis 不保存最终用户作品、额度或账户数据，不能用 Redis 替代 MySQL 备份。

## 6. 创建后端环境文件

生成两个不同的密钥：

```bash
openssl rand -hex 32
openssl rand -hex 32
```

创建 `/etc/gouo/gouo.env`：

```dotenv
PORT=3000
GIN_MODE=release
TZ=Asia/Shanghai

SQL_DSN=gouo:替换为数据库强密码@tcp(127.0.0.1:3306)/gouo?charset=utf8mb4&parseTime=True&loc=Local
REDIS_CONN_STRING=redis://127.0.0.1:6379

SESSION_SECRET=替换为第一段随机值
USER_TOKEN_SECRET=替换为第二段不同的随机值

GOUO_IMAGE_PRICE_CNY=0.10
GOUO_CLOUD_LIBRARY_ENABLED=true
GOUO_ASSET_DIR=/var/lib/gouo/assets
GOUO_ASSET_USER_QUOTA_BYTES=2147483648
GOUO_ASSET_MAX_FILE_BYTES=26214400
GOUO_ASSET_MAX_TASK_FILES=32
LOG_DIR=/var/lib/gouo/logs
```

设置权限：

```bash
sudo chown root:gouo /etc/gouo/gouo.env
sudo chmod 640 /etc/gouo/gouo.env
```

注意事项：

- `SESSION_SECRET` 和 `USER_TOKEN_SECRET` 必须不同并长期固定。
- 环境文件不能提交到 Git。
- `GOUO_ASSET_DIR` 必须是绝对路径、可写、在备份范围内。
- 单机本地文件模式只运行一个后端实例。多实例必须使用共享文件系统，不能给每台机器单独的资产目录。
- `GOUO_IMAGE_PRICE_CNY` 是对用户的固定售价，不代表上游成本。

## 7. 构建光构公开前端

```bash
cd /opt/gouo/src
npm ci
```

创建只用于生产构建的 `.env.production.local`：

```dotenv
VITE_GOUO_BACKEND_ENABLED=true
VITE_GOUO_BACKEND_URL=
VITE_GOUO_IMAGE_MODEL=gpt-image-2
```

同域部署必须让 `VITE_GOUO_BACKEND_URL` 保持为空，浏览器会直接请求当前域名的 `/api` 和 `/v1`。模型名必须与管理后台渠道配置一致。

构建并发布静态文件：

```bash
npm run build
sudo find /var/www/gouo -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
sudo cp -a dist/. /var/www/gouo/
sudo chown -R root:root /var/www/gouo
sudo find /var/www/gouo -type d -exec chmod 755 {} +
sudo find /var/www/gouo -type f -exec chmod 644 {} +
```

发布前先确认 `npm run build` 成功。不要手动编辑 `dist/`；所有前端变化都应从源码重新构建。

## 8. 构建 One Hub 管理端

```bash
cd /opt/gouo/src/server/web
corepack enable
corepack yarn install --frozen-lockfile
corepack yarn build
test -f build/index.html
```

这一阶段生成 `/opt/gouo/src/server/web/build`。管理端构建失败时不要继续构建 Go 后端，否则可能嵌入旧页面或缺少页面。

## 9. 构建 Go 后端

```bash
cd /opt/gouo/src/server
CGO_ENABLED=1 go build -trimpath -ldflags "-s -w" -o /tmp/gouo-server .
sudo install -o root -g root -m 0755 /tmp/gouo-server /opt/gouo/bin/gouo-server
test -x /opt/gouo/bin/gouo-server
```

Go 构建会把上一步的 `server/web/build` 嵌入二进制。以后只要管理端发生变化，就必须重新执行第 8、9 步。

## 10. 创建 systemd 服务

创建 `/etc/systemd/system/gouo.service`：

```ini
[Unit]
Description=Gouo Canvas Backend
After=network-online.target mysql.service redis-server.service
Wants=network-online.target

[Service]
Type=simple
User=gouo
Group=gouo
WorkingDirectory=/var/lib/gouo
EnvironmentFile=/etc/gouo/gouo.env
ExecStart=/opt/gouo/bin/gouo-server
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/gouo
UMask=0027

[Install]
WantedBy=multi-user.target
```

启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now gouo
sudo systemctl status gouo --no-pager
curl -fsS http://127.0.0.1:3000/api/status
```

查看日志：

```bash
sudo journalctl -u gouo -n 200 --no-pager
sudo journalctl -u gouo -f
```

如果服务无法写入图片，检查 `GOUO_ASSET_DIR` 的所有者和 systemd 的 `ReadWritePaths` 是否覆盖该目录。

## 11. 配置 Nginx

创建 `/etc/nginx/sites-available/gouo`：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name 你的域名;

    root /var/www/gouo;
    index index.html;
    client_max_body_size 32m;

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }

    location /v1/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

启用站点并检查：

```bash
sudo ln -s /etc/nginx/sites-available/gouo /etc/nginx/sites-enabled/gouo
sudo nginx -t
sudo systemctl reload nginx
curl -fsS -H 'Host: 你的域名' http://127.0.0.1/api/status
```

这里故意没有把 `/panel` 转发到公网域名。管理端继续通过后端本机端口和 SSH 隧道访问，减少管理入口暴露面。

## 12. 配置 HTTPS

使用你的证书管理工具为域名签发证书，并把 HTTP 永久重定向到 HTTPS。无论使用 Certbot、Caddy 还是云负载均衡，都要保留第 11 步中的 `/api`、`/v1`、请求体大小和超时配置。

配置完成后验证：

```bash
curl -I http://你的域名/
curl -I https://你的域名/
curl -fsS https://你的域名/api/status
```

预期 HTTP 返回 301 或 308，HTTPS 页面和状态接口正常。

## 13. 安全访问管理端

当前后端进程会监听主机的 3000 端口，因此必须在云安全组和主机防火墙中禁止公网访问 3000，只允许 Nginx 本机反向代理。确认 SSH 端口已经放行后，可以使用以下 UFW 规则作为参考：

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw deny 3000/tcp
```

不要在未确认 SSH 规则时贸然启用防火墙，否则可能把自己锁在服务器外。配置完成后，在自己的电脑执行：

```bash
ssh -L 3000:127.0.0.1:3000 你的服务器用户@服务器地址
```

然后打开：

```text
http://127.0.0.1:3000/panel
```

首次登录后立即修改 `root` 默认密码 `123456`，再按照[统一配置顺序](./DEPLOYMENT.md#部署后的统一配置顺序)配置渠道、模型、价格和用户策略。

## 14. 备份

创建备份目录：

```bash
sudo mkdir -p /var/backups/gouo
sudo chmod 700 /var/backups/gouo
```

为了得到一致的数据库与图片快照，先在 Nginx 或上层负载均衡启用维护页，然后暂时停止后端：

```bash
sudo systemctl stop gouo
```

备份数据库：

```bash
mysqldump --single-transaction --routines --triggers -h 127.0.0.1 -ugouo -p gouo | gzip > /var/backups/gouo/gouo-db-$(date +%F-%H%M%S).sql.gz
```

备份资产目录：

```bash
sudo tar -C /var/lib/gouo -czf /var/backups/gouo/gouo-assets-$(date +%F-%H%M%S).tar.gz assets
sudo systemctl start gouo
curl -fsS http://127.0.0.1:3000/api/status
```

备份环境和服务配置时应加密保存：

```text
/etc/gouo/gouo.env
/etc/systemd/system/gouo.service
/etc/nginx/sites-available/gouo
```

数据库和资产目录必须在同一个维护窗口备份并成对恢复。备份完成后复制到异地位置，并定期演练恢复。

## 15. 恢复演练和灾备恢复

优先在隔离服务器上恢复。必须在原服务器恢复时，确认数据库归档和资产归档来自同一个维护窗口，然后启用维护页并停止后端：

```bash
sudo systemctl stop gouo
```

先额外保存当前故障现场，再恢复数据库：

```bash
mysqldump --single-transaction --routines --triggers -h 127.0.0.1 -ugouo -p gouo | gzip > /var/backups/gouo/before-restore-db-$(date +%F-%H%M%S).sql.gz
gunzip -c /var/backups/gouo/选定的数据库备份.sql.gz | mysql -h 127.0.0.1 -ugouo -p gouo
```

保留当前资产目录并恢复选定归档：

```bash
sudo mv /var/lib/gouo/assets /var/lib/gouo/assets.before-restore
sudo tar -C /var/lib/gouo -xzf /var/backups/gouo/选定的资产备份.tar.gz
sudo chown -R gouo:gouo /var/lib/gouo/assets
sudo chmod 750 /var/lib/gouo/assets
```

如果 `assets.before-restore` 已存在，请先改为带日期的唯一名称。确认恢复文件不是空目录后再启动：

```bash
sudo systemctl start gouo
sudo systemctl status gouo --no-pager
curl -fsS http://127.0.0.1:3000/api/status
```

最后使用测试账号检查登录、余额、任务、缩略图、原图和回收站。全部正确后再关闭维护页；失败时停止服务并使用 `before-restore` 现场副本返回恢复前状态。

## 16. 日常升级

升级前完成数据库和资产备份，并记录旧提交：

```bash
cd /opt/gouo/src
git rev-parse HEAD
git status --short
```

确认生产目录没有未提交修改后：

```bash
git pull --ff-only
npm ci
npm run build
cd server/web
corepack yarn install --frozen-lockfile
corepack yarn build
cd ..
CGO_ENABLED=1 go build -trimpath -ldflags "-s -w" -o /tmp/gouo-server .
```

先停止后端，原子替换二进制和前端目录，再启动：

```bash
sudo systemctl stop gouo
sudo install -o root -g root -m 0755 /tmp/gouo-server /opt/gouo/bin/gouo-server
sudo find /var/www/gouo -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
sudo cp -a /opt/gouo/src/dist/. /var/www/gouo/
sudo chown -R root:root /var/www/gouo
sudo systemctl start gouo
sudo systemctl status gouo --no-pager
curl -fsS http://127.0.0.1:3000/api/status
```

升级后检查 Nginx、登录、生成、计费、云端同步和管理端作品读取。

## 17. 回滚

1. 停止公网流量或临时关闭注册和生成。
2. 保存故障版本的 systemd 日志和提交号。
3. 切换到上一个已验证的 Git 标签或提交，重新执行前端、管理端和 Go 构建。
4. 替换二进制和静态文件后重启服务。
5. 如果升级包含不兼容数据库变化，同时恢复升级前成对保存的数据库与资产目录。
6. 完成状态接口、登录、生成和作品读取验证后再恢复流量。

建议把每次发布的后端二进制和前端 `dist` 归档，回滚时仍要确认它们来自同一个 Git 提交。

## 18. 常见问题

### systemd 启动后立即退出

```bash
sudo systemctl status gouo --no-pager
sudo journalctl -u gouo -n 200 --no-pager
sudo -u gouo test -w /var/lib/gouo/assets
```

重点检查数据库 DSN、环境文件权限、资产目录权限和 3000 端口占用。

### 前端能打开但登录请求 404

确认 Nginx 存在 `/api/` 反向代理，且 `VITE_GOUO_BACKEND_URL` 在构建时为空。修改前端构建变量后需要重新运行 `npm run build` 并发布 `dist/`。

### 图片请求 413

Nginx 的 `client_max_body_size` 必须至少为 32 MB。若前面还有 CDN 或负载均衡，也要同步提高请求体限制。

### 图片生成超时

确认 `/v1/` 的 `proxy_read_timeout` 和 `proxy_send_timeout` 至少为 600 秒，并关闭代理缓冲。524 通常来自更上层的 CDN 或代理超时，还要检查域名前面的服务限制。

### 图片生成成功但云端不显示

```bash
sudo -u gouo test -w /var/lib/gouo/assets
sudo du -sh /var/lib/gouo/assets
sudo journalctl -u gouo -n 200 --no-pager
```

同时检查用户配额、单文件 25 MB 限制，以及数据库中任务和资产记录是否写入。

## 19. 手动部署验收清单

- [ ] MySQL 和 Redis 只监听本机或私网。
- [ ] 后端由 `gouo` 非登录用户运行，环境文件权限为 `640`。
- [ ] `/var/lib/gouo/assets` 可写但没有被 Nginx 静态公开。
- [ ] Nginx 只公开 80/443，HTTPS 和重定向正常。
- [ ] `/api/status` 通过域名和后端本机地址都能访问。
- [ ] 管理端只能通过受控入口访问，默认密码已修改。
- [ ] 渠道、模型映射、生成、编辑、变体和计费测试通过。
- [ ] 云端作品能够跨浏览器恢复，管理端可以查看输出图。
- [ ] 数据库和资产目录已完成成套备份与恢复演练。
- [ ] 已完成[生产上线检查清单](./PRODUCTION_CHECKLIST.md)。
