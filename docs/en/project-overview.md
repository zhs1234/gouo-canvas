# Gouo Canvas project overview

[简体中文](../zh-CN/project-overview.md) · [Documentation index](../README.md)

Gouo Canvas is an AI image workspace with accounts, balance settlement, and a cloud library. Users enter prompts, edit reference images and masks, and organize artwork in the React frontend. The Go backend, derived from One Hub, handles authentication, channel selection, upstream requests, and data ownership. Configured upstream services provide image models; this repository does not contain model training or inference services.

This document helps maintainers and new contributors understand the product scope, code ownership, main data flows, and deployment boundaries. It was checked on 2026-10-05 against source and existing documentation at `main` commit `67cd4d1`. Live configuration and production behavior were not verified during this review.

## Product scope

| Area | Existing entry points and behavior | Main code |
| --- | --- | --- |
| Accounts | Login, registration, email verification and password reset according to backend capabilities | [BackendAuthGate.tsx](../../src/components/BackendAuthGate.tsx) |
| Image creation | Text-to-image, reference-image editing, masked editing, size, quality, and output-format controls | [InputBar.tsx](../../src/components/InputBar.tsx), [MaskEditorModal.tsx](../../src/components/MaskEditorModal.tsx) |
| Tasks and artwork | Status, error details, retries, parameter reuse, search, filters, downloads, and recycle-bin restoration | [store.ts](../../src/store.ts), [TaskGrid.tsx](../../src/components/TaskGrid.tsx) |
| Collections and data | Collections, batch actions, ZIP data import and export | [favorites](../../src/components/favorites), [DataSettingsTab.tsx](../../src/components/settings/DataSettingsTab.tsx) |
| User center | Balance, current image price, redemption codes, usage history, and account settings | [UserCenterModal.tsx](../../src/components/UserCenterModal.tsx) |
| Cloud library | Task and image synchronization, storage usage, and account isolation | [cloudSync.ts](../../src/lib/cloudSync.ts), [gouo_cloud.go](../../server/controller/gouo_cloud.go) |
| Admin application | One Hub user, channel, and quota administration, plus Gouo storage management | [server/web](../../server/web), [api-router.go](../../server/router/api-router.go) |

The frontend also includes an inspiration library, onboarding, dark theme, and PWA installation. The service worker caches pages and static assets while bypassing `/api`, `/v1`, and `/panel`; it does not generate images offline. See [main.tsx](../../src/main.tsx) and [sw.js](../../public/sw.js).

## Runtime modes

| Setting | Full product mode | Frontend-only development mode |
| --- | --- | --- |
| Switch | `VITE_GOUO_BACKEND_ENABLED=true` | `false` or unset |
| Identity | Backend Cookie session; login is checked before opening the workspace | No product login gate |
| Image configuration | Backend channels; default model `gpt-image-2` | User-configured OpenAI-compatible, fal.ai, or custom providers |
| API keys | Platform upstream keys remain on the server; the browser uses a user relay token | Provider credentials supplied by the user may enter local browser settings |
| Data | Local cache scoped to the account, plus the cloud library when enabled | Data in the current browser |
| Use | Hosted product and account/billing integration | Protocol compatibility, streaming, async polling, and mock API debugging |

Vite reads the mode at startup or build time. Restart the development server after changing `.env.local`; rebuild production frontend assets after changing `VITE_*` configuration. Never put backend channel secrets in `VITE_*` variables.

The modes use separate storage scopes. Product mode uses `gouo-canvas:user:<user ID>`; frontend-only mode uses `gouo-canvas`. Seeing different artwork after changing modes or accounts does not, by itself, prove data loss. See [storageScope.ts](../../src/lib/storageScope.ts) and the [development guide](./development.md).

## Technology and code ownership

The repository contains three independent dependency and build units.

| Unit | Stack | Dependencies and output |
| --- | --- | --- |
| Public frontend | React 19, TypeScript, Vite 6, Zustand, Tailwind CSS 3 | npm and root `package-lock.json`; outputs `dist/` |
| Product backend | Go 1.25, Gin, GORM, derived from One Hub | `server/go.mod` and `go.sum`; compiles to a Go executable |
| Admin frontend | React 18, Vite 7, MUI 5, Redux | Yarn 1.22.22 and `server/web/yarn.lock`; outputs `server/web/build/` |

