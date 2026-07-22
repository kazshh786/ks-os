# Phase 7.2 verification

Verification covers strict Zod inputs, deterministic dedup keys, build/typecheck/lint, API and web tests, and migration review. The reconciliation worker is called with `Authorization: Bearer $OPERATIONS_WORKER_SECRET` at `POST /api/v1/internal/operations-reconciliation`.

Operational acceptance checks: permanent email/SMS failure appears once; recurrence increments the same issue; delivered recovery resolves it; owner summaries count all actionable tenant issues; staff cannot retrieve finance/Stripe/team-wide or another staff member's appointment issue; retry preserves source idempotency.
