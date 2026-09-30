# V2 workspace instructions

Read root AGENTS.md and START_HERE_V2.md. Use npm only, inside `v2/`.

- `apps/studio`: React UI, routes, query integration. No provider SDKs/keys or direct `/v1` calls here.
- `apps/api`: Node/Fastify business adapter. Validate account Bearer tokens against New API; gateway relay credentials remain server-side. Default generation is disabled. Contract fixtures must not call real paid models.
- `packages/ui`: small shared presentation components. Do not build another image engine.
- `packages/contracts`: framework-independent types and validation. Public DTOs must not include keys, internal channel base URLs or cross-user asset paths.
- `scripts`: setup and explicit operator probes. Setup/CI must not incur model costs.
- `tests`: native Node contract/probe tests and Playwright browser checks. Test filenames intentionally avoid legacy Vitest's `*.test.*`/`*.spec.*` discovery.

The user selected Loomic's mature creative frontend, pinned at `bdb47a5adf900b48615af0bd914336e3770021b5`. Source is in `apps/studio/src/loomic`, with upstream MIT license and file provenance. Preserve the native canvas, toolbar, panels and chat layout; use thin Vite/router/New API adapters. Excalidraw is its sole canvas engine. Do not restore the prior Fabric shell, add another engine, or enable Supabase/credits/cloud storage without a new requirement. Local drafts use IndexedDB and are not cloud or secure shared-device storage. See `docs/v2/LOOMIC.md`.

Video generation is a future extension; retain the upstream rendering contracts, keep its action disabled, and do not add video clipping. The current agent transport returns an HTTP event batch; it is not a WebSocket streaming service or a durable job worker. The local SQLite idempotency guard is not subscription/usage accounting.

Use capability-driven forms. Keep unsupported/unverified models disabled. Additional quality values such as xhigh/max must remain strings from channel capability data, not old global enums.

Dependencies: add only used packages, update package-lock.json and docs/v2/DEPENDENCIES.md. The initial lockfile is committed from a successful GitHub Actions run. Use npm ci. Network is still required for uncached packages. Do not regenerate the dependency graph without an intentional upgrade or fabricate integrity hashes.
