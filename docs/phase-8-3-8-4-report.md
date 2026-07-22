# Phase 8.3–8.4 implementation report

Phase 8.3 adds asynchronous CSV export jobs for the ten Phase 8.2 reports, private Supabase Storage, owner-authorised signed downloads, expiring history, recurring schedules and schedule-run history. Phase 8.4 adds owner-only advanced analytics at `/app/analytics` using tenant-scoped aggregate SQL.

The implementation reuses `ReportsService`, `resolveAnalyticsPeriod`, the automation worker authentication convention and the durable email outbox. It does not add an HTTP-time CSV generator, a second email worker, an in-process timer, arbitrary cron, arbitrary SQL, public sharing or mock fallback.

Database changes are in `packages/database/migrations/20260719210000_phase_8_3_8_4_reporting_analytics.sql`. The migration is intentionally unapplied and must be reviewed before use in any connected environment.

Worker calls, authenticated with `AUTOMATION_WORKER_SECRET`, are:

- `POST /api/v1/internal/report-worker/schedules` to create one idempotent run/export per due occurrence.
- `POST /api/v1/internal/report-worker/exports` to generate bounded exports and enqueue ready emails.
- `POST /api/v1/internal/report-worker/cleanup` to remove expired objects before marking history expired.

Required runtime configuration is `SUPABASE_URL`, server-only `SUPABASE_SECRET_KEY`, `AUTOMATION_WORKER_SECRET`, `PUBLIC_APP_URL` (or `WEB_APP_URL`) and the existing email sender variables. Optional limits are `REPORT_EXPORT_MAX_ROWS`, `REPORT_EXPORT_MAX_ACTIVE_PER_TENANT`, `REPORT_EXPORTS_PER_USER_HOUR`, `REPORT_EXPORT_RETENTION_HOURS`, `REPORT_EXPORT_SIGNED_URL_SECONDS` and `ANALYTICS_MINIMUM_SAMPLE_SIZE`.

Current known data limitation: the connected database inspected during implementation did not contain every earlier-phase prerequisite table (notably refund/form/email/SMS reporting tables). Missing prerequisites return safe data-unavailable errors; they are not replaced with mock data.
