# Phase 8.1 verification

Automated coverage includes tenant-timezone today/yesterday/week/month/custom periods, previous boundaries, 366-day validation, UK 23/25-hour DST dates, zero-safe comparisons, tenant propagation, rate/money calculations, null utilisation, and frontend loading/error/retry/empty/period/currency behaviour.

Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`. The pre-implementation baseline had six unrelated API failures: two bootstrap/session expectations and four booking tests requiring local Postgres. Validate the overview against a dedicated database with two tenants, successful/manual/Stripe checkouts, partial/full refunds, cancelled/no-show appointments, schedules, incomplete forms, failed communications, and open disputes. Confirm staff receive 403, Tenant B cannot observe Tenant A, UTC boundaries match each tenant timezone, browser console is clean, and disconnecting the API shows the retry state without mock KPIs.
