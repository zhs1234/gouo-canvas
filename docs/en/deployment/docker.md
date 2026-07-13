# Gouo Canvas Docker Compose deployment

[简体中文](../../zh-CN/deployment/docker.md) · [Deployment overview](./index.md) · [Documentation index](../../README.md)

This guide applies only to `deploy/docker-compose.yml`. It runs four services on one server:

- `web`: the public Gouo frontend and internal Nginx, container port 80.
- `backend`: the Gouo/One Hub Go service and admin panel, container port 3000.
- `db`: MySQL 8.4.
- `redis`: Redis 7.4 with AOF enabled.

Compose creates three persistent volumes: `mysql-data`, `redis-data`, and `backend-data`. Recreating containers does not remove them. `docker compose down -v` does remove them and must not be used casually in production.

## 1. Prepare the server

Install:

- Git
- Docker Engine
- Docker Compose v2, invoked as `docker compose`
- OpenSSL

Verify:

```bash
git --version
docker version
docker compose version
openssl version
```

The first build downloads Node, Go, Alpine, MySQL, and Redis images and builds both frontend applications plus the Go backend. Provide adequate disk and at least 4 GiB RAM. Swap can help a one-time build but is not a substitute for operating memory.

Do not open ports 3000, 3306, or 6379 in the firewall.

## 2. Clone and record a version

```bash
sudo mkdir -p /opt/gouo
sudo chown "$USER":"$USER" /opt/gouo
git clone https://github.com/zhs1234/gouo-canvas.git /opt/gouo/app
cd /opt/gouo/app
git rev-parse HEAD
```

Record the commit in the release log. Do not edit production checkout files directly; make and commit changes in a development environment, then deploy a known commit or tag.

## 3. Create the production environment

```bash
cd /opt/gouo/app/deploy
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
openssl rand -hex 32
```

Edit `/opt/gouo/app/deploy/.env`:

```dotenv
# Bind to loopback when an outer Caddy, Nginx, or load balancer terminates HTTPS.
PUBLIC_PORT=127.0.0.1:8080

# Compose already binds the admin backend to loopback.
BACKEND_ADMIN_PORT=3000

GOUO_IMAGE_MODEL=gpt-image-2
GOUO_IMAGE_PRICE_CNY=0.10
GOUO_CLOUD_LIBRARY_ENABLED=true
GOUO_ASSET_DIR=/data/gouo-assets
GOUO_ASSET_USER_QUOTA_BYTES=2147483648
GOUO_ASSET_MAX_FILE_BYTES=26214400
GOUO_ASSET_MAX_TASK_FILES=32

MYSQL_PASSWORD=replace-with-a-strong-database-password
MYSQL_ROOT_PASSWORD=replace-with-another-strong-password
SESSION_SECRET=replace-with-the-first-random-value
USER_TOKEN_SECRET=replace-with-the-second-random-value
```

| Variable | Recommended value | Important behavior |
| --- | --- | --- |
| `PUBLIC_PORT` | `127.0.0.1:8080` behind a host proxy; `8080` only for temporary private-network testing | Plain `8080` listens on every interface |
| `BACKEND_ADMIN_PORT` | `3000` | Compose binds it to `127.0.0.1`; do not expose it publicly |
| `GOUO_IMAGE_MODEL` | The model actually enabled in One Hub | Embedded in the web build; changing it requires rebuilding `web` |
| `GOUO_IMAGE_PRICE_CNY` | Your price per successful request | Restart backend after changing; validate upstream cost first |
| `GOUO_ASSET_DIR` | `/data/gouo-assets` | `/data` is backed by `backend-data`; do not move it outside the mounted path |
| `MYSQL_PASSWORD` | Strong application-database password | Prefer long alphanumeric text that does not create DSN parsing ambiguity |
| `SESSION_SECRET` | First random value | Changing it invalidates all login sessions |
| `USER_TOKEN_SECRET` | Second, different random value | Changing it invalidates user relay tokens |

Check for placeholders without printing every secret:

```bash
grep -n 'replace-with' .env
```

Continue only when there is no output. Never paste the expanded environment into public logs, tickets, or chat.

## 4. Validate Compose

