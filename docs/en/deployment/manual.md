# Gouo Canvas manual Linux deployment

[简体中文](../../zh-CN/deployment/manual.md) · [Deployment overview](./index.md) · [Documentation index](../../README.md)

This path runs Node.js, Go, MySQL, Redis, Nginx, and systemd directly on a Linux host. Commands target Ubuntu/Debian; other distributions need equivalent package commands, while service relationships and environment variables remain the same.

The deployment has three build outputs:

1. The root React frontend builds to `dist/` and is served by Nginx.
2. The One Hub admin frontend in `server/web` builds to `server/web/build/`.
3. The Go backend in `server/` embeds that admin build and runs on port 3000 under systemd.

Always build the admin frontend before the Go binary, or the binary can embed an old or missing admin UI.

## 1. Install system software

Install:

- Git
- Node.js 22 and npm
- Corepack and Yarn 1.22.22 for `server/web` only
- Go 1.25
- GCC and C development libraries; the SQLite driver requires a CGO toolchain even if production uses MySQL
- MySQL 8
- Redis 7
- Nginx
- OpenSSL

Verify:

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

Keep versions aligned with repository Dockerfiles and use trusted package sources.

## 2. Create a service user and directories

```bash
sudo useradd --system --home /var/lib/gouo --shell /usr/sbin/nologin gouo
sudo mkdir -p /opt/gouo/src /opt/gouo/bin /var/lib/gouo/assets /var/lib/gouo/logs /var/www/gouo /etc/gouo
sudo chown -R "$USER":"$USER" /opt/gouo/src
sudo chown -R gouo:gouo /var/lib/gouo
sudo chmod 750 /var/lib/gouo /var/lib/gouo/assets
sudo chmod 750 /etc/gouo
```

| Path | Purpose | Owner/access |
| --- | --- | --- |
| `/opt/gouo/src` | Git checkout and build directory | Deployment user |
| `/opt/gouo/bin` | Published backend binary | Root writes, service reads |
| `/var/www/gouo` | Public frontend files | Root writes, Nginx reads |
| `/var/lib/gouo/assets` | Private user images | `gouo` reads/writes |
| `/var/lib/gouo/logs` | Backend logs | `gouo` reads/writes |
| `/etc/gouo/gouo.env` | Backend secrets and connection strings | Root manages, `gouo` reads |

Nginx must never serve `/var/lib/gouo/assets` as static files.

## 3. Clone the repository

```bash
git clone https://github.com/zhs1234/gouo-canvas.git /opt/gouo/src
cd /opt/gouo/src
git rev-parse HEAD
git status --short
```

Record the commit and require a clean worktree. The production server is not a development workspace.

## 4. Initialize MySQL

Enter the MySQL administrative shell:

```bash
sudo mysql
```

Run the following with a real password:

```sql
CREATE DATABASE gouo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'gouo'@'127.0.0.1' IDENTIFIED BY 'replace-with-a-strong-password';
GRANT ALL PRIVILEGES ON gouo.* TO 'gouo'@'127.0.0.1';
FLUSH PRIVILEGES;
```

Verify the application account:

```bash
mysql -h 127.0.0.1 -ugouo -p gouo -e 'SELECT 1;'
```

- Do not run the backend as MySQL `root`.
- Keep MySQL on loopback or a private network.
- Prefer a long alphanumeric password to avoid DSN parsing ambiguity.
- For a remote database, allow only backend private IPs and enable transport encryption and database firewall rules.

## 5. Configure Redis

For one host, bind Redis to `127.0.0.1`, enable AOF, and manage it with systemd:

```bash
sudo systemctl enable --now redis-server
redis-cli ping
```

Expected: `PONG`.

If Redis requires a password, the later environment uses:

```dotenv
REDIS_CONN_STRING=redis://:your-redis-password@127.0.0.1:6379
```

Redis does not contain final account, balance, or artwork records and cannot replace MySQL backups.

## 6. Create the backend environment file

Generate two different secrets:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Create `/etc/gouo/gouo.env`:

```dotenv
PORT=3000
GIN_MODE=release
TZ=Asia/Shanghai

SQL_DSN=gouo:replace-with-the-database-password@tcp(127.0.0.1:3306)/gouo?charset=utf8mb4&parseTime=True&loc=Local
REDIS_CONN_STRING=redis://127.0.0.1:6379

SESSION_SECRET=replace-with-the-first-random-value
USER_TOKEN_SECRET=replace-with-the-second-different-random-value

GOUO_IMAGE_PRICE_CNY=0.10
GOUO_CLOUD_LIBRARY_ENABLED=true
GOUO_ASSET_DIR=/var/lib/gouo/assets
GOUO_ASSET_USER_QUOTA_BYTES=2147483648
GOUO_ASSET_MAX_FILE_BYTES=26214400
GOUO_ASSET_MAX_TASK_FILES=32
LOG_DIR=/var/lib/gouo/logs
```

