# Phase 8.1 dashboard report

Phase 8.1 replaces the prototype dashboard's browser-side catalogue-price arithmetic and hard-coded trends with an owner-only, server-authoritative overview. `/api/v1/dashboard/overview` derives the tenant from authentication, resolves reporting boundaries in `tenant.timezone`, and runs a bounded set of aggregate queries. `/app/dashboard` provides period controls, previous-period comparisons, booking/revenue/client KPIs, operational attention counts, daily trends, top services, and staff activity.

The dashboard is read-only. It never calls Stripe, Resend, or Twilio live and never writes aggregates into operational records. Staff retain the calendar home and cannot access tenant-wide financial analytics. Live API errors render an error/retry state rather than mock values. Advanced forecasting, AI insights, payroll, commission, exports, scheduled reports, and arbitrary formulas remain excluded.

No schema object was added. The Supabase CLI was unavailable locally, so no migration filename was invented. Recommended indexes are documented in the performance report for a separately reviewed migration.
