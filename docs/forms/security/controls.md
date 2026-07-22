# Intake-form security controls

All form tables are tenant-keyed, RLS-enabled and unavailable to Supabase browser roles. The Fastify service-role path performs membership, staff-assignment and customer-link checks. Public operations require a hashed assignment/resume token, expiry, bounded rate limits, strict Zod input and idempotency.

Published versions are append-only. Structured answers retain field key/version/type/classification for safe review and export. Sensitive answer data is excluded from logs, URLs and analytics. Staff review is operational-need access and should emit detailed access audit events when clinical role policy is finalised.

Private files require server-authorised signed operations, content validation, scanning and short-lived download URLs. The service role and storage secrets never enter browser bundles. Storage upsert is not used for customer evidence.

Regex validation is length-limited; custom CSS and arbitrary formulas are not accepted. Redirect destinations, if enabled later, must use an allowlist. AI-assisted drafts are not enabled: any future provider must receive no customer answers, create drafts only, and pass the same schema and publishing checks.

Performance targets: field cap 250, page cap 30, rules cap 200, options cap 250, bounded undo history 50, debounced saves and memoised renderer state. For very large option catalogues, add virtualised searchable selectors before raising limits.
