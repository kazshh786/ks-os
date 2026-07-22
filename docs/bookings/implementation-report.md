# Booking operations implementation report

## Delivered layers

- Shared booking-page, operations, hold, source and analytics contracts.
- Drizzle models and an additive migration with tenant isolation, indexes and least-privilege grants.
- Tenant-user-aware booking authorization.
- Page settings, publish/unpublish, custom-domain pending state and analytics APIs.
- Public page resolution, scoped catalogue, exact availability, holds, idempotent booking creation and privacy-safe attribution.
- Bounded operational list/detail/export APIs, direct staff booking creation, status, reschedule, cancellation and audit events.
- Dashboard command centre, dedicated calendar/list workspaces, quick view and responsive public booking flow.
- Booking Page settings with responsive preview.
- Focused contract/unit/API/component tests and operational documentation.

## Release sequence

1. Review unrelated dirty-tree work before composing commits; this implementation was developed alongside earlier integrations/forms changes.
2. Run the migration plan and inspect the pre-existing ledger mismatch. Do not apply only the latest migration out of order.
3. Back up and apply all approved migrations in a disposable staging database.
4. Deploy API with `BOOKING_RATE_LIMIT_SALT` and `BOOKING_SLOT_HOLD_MINUTES` configured.
5. Deploy web, then smoke-test authenticated and signed-out routes.
6. Create a service/staff schedule, publish a page, book a real staging slot, exercise a conflict, and verify dashboard/calendar visibility.
7. Exercise Stripe only with staging/test credentials and verify webhook-driven state.
8. Observe API errors, hold conflicts/expiry, checkout failures, notification outbox failures and booking funnel abandonment before production promotion.

## Rollback

The UI/API deployment can be rolled back independently while the additive columns/tables remain. Do not drop populated booking tables during an emergency rollback. Disable a problematic page through its publish state, roll back application code, then prepare a reviewed forward migration for schema correction.

## Known repository-wide risks

The migration ledger reported all 25 migrations as pending, including migrations that predate this feature; migration application requires an environment owner and ledger reconciliation.

`pnpm audit --prod --audit-level high` currently reports nine repository dependency findings (seven high): Fastify 4 is below the advisory's Fastify 5 patch line, Drizzle ORM 0.31 is below its identifier-escaping patch line, and transitive `fast-uri` versions are affected by several parsing advisories. These are cross-cutting framework upgrades and were not silently forced into the booking change. Production promotion should remain blocked until an owner plans, tests and deploys the Fastify/Drizzle upgrade or records an explicit, time-bounded risk exception.