[server/main.go](../../server/main.go) embeds the admin build with `go:embed`. Generate `server/web/build/` before building or running the backend for the first time. The public frontend and admin application are separate applications; a root `npm ci` does not install all repository dependencies.

| Directory or file | Responsibility | Typical changes |
| --- | --- | --- |
| [src/main.tsx](../../src/main.tsx), [src/App.tsx](../../src/App.tsx) | Entry point, authentication gate, initialization, and synchronization startup | Application startup |
| [src/store.ts](../../src/store.ts) | State, task submission/execution, retries, collections, and import/export | Creation and task workflows |
| [src/types.ts](../../src/types.ts) | Settings, providers, task parameters, and records | Data structures |
| [src/lib/api.ts](../../src/lib/api.ts) | Image request dispatch and refresh/retry for invalid relay tokens | Request routing and errors |
| [src/lib/openaiCompatibleImageApi.ts](../../src/lib/openaiCompatibleImageApi.ts), [falAiImageApi.ts](../../src/lib/falAiImageApi.ts) | Protocol adapters, image extraction, and polling | Provider compatibility |
| [src/lib/db.ts](../../src/lib/db.ts), [cloudSync.ts](../../src/lib/cloudSync.ts) | IndexedDB, thumbnails, sync queue, and asset mapping | Persistence and synchronization |
| [src/lib/gouoBackend.ts](../../src/lib/gouoBackend.ts) | HTTP client for accounts, tokens, balances, and cloud data | Product APIs |
| [server/router](../../server/router), [middleware](../../server/middleware) | Routing, authentication, permissions, rate limits, and channel distribution | API entry and access control |
| [server/controller/gouo_cloud.go](../../server/controller/gouo_cloud.go), [model/gouo_cloud.go](../../server/model/gouo_cloud.go) | Gouo tasks, assets, collections, and storage quotas | Cloud library |
| [server/relay](../../server/relay), [providers](../../server/providers) | Upstream protocols, forwarding, and settlement | Channels and billing |
| [deploy](../../deploy), [Dockerfile](../../Dockerfile) | Containers, reverse proxy, and environment examples | Product deployment |

Follow the root [AGENTS.md](../../AGENTS.md) for frontend changes and [server/AGENTS.md](../../server/AGENTS.md) for backend/admin changes. New persisted fields must account for legacy normalization; IndexedDB schema changes require version and migration planning.

## Main workflows

### Login and account isolation

`main.tsx` wraps the workspace with `BackendAuthGate`. Product mode requests `GET /api/user/self` first and shows the login page if there is no session. Successful login activates the user's local storage scope. A scope change reloads the page before loading that account's data.

The frontend then obtains a user relay token from `GET /api/token/playground`. The backend finds or creates the user's `sys_playground` token and validates an existing token. Image calls use this token; account and cloud requests use the Cookie session. `UnlimitedQuota` removes a separate token-level cap; image calls still check the user's balance.

Account changes in another tab trigger a storage-scope check. Synchronization also confirms that the signed-in user matches the loaded local scope. Server `/api/gouo` routes use `UserAuth`, and model queries include `user_id`; admin routes use `AdminAuth`. Local isolation works alongside server resource-ownership checks.

Sources: [BackendAuthGate.tsx](../../src/components/BackendAuthGate.tsx), [storageScope.ts](../../src/lib/storageScope.ts), [token.go](../../server/controller/token.go), [api-router.go](../../server/router/api-router.go), [gouo_cloud.go](../../server/model/gouo_cloud.go).

### Image generation and editing

```text
Prompt, parameters, references, and mask
  → InputBar calls submitTask
  → Validate input and persist a local running task
  → executeTask loads reference images and mask
  → callImageApi selects configuration and protocol
  → /v1/images/* authenticates the token, selects a channel, and calls upstream
  → Persist output images in IndexedDB; mark the task done or error
  → Cloud synchronization observes changes to terminal tasks
```

Mask submission validates the target reference and mask dimensions; a mask covering the whole image requires user confirmation. Successful results retain image IDs, actual parameters, and elapsed time. Failures retain details, and some protocols also retain raw image URLs or responses for diagnosis. A retry creates a new task and can cause another upstream call and charge.

