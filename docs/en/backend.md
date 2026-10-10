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

Same-origin sessions default to `HttpOnly; SameSite=Strict`. For a frontend at `https://app.example.com` and a backend on a separate site, build the frontend with `VITE_GOUO_BACKEND_URL=https://api.example.net` and configure the backend:

```dotenv
GOUO_ALLOWED_ORIGINS=https://app.example.com
SESSION_COOKIE_SECURE=true
SESSION_COOKIE_SAME_SITE=none
```

Origins must be exact `http(s)://host[:port]` values, comma-separated, without trailing slashes, paths, or wildcards. Invalid settings prevent startup; `none` requires both Secure and an origin allowlist. The reverse proxy must overwrite and correctly forward `Host` and `X-Forwarded-Proto`, with HTTPS at the browser entry point. Account API credentials are allowed only for listed origins. Cross-site requests without Origin are rejected; in `none` mode, session-bearing requests without Origin also require `Sec-Fetch-Site: same-origin`. Only existing GitHub/Lark/OIDC GET callbacks, which validate session state, are exempt. Browsers that block third-party cookies still require a same-origin proxy. Compose passes these three variables; YAML uses their lowercase equivalents.

The backend rate-limits sign-in, registration and verification emails by client IP and supports per-token IP allowlists. It reads the client IP from `X-Forwarded-For` only for requests coming from `TRUSTED_PROXIES` (`trusted_proxies` in YAML). The default covers loopback and private networks, which fits Nginx on the same host or container network. If the reverse proxy runs at another public address, add its address or CIDR (comma-separated). If the backend faces the internet directly, set it to empty. Behind a platform such as Cloudflare, use `trusted_header` (for example `CF-Connecting-IP`) instead. The backend trusts that header whenever it is present, without checking where the request came from, so the origin must be reachable only through that platform (firewall allows only the platform's ranges, `PUBLIC_PORT` bound to loopback or a private network). Otherwise anyone can connect directly with the header set, spoof their IP, and bypass rate limits and token IP allowlists.

## 3. Initial admin setup

The backend exposes the admin UI at `http://127.0.0.1:3000/panel` by default. An empty database creates `root` / `123456`; change it before any network exposure.

Recommended order:

1. Create a separate day-to-day administrator account.
2. Add an OpenAI or compatible image channel. Store its API key only in the channel.
3. Configure image channels and mappings. In the single-model price editor, enable Gouo and set its CNY price, reference/mask capabilities, and output limit. The client displays the public model ID used in requests; there is no separate display name.
4. Validate generations, edits, and variations routes.
5. Validate model-specific charging, failure refunds, price-change confirmation, and insufficient-balance rejection.
6. Configure new-user credit, redemption codes, registration policy, and rate limits.
7. If online payment is planned, validate provider setup, callback signatures, abnormal orders, and reconciliation before exposing it. Payment callbacks are always verified with the gateway's current configuration: to switch to a different merchant (another app ID, merchant ID, or platform public key), add a new gateway and disable the old one, keeping it until its orders are completed or closed. Otherwise callbacks from the old merchant for orders created before the change fail verification and are not credited.
8. Confirm the asset directory and user storage under the Gouo storage administration view.

Registration reads backend status to display email verification and Cloudflare Turnstile. A status failure shows a retry action instead of skipping required verification. Configure `TurnstileCheckEnabled`, `TurnstileSiteKey`, and `TurnstileSecretKey` in the backend and allow the actual frontend hostname in Cloudflare. The public site key enables challenges for registration, verification emails, password-reset emails, and account email binding; the secret stays on the server. Expired or failed challenges can be retried and refresh after submission. Custom CSP must allow scripts and frames from `https://challenges.cloudflare.com`. Tokens are sent to the existing backend Siteverify middleware; a client callback alone is not proof of verification. See [client rendering](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/) and [server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/). OAuth entry points are not part of the public Gouo login page.

Turnstile retains the existing backend session policy: the first successful verification stores `turnstile=true` in the session, and later requests in that session may reuse it without another Siteverify call. Refreshing the frontend token after each request does not change this server policy.

## 4. Model-specific image billing

Generation, edit, and variation routes charge the public model's CNY selling price per successful HTTP request. The existing `Price` table holds its enabled state, price, capabilities, and output limit. Sizes, quality levels, generation, and editing share one price per model. Group multipliers and upstream model mappings do not change that selling price.

These legacy settings seed the default model only on the first migration. Change later prices in the admin UI:

```dotenv
GOUO_IMAGE_PRICE_CNY=0.10
GOUO_IMAGE_MODEL=gpt-image-2
```

- Migration enables only the previous default model and price, with reference/mask support and an output limit of **1 image**. Increase the limit after checking upstream costs. The limit applies to `n` in a single HTTP request; it does not cap the total images the product client generates, because the client splits them into single-image requests. It preserves balances and historical artworks, never enables other models automatically, and never re-enables a removed or disabled default on restart.
- `VITE_GOUO_IMAGE_MODEL` supplies the initial frontend choice. Subsequent choices are remembered per account and survive login/token refresh. Tasks and retries retain their original model.
- `GET /api/gouo/models` requires the login cookie and that account's relay token in `X-Gouo-Token`. It intersects enabled models, valid prices, the actual token allowlist, and channels available to its groups. Missing prices and disabled models fail closed instead of falling back to generic pricing.
- The client submits `X-Gouo-Price-Version`. Changed prices or capabilities return `409 image_price_changed`; refresh the catalog and confirm by submitting again. In product mode every retry asks the user to confirm the cost of the new request, showing the new price when it changed. Non-product API tokens may omit the version but still use a quote captured when the request starts.
- Quota is `ceil(CNY price / PaymentUSDRate × QuotaPerUnit)`. Conditional database updates reserve user/token balances in one transaction. Success settles the reservation, confirmed backend failure refunds it, and channel retries share one reservation. Logs preserve the public model, price, billing unit, version, and charged quota. The user center and CSV use the price snapshot; cumulative usage is consumed quota converted at the current rate.
- The Gouo product client splits n images into n single-image requests, and each successful request is charged separately (billed per successful image), up to 10 images at a time. For direct API calls, multiple outputs within the model limit in one HTTP request cost one charge. Frontend compatibility modes can also split a task into separately charged requests.
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

Successful images are written to the library by the server when they are generated; the browser only submits task metadata, references, and masks, and no longer uploads thumbnails or streaming previews. Canvases and Agent conversations are stored as documents in the database (up to 4 MB each, at most 2000 linked images). Assets are read through authenticated endpoints. Never expose `GOUO_ASSET_DIR` as an Nginx static directory.

The storage quota and the 25 MiB per-file limit apply to user uploads such as references and masks. Paid generated images saved by the server are not limited by the quota (up to 64 MB each), so used storage can exceed the quota. Image results are also cached in `GOUO_ASSET_DIR/image-results` for 24 hours (4 GB total, 256 MB per result) so an interrupted request can recover its original result; include it in capacity and backup planning.

Deleted artworks, canvases, conversations, and collections go to the recycle bin for 3 days. They can be restored during that time and still count toward storage. After that, a cleanup job that runs hourly on the master node permanently deletes the records and any images no longer referenced. Cloud data of deleted accounts is likewise removed after 3 days.

Local-file storage is suitable for one backend instance. Multiple instances must mount the same shared filesystem or database records can point to files visible only on another instance. Gouo-specific object storage is not yet implemented.

## 6. Database, Redis, and backup

- SQLite is acceptable for local development.
- Use MySQL or PostgreSQL for a public production service.
- Multiple instances must share the database, Redis, signing secrets, and asset storage.
- Run exactly one master; set `NODE_TYPE=slave` on the others so scheduled jobs (charge recovery, recycle-bin purge) run once. Model price changes and Gouo model enable/disable reach other instances within one minute; requests made with the old price version in that window get "price updated" and succeed after a page refresh.
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
| `GET /api/gouo/tasks`, `GET /api/gouo/collections` | Cursor-paginated artworks and collections (`hidden=true` for the recycle bin) |
| `PUT /api/gouo/tasks/:clientTaskId` | Create or update a task |
| `PATCH /api/gouo/tasks/:clientTaskId/meta` | Submit metadata for an artwork the server already saved |
| `POST /api/gouo/tasks/:id/hide`, `/restore` | Move an artwork to the recycle bin or restore it |
| `PUT /api/gouo/collections/:id` | Create or update a collection (`/hide` and `/restore` as above) |
| `/api/gouo/canvases[/:id]`, `/api/gouo/conversations[/:id]` | List, read, save, hide, and restore canvas and Agent conversation documents |
| `GET /api/gouo/image-charges` | Current user's image charge records |
| `GET /api/gouo/image-results` | Recover a paid image result by its original request ID |
| `GET /api/gouo/agent/models` | Agent models available to the current user |

Every user-data endpoint must enforce authentication and ownership on the server. Hiding a frontend control is not authorization.

## 8. Current boundaries

- The public frontend includes sign-in, registration, user center, redemption codes, usage history, and cloud library.
- Online payment becomes a production feature only after One Hub configuration and callback, duplicate-notification, failure, and reconciliation testing.
- Product-mode image endpoints currently use non-streaming backend settings; frontend-only mode retains streaming compatibility tests.
- `server/docs/` describes general upstream One Hub features and does not imply that the public Gouo UI exposes every one of them.
