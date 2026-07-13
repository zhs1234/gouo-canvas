# Gouo Canvas production checklist

[简体中文](../../zh-CN/deployment/checklist.md) · [Deployment overview](./index.md) · [Documentation index](../../README.md)

Use this checklist to turn a locally working installation into a public service. The actual operator must verify every relevant item; never reuse local test configuration on the public internet.

Follow either [Docker Compose](./docker.md) or [manual Linux deployment](./manual.md) first. This is final acceptance, not a replacement for those guides.

## 1. Accounts and access

- [ ] After initializing a new database, sign in and immediately change the `root` password from `123456`.
- [ ] Create a separate day-to-day administrator; do not share a regular-user account.
- [ ] Disable unused registration methods, OAuth providers, and admin access paths.
- [ ] Confirm that regular users cannot open admin functions or change another user's balance.
- [ ] Apply reasonable rate limits to login, registration, redemption, upload, and generation.

## 2. Secrets and environment

- [ ] Generate different high-entropy values of at least 32 random bytes for `SESSION_SECRET` and `USER_TOKEN_SECRET`.
- [ ] Keep the real environment file in a restricted server directory; do not commit it or include backend secrets in frontend build variables.
- [ ] Confirm that all upstream API keys exist only in backend channel configuration.
- [ ] If a real key was used during testing, inspect usage and rotate it when appropriate.
- [ ] Preserve `USER_TOKEN_SECRET`; changing it invalidates existing user relay tokens.

PowerShell secret generation:

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
```

## 3. Domain and network

- [ ] Enable HTTPS and permanently redirect HTTP to HTTPS.
- [ ] Serve the frontend, `/api`, and `/v1` from one public origin where possible.
- [ ] Expose only 80/443; do not expose database, Redis, or backend admin port 3000.
- [ ] Restrict SSH and management ports with a firewall or cloud security group.
- [ ] Configure trusted proxy headers, real client IP, request-body limits, and image-request timeouts.

## 4. Database, cache, assets, and backup

- [ ] Use MySQL or PostgreSQL for public production; do not run a public service on single-file SQLite.
- [ ] Use a dedicated database account with a strong password and only the required database grants.
- [ ] Multiple backend instances share the same database, Redis, secrets, and asset filesystem.
- [ ] Automate database backups, retain an off-host copy, and run restore drills.
- [ ] Put `GOUO_ASSET_DIR` on persistent storage and back it up in the same window as the database.
- [ ] Confirm the asset directory is writable by one backend instance; before scaling, switch to a shared filesystem.
- [ ] Define retention for logs, accounts, orders, recycle-bin items, and API usage.

## 5. Providers and billing

- [ ] Configure a working OpenAI-compatible channel and the deployment's image-model mapping.
- [ ] Test generations, edits, and variations separately.
- [ ] Compare `GOUO_IMAGE_PRICE_CNY` with real upstream charges across sizes and quality levels.
- [ ] Verify successful charge, failure refund, and insufficient-balance rejection.
- [ ] Set per-user concurrency, request-rate, and spending limits to prevent abuse and surprise bills.

## 6. Credit and payments

- [ ] Before a payment provider is fully configured, expose only manual credit or redemption codes.
- [ ] Verify every payment callback signature and require HTTPS.
- [ ] Test success, failure, cancellation, duplicate notification, and delayed notification.
- [ ] Reconcile order value, user credit, and provider transaction ID.
- [ ] Publish prices, refunds, invoices, and support policy.

## 7. Content, security, and privacy

- [ ] Configure and validate upstream safety controls and retain request IDs for investigation.
- [ ] Confirm logs do not contain passwords, cookies, authorization headers, API keys, or private asset links.
- [ ] Publish terms, privacy policy, content rules, and infringement contact.
- [ ] Explain that prompts and references are sent to upstream providers and document storage locations and retention.
- [ ] Provide processes for account closure, data export, and data deletion.

## 8. Release verification

- [ ] Run `npm run build` and `npm test`.
- [ ] Run relevant backend checks and manually cover registration, sign-in, sign-out, credit, generation, charge, refund, and user center.
- [ ] Test first visit in a clean browser and authorization boundaries with a regular user.
- [ ] With an account that has local work, test migration, resumed sync, cross-browser restore, recycle bin, and quota exhaustion.
- [ ] Configure health, error-rate, upstream-latency, balance-anomaly, storage, and payment alerts.
- [ ] Document rollback and retain the previous image/binary plus pre-migration database and asset backups.

After completing the checklist, expose the service gradually with a small test cohort before opening registration and credit to all users.
