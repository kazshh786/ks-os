# Phase 9.1 verification

Contracts/database/API/web typechecks, lint, and the production build pass. Contract tests cover request-body role/tenant rejection, immutable identity/profile fields, duplicate service assignment, invalid schedules and supported booking channels. The first full test sweep exposed legacy fixtures without the new non-null status field; the auth guard was made migration-compatible and representative client/public/team suites then passed 14/14. Complete database/browser verification requires applying the reviewed migration to a dedicated development database and configuring Supabase custom SMTP, `SUPABASE_SECRET_KEY`, and `TEAM_INVITE_REDIRECT_URL` with fictitious addresses.

Verify invitation resend/cancel/accept, cross-tenant denial, availability exclusion, future-appointment impact, access denial after deactivation and restoration after reactivation. Phase 9.2 advanced permissions and all payroll/leave/commission features remain out of scope.
