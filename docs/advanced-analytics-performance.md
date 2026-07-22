# Advanced analytics performance

Advanced analytics uses bounded, grouped PostgreSQL queries and `Promise.all` across independent aggregates. It does not fetch historical records into Node memory and never queries Stripe, Resend or Twilio.

The reporting migration indexes export history, worker claims, expiry cleanup, due schedules, schedule history and every new foreign key. Existing analytics depend on tenant/time indexes already used by Phase 8.1/8.2: appointments by tenant/start/created/status/client/service/staff, transactions by tenant/created/status and refunds by tenant/completed/status.

No cross-request cache is enabled in this phase. This avoids a tenant-keying risk while data volumes are small. If later profiling justifies a 5–15 minute cache, the key must contain tenant ID, UTC/local period, timezone, filters, grain, retention window and an analytics schema version. Cached values must never be shared between tenants.

Large operational exports remain asynchronous, capped and cursor-paged. The worker holds no database lock while querying reports or uploading Storage objects. Schedule claiming uses only a short transaction; email delivery happens after commit through the existing outbox.

Before adding materialised summaries, capture `EXPLAIN (ANALYZE, BUFFERS)` in a non-production environment with representative tenant data and add only indexes supported by the resulting plan.
