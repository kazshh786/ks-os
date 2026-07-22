# Phase 12.0 authentication report

Phase 12.0 is implemented as an additive authentication layer. It does not remove or replace the existing Phase 12 agency control plane, commercial plans, onboarding, GoCardless billing, fulfilment, support mode, audit, analytics, or operations work.

Delivered repository work:

- canonical `AGENCY`, `TENANT`, and `CUSTOMER` context contracts;
- multi-tenant membership support without changing operational membership foreign keys;
- central agency/owner/staff invitation intent and Supabase Admin provisioning;
- safe existing-Supabase-user onboarding;
- explicit server context resolution and deny-by-default guards;
- server-persisted business selection;
- context-specific application sessions, security versions, listing, local/global revocation;
- JWT-issued-at validity cutoffs for immediate global sign-out, suspension, deactivation, and MFA-recovery enforcement;
- separate agency and client login, callback, invitation, recovery, MFA, selection, access-denied, expiry, and security pages;
- tenant owner invitation, agency user lifecycle, and agency-controlled tenant-user session/lifecycle APIs;
- MFA recovery with two-person restriction and audit;
- Resend application-access notification template;
- environment matrix and development-only Auth Admin seed;
- RLS/grants and append-only access audit migration;
- automated contract/security/frontend coverage and operating documentation.

The customer portal remains separate and continues to use its existing magic-link and customer-account model.

Known external dependency: this environment exposed no Supabase MCP tools, so no remote project was inspected, migrated, seeded, or configured. Production completion requires authorised migration application plus Auth redirect, SMTP, rate-limit, MFA, grant, advisor, and end-to-end verification described in the companion documents.
