# Gouo Canvas

[简体中文](./README.zh-CN.md) · **English** · [Documentation](./docs/README.md)

An AI creation app with three workspaces: image generation, an infinite canvas, and Agent. Built with React and a Go backend derived from One Hub. Accounts, balances, and cloud libraries are managed by the backend; platform API keys stay on the server.

- **Generate images**: text-to-image generation, reference-image and masked editing, and library management.
- **Canvas**: reuse Infinite Canvas's interface and interactions to organize images, text, and connections across projects.
- **Agent**: a centered composer before the first message, then a conversation with a bottom composer. Chat, submit image tasks, and edit a linked canvas through the platform API, without installing local Codex or Claude.

![Gouo Canvas logo](./docs/images/gouo-logo-source.png)

[Live demo](https://canvas.wcnmb.top/) — an account is required; image generation uses your balance.

## Preview

Public sign-in page, captured on 2026-09-30. No private account data is shown.

![Gouo Canvas sign-in page](./docs/images/demo-login.png)

## Run locally

Requires Node.js 22, npm, Git, and Go 1.25. The commands below use PowerShell, starting at the repository root.

Start the backend (SQLite by default; Redis is optional locally):

```powershell
Set-Location server
$env:SESSION_SECRET = '<at-least-32-random-characters>'
$env:USER_TOKEN_SECRET = '<a-different-at-least-32-character-secret>'
go run .
```

In a second terminal at the repository root:

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api`, `/v1`, and `/panel` to `VITE_GOUO_BACKEND_DEV_TARGET` (default: `http://127.0.0.1:3000`).

An empty database creates `root` / `123456`. **Change this password immediately, before exposing the service.** In `http://127.0.0.1:3000/panel`, configure an image channel and its upstream API key, matching `VITE_GOUO_IMAGE_MODEL`. Generation needs a working channel and account balance.

See the [development guide](./docs/en/development.md) for full setup, frontend-only mode, and frontend variables. Backend settings, cloud storage limits, and backups are in the [backend guide](./docs/en/backend.md); environment examples are in [`.env.example`](./.env.example) and [`deploy/.env.example`](./deploy/.env.example).

### Enable Agent models

In the backend admin panel, configure a text model's pricing, available channel, and model information: include `"text"` in `output_modalities` and `"tools"` in `tags`. For vision input, also include `"image"` in `input_modalities`. The channel must actually support streaming tool calls, and the account group and token must allow access. Administrators maintain these capability flags; the server does not probe upstream capabilities.

`GET /api/gouo/agent/models` publishes only eligible text models, separately from the image model catalog; the list stays empty until configured. Conversations use the existing `/v1/chat/completions` endpoint and platform text-usage billing. Image tool calls are billed separately at image prices.

### Free local mock

The bundled mock listens only on localhost and never forwards requests upstream. It needs no real API keys or account balance. Create `.env.mock.local` at the repository root, leaving your existing `.env.local` unchanged:

```dotenv
VITE_GOUO_BACKEND_ENABLED=true
VITE_GOUO_BACKEND_URL=
VITE_GOUO_BACKEND_DEV_TARGET=http://127.0.0.1:5190
VITE_GOUO_IMAGE_MODEL=gpt-image-2
VITE_CANVAS_ENABLED=true
VITE_AGENT_ENABLED=true
```

Run these commands in separate terminals:

```powershell
# Terminal 1: local mock API
node scripts/mock-workspace-api.mjs
```

```powershell
# Terminal 2: frontend in mock mode
npm run dev -- --mode mock --host 127.0.0.1 --port 5175 --strictPort
```

Open `http://127.0.0.1:5175` and confirm that the account and model names contain `MOCK`. Try `生成一张图片` to generate a fixture image, `画布添加文字` after linking a canvas, or `慢速` to test stopping a stream. Run `node scripts/mock-workspace-api.mjs --self-test` for the standalone self-test. Images come from the repository; displayed balances and prices are test data. This mode does not validate real providers, actual billing, or cloud document synchronization.

The mock account supports image request status, usage filters/pagination, display name changes, test redemption, test password changes, and logout/login. Initial credentials are `MOCK-local` / `MOCK-password-123`; redeem `MOCK-TOPUP-10` once for test credit. State is in memory and resets on server restart; a browser cookie retains logout status. Registration, email, CAPTCHA, and cloud storage are not enabled in this mock and require an isolated real backend for acceptance testing. Image edits validate uploads and return the first reference image unchanged with an explicit mock explanation; this is not evidence of model understanding. The rule-based Agent splits canvas operations into batches of at most 50, subject to the existing eight-tool-call limit per turn.

## Checks

```powershell
npm run build
npm test

# Backend smoke checks, from server/
Set-Location server
go test ./controller -run '^$'
go test ./relay/relay_util -run '^TestGetFixedImageQuota$'
```

## Deploy

Use one public origin: serve the frontend and proxy `/api` and `/v1` to the backend. Configure upstream keys only in the backend admin panel.

Choose [Docker Compose](./docs/en/deployment/docker.md) or [manual Linux deployment](./docs/en/deployment/manual.md). Read the [deployment overview](./docs/en/deployment/index.md) and complete the [production checklist](./docs/en/deployment/checklist.md) before opening registration or payments.

- Keep session and relay-token secrets stable and private. Never commit real environment files, credentials, databases, logs, or private keys.
- In product mode, unsynchronized work may exist only in the browser; IndexedDB is a cache, not a backup. In frontend-only mode, data stays in the browser unless the provider stores request data.
- The local asset directory supports one backend instance. Multiple instances need shared storage.
- Fixed user pricing is separate from upstream cost. Validate costs for each model, quality, size, and edit type. Payments need a configured provider, verified callbacks, public pricing and refund terms, and reconciliation; use redemption codes until this is ready.

### Data upgrades and disabling entries

Browser IndexedDB upgrades to **DB 5**, adding canvas project storage while preserving existing tasks, images, and raw legacy conversation records. Only supported conversation formats appear in the new interface; legacy records are not executed automatically. **ZIP 4** backups include tasks, images, canvases, and supported Agent conversations, and still accept ZIP 2 and 3 imports. Unsupported legacy conversation records remain in the browser and are excluded from new ZIP exports.

Before upgrading, back up browser work and the backend database and asset directory. To roll back the interface, set `VITE_CANVAS_ENABLED=false` or `VITE_AGENT_ENABLED=false`, then rebuild and deploy (restart the server in development). This closes the corresponding entries and preserves documents. Keep the current data layer: do not lower `DB_VERSION`, clear browser storage, or overwrite it with an older implementation that may fail to open DB 5. These flags control frontend entries, not backend authorization.

## More documentation

[User guide](./docs/en/user-guide.md) · [Testing and mock API](./docs/en/testing.md) · [Changelog](./CHANGELOG.md)

`server/docs/` belongs to upstream One Hub; use the Gouo deployment guides linked above for this project.

## License

The frontend is derived from [GPT Image Playground](https://github.com/CookSleep/gpt_image_playground) under MIT. The backend is derived from [One Hub](https://github.com/MartialBE/one-hub) under Apache-2.0, with its original notices retained. See [LICENSE](./LICENSE) and the license files in `server/`.

The canvas reuses [Infinite Canvas](https://github.com/basketikun/infinite-canvas), pinned to upstream commit `dab19adc0847e32e39b7fc8ff90cb392561fb826`. Its MIT license is retained in [LICENSE.infinite-canvas](./src/lib/canvas/LICENSE.infinite-canvas); adaptations are recorded in [UPSTREAM.md](./src/lib/canvas/UPSTREAM.md). Distribution includes the [third-party notices](./public/third-party-notices.txt).
