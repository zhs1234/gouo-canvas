# Gouo Canvas backend integration

[简体中文](../zh-CN/backend.md) · [Documentation index](../README.md)

Gouo Canvas uses a Go service derived from New API for accounts, balance, API relay, and the cloud library. `server/` retains upstream licenses, the admin frontend, and general provider capabilities; the public Gouo frontend uses only the product routes that are integrated here.

## 1. Request flow

```text
Register/sign in
  POST /api/user/register
  POST /api/user/login
          ↓ server session cookie
Obtain the user's relay token
  GET /api/gouo/token
          ↓ user-scoped token
Read available models and quotes
  GET /api/gouo/models
          ↓ model, capabilities, price version
Image request
  POST /v1/images/generations
  POST /v1/images/edits
          ↓
New API selects a channel, calls upstream, reserves by model price, and settles balance
```

The browser never receives the platform's upstream API key. It holds only the current user's relay token (one dedicated New API token per user in the database), limiting exposure to that user's account, permissions, and balance. The token is still sensitive and must not be logged or shared.

## 2. Local integration

Run the backend with SQLite:

```powershell
Set-Location server
$env:SESSION_SECRET = '<at-least-32-random-characters>'
go run .
```

Frontend `.env.local`:

```dotenv
VITE_GOUO_BACKEND_URL=
VITE_GOUO_BACKEND_DEV_TARGET=http://127.0.0.1:3000
```

Local Vite and production Nginx preserve the same routing semantics: `/api` handles accounts and the library; `/v1` handles model relay. Prefer one origin in production. Set `VITE_GOUO_BACKEND_URL` only when frontend and backend are different subdomains of the same site.

The session cookie is always `HttpOnly; SameSite=Strict`, so a frontend on a different site (registrable domain) never receives the session; cross-site deployment is not supported. When serving over HTTPS, set `SESSION_COOKIE_SECURE=true` and list the public origin(s) in `SESSION_COOKIE_TRUSTED_URL` (https only, comma-separated); the two must be set together or the backend refuses to start. The reverse proxy must overwrite and correctly forward `Host` and `X-Forwarded-Proto`.

