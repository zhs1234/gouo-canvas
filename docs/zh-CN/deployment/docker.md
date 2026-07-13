# 光构 Docker Compose 部署

[English](../../en/deployment/docker.md) · [部署总览](./index.md) · [文档中心](../../README.md)

本教程只适用于仓库提供的 `deploy/docker-compose.yml`。它会在一台服务器上启动四个服务：

- `web`：光构公开前端和内部 Nginx，容器端口 80。
- `backend`：光构 Go 后端和 One Hub 管理端，容器端口 3000。
- `db`：MySQL 8.4。
- `redis`：Redis 7.4，开启 AOF。

Docker Compose 会创建 `mysql-data`、`redis-data` 和 `backend-data` 三个持久卷。停止或重建容器不会自动删除这些卷，但执行 `docker compose down -v` 会删除它们，生产环境禁止随意执行该命令。

## 1. 准备服务器

在服务器安装以下软件：

- Git。
- Docker Engine。
- Docker Compose v2，命令格式应为 `docker compose`。
- OpenSSL，用于生成密钥。

确认安装结果：

```bash
git --version
docker version
docker compose version
openssl version
```

注意事项：

- 当前 Compose 会在服务器本地构建前端、后端和管理端，首次构建需要下载 Node、Go、Alpine、MySQL 和 Redis 镜像。
- 磁盘空间不足或内存小于 4 GB 时，第一次构建可能失败。必要时先增加交换空间，但交换空间不能替代长期内存容量。
- 防火墙暂时不要开放 3000、3306 和 6379。

## 2. 获取代码并固定版本

```bash
sudo mkdir -p /opt/gouo
sudo chown "$USER":"$USER" /opt/gouo
git clone https://github.com/zhs1234/gouo-canvas.git /opt/gouo/app
cd /opt/gouo/app
git rev-parse HEAD
```

把最后输出的提交号记录到发布记录中。生产服务器不要直接修改仓库文件；需要改代码时先在开发环境提交，再在服务器拉取明确版本。

## 3. 创建生产环境变量

```bash
cd /opt/gouo/app/deploy
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
openssl rand -hex 32
```

编辑 `/opt/gouo/app/deploy/.env`：

```dotenv
# 如果服务器前面还有 Caddy、Nginx Proxy Manager 或云负载均衡，绑定本机即可。
PUBLIC_PORT=127.0.0.1:8080

# 后端管理端只绑定本机，远程访问使用 SSH 隧道。
BACKEND_ADMIN_PORT=3000

GOUO_IMAGE_MODEL=gpt-image-2
GOUO_IMAGE_PRICE_CNY=0.10
GOUO_CLOUD_LIBRARY_ENABLED=true
GOUO_ASSET_DIR=/data/gouo-assets
GOUO_ASSET_USER_QUOTA_BYTES=2147483648
GOUO_ASSET_MAX_FILE_BYTES=26214400
GOUO_ASSET_MAX_TASK_FILES=32

MYSQL_PASSWORD=替换为数据库用户强密码
MYSQL_ROOT_PASSWORD=替换为另一个数据库管理员强密码
SESSION_SECRET=替换为第一段随机值
USER_TOKEN_SECRET=替换为第二段随机值
```

每项配置的作用：

| 变量 | 应该怎么填 | 需要注意 |
| --- | --- | --- |
| `PUBLIC_PORT` | 有外层 HTTPS 代理时用 `127.0.0.1:8080`；临时局域网测试可用 `8080` | 使用 `8080` 会监听所有网卡，不应长期裸露在公网 |
| `BACKEND_ADMIN_PORT` | 一般保持 `3000` | Compose 已固定绑定 `127.0.0.1`，不要改成公网地址 |
| `GOUO_IMAGE_MODEL` | One Hub 渠道中实际开放的模型名 | 前端构建时写入，修改后必须重新构建 `web` |
| `GOUO_IMAGE_PRICE_CNY` | 每次成功图片请求的人民币售价 | 修改后重启后端；上线前要确认能够覆盖上游成本 |
| `GOUO_ASSET_DIR` | 保持 `/data/gouo-assets` | `/data` 已挂载 `backend-data`，不要改到未挂载目录 |
| `MYSQL_PASSWORD` | 数据库业务账号密码 | 建议使用不含换行和 DSN 歧义字符的长随机值 |
| `SESSION_SECRET` | 第一段至少 32 字节的随机值 | 更换后所有登录 Cookie 失效 |
| `USER_TOKEN_SECRET` | 第二段不同的随机值 | 更换后现有用户中继令牌失效 |

检查是否还有示例占位符：

```bash
grep -n 'replace-with\|替换为' .env
```

命令没有输出才可以继续。不要运行会把完整 `.env` 输出到公开日志的命令。

## 4. 检查 Compose 配置

