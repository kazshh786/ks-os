# Phase 8.2 report performance

Each list applies filters, deterministic ordering, `LIMIT limit + 1`, and cursor-derived `OFFSET` inside Postgres. Summaries are aggregate SQL over the same filter set. Related names and metrics use joins/CTEs rather than per-row queries. Staff schedules use one `generate_series`; product arrays are expanded only for bounded transaction periods except the current-stock last-sale lookup. Provider APIs are never called.

The connected Supabase project currently has the appointment availability index `(tenant_id,user_id,start_time,end_time)` plus primary/uniqueness indexes, but it does not yet contain the prerequisite forms, refunds, email, or SMS tables. Representative staging `EXPLAIN (ANALYZE, BUFFERS)` should review these candidate additions separately after those migrations are approved:

- `appointments(tenant_id,start_time,status,id)`
- `appointments(tenant_id,client_id,start_time)`
- `appointments(tenant_id,user_id,start_time)`
- `appointments(tenant_id,service_id,start_time)`
- `checkout_transactions(tenant_id,created_at,payment_status,id)`
- `stripe_refunds(tenant_id,created_at,status,id)`
- `email_outbox(tenant_id,created_at desc,id)`
- `products(tenant_id,name,id)`

No index migration was created. The connected dataset currently contains only two appointments and no checkout transactions or products, so sequential scans on several tiny tables are expected and do not justify write amplification. The live staff plan completed in 1.623 ms without disk reads. Index decisions should be repeated against representative staging volume after the missing prerequisite migrations are explicitly approved.

Offset cursors are opaque and deterministic because every sort has an ID tie-breaker. They are suitable for operational browsing; very deep pages may later move to value-and-ID keyset cursors after representative query profiling.
