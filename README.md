# Gouo Canvas

> Turn ideas into images.

[简体中文](./README.zh-CN.md) · **English** · [Documentation](./docs/README.md)

Gouo Canvas is an AI image creation workspace for text-to-image generation, reference-image editing, masked edits, and asset management. Its production mode combines a React frontend with a Go backend based on One Hub, so platform API keys stay on the server while each user gets an isolated account, balance, relay token, and cloud library.

![Gouo Canvas logo](./docs/images/gouo-logo-source.png)

## Highlights

- Text-to-image generation, reference-image editing, variations, and masked edits
- Up to 16 reference images with explicit image mentions in prompts
- Size, quality, output format, transparency, compression, moderation, and output-count controls
- Searchable gallery, collections, batch selection, ZIP export, retries, and reusable task settings
- Username/password accounts, balance display, redemption codes, and usage history
- Cloud synchronization for tasks, outputs, references, masks, thumbnails, and collections
- Recoverable recycle bin and per-user cloud storage quotas
- Installable PWA with responsive desktop and mobile layouts
- A separate frontend-only development mode for direct API profile testing

## Architecture

```text
Browser (React 19 + Vite 6 + TypeScript + Zustand)
  ├─ /api/*  → authentication, users, balance, cloud library
  └─ /v1/*   → OpenAI-compatible image endpoints
                     ↓
             Gouo backend (Go / One Hub)
               ├─ MySQL or SQLite
               ├─ Redis (optional for local development)
               ├─ private image asset directory
               └─ upstream image providers
```

Production deployments should use one public origin. The reverse proxy serves the frontend and forwards `/api` and `/v1` to the backend. Upstream API keys are configured only in the One Hub admin panel.

## Quick start

Requirements:

- Node.js 22 and npm
- Go 1.25 for the backend
- Git

Start the backend with SQLite for local development:

```powershell
Set-Location server
$env:SESSION_SECRET = '<at-least-32-random-characters>'
$env:USER_TOKEN_SECRET = '<a-different-at-least-32-character-secret>'
go run .
```

In a second terminal, start the frontend:

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api`, `/v1`, and `/panel` to the target in `VITE_GOUO_BACKEND_DEV_TARGET`, which defaults to `http://127.0.0.1:3000`.

An empty backend database creates the administrator `root` with password `123456`. This is only an initialization credential: change it immediately, and never expose an installation that still uses the default password.

For detailed setup, full-stack and frontend-only modes, and repository structure, see the [development guide](./docs/en/development.md).

## Verify changes

```powershell
npm run build
npm test
```

Backend smoke checks used by this repository:

```powershell
Set-Location server
go test ./controller -run '^$'
go test ./relay/relay_util -run '^TestGetFixedImageQuota$'
```

## Deploy

Choose one production path and follow it from start to finish:

- [Docker Compose](./docs/en/deployment/docker.md) — recommended for a new single-server deployment
- [Manual Linux deployment](./docs/en/deployment/manual.md) — for operators who manage Nginx, systemd, MySQL, and Redis directly

Read the [deployment overview](./docs/en/deployment/index.md) before choosing, then complete the [production checklist](./docs/en/deployment/checklist.md) before opening registration or payments.

## Configuration

### Frontend build variables

| Variable | Purpose |
| --- | --- |
| `VITE_GOUO_BACKEND_ENABLED` | Enables the login gate, backend relay, and account-scoped storage |
| `VITE_GOUO_BACKEND_URL` | Optional cross-origin backend base URL; leave empty for same-origin production |
| `VITE_GOUO_BACKEND_DEV_TARGET` | Local Vite proxy target |
| `VITE_GOUO_IMAGE_MODEL` | Image model requested by production-mode clients |

### Backend variables

| Variable | Purpose |
| --- | --- |
| `SESSION_SECRET` | Session-cookie signing secret; keep stable and private |
| `USER_TOKEN_SECRET` | Per-user relay-token signing secret; keep stable and private |
| `GOUO_IMAGE_PRICE_CNY` | Fixed charge for each successful image request |
| `GOUO_CLOUD_LIBRARY_ENABLED` | Enables account cloud-library endpoints |
| `GOUO_ASSET_DIR` | Private directory for synchronized image files |
| `GOUO_ASSET_USER_QUOTA_BYTES` | Default per-user cloud storage quota |
| `GOUO_ASSET_MAX_FILE_BYTES` | Maximum size of one synchronized asset |
| `GOUO_ASSET_MAX_TASK_FILES` | Maximum number of assets attached to one task |
| `SQL_DSN` | MySQL/PostgreSQL connection string; unset uses SQLite |
| `REDIS_CONN_STRING` | Redis connection string |

Examples are provided in [`.env.example`](./.env.example) and [`deploy/.env.example`](./deploy/.env.example). Never commit real environment files, credentials, databases, logs, or private keys.

## Documentation

- [Documentation index](./docs/README.md)
- [User guide](./docs/en/user-guide.md)
- [Development guide](./docs/en/development.md)
- [Backend integration](./docs/en/backend.md)
- [Testing and local mock API](./docs/en/testing.md)
- [Deployment overview](./docs/en/deployment/index.md)
- [Changelog](./CHANGELOG.md)

The files under `server/docs/` document the upstream One Hub project. They are retained as upstream reference material and are not the deployment guide for Gouo Canvas.

## Data and security boundaries

- In production mode, signed-in users synchronize their library to the backend. IndexedDB remains a cache and retry queue; unsynchronized items can exist only in the original browser.
- In frontend-only mode, settings, tasks, and images stay in the browser unless the configured provider stores request data.
- The local asset backend is suitable for one backend instance. Multiple instances need a shared filesystem or a future object-storage implementation.
- A fixed user price is not the same as upstream cost. Operators must validate model, quality, size, and edit costs before enabling paid use.
- Payments require a configured payment provider, verified callbacks, published pricing, refund terms, and an operator reconciliation process. Redemption codes are the safer default before that work is complete.

## License and acknowledgements

The frontend is derived from [GPT Image Playground](https://github.com/CookSleep/gpt_image_playground) and is redistributed under the MIT License. The backend is derived from [One Hub](https://github.com/MartialBE/one-hub); its source tree retains its Apache-2.0 license and original notices. See [LICENSE](./LICENSE) and the license files under `server/`.
