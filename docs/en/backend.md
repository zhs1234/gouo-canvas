# Gouo Canvas backend integration

[简体中文](../zh-CN/backend.md) · [Documentation index](../README.md)

Gouo Canvas uses a Go service derived from One Hub for accounts, balance, API relay, and the cloud library. `server/` retains upstream licenses, the admin frontend, and general provider capabilities; the public Gouo frontend uses only the product routes that are integrated here.

## 1. Request flow

```text
Register/sign in
  POST /api/user/register
  POST /api/user/login
          ↓ server session cookie
Obtain the user's relay token
  GET /api/token/playground
          ↓ user-scoped token
Read available models and quotes
  GET /api/gouo/models (X-Gouo-Token)
          ↓ model, capabilities, price version
Image request
  POST /v1/images/generations
  POST /v1/images/edits
  POST /v1/images/variations
          ↓
One Hub selects a channel, calls upstream, records usage, and settles balance
```

The browser never receives the platform's upstream API key. It holds only the current user's relay token, limiting exposure to that user's account, permissions, and balance. The token is still sensitive and must not be logged or shared.

## 2. Local integration

Run the backend with SQLite:

```powershell
Set-Location server
$env:SESSION_SECRET = '<at-least-32-random-characters>'
$env:USER_TOKEN_SECRET = '<a-different-at-least-32-character-secret>'
go run .
```

Frontend `.env.local`:

```dotenv
VITE_GOUO_BACKEND_ENABLED=true
VITE_GOUO_BACKEND_URL=
VITE_GOUO_BACKEND_DEV_TARGET=http://127.0.0.1:3000
VITE_GOUO_IMAGE_MODEL=gpt-image-2
```

Local Vite and production Nginx preserve the same routing semantics: `/api` handles accounts and the library; `/v1` handles model relay. Prefer one origin in production. Set `VITE_GOUO_BACKEND_URL` only for an intentional cross-origin design, together with correct cookie, CORS, and HTTPS configuration.

## 3. Initial admin setup

The backend exposes the admin UI at `http://127.0.0.1:3000/panel` by default. An empty database creates `root` / `123456`; change it before any network exposure.

Recommended order:

1. Create a separate day-to-day administrator account.
2. Add an OpenAI or compatible image channel. Store its API key only in the channel.
3. Configure image channels and mappings. In the single-model price editor, enable Gouo and set its CNY price, reference/mask capabilities, and output limit. The client displays the public model ID used in requests; there is no separate display name.
4. Validate generations, edits, and variations routes.
5. Validate model-specific charging, failure refunds, price-change confirmation, and insufficient-balance rejection.
6. Configure new-user credit, redemption codes, registration policy, and rate limits.
7. If online payment is planned, validate provider setup, callback signatures, abnormal orders, and reconciliation before exposing it.
8. Confirm the asset directory and user storage under the Gouo storage administration view.

Registration supports username/password and conditionally presents email-verification fields from backend status. Before forcing another CAPTCHA or OAuth flow, verify that the Gouo login/registration UI supplies all required parameters.

## 4. Model-specific image billing

Generation, edit, and variation routes charge the public model's CNY selling price per successful HTTP request. The existing `Price` table holds its enabled state, price, capabilities, and output limit. Sizes, quality levels, generation, and editing share one price per model. Group multipliers and upstream model mappings do not change that selling price.

These legacy settings seed the default model only on the first migration. Change later prices in the admin UI:

```dotenv
GOUO_IMAGE_PRICE_CNY=0.10
GOUO_IMAGE_MODEL=gpt-image-2
```

- Migration enables only the previous default model and price, with reference/mask support and an output limit of **1 image**. Increase the limit after checking upstream costs. It preserves balances and historical artworks, never enables other models automatically, and never re-enables a removed or disabled default on restart.
- `VITE_GOUO_IMAGE_MODEL` supplies the initial frontend choice. Subsequent choices are remembered per account and survive login/token refresh. Tasks and retries retain their original model.
- `GET /api/gouo/models` requires the login cookie and that account's relay token in `X-Gouo-Token`. It intersects enabled models, valid prices, the actual token allowlist, and channels available to its groups. Missing prices and disabled models fail closed instead of falling back to generic pricing.
- The client submits `X-Gouo-Price-Version`. Changed prices or capabilities return `409 image_price_changed`; refresh the catalog and confirm by submitting again. Legacy task retries and changed retry prices require a confirmation dialog. Non-product API tokens may omit the version but still use a quote captured when the request starts.
- Quota is `ceil(CNY price / PaymentUSDRate × QuotaPerUnit)`. Conditional database updates reserve user/token balances in one transaction. Success settles the reservation, confirmed backend failure refunds it, and channel retries share one reservation. Logs preserve the public model, price, billing unit, version, and charged quota. The user center and CSV use the price snapshot; cumulative usage is consumed quota converted at the current rate.
- Multiple outputs within the model limit cost one charge for one HTTP request. Product settings disable Codex CLI splitting and streaming. Frontend compatibility modes can split a task into separately charged requests.
- Price synchronization and generic batch editing preserve enabled Gouo settings; change them in the single-model editor. Selling prices are independent of upstream costs, so operators must check actual upstream bills.

