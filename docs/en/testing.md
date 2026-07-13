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
go test ./relay/relay_util -run '^TestGetFixedImageQuota$'
```

The first compiles the `controller` package without running tests, catching route and type compilation failures. The second verifies Gouo fixed image-quota calculation. For other backend packages, follow `server/AGENTS.md` and run the relevant package tests, expanding scope when risk warrants it.

## 3. What the mock API covers

`scripts/mock-image-api.mjs` reproduces browser image API failures, including:

- API or image-URL CORS failures.
- HTTP errors, invalid JSON, empty responses, and wrong response shapes.
- Image download 404 and redirect-to-CORS failures.
- Slow responses and alternating failures.
- SSE event-format errors, failure events, and missing final images.
- Custom synchronous and asynchronous provider extraction and polling errors.

It is a development utility, not a production image service.

## 4. Start the mock API

```powershell
npm run mock:api
```

It listens at `http://127.0.0.1:8787` by default. To change the port:

```powershell
$env:MOCK_IMAGE_API_PORT = '8788'
npm run mock:api
```

## 5. Test in frontend-only mode

Product mode hides API settings and forces the user relay token. Before testing the mock, disable product mode in `.env.local`:

```dotenv
VITE_GOUO_BACKEND_ENABLED=false
VITE_GOUO_BACKEND_URL=
VITE_GOUO_BACKEND_DEV_TARGET=
```

Restart `npm run dev`, then create an OpenAI-compatible profile under **设置 → API** (Settings → API):

- API URL: for example `http://127.0.0.1:8787/url-ok`
- API key: any non-empty test value, such as `mock`
- API mode: `Images API`
- Model: any value, such as `mock`

The mock reads request `n` and returns up to 10 results. Set output count to 2 or more for multi-output and partial-failure tests.

## 6. OpenAI-compatible scenarios

| Path | Expected behavior |
| --- | --- |
| `/url-ok` | CORS-enabled image URL; task succeeds |
| `/b64` | `b64_json`; task succeeds |
| `/url-cors-block` | API succeeds but image download fails CORS |
| `/url-404` | Returned image URL responds 404 |
| `/url-redirect-cors-block` | Redirect target lacks CORS headers |
| `/wrong-shape` | JSON is not OpenAI `data[]`; raw response is available |
| `/no-recognizable` | `data[]` contains neither URL nor base64 |
| `/empty` | Empty `data[]` |
| `/http-error` | API returns HTTP 500 |
| `/invalid-json` | API returns invalid JSON |
| `/slow` | Delayed response for timeout testing |
| `/api-no-cors` | The API request itself fails CORS |
| `/alternating-http-error` | Every other request returns HTTP 500 |

When image extraction fails, task details should retain the raw response or raw image links for diagnosis instead of showing only a generic error.

## 7. Streaming scenarios

Enable streaming in the API profile, then use:

| Path | Expected problem |
| --- | --- |
| `/stream-unsupported` | Server rejects streaming |
| `/stream-invalid-json` | SSE `data:` is invalid JSON |
| `/stream-no-data` | No valid `data:` event |
| `/stream-failed-event` | A `*.failed` event arrives |
| `/stream-error-object` | An error object arrives |
| `/stream-no-final` | Intermediate images without a final image |
| `/stream-no-usable` | Completion event without a usable image |

Responses API mode can use the same paths to validate extraction and streaming failures.

## 8. Custom-provider tests

The mock exposes:

- `custom/random-image` for a synchronous custom JSON response.
- `custom/async-submit` and `custom/tasks/{task_id}` for submit-and-poll behavior.

Use **Settings → API → Custom provider** to create or import a manifest, then set its base URL to `http://127.0.0.1:8787`. The application's **Copy LLM prompt** action is maintained together with the actual manifest schema, avoiding a second long prompt copy in documentation that can drift.

Useful asynchronous model values:

- `mock:url-ok`
- `mock:b64`
- `mock:async-failure`
- `mock:async-no-task-id`
- `mock:async-empty`

They exercise successful polling, base64 extraction, reported failure, missing task ID, and successful status without images.

## 9. Manual regression checklist

Select all relevant cases for a change:

- Registration, sign-in, sign-out, and reauthentication.
- Generation, reference edit, variation, and masked edit.
- Successful charge, failure refund, and insufficient balance.
- Multiple images, partial failure, retry, and task-setting reuse.
- Search, filters, collections, batch download, and data import/export.
- Interrupted sync, recovery, cross-browser restore, recycle bin, and quota exhaustion.
- Dark mode, mobile input, modal scrolling, and PWA install guidance.

Bug reports should retain request ID, HTTP status, reproduction path, and a redacted response shape. Never paste a real API key, cookie, full relay token, or private user image URL.