```bash
cd /opt/gouo/app/deploy
docker compose config --quiet
docker compose pull db redis
```

`docker compose config --quiet` 只检查配置是否合法。不要把 `docker compose config` 的完整输出贴到聊天或工单，因为展开后的内容可能包含真实密码和密钥。

## 5. 第一次构建和启动

```bash
cd /opt/gouo/app/deploy
docker compose up -d --build
docker compose ps
```

第一次构建通常需要几分钟。`docker compose ps` 中四个服务都应为 `Up`，`backend`、`db` 和 `redis` 最终应显示 `healthy`。

如果后端还在启动，查看日志：

```bash
docker compose logs --tail=200 backend
docker compose logs --tail=100 db
docker compose logs --tail=100 redis
```

不要在公开工单中粘贴包含渠道 Key、用户令牌或数据库连接串的日志。

## 6. 验证服务

在服务器本机执行：

```bash
curl -fsS http://127.0.0.1:8080/
curl -fsS http://127.0.0.1:8080/api/status
curl -fsS http://127.0.0.1:3000/api/status
```

预期结果：

- 第一个命令返回光构前端 HTML。
- 后两个命令返回成功状态。
- `http://127.0.0.1:8080/api/status` 证明内部 Nginx 已正确转发 `/api`。

如果 `PUBLIC_PORT` 使用了其他端口，请相应替换 `8080`。

## 7. 安全访问管理端

后端管理端口只绑定服务器本机。请在自己的电脑建立 SSH 隧道：

```bash
ssh -L 3000:127.0.0.1:3000 你的服务器用户@服务器地址
```

保持 SSH 会话打开，然后在本机浏览器访问：

```text
http://127.0.0.1:3000/panel
```

