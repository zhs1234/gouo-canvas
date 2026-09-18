# Studio business domain (new, additive)

This nested scope is approved for new V2 architecture. Read server/AGENTS.md for Go commands/style and docs/v2/ARCHITECTURE.md for V2 boundaries. It does not authorize rewriting legacy relay/auth/payment modules wholesale.

Use the existing Go module, Gin, GORM and sessions. Add domain packages for projects/assets/jobs/models/subscriptions/usage. Wire routes only when their implementation and authorization tests exist. No placeholder successful handlers.

Authenticate every business request; derive user ID from verified middleware. A worker must not rely on client-supplied ownership, prices, quotas, URLs, status or model capability claims.

A job and its entitlement reservation/outbox must be transactionally persisted before external submission. Repeated worker deliveries and payment events must be idempotent in the database, not merely process-local locks. An unknown upstream submission outcome becomes reconciling, not automatic resubmission.

Existing payment SDKs/storage drivers may be reused, but their current handlers do not establish correct subscription settlement/private asset access. Review and test before connecting paid paths. Keep old wallet settlement separate from V2 subscription usage to avoid double charges.

Do not expose internal service tokens via user token APIs. Prefer vetted direct server-side adapters when the legacy gateway demonstrably lacks required capabilities; no browser bypass.