Protect it:

```bash
sudo chown root:gouo /etc/gouo/gouo.env
sudo chmod 640 /etc/gouo/gouo.env
```

Requirements:

- `SESSION_SECRET` and `USER_TOKEN_SECRET` are different and stable.
- The environment file never enters Git.
- `GOUO_ASSET_DIR` is absolute, writable, and included in backup.
- Local-file assets support one backend instance. Multiple instances require a shared filesystem.
- `GOUO_IMAGE_PRICE_CNY` is the customer price, not upstream cost.

## 7. Build the public frontend

```bash
cd /opt/gouo/src
npm ci
```

Create a production-only `.env.production.local`:

```dotenv
VITE_GOUO_BACKEND_ENABLED=true
VITE_GOUO_BACKEND_URL=
VITE_GOUO_IMAGE_MODEL=gpt-image-2
```

Leave `VITE_GOUO_BACKEND_URL` empty for same-origin production so the browser requests `/api` and `/v1` on the current domain. The model must match backend channel configuration.

Build and publish:

```bash
npm run build
sudo find /var/www/gouo -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
sudo cp -a dist/. /var/www/gouo/
sudo chown -R root:root /var/www/gouo
sudo find /var/www/gouo -type d -exec chmod 755 {} +
sudo find /var/www/gouo -type f -exec chmod 644 {} +
```

Do not publish after a failed build, and never edit `dist/` directly.

## 8. Build the One Hub admin frontend

```bash
cd /opt/gouo/src/server/web
corepack enable
corepack yarn install --frozen-lockfile
corepack yarn build
test -f build/index.html
```

Stop here if `server/web/build/index.html` is missing. Continuing could embed an old or absent admin UI.

## 9. Build the Go backend

```bash
cd /opt/gouo/src/server
CGO_ENABLED=1 go build -trimpath -ldflags "-s -w" -o /tmp/gouo-server .
sudo install -o root -g root -m 0755 /tmp/gouo-server /opt/gouo/bin/gouo-server
test -x /opt/gouo/bin/gouo-server
```

The binary embeds the admin build from the previous step. Repeat both steps whenever the admin frontend changes.

## 10. Create the systemd service

Create `/etc/systemd/system/gouo.service`:

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

Start and verify:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now gouo
sudo systemctl status gouo --no-pager
curl -fsS http://127.0.0.1:3000/api/status
```

Logs:

```bash
sudo journalctl -u gouo -n 200 --no-pager
sudo journalctl -u gouo -f
```

If asset writes fail, check directory ownership and that `ReadWritePaths` covers `GOUO_ASSET_DIR`.

## 11. Configure Nginx

Create `/etc/nginx/sites-available/gouo`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name your-domain.example;

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

Enable and test:

```bash
sudo ln -s /etc/nginx/sites-available/gouo /etc/nginx/sites-enabled/gouo
sudo nginx -t
sudo systemctl reload nginx
curl -fsS -H 'Host: your-domain.example' http://127.0.0.1/api/status
```

The public Nginx configuration deliberately does not proxy `/panel`. Reach the admin panel through backend loopback and an SSH tunnel.

## 12. Add HTTPS

Use your certificate manager to issue a certificate and permanently redirect HTTP to HTTPS. Whether using Certbot, Caddy, or a cloud load balancer, preserve the `/api`, `/v1`, body-size, and timeout behavior above.

Verify:

```bash
curl -I http://your-domain.example/
curl -I https://your-domain.example/
curl -fsS https://your-domain.example/api/status
```

HTTP should return 301 or 308. HTTPS content and status should work.

## 13. Protect and reach the admin panel

The backend listens on host port 3000. Deny public access to it in both cloud security groups and the host firewall while allowing Nginx loopback access. After confirming SSH remains allowed, UFW rules can resemble:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw deny 3000/tcp
```

Do not enable a firewall before confirming SSH access or you may lock yourself out.

From your workstation:

```bash
ssh -L 3000:127.0.0.1:3000 your-user@your-server
```

Then open:

```text
http://127.0.0.1:3000/panel
```

