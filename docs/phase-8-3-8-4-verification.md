# Phase 8.3–8.4 verification

## Automated checks

Implementation-time focused checks:

- Contracts and CSV privacy/injection tests: passed.
- Daily, weekly, monthly and Europe/London DST recurrence tests: passed.
- Advanced analytics minimum-sample and integer-money tests: passed.
- Export UI, schedule pause and insufficient-data UI tests: passed.
- API and web isolated typechecks: passed after implementation.

Full monorepo command results are recorded at final handoff. The baseline before changes passed typecheck, lint and build. Its API test suite had six existing environment-dependent failures: missing `DATABASE_URL`, a session-route expectation mismatch, and booking tests attempting an unavailable local PostgreSQL connection.

## Environment-limited manual checks

No production migration or deployment was performed. A complete live export requires the reviewed migration, a private `report-exports` bucket, `SUPABASE_SECRET_KEY`, an externally invoked report worker, `PUBLIC_APP_URL`, the earlier email-outbox migration and representative tenant data. The current local environment did not provide a database URL or an authenticated browser session, so live Storage upload, signed-link expiry and email-provider delivery must be verified after those prerequisites are deliberately provisioned.

Manual verification should cover: queue an appointment export; run the export worker; inspect the private object; download as its tenant; deny a second tenant; expire and clean it up; check clients/forms/communications for excluded fields; queue one weekly occurrence; verify one run and one outbox row; pause/resume across DST; reconcile revenue with Phase 8.1/8.2; confirm low samples and forward-booking labels; inspect logs for content, email and signed-URL leakage.