Image reservations create a durable ledger row in the same transaction. Upstream requests have a 15-minute deadline. At startup and every minute, the primary node refunds unsent reservations older than 20 minutes and marks dispatched requests with unknown outcomes for review. Settlement/refund, balances, statistics, and logs commit atomically; repeated resolution does not repeat the balance change.

Browser timeouts, output downloads, or local storage failures do not mean a refund occurred. Users check image request status in Account → Usage; administrators reconcile upstream records in Operations → Image Billing and provide a reason before settling or refunding. Retrying creates a new paid request and does not recover the original result. Back up the database before upgrading. Historical interruptions without ledger rows require manual reconciliation against old logs.

## 5. Cloud library

Primary configuration:

```dotenv
GOUO_CLOUD_LIBRARY_ENABLED=true
GOUO_ASSET_DIR=/data/gouo-assets
GOUO_ASSET_USER_QUOTA_BYTES=2147483648
GOUO_ASSET_MAX_FILE_BYTES=26214400
GOUO_ASSET_MAX_TASK_FILES=32
```

Defaults mean:

- 2 GiB per user.
- 25 MiB per file.
- 32 assets attached to one task.
- SHA-256 deduplication within one user; authorization remains isolated between users.

Synchronization includes task metadata, outputs, references, masks, thumbnails, streaming previews, and collection membership. Assets are read through authenticated endpoints. Never expose `GOUO_ASSET_DIR` as an Nginx static directory.

Deleting a synchronized task hides it in the recycle bin and retains its files. There is currently no user-facing physical purge flow, so operators need an explicit retention and cleanup policy.

Local-file storage is suitable for one backend instance. Multiple instances must mount the same shared filesystem or database records can point to files visible only on another instance. Gouo-specific object storage is not yet implemented.

## 6. Database, Redis, and backup

- SQLite is acceptable for local development.
- Use MySQL or PostgreSQL for a public production service.
- Multiple instances must share the database, Redis, signing secrets, and asset storage.
- Redis is a cache and coordination layer, not a database backup.
- Back up and restore the database and `GOUO_ASSET_DIR` as one point-in-time set.
- Keep encrypted backups of `SESSION_SECRET`, `USER_TOKEN_SECRET`, and the production environment file.

Restoring only the database leaves library records without images. Restoring only assets leaves files without ownership and task relationships.

## 7. Key routes

| Route | Purpose |
| --- | --- |
| `GET /api/status` | Backend status and enabled capabilities |
| `GET /api/user/self` | Current user and balance; legacy image_price_cny is not a model quote |
| `GET /api/gouo/models` | Models, prices, capabilities, output limits, and price versions available to the current image token |
| `POST /api/user/login` | Sign in |
| `POST /api/user/register` | Register |
| `GET /api/token/playground` | Current user's image relay token |
| `POST /api/user/topup` | Redeem credit code |
| `GET /api/log/self` | Current user's usage history |
| `GET /api/gouo/storage` | Cloud storage summary |
| `POST /api/gouo/assets` | Upload an account asset |
| `GET /api/gouo/sync` | Pull task and collection changes |
| `PUT /api/gouo/tasks/:clientId` | Create or update a task |
| `PUT /api/gouo/collections/:id` | Create or update a collection |

Every user-data endpoint must enforce authentication and ownership on the server. Hiding a frontend control is not authorization.

## 8. Current boundaries

- The public frontend includes sign-in, registration, user center, redemption codes, usage history, and cloud library.
- Online payment becomes a production feature only after One Hub configuration and callback, duplicate-notification, failure, and reconciliation testing.
- Product-mode image endpoints currently use non-streaming backend settings; frontend-only mode retains streaming compatibility tests.
- `server/docs/` describes general upstream One Hub features and does not imply that the public Gouo UI exposes every one of them.
