# Gouo Canvas development guide

[简体中文](../zh-CN/development.md) · [Documentation index](../README.md)

## 1. Requirements

- Node.js 22
- npm (the repository has `package-lock.json`; do not use yarn or pnpm for the root frontend)
- Go 1.25 when running `server/`
- Git

The frontend uses React 19, Vite 6, TypeScript, Zustand, and Tailwind CSS. The backend in `server/` is derived from One Hub and uses Go, Gin, and GORM. It has its own upstream conventions and dependencies.

## 2. Two runtime modes

The frontend intentionally retains two different modes. Establish the active mode before changing or debugging behavior.

| Mode | `VITE_GOUO_BACKEND_ENABLED` | Accounts and cloud sync | API configuration |
| --- | --- | --- | --- |
| Full product mode | `true` | Enabled | Managed by the platform; hidden in the frontend |
| Frontend-only development mode | `false` or unset | Disabled | Entered by the user in Settings |

Production uses full product mode. Frontend-only mode is for provider compatibility, proxy, streaming, and custom-provider development. Do not document its direct API-key workflow as the normal hosted-user experience.

## 3. Run full product mode

### 3.1 Start the backend

Local development can omit `SQL_DSN` to use SQLite. Redis is also optional locally.

```powershell
Set-Location server
$env:SESSION_SECRET = '<at-least-32-random-characters>'
$env:USER_TOKEN_SECRET = '<a-different-at-least-32-character-secret>'
$env:GOUO_IMAGE_PRICE_CNY = '0.10'
go run .
```

The backend listens on `http://127.0.0.1:3000` by default. An empty database creates administrator `root` with password `123456`. Change it on first login even in a local environment.

### 3.2 Start the frontend

From the repository root:

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

The example contains:

```dotenv
VITE_GOUO_BACKEND_ENABLED=true
VITE_GOUO_BACKEND_URL=
VITE_GOUO_BACKEND_DEV_TARGET=http://127.0.0.1:3000
VITE_GOUO_IMAGE_MODEL=gpt-image-2
```

Open `http://127.0.0.1:5173`. Vite proxies same-origin `/api`, `/v1`, and `/panel` requests to the backend, avoiding cross-origin login-cookie setup.

### 3.3 Configure an image channel

Sign into `http://127.0.0.1:3000/panel` as an administrator, then:

1. Add an OpenAI or compatible image channel.
2. Store the upstream API key only in the backend channel.
3. Expose the model selected by `VITE_GOUO_IMAGE_MODEL`, using a model mapping when required.
4. Validate generations, edits, and variations routes.
5. Use a regular account at `http://127.0.0.1:5173` to test login, generation, billing, and synchronization end to end.

## 4. Run frontend-only development mode

Use the following `.env.local`:

```dotenv
VITE_GOUO_BACKEND_ENABLED=false
VITE_GOUO_BACKEND_URL=
VITE_GOUO_BACKEND_DEV_TARGET=
```

Then run:

```powershell
npm install
npm run dev
```

This mode skips the login gate and exposes API settings for OpenAI-compatible, fal.ai, and custom provider profiles. Configuration and tasks remain in browser IndexedDB/localStorage; they do not enter the Gouo cloud library.

If data appears to change after switching modes, do not assume that user isolation failed. Product mode uses account-scoped local storage while frontend-only mode uses a separate local scope. Export important data before clearing storage, and inspect the current origin's storage in browser developer tools when debugging.

## 5. Local API proxy

Direct browser requests can be blocked by CORS. Copy the development proxy example:

```powershell
Copy-Item dev-proxy.config.example.json dev-proxy.config.json
```

Example:

```json
{
  "enabled": true,
  "prefix": "/api-proxy",
  "target": "http://127.0.0.1:3000",
  "changeOrigin": true,
  "secure": false
}
```

`dev-proxy.config.json` is ignored by Git. Point `target` only at a service you trust and do not commit credentials. The proxy addresses routing and CORS; it does not add account isolation and does not hide an API key that the browser itself stores.

## 6. Environment variables

### Product mode

| Variable | Read by | Description |
| --- | --- | --- |
| `VITE_GOUO_BACKEND_ENABLED` | Frontend build/dev | Enables product mode only when exactly `true` |
| `VITE_GOUO_BACKEND_URL` | Frontend build/dev | Backend base URL; empty for same-origin use |
| `VITE_GOUO_BACKEND_DEV_TARGET` | Vite dev server | Local proxy target for `/api`, `/v1`, and `/panel` |
| `VITE_GOUO_IMAGE_MODEL` | Frontend build/dev | Image model requested in product mode |

### Frontend-only compatibility variables

The code also supports `VITE_DEFAULT_API_URL`, `VITE_API_PROXY_AVAILABLE`, `VITE_API_PROXY_LOCKED`, and `VITE_SHOW_DEFAULT_CONFIG_ONLY` for default profiles and proxy restrictions. They do not replace backend authentication.

Use the root `Dockerfile` and `deploy/docker-compose.yml` for the current production product. Do not mix older frontend-only container parameters into the full-stack Compose instructions.

## 7. Repository layout

```text
.
├─ src/
│  ├─ components/       React components
│  ├─ hooks/            custom hooks
│  ├─ lib/              API, sync, database, and pure utilities
│  ├─ store.ts          Zustand state and action entry points
│  └─ types.ts          shared TypeScript types
├─ public/              PWA manifest, icons, and service worker
├─ scripts/             local helpers and mock API
├─ deploy/              full-stack Compose, Nginx, and env examples
├─ docs/                bilingual Gouo documentation
├─ server/              One Hub-derived backend and admin frontend
├─ Dockerfile           production public-frontend image
└─ vite.config.ts       Vite and local proxy configuration
```

Do not edit `dist/`; Vite generates it. `server/` has a separate `AGENTS.md`, which also applies before any backend change.

## 8. Data flow and persistence

- `src/store.ts` owns application state and primary actions.
- `src/lib/db.ts` wraps IndexedDB. Schema changes require a version upgrade and migration for old data.
- `normalize*` functions sanitize legacy localStorage/IndexedDB values; do not remove compatibility branches casually.
- In product mode, `src/lib/cloudSync.ts` synchronizes account-scoped tasks, images, and collections.
- A browser cache is not a server backup. A synchronization failure can leave work only in the browser.

Put new pure or shared logic in `src/lib/` instead of expanding `src/store.ts`. Shared types belong in `src/types.ts`; local types belong near the top of their file.

## 9. Commands

```powershell
npm run dev
npm run build
npm test
npm run test:watch
npm run mock:api
npm run preview
```

The normal verification order is:

```powershell
npm run build
npm test
```

For Markdown-only changes, still validate links and commands. If documentation accompanies a behavior change, run build, tests, and manual checks in proportion to that change.

## 10. Pre-commit checklist

- No `.env.local`, `dev-proxy.config.json`, database, log, or secret is staged.
- Documented variables, ports, and paths match code and Compose configuration.
- Chinese and English documents were updated together.
- `dist/` was not edited manually.
- The root uses npm. Only the upstream `server/web` admin project continues to use Yarn according to its own instructions.
- Build and relevant tests pass.
