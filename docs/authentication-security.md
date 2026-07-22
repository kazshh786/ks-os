# Authentication security

Security invariants:

- Supabase establishes identity; local records establish authorization.
- Every authenticated API request declares one context.
- Tenant scope is derived from a verified membership and server-side selection.
- Agency roles and capabilities are server-owned.
- Customer accounts never inherit agency or tenant access.
- Admin Auth APIs use a server-only client with refresh, persistence, and URL detection disabled.
- Browser roles have no grants on membership, invitation, session, or access-audit tables.
- Access audit is append-only; tokens, links, passwords, MFA secrets, and raw IP addresses are forbidden.
- Sensitive response models use opaque public references.
- Login is protected by Supabase Auth rate limits; reset, invitation acceptance, resend, support, session, and MFA recovery endpoints also have Fastify limits.
- Account-existence responses are neutral.
- Global sign-out, suspension, deactivation, and MFA recovery advance a server-owned session-validity cutoff checked against the verified JWT `iat` claim.

The Phase 12.0 migration enables RLS and revokes `anon`/`authenticated` privileges for `users`, `account_invitations`, `application_sessions`, and `account_access_audit_events`. Server code always filters by verified identity plus tenant/context; indexes lead with those policy columns to avoid full scans.

Before production, run migration review, Supabase security advisors, grant inspection, redirect/SMTP tests, bundle secret scanning, and cross-context browser tests. Do not apply the migration automatically to production.
