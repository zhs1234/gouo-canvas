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
3. Configure `gpt-image-2`, or the actual model selected by `VITE_GOUO_IMAGE_MODEL`, including mappings when needed.
4. Validate generations, edits, and variations routes.
5. Validate fixed charging, failure refunds, and insufficient-balance rejection.
6. Configure new-user credit, redemption codes, registration policy, and rate limits.
7. If online payment is planned, validate provider setup, callback signatures, abnormal orders, and reconciliation before exposing it.
8. Confirm the asset directory and user storage under the Gouo storage administration view.

Registration supports username/password and conditionally presents email-verification fields from backend status. Before forcing another CAPTCHA or OAuth flow, verify that the Gouo login/registration UI supplies all required parameters.

## 4. Fixed image billing

Generation, edit, and variation routes use a fixed CNY price per successful request:

```dotenv
GOUO_IMAGE_PRICE_CNY=0.10
```

- Balance is checked and reserved when a request starts.
- A confirmed failure refunds the reservation.
- A request asking for multiple outputs currently settles as one successful request.
- The user center shows price, balance, and recent usage.
- Fixed selling price is independent of upstream cost. Operators must inspect real bills across models, sizes, quality levels, output counts, and edits.

Do not infer behavior by mixing generic One Hub multipliers with Gouo fixed pricing. Run real success, failure, and insufficient-balance regression cases.

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
| `GET /api/user/self` | Current user, balance, and price |
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
