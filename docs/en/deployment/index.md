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
4. A high-entropy `SESSION_SECRET` of at least 32 random bytes.
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

1. Reach the New API admin panel at the backend root through localhost or an SSH tunnel.
2. Sign in with the bootstrap account and immediately change the `root` password from `123456`.
3. In Settings → System Settings, set Server Address to the public URL of the Gouo client (for example `https://your-domain.com`). Do not keep the default `http://localhost:3000` or use the SSH tunnel address. Password-reset emails, low-balance emails, and payment callbacks build their links from it; it is also the admin OIDC callback, so sign in to the admin panel with a password.
4. Add the upstream channel and map `gpt-image-2`, or the model selected for your deployment. Then price models in New API's model pricing (tag image models `edit`/`mask` and Agent models `tools` in Models as needed), and set the default image model, redemption instructions, and support contact under 光构 → 光构设置 (Gouo settings); see the [backend guide](../backend.md#3-admin-panel).
5. Validate the generation and edit endpoints.
6. Validate each model's price, output limit, price-change confirmation, successful charge, failure refund, and insufficient balance.
7. In 光构 → 光构存储 (Gouo storage), verify asset writes, per-user quota, and artwork inspection.
8. Configure HTTPS, backups, monitoring, firewall, and rate limits.
9. With a regular account, test registration, sign-in, generation, synchronization, recycle bin, and cross-browser restore.
10. Complete the [production checklist](./checklist.md) before opening registration.

## Critical data

| Data | Purpose | Backup requirement |
| --- | --- | --- |
| MySQL database | Users, channels, tokens, balance, logs, tasks, and asset relationships | Required |
| `GOUO_ASSET_DIR` | Outputs, references, masks, and the 24-hour image result cache under `image-results` (up to 4 GB) | Required at the same point in time as the database |
| `SESSION_SECRET` | Session-cookie signing | Store securely; changing it signs all users out |
| Redis | Cache and multi-instance coordination | Preserve configuration; it does not replace the database |
| Frontend build and backend binary | Deployed version | Rebuildable from a recorded commit, but record every release SHA |

Never expose the asset directory through Nginx. Images must be read through authenticated routes such as `/api/gouo/assets/:id/content`.

## Continue

- Docker: start at [Docker Compose deployment](./docker.md).
- No Docker: start at [manual Linux deployment](./manual.md).
- Provider, billing, and storage behavior: [backend integration](../backend.md).
- Before launch: [production checklist](./checklist.md).
