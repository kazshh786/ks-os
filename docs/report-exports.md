# Report exports

`POST /api/v1/report-exports` queues a `PENDING` CSV job. The worker claims jobs with `FOR UPDATE SKIP LOCKED`, reads Phase 8.2 reports in pages of 100, enforces the configured row ceiling and a 10 MiB file ceiling, uploads once, and marks the job `READY`. An oversized export fails with `EXPORT_LIMIT_EXCEEDED`; rows are never silently truncated.

Export allowlists are defined in `report-csv.ts`:

- Appointments: public booking reference, dates, display names, status/channel, quoted amount and payment state.
- Clients: client reference, display name, first/last completed appointment, activity counts, recorded spend and future booking count.
- Services/staff/products/stock: named operational aggregates only.
- Payments/refunds: safe local transaction/refund fields and integer minor-unit amounts; no provider secrets or internal notes.
- Forms: assignment/completion metadata only; no answers, acknowledgement data or public tokens.
- Communications: channel, category, masked recipient, safe timestamps/status/failure category; no body, secure link, token or webhook payload.

CSV cells beginning with spreadsheet formula characters are prefixed with an apostrophe and RFC-style quoting handles commas, quotes and newlines. Storage/download filenames contain report/date labels only; customer names are never used.

History endpoints are tenant-scoped and owner-only. `POST /api/v1/report-exports/:exportId/download` ignores browser-supplied paths, rechecks tenant, status and retention expiry, and mints a new signed URL for 30–300 seconds. Pending exports may be cancelled. Cleanup deletes Storage objects first and then clears their paths and marks rows `EXPIRED`.
