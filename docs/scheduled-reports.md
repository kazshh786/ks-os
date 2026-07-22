# Scheduled reports

Owners can create constrained `DAILY`, `WEEKLY` or `MONTHLY` schedules. Weekly schedules require Sunday–Saturday; monthly schedules accept `FIRST`, `LAST` or 1–28. Tenant cron strings are not accepted.

The schedule stores its IANA tenant timezone, local delivery time and UTC `next_run_at`. `nextReportRun` searches calendar dates in the tenant timezone and converts each local occurrence to UTC with `date-fns-tz`, so UTC offsets change correctly across daylight-saving transitions.

Due rows are selected inside a short database transaction with `FOR UPDATE SKIP LOCKED`. The transaction inserts `report_schedule_runs(schedule_id, scheduled_for)` under a unique constraint, creates the export job, links it to the run, and advances `next_run_at`. The unique occurrence is the idempotency boundary.

Selected user recipients must be active users in the same tenant when the schedule is created/updated. Inactive recipients are removed again at delivery time. Owner-entered operational email addresses are normalised and masked in list responses. Every email uses the existing outbox with `scheduled-report:{runId}:{normalisedEmail}` as its idempotency key, preventing duplicate delivery.

The `scheduled-report-ready` email links to the authenticated export-history page. That page requests a fresh short-lived Storage URL only after login and tenant authorisation. The export itself is not attached. Pausing clears `next_run_at`; resuming recalculates it from the current instant; deletion is soft so prior runs remain auditable.
