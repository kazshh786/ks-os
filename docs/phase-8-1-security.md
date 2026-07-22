# Phase 8.1 security

The route calls `requireAuth`, rejects non-owner roles, and scopes every SQL source by the authenticated tenant. Contracts do not accept tenant IDs. Analytics are served through Fastify's direct Postgres connection; no new Supabase Data API table, view, function, grant, or RLS policy was created.

The response contains aggregate counts, integer minor-unit amounts, service names, and staff names only. It excludes customer names, contact details, medical data, form content/answers, internal notes, secure tokens, card/bank data, and provider secrets. Logs contain tenant ID, preset, duration, query category, and stable error code—not full results or raw SQL errors. Live provider failures never activate mock analytics.
