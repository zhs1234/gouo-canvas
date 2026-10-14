# Testing and local mock API

[简体中文](../zh-CN/testing.md) · [Documentation index](../README.md)

## 1. Frontend verification order

Run these first after a change:

```powershell
npm run build
npm test
```

`npm run build` runs the TypeScript project build and then the Vite production build. `npm test` runs the Vitest suite once.

Watch during development:

```powershell
npm run test:watch
```

Inspect the production build manually:

```powershell
npm run preview
```

Never edit `dist/` manually; rebuild it.

## 2. Backend smoke checks

Low-cost checks commonly used in this repository:

```powershell
Set-Location server
go test ./controller -run '^$'
go test ./relay/relay_util -run '^TestGouoImage'
```

The first compiles the `controller` package without running tests, catching route and type compilation failures. The second verifies Gouo fixed image-quota calculation. For other backend packages, follow `server/AGENTS.md` and run the relevant package tests, expanding scope when risk warrants it.

## 3. Local mock service

`scripts/mock-workspace-api.mjs` listens on localhost only and simulates accounts, the model catalog, image generation, and Agent tool calls without forwarding upstream requests or charging. See the [root README](../../README.md#free-local-mock) for startup steps and test accounts; run `node scripts/mock-workspace-api.mjs --self-test` for its self-check.

## 4. Manual regression checklist

Select all relevant cases for a change:

- Registration, sign-in, sign-out, and reauthentication.
- Generation, reference edit, variation, and masked edit.
- Successful charge, failure refund, and insufficient balance.
- Multiple images, partial failure, retry, and task-setting reuse.
- Search, filters, collections, batch download, and data import/export.
- Interrupted sync, recovery, cross-browser restore, recycle bin, and quota exhaustion.
- Dark mode, mobile input, modal scrolling, and PWA install guidance.

Bug reports should retain request ID, HTTP status, reproduction path, and a redacted response shape. Never paste a real API key, cookie, full relay token, or private user image URL.