```bash
cd /opt/gouo/app/deploy
docker compose config --quiet
docker compose pull db redis
```

Use `config --quiet`, not a copied full `docker compose config` output, because expansion can reveal passwords and secrets.

## 5. Build and start

```bash
cd /opt/gouo/app/deploy
docker compose up -d --build
docker compose ps
```

The first build can take several minutes. All four services should reach `Up`; `backend`, `db`, and `redis` should become healthy.

Inspect startup failures:

```bash
docker compose logs --tail=200 backend
docker compose logs --tail=100 db
docker compose logs --tail=100 redis
```

Redact credentials, tokens, DSNs, and private links before sharing logs.

## 6. Verify locally

```bash
curl -fsS http://127.0.0.1:8080/
curl -fsS http://127.0.0.1:8080/api/status
curl -fsS http://127.0.0.1:3000/api/status
```

Expected:

- The first request returns frontend HTML.
- Both status routes report success.
- The status route through 8080 proves that internal Nginx forwards `/api` correctly.

Replace 8080 if `PUBLIC_PORT` uses another port.

## 7. Reach the admin panel safely

Keep the backend port bound to server loopback. From your workstation:

```bash
ssh -L 3000:127.0.0.1:3000 your-user@your-server
```

Keep the SSH session open and visit:

```text
http://127.0.0.1:3000/panel
```