The backend rate-limits sign-in, registration and verification emails by client IP and supports per-token IP allowlists. It reads the client IP from `X-Forwarded-For` only for requests coming from `TRUSTED_PROXIES` (`trusted_proxies` in YAML). The default covers loopback and private networks, which fits Nginx on the same host or container network. If the reverse proxy runs at another public address, add its address or CIDR (comma-separated). If the backend faces the internet directly, set it to empty. Behind a platform such as Cloudflare, use `trusted_header` (for example `CF-Connecting-IP`) instead. The backend trusts that header whenever it is present, without checking where the request came from, so the origin must be reachable only through that platform (firewall allows only the platform's ranges, `PUBLIC_PORT` bound to loopback or a private network). Otherwise anyone can connect directly with the header set, spoof their IP, and bypass rate limits and token IP allowlists.

## 3. Admin panel

The backend serves the admin panel at `http://127.0.0.1:3000` by default. An empty database creates `root` / `123456`; change it before any network exposure.

Only administrators can sign in to the admin panel. Regular users are rejected at its login form, a regular user who already has a session is signed out when opening it, and the admin login page has no registration link. Regular users use only the Gouo client. Balances, logs, statistics, charts, and input hints in the panel are shown in points (1 CNY = 100 points); [section 4](#4-model-specific-image-billing) explains the server-side accounting.

Gouo-specific features live under the **光构** (Gouo) menu: 光构设置 (Gouo settings), 光构存储 (Gouo storage), and 图片账务 (Image billing). The models the client uses are configured in New API's native Models and model pricing; see [section 3.2](#32-client-models). The panel interface is Chinese, so English names are given alongside the labels.

> Screenshots come from a local demo environment with demo data.

### 3.1 Gouo settings

![Gouo settings](../images/screenshots/panel-gouo-settings.webp)

The announcement at the top of the creation page uses New API's native console announcements (enable and add them under Settings → Console): the client shows the first line of the newest announcement, or the default introduction when announcements are off or empty. A dismissed announcement reappears when its text changes.

**光构设置** collects the settings that act directly on the client. Any administrator can change them (the system-settings API is still root only); they take effect when users return to or reload the client:

- **默认图片模型** (default image model): chosen from enabled models; see [section 4](#4-model-specific-image-billing).
- **兑换码获取说明** (redemption instructions) and **客服联系方式** (support contact): shown on the redemption screen and under "top-up and billing help" in the user center. Both default to blank, and the client says they are not configured yet.
- **开放画布** (canvas) and **开放 Agent** (Agent): when switched off, the client hides the corresponding entry points (the mode switch on the creation page, "My canvases" or "Agent conversations" in the sidebar, and the Agent button inside canvases), and visiting their addresses returns to the creation page. Saved canvases and conversations are kept. With Agent off, the Agent model catalog is empty. The build variables `VITE_CANVAS_ENABLED` and `VITE_AGENT_ENABLED` remain the upper limit: an entry disabled at build time cannot be turned on from the panel.
- **一次最多生成张数** (max images per submission): 1–10. Limits how many images the client submits at once on the creation page, canvas, and Agent; each image is still billed as a single-image request. This is a client submission limit; the images per HTTP request are bounded by each model's "maximum images per request".
- **默认 Agent 模型** (default Agent model): the chat model new conversations start with, chosen from models that qualify for the Agent (step 10 in 3.8). When unset or unavailable to the user, the first model in the catalog is used.
- **Agent 附加提示词** (extra Agent prompt): up to 4000 characters appended after the built-in rules to add tone, brand, or business requirements. It cannot relax the billing confirmation, tool, or safety rules, and applies from the next conversation turn.
- **云端作品库** (cloud library): the on/off switch, default per-user storage (GB), per-file upload limit (1–100 MB), and recycle-bin retention (1–30 days); see [section 5](#5-cloud-library). When raising the upload limit, also raise Nginx `client_max_body_size` (32 MB in the deployment templates) and any CDN limit.

The bottom of the page shows whether registration and password sign-in are open. Change them under Settings → System (root only); the client follows them: with registration closed, **免费注册** shows "registration is not open" and the sign-in page hides its registration link; with password sign-in closed, the sign-in page says sign-in is paused.

### 3.2 Client models

The client's image and Agent model lists read New API's native model data directly; there is no separate Gouo models page:

- **Image models**: models New API recognises as image generation (inferred from the model name, or declared with an image-generation endpoint in Models) that have an available channel in the user's group. The model name is the display name and the description comes from Models.
- **Image editing**: add tags in Models. `edit` enables reference-image edits; `edit` plus `mask` enables mask edits. The client offers all 1K/2K/4K resolution tiers and one output per request (it splits multiple images into single-image requests).
- **Agent models**: text models tagged `tools`, priced in model pricing, with an available channel in the user's group; add `vision` to let them understand uploaded images. The channel must actually support streaming tool calls.
- Models disabled in Models do not appear in the client.

After a tag or price change, the client's next submission gets "price or capabilities updated"; refresh and confirm again.

### 3.3 Users and points

![Adjusting a user's points](../images/screenshots/panel-users.webp)

The user list shows balances and usage in points. **增减积分** (Adjust points) in a user's menu takes the change in points and shows the equivalent quota. Submitting writes a "管理员增减用户积分" (admin adjusted points) log that the user also sees in the client's usage records.

### 3.4 Redemption codes

![Creating redemption codes](../images/screenshots/panel-redemption.webp)

When creating codes, enter points in **按积分填写** (Enter in points); the quota is calculated automatically and rounded up so the credited balance is never below the entered points, and the quota field shows the approximate points. Up to 100 codes can be created at once; creating several downloads a text file. Redeemed points are credited immediately and logged as "兑换码 #ID 充值 N 积分" (code #ID added N points).

### 3.5 Image billing

![Image billing](../images/screenshots/panel-gouo-billing.webp)

**图片账务** lists every image reservation with its user, model, status, and note, filterable by user, client request ID, and status; regular administrators see only lower-privileged accounts. Any request that does not return an image to the user (upstream failure, timeout, disconnect, or a result-save or settlement failure) is refunded automatically, and the scheduled job refunds rows left unsettled. See [section 4](#4-model-specific-image-billing).

### 3.6 Gouo storage

![Gouo storage](../images/screenshots/panel-gouo-storage.webp)

**光构存储** shows total assets, image assets, work tasks, works in the recycle bin, and active users, plus each user's usage, share, and quota. You can change one user's quota (not below their current usage) and browse their works. The default quota is set in Gouo settings and the asset directory comes from an environment variable; see [section 5](#5-cloud-library).

### 3.7 Logs

![Logs](../images/screenshots/panel-logs.webp)

The log page filters by type (top-up, consumption, management, system), user, model, channel, and time, and shows quota in points. Newly written redemption, gift, admin adjustment, online top-up, and task compensation logs also use points in their text.

### 3.8 Recommended first-time setup

1. Create a separate day-to-day administrator account.
2. Add an OpenAI or compatible image channel. Store its API key only in the channel.
3. Configure image models and channel mappings, price the model in New API's model pricing, and add the `edit` and `mask` tags and a description in Models as needed.
4. In **光构设置**, set the default image model, redemption instructions, and support contact, and publish a console announcement if needed.
5. Validate the generations and edits routes (variations is not implemented).
6. Validate per-model pricing, successful charges, failure refunds, price-change confirmation, and insufficient-balance rejection.
7. Configure the new-user gift (inputs show the points equivalent), redemption codes, registration policy, and rate limits.
8. If online payment is planned, validate the payment provider, callback signatures, abnormal orders, and reconciliation before exposing it. Payment callbacks are always verified with the gateway's current configuration: to switch merchants (a different app ID, merchant ID, or platform public key), add a new gateway and disable the old one, keeping it until its orders are completed or closed. Otherwise callbacks from the old merchant for orders created before the change fail verification and are not credited.
9. Confirm in **光构存储** that the asset directory is writable, and check user storage.
10. For the Agent, tag a text model `tools` in Models (add `vision` for image understanding), price it, and give it a channel that supports streaming tool calls.

### 3.9 Registration checks and Turnstile

Registration reads backend status to display email verification and Cloudflare Turnstile. A status failure shows a retry action instead of skipping required verification. Configure `TurnstileCheckEnabled`, `TurnstileSiteKey`, and `TurnstileSecretKey` in the backend and allow the actual frontend hostname in Cloudflare. The public site key enables challenges for registration, verification emails, password-reset emails, and account email binding; the secret stays on the server. Expired or failed challenges can be retried and refresh after submission. Custom CSP must allow scripts and frames from `https://challenges.cloudflare.com`. Tokens are sent to the existing backend Siteverify middleware; a client callback alone is not proof of verification. See [client rendering](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/) and [server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/). The public Gouo sign-in page has no OAuth entry points.

Turnstile keeps the existing backend session policy: the first successful verification stores `turnstile=true` in the session, and later requests in that session reuse it without another Siteverify call. Refreshing the frontend token after each request does not change this server policy.

In product mode the client does not import service-address parameters such as `apiUrl`/`apiKey` from links or remote config URLs; it only removes them from the address bar.

## 4. Model-specific image billing

Generation and edit routes use New API's own model pricing (per-request price, model ratio, or tiered billing expression), edited in New API's pricing settings; group ratios and other New API rules apply as usual. Gouo's extra checks apply only to image requests from the Gouo client (platform token); other API calls get native New API behaviour. The client offers 1K/2K/4K resolutions and the server rejects sizes above 4K. The edit route accepts only `multipart/form-data` with files under `image`, `image[]`, and `mask`. `/v1/images/variations` is not implemented.

- Users only ever see points (积分): **1 CNY = 100 points**. The client shows balance, unit prices, estimated charges, usage records, and CSV in points.
- The models available to clients come from New API's native model data; see [section 3.2](#32-client-models).
- The client's default model is set in 光构 → 光构设置 → "默认图片模型" (Gouo settings → default image model). It is used when the user has not picked a model or the picked model is no longer available; when empty or unavailable to the user, the first model in the catalog is used. The client does not hard-code a model; nothing is selected until the catalog loads. Manual choices are remembered per account; tasks and retries retain their original model.
- `GET /api/gouo/models` requires the login cookie and returns enabled models available to the account's group.
- The client submits `X-Gouo-Price-Version`, computed from the effective New API pricing and the Gouo capability settings. Any change returns `409 image_price_changed`; refresh the catalog and confirm by submitting again. Renaming, editing the description, or reordering does not change the version. In product mode every retry asks the user to confirm the cost of the new request.
- The Gouo product client splits n images into n single-image requests, and each successful request is charged separately. For direct API calls, multiple outputs within the model limit in one HTTP request are billed by New API rules.
- Selling prices are independent of upstream costs, so operators must check actual upstream bills.

Image reservations create a durable ledger row (deduplicated by `X-Gouo-Request-Id`). Every minute, the primary node refunds every request still unsettled after 20 minutes. Requests with an unknown upstream outcome are also refunded immediately and are not retried on another channel; the platform absorbs any upstream cost for them. Settlement/refund, balances, statistics, and logs commit atomically; repeated resolution does not repeat the balance change.

Results of settled requests are kept briefly so the browser can fetch them after a disconnect; a local browser save failure is not refunded. Users see charges and refunds in the point history under Account → Usage; administrators look up requests by ID in 光构 → 图片账务 (Image billing). Retrying creates a new paid request and does not recover the original result. Back up the database before upgrading.

## 5. Cloud library

Primary configuration (only these two come from environment variables):

```dotenv
GOUO_ASSET_DIR=/data/gouo-assets
GOUO_ASSET_MAX_TASK_FILES=32
```

The library switch, default per-user storage, per-file limit, and recycle-bin retention are set under 光构 → 光构设置 (Gouo settings) in the admin panel. Changes apply immediately (up to one minute across instances).

Defaults mean:

- 2 GiB per user.
- 25 MiB per file.
- 32 assets attached to one task.
- SHA-256 deduplication within one user; authorization remains isolated between users.

Successful images are written to the library by the server when they are generated; the browser only submits task metadata, references, and masks, and no longer uploads thumbnails or streaming previews. Canvases and Agent conversations are stored as documents in the database (up to 4 MB each, at most 2000 linked images). Assets are read through authenticated endpoints. Never expose `GOUO_ASSET_DIR` as an Nginx static directory.

The storage quota and the 25 MiB per-file limit apply to user uploads such as references and masks. Paid generated images saved by the server are not limited by the quota (up to 64 MB each), so used storage can exceed the quota. Image results are also cached in `GOUO_ASSET_DIR/image-results` for 24 hours (4 GB total, 256 MB per result) so an interrupted request can recover its original result; include it in capacity and backup planning.

Deleted artworks, canvases, conversations, and collections go to the recycle bin, for 3 days by default (1–30 days, configurable in Gouo settings). They can be restored during that time and still count toward storage. After that, a cleanup job that runs hourly on the master node permanently deletes the records and any images no longer referenced. Cloud data of deleted accounts is removed on the same schedule. After shortening the retention, items already past the new period are deleted at the next cleanup.

Local-file storage is suitable for one backend instance. Multiple instances must mount the same shared filesystem or database records can point to files visible only on another instance. Gouo-specific object storage is not yet implemented.

## 6. Database, Redis, and backup

- SQLite is acceptable for local development.
- Use MySQL or PostgreSQL for a public production service.
- Multiple instances must share the database, Redis, signing secrets, and asset storage.
- Run exactly one master; set `NODE_TYPE=slave` on the others so scheduled jobs (charge recovery, recycle-bin purge) run once.
- Redis is a cache and coordination layer, not a database backup.
- Back up and restore the database and `GOUO_ASSET_DIR` as one point-in-time set.
- Keep encrypted backups of `SESSION_SECRET` (and `CRYPTO_SECRET` if set separately) and the production environment file.

Restoring only the database leaves library records without images. Restoring only assets leaves files without ownership and task relationships.

## 7. Key routes

| Route | Purpose |
| --- | --- |
| `GET /api/status` | Backend status and client settings (registration and password sign-in switches, console announcements, redemption instructions, support contact, email and Turnstile settings) |
| `GET /api/user/self` | Current user and balance |
| `GET /api/gouo/models` | Models, prices, capabilities, output limits, and price versions available to the current image token |
| `POST /api/user/login` | Sign in |
| `POST /api/user/register` | Register |
| `GET /api/gouo/token` | Current user's relay token |
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
| `GET /api/gouo/image-results` | Recover a paid image result by its original request ID |
| `GET /api/gouo/agent/models` | Agent models available to the current user |
| `POST /pg/chat/completions` | Agent conversation (New API native playground, login-session auth, with the `X-Gouo-Agent` header) |
| `GET/PUT /api/gouo/admin/settings` | Admins read and write Gouo client settings (default image model, redemption instructions, support contact, and more) |
| `GET /api/gouo/admin/models` | Admins list the image and Agent models the client will show, for choosing defaults |
| `GET /api/gouo/admin/image-charges` | Admins review the image reservation ledger |
| `GET /api/gouo/admin/storage[/users…]`, `PUT …/users/:id/quota` | Admins view storage usage, browse a user's works, and change user quotas |

Every user-data endpoint must enforce authentication and ownership on the server. Hiding a frontend control is not authorization.

## 8. Current boundaries

- The public frontend includes sign-in, registration, user center, redemption codes, usage history, cloud library, canvas, and Agent.
- Online payment becomes a production feature only after New API configuration and callback, duplicate-notification, failure, and reconciliation testing.
- The client calls image endpoints without streaming.
- `server/docs/` describes general upstream New API features and does not imply that the public Gouo UI exposes every one of them.