Product mode uses Images API through `createBackendSettings` and disables streaming. Frontend-only mode retains Responses API, partial streaming images, fal.ai, and custom asynchronous provider support. These compatibility capabilities do not establish that the hosted product exposes all of them.

A normal page refresh cannot resume an interrupted OpenAI request. Initialization marks these locally running tasks as failed. fal.ai and custom asynchronous providers can query results again when their server task ID has been saved. Synchronizing artwork records does not replace a durable server-side generation queue.

Sources: [store.ts](../../src/store.ts), [api.ts](../../src/lib/api.ts), [gouoBackend.ts](../../src/lib/gouoBackend.ts).

### Billing and failures

`/v1/images/generations`, `/v1/images/edits`, and `/v1/images/variations` use the public model's price per successful HTTP request. Configuration reuses `Price`; `/api/gouo/models` intersects actual token permissions and available channels to return prices, capabilities, limits, and versions. Quota is `ceil(CNY price / PaymentUSDRate × QuotaPerUnit)`. Models without valid pricing fail closed. Model choices are remembered per account, and tasks retain model and quote snapshots.

Image requests reserve user/token quota atomically through conditional transaction updates, including high-balance accounts. Channel retries share one reservation. Confirmed backend failures refund it and success settles it. Logs preserve the public model, price, billing unit, version, and charged quota. Group multipliers and upstream mappings do not alter selling prices. Changed prices or capabilities require renewed client confirmation.

Multiple outputs within the model limit cost one charge per HTTP request. Legacy `GOUO_IMAGE_PRICE_CNY` seeds the default model only once, with an output limit of 1; administrators explicitly enable and price other models. Product settings disable splitting, while frontend compatibility modes may create separately charged requests. Browser timeouts, downloads, and local storage failures do not establish upstream failure. The durable ledger refunds unsent reservations older than 20 minutes; dispatched requests with unknown outcomes require administrator reconciliation against upstream records. Users can inspect request status in Usage, and retries require confirmation of the new request's price.

Sources: [relay/main.go](../../server/relay/main.go), [quota.go](../../server/relay/relay_util/quota.go), [openaiCompatibleImageApi.ts](../../src/lib/openaiCompatibleImageApi.ts). See the [backend guide](./backend.md) for pricing, payment configuration, and production validation.

### Cloud synchronization

IndexedDB stores tasks, images, thumbnails, queue items, cursors, and mappings between local images and cloud assets. Changes to terminal tasks enter the queue. Synchronization uploads linked assets, writes task and collection relationships, then pulls cloud changes by cursor and merges them locally. Thumbnails download during the pull; original images can be loaded on demand.

Initialization, relevant state changes, network recovery, window focus, and manual retries trigger synchronization. Queue records include attempts and the next attempt time, but there is no independent continuous polling timer; another sync run processes eligible retries. The implementation provides artwork synchronization, not real-time collaboration or a verified guarantee for concurrent conflict resolution.

The backend recalculates SHA-256 and deduplicates within each user. The database stores metadata and ownership; files live in `GOUO_ASSET_DIR`. Image reads require an authenticated endpoint. Do not publish this directory as public static storage.

| Default limit | Value | Configuration |
| --- | --- | --- |
| Storage per user | 2 GiB | `GOUO_ASSET_USER_QUOTA_BYTES` |
| Size per file | 25 MiB | `GOUO_ASSET_MAX_FILE_BYTES` |
| Asset links per task | 32 | `GOUO_ASSET_MAX_TASK_FILES` |

The frontend also caps uploads at 32 asset links, including references, masks, outputs, and thumbnails. Raising only the backend limit does not expand frontend synchronization. Administrators can override storage quota for individual users.

Deleting a synchronized task hides it in a recoverable recycle bin; cloud files still consume storage. Unsynchronized task deletion uses local cleanup. Artwork may remain viewable locally after sync failure, but clearing browser data or changing devices can lose content that was never uploaded.

Sources: [db.ts](../../src/lib/db.ts), [cloudSync.ts](../../src/lib/cloudSync.ts), [controller/gouo_cloud.go](../../server/controller/gouo_cloud.go), [model/gouo_cloud.go](../../server/model/gouo_cloud.go).

## Development and deployment