首次空数据库会创建管理员 `root`，默认密码是 `123456`。登录后第一件事必须是修改密码。完成后按照[部署入口页的统一配置顺序](./index.md#部署后的统一配置顺序)添加渠道并测试图片请求。

不要为了方便而把 Compose 中的后端端口改成 `0.0.0.0:3000:3000`。

## 8. 配置域名和 HTTPS

推荐在 Compose 外层使用 Caddy、Nginx Proxy Manager、宿主机 Nginx或云负载均衡终止 HTTPS，然后把所有请求转发到：

```text
http://127.0.0.1:8080
```

外层代理必须满足：

- HTTP 永久重定向到 HTTPS。
- 保留 `Host`、`X-Forwarded-For` 和 `X-Forwarded-Proto`。
- 请求体上限至少 32 MB，否则 25 MB 图片会在到达后端前被拒绝。
- `/v1/` 的读取和发送超时至少 600 秒，并关闭代理缓冲。
- `/api/` 的读取超时至少 300 秒。
- 不单独公开后端 3000 端口、MySQL 3306 或 Redis 6379。

证书配置完成后验证：

```bash
curl -I https://你的域名/
curl -fsS https://你的域名/api/status
```

## 9. 检查持久卷和云端图片

```bash
cd /opt/gouo/app/deploy
docker compose exec backend sh -c 'test -d /data/gouo-assets && test -w /data/gouo-assets'
docker compose exec backend sh -c 'du -sh /data/gouo-assets'
docker volume ls
```

随后使用普通用户生成一张测试图片，在管理端“运营 → 光构存储”检查：

- 任务数量增加。
- 图片资产数量增加。
- 用户已用空间增加。
- “查看作品”可以加载输出图。

不要把 `/data/gouo-assets` 配置为 Nginx 静态目录，也不要给用户返回服务器磁盘路径。

## 10. 备份

先创建只有管理员可读的备份目录：

```bash
sudo mkdir -p /var/backups/gouo
sudo chmod 700 /var/backups/gouo
cd /opt/gouo/app/deploy
```

为了让数据库记录与图片文件处于同一时间点，先在外层代理开启维护页，或暂时停止公开前端：

```bash
docker compose stop web
```

此时不要通过管理端修改用户、作品或配额。

备份 MySQL：

```bash
docker compose exec -T db sh -c 'mysqldump --single-transaction --routines --triggers -uroot -p"$MYSQL_ROOT_PASSWORD" gouo' > /var/backups/gouo/gouo-db-$(date +%F-%H%M%S).sql
```

备份云端图片目录：

```bash
docker compose exec -T backend tar -C /data -czf - gouo-assets > /var/backups/gouo/gouo-assets-$(date +%F-%H%M%S).tar.gz
docker compose start web
```

备份原则：

- 数据库和后端数据卷应在同一个维护窗口中备份，并成对标记时间。
- 定期把备份复制到另一台机器或对象存储，不要只放在原服务器磁盘。
- 至少每季度在隔离环境做一次完整恢复演练。
- `.env` 需要加密备份，因为丢失签名密钥会影响会话和令牌。
- Redis 不是作品和账户的最终数据源，不可用 Redis 备份代替 MySQL。

## 11. 恢复演练和灾备恢复

优先在隔离服务器上演练恢复。需要在原服务器恢复时，先确认选中的数据库备份和资产备份来自同一个维护窗口，然后停止公开流量：

```bash
cd /opt/gouo/app/deploy
docker compose stop web backend
```

在继续前，再为当前故障现场做一次额外快照，避免选错备份后无法返回。

恢复 MySQL：

```bash
docker compose exec -T db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" gouo' < /var/backups/gouo/选定的数据库备份.sql
```

启动仅供本机访问的后端，把资产归档复制进去：

```bash
docker compose start backend
docker compose cp /var/backups/gouo/选定的资产备份.tar.gz backend:/tmp/gouo-assets-restore.tar.gz
```

保留当前资产目录作为现场副本，再解压备份：

```bash
docker compose exec backend sh -c 'mv /data/gouo-assets /data/gouo-assets.before-restore && tar -C /data -xzf /tmp/gouo-assets-restore.tar.gz'
docker compose restart backend
```

如果 `gouo-assets.before-restore` 已存在，先把它改成带日期的唯一名称，不要覆盖旧现场。

验证后再恢复公开前端：

```bash
curl -fsS http://127.0.0.1:3000/api/status
docker compose start web
curl -fsS http://127.0.0.1:8080/api/status
```

最后使用测试账号检查登录、余额、任务数量、缩略图、原图和回收站。恢复失败时不要继续写入新数据，应停止服务并回到恢复前现场副本。

## 12. 日常升级

升级前先备份数据库和 `/data`，并记录当前提交：

```bash
cd /opt/gouo/app
git rev-parse HEAD
git status --short
```

生产目录应保持干净。确认没有未提交修改后执行：

```bash
git pull --ff-only
cd deploy
docker compose build --pull
docker compose up -d
docker compose ps
curl -fsS http://127.0.0.1:8080/api/status
```

升级后人工验证登录、图片生成、扣费、失败退款、云端同步和管理端作品查看。

如果只修改 `.env` 中的后端运行变量，执行：

```bash
docker compose up -d backend
```

如果修改了 `GOUO_IMAGE_MODEL`，它属于前端构建变量，必须重新构建：

```bash
docker compose up -d --build web
```

## 13. 回滚

1. 停止继续开放流量。
2. 保存故障版本日志和当前提交号。
3. 如果只是代码问题，切换到上一个已验证的 Git 标签或提交并重新构建。
4. 如果新版本执行了不兼容的数据迁移，必须同时恢复升级前的数据库和 `/data` 备份。
5. 恢复后重新验证 `/api/status`、登录、生成和作品读取。

不要把“容器能启动”当作回滚完成。数据库与图片目录必须保持匹配。

## 14. 常见问题

### `backend` 一直不健康

依次检查：

```bash
docker compose logs --tail=200 backend
docker compose ps db redis
docker compose exec db sh -c 'mysqladmin ping -h localhost -uroot -p"$MYSQL_ROOT_PASSWORD"'
```

常见原因是数据库密码仍为占位符、MySQL 第一次初始化未完成、磁盘已满或 `/data` 不可写。

### 登录后立刻失效

确认 `SESSION_SECRET` 有固定值且所有后端实例一致。不要在每次启动时重新生成。

### 图片能生成但无法同步云端

检查：

```bash
docker compose exec backend sh -c 'echo "$GOUO_CLOUD_LIBRARY_ENABLED"; echo "$GOUO_ASSET_DIR"; test -w "$GOUO_ASSET_DIR"'
docker compose logs --tail=200 backend
```

同时在管理端确认用户配额未满、单文件没有超过 25 MB。

### 域名能打开但 `/api` 返回 404

外层代理必须把整个域名转发到 `127.0.0.1:8080`，不要只转发静态首页。Compose 内部 Nginx 会继续处理 `/api` 和 `/v1`。

### 误执行了 `docker compose down`

普通 `down` 不删除卷，可以再次运行 `docker compose up -d`。如果执行了 `down -v`，持久卷已被删除，只能从备份恢复。

## 15. Docker 路线验收清单

- [ ] 四个 Compose 服务正常，健康检查通过。
- [ ] 公网只开放 80/443，8080 和 3000 仅本机可访问。
- [ ] HTTPS 和 HTTP 重定向正常。
- [ ] 默认管理员密码已修改。
- [ ] 上游渠道、模型映射和三种图片接口测试通过。
- [ ] 成功请求扣费、失败请求退款正确。
- [ ] 云端作品、参考图和收藏夹能够跨浏览器恢复。
- [ ] 管理端可以查看用户输出作品，但普通用户不能访问管理接口。
- [ ] 数据库和 `/data` 已完成一次成套备份与恢复演练。
- [ ] 已完成[生产上线检查清单](./checklist.md)。
