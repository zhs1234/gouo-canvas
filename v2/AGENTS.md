# V2 workspace instructions

Read root AGENTS.md and START_HERE_V2.md. Use npm only, inside `v2/`.

- `apps/studio`: React UI, routes, query integration. No provider SDKs/keys or direct `/v1` calls here.
- `packages/ui`: small shared presentation components. Do not build another image engine.
- `packages/contracts`: framework-independent types and validation. Public DTOs must not include keys, internal channel base URLs or cross-user asset paths.
- `scripts`: setup and explicit operator probes. Setup/CI must not incur model costs.
- `tests`: native Node contract/probe tests and Playwright browser checks. Test filenames intentionally avoid legacy Vitest's `*.test.*`/`*.spec.*` discovery.

Fabric.js is the selected editor engine, not a complete editor product. Existing proof supports local images/text/transforms/delete/PNG export only. Add undo/redo, layers, project persistence and templates in E1 with real tests, not menu placeholders.

Use capability-driven forms. Keep unsupported/unverified models disabled. Additional quality values such as xhigh/max must remain strings from channel capability data, not old global enums.

Dependencies: add only used packages, update package-lock.json and docs/v2/DEPENDENCIES.md. First initialization may need network; after lockfile exists use npm ci. Do not fabricate lockfile integrity hashes.
