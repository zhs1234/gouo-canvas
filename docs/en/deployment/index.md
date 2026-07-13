# Gouo Canvas deployment overview

[简体中文](../../zh-CN/deployment/index.md) · [Documentation index](../../README.md)

Gouo Canvas supports two production paths. Their directories, process managers, build steps, and upgrade commands differ. Choose one path and follow only that guide; do not combine commands from both.

## Choose a deployment path

| Path | Best for | Advantages | You operate |
| --- | --- | --- | --- |
| [Docker Compose](./docker.md) | New deployments, one production server, fast setup | Consistent services; frontend, backend, MySQL, and Redis start together | Docker, DNS, HTTPS, backups, and host security |
| [Manual Linux deployment](./manual.md) | Operators experienced with Linux, systemd, and Nginx | Independent control over processes, directories, logs, and databases | Node.js, Go, MySQL, Redis, Nginx, systemd, and upgrades |

Use Docker Compose unless you have a concrete operational reason to manage every component directly. Manual deployment is not a shorter Docker alternative.

## Shared production requirements

Both paths require:

1. A Linux server. Start with at least 2 CPU cores and 4 GiB RAM, plus enough disk for database data, build caches, backups, and user images.
2. A domain whose DNS resolves to the public server or load balancer.
3. Only ports 80 and 443 exposed publicly. MySQL, Redis, and backend port 3000 must remain private.
4. Two different high-entropy secrets, `SESSION_SECRET` and `USER_TOKEN_SECRET`, each at least 32 random bytes.
5. A working OpenAI-compatible image provider, API key, and actual model ID.
6. One point-in-time backup plan covering both the database and `GOUO_ASSET_DIR`.

Generate two secrets on the server:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Store the outputs separately. Never copy example values, commit production secrets, or expose them in screenshots, tickets, or chat.

## Configuration order after first start

A running service is not ready for public registration. Configure it in this order:

1. Reach the One Hub admin panel `/panel` through localhost or an SSH tunnel.
2. Sign in with the bootstrap account and immediately change the `root` password from `123456`.
3. Add the upstream channel and map `gpt-image-2`, or the model selected for your deployment.
4. Validate generation, edit, and variation endpoints.
5. Validate fixed price, successful charge, failure refund, and insufficient balance.
6. In the Gouo storage admin view, verify asset writes, per-user quota, and artwork inspection.
7. Configure HTTPS, backups, monitoring, firewall, and rate limits.
8. With a regular account, test registration, sign-in, generation, synchronization, recycle bin, and cross-browser restore.
9. Complete the [production checklist](./checklist.md) before opening registration.

## Critical data

| Data | Purpose | Backup requirement |
| --- | --- | --- |
| MySQL database | Users, channels, tokens, balance, logs, tasks, and asset relationships | Required |
| `GOUO_ASSET_DIR` | Outputs, references, masks, thumbnails, and partial images | Required at the same point in time as the database |
| `SESSION_SECRET` | Session-cookie signing | Store securely; changing it signs all users out |
| `USER_TOKEN_SECRET` | Per-user relay-token signing | Store securely; changing it invalidates existing tokens |
| Redis | Cache and multi-instance coordination | Preserve configuration; it does not replace the database |
| Frontend build and backend binary | Deployed version | Rebuildable from a recorded commit, but record every release SHA |

Never expose the asset directory through Nginx. Images must be read through authenticated routes such as `/api/gouo/assets/:id/content`.

## Continue

- Docker: start at [Docker Compose deployment](./docker.md).
- No Docker: start at [manual Linux deployment](./manual.md).
- Provider, billing, and storage behavior: [backend integration](../backend.md).
- Before launch: [production checklist](./checklist.md).