Local product development needs the public frontend, Go backend, and built admin application embedded in the backend. Documentation requires Node.js 22 and Go 1.25. Use npm at the root and Yarn for the admin application. SQLite is selected when `SQL_DSN` is absent; Redis is optional locally. On Windows, the current SQLite driver also requires a C compiler supporting CGO.

The development frontend is at `http://127.0.0.1:5173`; the backend defaults to port 3000. Vite proxies `/api`, `/v1`, and `/panel` according to `VITE_GOUO_BACKEND_DEV_TARGET`, set to `http://127.0.0.1:3000` in the product example. An empty database creates `root` / `123456`; change the password promptly.

The current product deployment entry points are the root `Dockerfile` and [deploy/docker-compose.yml](../../deploy/docker-compose.yml). Compose starts an Nginx frontend, Go backend, MySQL 8.4, and Redis 7.4. The public port defaults to 8080, and the backend admin port binds only to host `127.0.0.1:3000`. Production Nginx proxies `/api/` and `/v1/` but does not proxy `/panel` to the public port; use a controlled admin access path.

The database holds accounts, balances, channels, and artwork relationships; `backend-data` holds backend data and assets. Backups and restores must cover the database, asset files, and relevant signing secrets together. Multiple backend instances need shared database, coordination, and asset storage. Gouo's cloud library currently uses a filesystem directory; upstream object-storage modules do not establish product cloud-library integration.

The repository retains GitHub Pages, Vercel Hook, and image-publishing workflows. The [Docker workflow](../../.github/workflows/docker.yml) and Compose now use the root [Dockerfile](../../Dockerfile), which builds the backend-enabled product frontend. The `gpt_image_playground` image name is retained for compatibility; the legacy deploy/Dockerfile runtime-injection path has been removed. Static hosting still requires a separately configured backend URL. These changes do not trigger a release.

See the [development guide](./development.md), [Docker Compose deployment](./deployment/docker.md), [manual Linux deployment](./deployment/manual.md), and [production checklist](./deployment/checklist.md) for procedures.

## Verification and next steps

These checks completed in the Windows workspace and Docker Linux/CGO environment on 2026-10-05, using isolated databases and a mock image upstream. They do not establish production readiness or real upstream billing behavior.

| Check | Result |
| --- | --- |
| Root `npm ci` and `npm run build` | Passed |
| Root `npm test` | 19 test files and 194 tests passed |
| Admin Yarn installation with frozen lockfile and build | Passed; generated the files required for embedding |
| Go 1.25.14, `go mod download`, and `go mod verify` | Completed; all modules verified |
| Docker Linux/CGO backend compilation and model/controller/relay/relay_util package tests | Passed |
| Isolated SQLite/Redis and mock-upstream HTTP checks | Catalog, model-specific prices, mappings, refunds, channel retries, quote changes, finite tokens, and concurrent balance checks passed |
| Desktop and 390px mobile UI | Model choices, account choice retention, count/edit capability restrictions, mock generation and reference editing passed; admin price loading, validation, and saving passed |
| Real paid upstream, MySQL/PostgreSQL, production migration, cross-device sync, payments, and CSV download end to end | Unverified |

Root npm installation reported 17 dependency vulnerabilities, including 12 rated high. This is the installation audit result, not proof of an exploitable production vulnerability. No automatic fix or upgrade was applied. Public frontend builds also warned about old Browserslist data and mixed imports. Admin checks warned about peer dependencies, Tailwind content configuration, and large chunks; these warnings did not prevent the builds.

Before production, verify migration and backup/restore on the target database, run real-upstream generation/billing/sync/recycle-bin regression with a separate account, then review publishing workflows and dependency findings. Online payments require separate configuration, callback, duplicate-notification, and reconciliation checks. Upstream payment code alone does not establish readiness to accept payments publicly.

## Documentation reading order

1. [User guide](./user-guide.md): public product entry points.
2. [Development guide](./development.md): environment and runtime mode.
3. [Backend guide](./backend.md): channels, pricing, storage, and backups.
4. [Testing and local mock API](./testing.md): compatibility and failure scenarios.
5. [Deployment overview](./deployment/index.md): deployment choices and production checks.

The frontend derives from GPT Image Playground under MIT License. The backend derives from One Hub and retains Apache-2.0 notices. Upstream general documentation lives in `server/docs/`; use root `docs/` for Gouo product integration and deployment. See [README.md](../../README.md) for attribution and licensing.
