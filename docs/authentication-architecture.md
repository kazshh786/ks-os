# Authentication architecture

KS OS uses one Supabase Auth identity provider and three independent application contexts: `AGENCY`, `TENANT`, and `CUSTOMER`. A valid Supabase session proves identity only. Fastify then resolves the explicitly requested context from server-owned records and calculates permissions. A URL never grants or selects a context.

The browser sends `X-KS-Application-Context` on authenticated API calls. The API verifies the bearer token with `getClaims`, reads the `sub`, `session_id`, `aal`, and expiry claims, and then checks the corresponding local record:

- agency access: active `agency_users` record, role capabilities, security version, agency session, and AAL2 where required;
- business access: active `users` membership plus active tenant, selected server-side by the verified Auth session;
- customer access: active `customer_accounts` record, resolved only on customer routes.

`users.id` remains the operational tenant-membership key referenced by appointments, schedules, and audit records. `users.auth_user_id` is a separate nullable Supabase identity key. This preserves existing foreign keys while permitting one identity to have memberships in several tenants.

Application context and business selection live in `application_sessions`, keyed by the verified Supabase `session_id`. The browser does not persist a tenant identifier. API responses use opaque public references and do not return Supabase user IDs or internal tenant/member IDs.

Support mode is the sole agency-to-tenant bridge. It requires an active, unrevoked, short-lived `agency_support_sessions` record and retains both agency actor and tenant in append-only audit events.

Passwords, refresh tokens, invite tokens, TOTP secrets, and recovery links are never stored in application tables or logs.