Immediately change the `root` password from `123456`, then follow the [post-start configuration order](./index.md#configuration-order-after-first-start).

## 14. Back up

```bash
sudo mkdir -p /var/backups/gouo
sudo chmod 700 /var/backups/gouo
```

Enable a maintenance page, then stop the backend for a consistent database-and-assets point in time:

```bash
sudo systemctl stop gouo
```

Dump MySQL:

```bash
mysqldump --single-transaction --routines --triggers -h 127.0.0.1 -ugouo -p gouo | gzip > /var/backups/gouo/gouo-db-$(date +%F-%H%M%S).sql.gz
```

Archive assets and restart:

```bash
sudo tar -C /var/lib/gouo -czf /var/backups/gouo/gouo-assets-$(date +%F-%H%M%S).tar.gz assets
sudo systemctl start gouo
curl -fsS http://127.0.0.1:3000/api/status
```

Also keep encrypted backups of:

```text
/etc/gouo/gouo.env
/etc/systemd/system/gouo.service
/etc/nginx/sites-available/gouo
```

Treat database and assets as one backup set, copy it off-host, and run periodic restore drills.

## 15. Restore or run a disaster-recovery drill

Prefer an isolated server. For an in-place restore, select a database and asset archive from the same window, enable maintenance, and stop the backend:

```bash
sudo systemctl stop gouo
```

Take another dump of the failed current state, then restore the selected database:

```bash
mysqldump --single-transaction --routines --triggers -h 127.0.0.1 -ugouo -p gouo | gzip > /var/backups/gouo/before-restore-db-$(date +%F-%H%M%S).sql.gz
gunzip -c /var/backups/gouo/selected-database-backup.sql.gz | mysql -h 127.0.0.1 -ugouo -p gouo
```

Preserve current assets and restore the selected archive:

```bash
sudo mv /var/lib/gouo/assets /var/lib/gouo/assets.before-restore
sudo tar -C /var/lib/gouo -xzf /var/backups/gouo/selected-assets-backup.tar.gz
sudo chown -R gouo:gouo /var/lib/gouo/assets
sudo chmod 750 /var/lib/gouo/assets
```

Choose a unique date-stamped preservation path if `assets.before-restore` already exists. Verify the restored directory is non-empty, then:

```bash
sudo systemctl start gouo
sudo systemctl status gouo --no-pager
curl -fsS http://127.0.0.1:3000/api/status
```

Use a test account to inspect login, balance, tasks, thumbnails, originals, and recycle bin. Reopen traffic only after all checks pass.

## 16. Upgrade

Back up first, then record the old commit:

```bash
cd /opt/gouo/src
git rev-parse HEAD
git status --short
```

Require a clean checkout, then rebuild all three outputs:

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

Stop the backend, replace binary and static files, then restart:

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

After upgrade, validate Nginx, sign-in, generation, billing, cloud synchronization, and admin artwork inspection.

## 17. Roll back

1. Stop public writes or temporarily disable registration and generation.
2. Preserve systemd logs and the failing commit SHA.
3. Switch to a previously verified tag or commit and rebuild frontend, admin UI, and backend.
4. Replace the binary and static files, then restart.
5. If the release includes an incompatible data change, restore the paired pre-upgrade database and asset backup.
6. Verify status, login, generation, charge, and artwork reads before reopening traffic.

Archiving the binary and public `dist` from each release speeds code rollback, but they still need to come from the same recorded commit.

## 18. Troubleshooting

### systemd exits immediately

```bash
sudo systemctl status gouo --no-pager
sudo journalctl -u gouo -n 200 --no-pager
sudo -u gouo test -w /var/lib/gouo/assets
```

Inspect the database DSN, environment permissions, asset ownership, and port 3000 conflicts.

### Frontend opens but login returns 404

Confirm that Nginx has the `/api/` proxy and that `VITE_GOUO_BACKEND_URL` was empty at build time. Rebuild and republish `dist/` after changing a frontend build variable.

### Upload returns 413

Set `client_max_body_size` to at least 32 MiB and raise the limit in every CDN or load balancer in front of Nginx.

### Image generation times out

Keep `/v1/` `proxy_read_timeout` and `proxy_send_timeout` at 600 seconds or more and disable buffering. A 524 often comes from a CDN or outer proxy, so inspect every layer.

### Generation succeeds but cloud artwork is missing

```bash
sudo -u gouo test -w /var/lib/gouo/assets
sudo du -sh /var/lib/gouo/assets
sudo journalctl -u gouo -n 200 --no-pager
```

Also inspect user quota, the 25 MiB file limit, and task/asset database records.

## 19. Manual-deployment acceptance checklist

- [ ] MySQL and Redis listen only on loopback or a private network.
- [ ] Backend runs as non-login user `gouo`; environment permissions are `640`.
- [ ] `/var/lib/gouo/assets` is writable but not served by Nginx.
- [ ] Nginx exposes only 80/443; HTTPS and redirect work.
- [ ] `/api/status` works through both domain and backend loopback.
- [ ] Admin UI is available only through a controlled path and bootstrap password is changed.
- [ ] Provider, model mapping, generation, edit, variation, and billing tests pass.
- [ ] Cloud artwork restores in another browser and administrators can inspect outputs.
- [ ] A paired database-and-assets backup and restore drill has succeeded.
- [ ] The [production checklist](./checklist.md) is complete.
