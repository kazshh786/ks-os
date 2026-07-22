# Phase 8.1 performance

The overview uses six concurrent repository operations: two period summaries, operations, service ranking, staff utilisation, and daily trend. Each is an aggregate SQL query; there is no query per service, staff member, or day and no historical result set is loaded into JavaScript. Daily zero rows use `generate_series` inside Postgres. Provider APIs are never called.

Confirmed query patterns would benefit from separately reviewed indexes on `appointments(tenant_id,start_time)`, `appointments(tenant_id,status,start_time)`, `checkout_transactions(tenant_id,created_at,payment_status)`, and `stripe_refunds(tenant_id,completed_at,status)`. Existing form and SMS indexes are reused. The local Supabase CLI was unavailable, so Phase 8.1 deliberately did not invent or hand-name a migration; capture execution plans against representative staging data before adding these indexes.

No cache was added. This avoids cross-tenant cache risk and keeps values current; a future 30–60 second cache must include tenant, UTC range, timezone, and currency in its key.
