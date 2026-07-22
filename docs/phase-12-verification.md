# Phase 12 verification

## Automated

Run from `KS-OS-Platform`:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Apply the Phase 12 migration to a disposable Supabase project and inspect all new tables with browser roles (`anon`, `authenticated`) to confirm direct reads and writes fail. Confirm `service_role` cannot update/delete `platform_audit_events`.

## Security walkthrough

- Agency user without a database row is rejected.
- Privileged `aal1` session receives `AGENCY_MFA_REQUIRED`; verified TOTP `aal2` succeeds.
- Revoked/expired agency and support sessions fail immediately.
- Support token is absent from URLs, logs and database plaintext.
- Support banner shows tenant, reason and expiry; finance/refund/team/Stripe/provider changes return `SUPPORT_ACTION_BLOCKED`.
- Every agency mutation creates an audit event with the true actor.
- Cross-tenant identifiers do not expose another tenant's data.

## Commercial walkthrough

- Create each package, assign/override it and exceed boolean/quantity/usage limits.
- Verify a downgrade over staff/location limits returns blockers and preserves data.
- Complete the twelve onboarding stages; deliberately fail every launch prerequisite.
- Use GoCardless sandbox Hosted Payment Pages and replay signed duplicate webhooks.
- Verify failure enters grace, recovery reactivates, cancellation is scheduled, and Stripe data never changes MRR.
- Create/update a deliverable, approval and time entry; check workload totals.
- Retry one allowlisted failure and reject one unsafe failure.
- Request an agency export and verify private, expiring storage delivery when the worker is configured.

## Local baseline note

Before Phase 12, typecheck/build and all 32 web tests passed. The API suite had 207/213 passing with six existing failures caused by missing local `DATABASE_URL`, the obsolete unauthenticated session expectation and booking database expectations. Compare final results against that baseline rather than attributing those six to Phase 12.

## Final local result

Phase 12 typecheck, lint and production build pass. All 32 focused agency tests and all 32 web tests pass. The expanded API suite finishes at 239/245, retaining exactly the six baseline failures above and introducing no additional regression failures. The production web build retains the existing large-main-chunk warning. Database migration and GoCardless sandbox execution remain deployment-environment checks because this workspace has no configured Postgres/Supabase or GoCardless credentials.