An empty database creates `root` with password `123456`. Change it immediately, then follow the [post-start configuration order](./index.md#configuration-order-after-first-start). Never change the Compose backend mapping to `0.0.0.0:3000:3000` for convenience.

## 8. Add a domain and HTTPS

Use host Caddy/Nginx, Nginx Proxy Manager, or a cloud load balancer to terminate HTTPS and proxy the entire origin to:

```text
http://127.0.0.1:8080
```

The outer proxy must:

- Permanently redirect HTTP to HTTPS.
- Preserve `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto`.
- Accept request bodies of at least 32 MiB so a 25 MiB asset reaches the backend.
- Set `/v1/` read/send timeouts to at least 600 seconds and disable proxy buffering.
- Set `/api/` read timeout to at least 300 seconds.
- Keep backend 3000, MySQL 3306, and Redis 6379 private.

Verify after certificate setup:

```bash
curl -I https://your-domain.example/
curl -fsS https://your-domain.example/api/status
```

## 9. Verify persistent assets

```bash
cd /opt/gouo/app/deploy
docker compose exec backend sh -c 'test -d /data/gouo-assets && test -w /data/gouo-assets'
docker compose exec backend sh -c 'du -sh /data/gouo-assets'
docker volume ls
```

Create a regular user and generate a test image. In the Gouo storage admin view, verify that:

- Task count increases.
- Asset count increases.
- User storage usage increases.
- Artwork inspection loads the output.

Never map `/data/gouo-assets` into public Nginx or return server filesystem paths to users.

## 10. Back up

Create a restricted backup directory:

```bash
sudo mkdir -p /var/backups/gouo
sudo chmod 700 /var/backups/gouo
cd /opt/gouo/app/deploy
```

To keep database relationships and image files at one point in time, enable a maintenance page in the outer proxy or stop the public web service:

```bash
docker compose stop web
```

Do not modify users, artwork, or quotas through the admin panel during the backup window.

Dump MySQL:

```bash
docker compose exec -T db sh -c 'mysqldump --single-transaction --routines --triggers -uroot -p"$MYSQL_ROOT_PASSWORD" gouo' > /var/backups/gouo/gouo-db-$(date +%F-%H%M%S).sql
```

Archive the asset directory, then reopen the web service:

```bash
docker compose exec -T backend tar -C /data -czf - gouo-assets > /var/backups/gouo/gouo-assets-$(date +%F-%H%M%S).tar.gz
docker compose start web
```

Backup policy:

- Mark the database dump and asset archive as one backup set.
- Copy backup sets to another machine or object storage.
- Run a full isolated restore drill at least quarterly.
- Keep an encrypted backup of `.env` because it contains signing secrets.
- Redis is not the system of record and cannot replace the MySQL backup.

## 11. Restore or run a disaster-recovery drill

Prefer an isolated server. On the production host, first select a database and asset archive from the same maintenance window, then stop public writes:

```bash
cd /opt/gouo/app/deploy
docker compose stop web backend
```

Take an additional snapshot of the failed current state before overwriting anything.

Restore MySQL:

```bash
docker compose exec -T db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" gouo' < /var/backups/gouo/selected-database-backup.sql
```

Start the loopback-only backend and copy the asset archive into it:

```bash
docker compose start backend
docker compose cp /var/backups/gouo/selected-assets-backup.tar.gz backend:/tmp/gouo-assets-restore.tar.gz
```

Preserve the current asset directory, then extract the backup:

```bash
docker compose exec backend sh -c 'mv /data/gouo-assets /data/gouo-assets.before-restore && tar -C /data -xzf /tmp/gouo-assets-restore.tar.gz'
docker compose restart backend
```

If `gouo-assets.before-restore` already exists, choose a unique date-stamped name instead of overwriting it.

Verify before reopening traffic:

```bash
curl -fsS http://127.0.0.1:3000/api/status
docker compose start web
curl -fsS http://127.0.0.1:8080/api/status
```

Use a test account to inspect login, balance, task count, thumbnails, originals, and recycle bin. If validation fails, stop writes and return to the preserved pre-restore state.

## 12. Upgrade

Back up the database and `/data`, then record the current commit:

```bash
cd /opt/gouo/app
git rev-parse HEAD
git status --short
```

The production checkout must be clean. Then:

```bash
git pull --ff-only
cd deploy
docker compose build --pull
docker compose up -d
docker compose ps
curl -fsS http://127.0.0.1:8080/api/status
```

Manually test sign-in, image generation, charging, failure refund, cloud synchronization, and admin artwork inspection.

For a backend-only environment change:

```bash
docker compose up -d backend
```

`GOUO_IMAGE_MODEL` is a frontend build argument, so rebuild `web` after changing it:

```bash
docker compose up -d --build web
```

## 13. Roll back

1. Stop public writes.
2. Preserve logs and the failing commit SHA.
3. For code-only failure, switch to a previously verified tag or commit and rebuild.
4. If the release performed an incompatible data migration, restore the pre-upgrade database and `/data` as one backup set.
5. Verify status, login, generation, charging, and artwork reads before reopening traffic.

A running container does not prove rollback success; database relationships and files must match.

## 14. Troubleshooting

### `backend` never becomes healthy

```bash
docker compose logs --tail=200 backend
docker compose ps db redis
docker compose exec db sh -c 'mysqladmin ping -h localhost -uroot -p"$MYSQL_ROOT_PASSWORD"'
```

Common causes are unchanged placeholders, incomplete first-time MySQL initialization, full disk, or an unwritable `/data`.

### Login expires immediately

Confirm that `SESSION_SECRET` is fixed and identical across all backend instances. Do not generate it at every start.

### Generation succeeds but cloud synchronization fails

```bash
docker compose exec backend sh -c 'echo "$GOUO_CLOUD_LIBRARY_ENABLED"; echo "$GOUO_ASSET_DIR"; test -w "$GOUO_ASSET_DIR"'
docker compose logs --tail=200 backend
```

Also check the user's quota and the 25 MiB single-file limit.

### The domain opens but `/api` returns 404

Proxy the entire public origin to `127.0.0.1:8080`, not only the static home page. Internal Nginx handles `/api` and `/v1`.

### `docker compose down` was run accidentally

Plain `down` preserves named volumes; run `docker compose up -d` again. If `down -v` was used, restore the deleted volumes from backup.

## 15. Docker acceptance checklist

- [ ] All four services run and health checks pass.
- [ ] Public access is limited to 80/443; 8080 and 3000 are loopback-only.
- [ ] HTTPS and HTTP redirect work.
- [ ] Bootstrap administrator password has been changed.
- [ ] Provider, model mapping, and all three image routes pass.
- [ ] Successful charge and failure refund are correct.
- [ ] Cloud tasks, references, and collections restore in another browser.
- [ ] Administrators can inspect user outputs while regular users cannot call admin routes.
- [ ] One paired database-and-asset backup and restore drill has succeeded.
- [ ] The [production checklist](./checklist.md) is complete.
