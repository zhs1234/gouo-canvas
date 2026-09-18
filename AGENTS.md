# Gouo Canvas — repository instructions

## Active assignment

The user approved V2: a multi-model ecommerce image SaaS, monthly subscriptions, no video. Prefer mature reusable projects and migrate proven capabilities; do not preserve the old Playground interaction at the expense of the product goal.

Start with `START_HERE_V2.md`, then `docs/v2/TASKS.md`. This repository must explain the assignment without access to the original chat.

## Scope and safety

- V2 workspace: `v2/`. It has its own npm workspaces, configuration and dependencies. Do not make the root legacy package an npm workspace or replace its lockfile.
- Existing `src/` and `server/` remain functional references. Do not delete, mass-move or reformat them. Read nested AGENTS.md before editing.
- New Go business domains belong under `server/internal/studio/`; mount them additively behind authenticated `/api/studio/*`. Reuse existing Gin/GORM/session infrastructure. A modular monolith is the initial design, not a new microservice fleet.
- Work on `v2` or a task branch derived from it. Never push/merge to `main`, reset shared history, run production migrations or deploy without a separate request. In detached Codex environments verify the checked-out commit contains the V2 starter, then use a task branch.
- Do not change repository visibility, permissions, secrets, production credentials, balances or existing subscription entitlements.

## Truthfulness and external APIs

- Read implementation, not only README claims. Existing SDKs are reusable starting points, not evidence of safe paid production operation.
- `image2.5` is ambiguous shorthand. Official GPT Image 2.5 candidates are documented in `docs/v2/MODELS.md`. Do not guess a provider alias or assume it is Gemini 2.5.
- Never claim a model works because its name appears in a list. Distinguish planned, contract-tested and live-verified capabilities per channel/version.
- Real image probes may cost money. Do not run them automatically in setup/CI; require configured credentials and explicit paid-test authorization. Never expose keys via VITE_*, browser storage, logs or tracked files.
- Do not silently discard unsupported options, downgrade models, resubmit ambiguous paid requests, or call a different provider without the configured privacy/cost policy.

## Implementation style

TypeScript + React, readable small domain modules, existing Go conventions. UI Chinese by default. Use TanStack Query for server data, isolated editor state for Fabric, and no replacement mega-store. Prefer established package capabilities over home-grown engines. Add a dependency only when a concrete task uses it; record its license and integration reason.

Do not invent successful API responses, simulated payment success, fake AI outputs, empty handlers or TODO stubs and call them completed features. Explicit development fixtures are allowed only in tests or clearly labeled local demos. Missing provider credentials should not block unrelated implementation/testing.

## Commands

From repository root:

```sh
node v2/scripts/setup.mjs
cd v2
npm run check
npm run dev
```

Browser tests: from `v2`, `npx playwright install chromium && npm run test:e2e`.
Legacy checks when legacy code changes: root `npm ci && npm run build && npm test`; Go checks as documented under `server/AGENTS.md`. Do not remove failing tests to pass CI.

## Completion contract

Each task: implement only its coherent scope, add negative/authorization/idempotency tests, run relevant checks, update `docs/v2/STATUS.md` with actual command results, and leave a reviewable commit. Report changed files, behavior, tests, unresolved gates and next task ID. A preparation scaffold is not a completed SaaS.
