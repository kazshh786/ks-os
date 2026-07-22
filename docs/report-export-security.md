# Report export security

The `report-exports` Supabase bucket is private, CSV-only and limited to 10 MiB. The service-role key is read only in the API storage adapter and must never be exposed to the web application. Browser code never receives or submits an object path.

Object keys are `{tenant UUID}/{job UUID}/{random UUID}.csv`; tenant names and customer names are excluded. The API verifies authentication, owner role, tenant ID, `READY` status, object-path presence and retention expiry before asking Supabase for a short signed URL. Signed URLs are neither persisted nor logged. Fastify response bodies and request URLs are redacted.

The three reporting tables have RLS enabled and all privileges are revoked from `anon` and `authenticated`; access is through the trusted API/worker only. Every lookup, update and join includes tenant scope. New-table foreign keys and unique schedule-occurrence constraints provide additional integrity.

Exports use explicit column functions rather than raw rows. Medical notes, appointment notes, form answers, acknowledgement data, communication bodies, provider payloads, secure links/tokens, internal refund notes, auth IDs and storage paths are excluded. CSV formula injection is neutralised.

The migration and bucket definition are not applied automatically. Before production use, verify that `SUPABASE_SECRET_KEY` is server-only, run database advisors, inspect the private bucket, test cross-tenant 404/denial behaviour, and confirm cleanup is called after the configured retention window.
