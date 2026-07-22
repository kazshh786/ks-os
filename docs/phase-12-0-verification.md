# Phase 12.0 verification

## Automated commands

Run from `KS-OS-Platform`:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The focused authentication suite validates explicit contexts, multi-tenant constraints, public response references, invitation states, existing-user handling, password setup, session revocation, membership-specific suspension, MFA recovery, reset neutrality, RLS/grants, append-only audit, browser storage boundaries, and development seeding.

Local verification on 20 July 2026:

- `pnpm typecheck`: passed for all workspaces;
- `pnpm lint`: passed;
- focused API security/agency/team/customer suite: 123 passed;
- focused authentication UI suite: 3 passed;
- full web suite: 35 passed;
- full API suite: 258 passed; the runner reports 3 failures because the two booking subtest failures also fail their parent suite;
- `pnpm build`: passed; Vite reported the existing large-chunk warning;
- production bundle secret-identifier scan: no server-secret identifiers found.

The full API suite no longer overrides database-backed tests to dummy `localhost:5432` connection strings. Mocked tests inherit the configured Supabase `DATABASE_URL`, and the booking authorization assertions stub their transaction boundary explicitly so they do not accidentally reach a local PostgreSQL fallback.

## Development seed

Set a local-only `KS_OS_DEV_AUTH_PASSWORD` of at least 10 characters, configure a non-production Supabase project and database, then run `pnpm seed:auth:dev`. The script uses Auth Admin rather than writing `auth.users` directly and refuses production mode.

It creates a development Platform Owner identity for `kasim@kasimshah.com`, plus fictitious `@ksos.local` identities for agency support, Salon A owner/staff, Salon B owner, a multi-business user, customer, and suspended member, plus an expired invitation. The password is read from the environment and is never committed.

## Browser matrix

Verify agency password + enrolment + challenge, tenant credentials denied from agency, owner/staff invitation acceptance, existing-user invitation, multi-business selection, membership-specific suspension, global sign-out, reset/password invalidation, support-mode start/end/audit, and preserved customer magic-link access. Inspect Application/Network and built assets for service keys, tokens, tenant IDs, passwords, and MFA material.

Local in-app browser verification confirmed the business and agency login pages render with empty credential fields and separate recovery links; reset, session-expired, access-denied, and invalid-callback states render safely; `/agency` redirects to agency login; `/app` redirects to business login; unauthenticated `/select-business` is denied; and the customer portal shows its live-unavailable state rather than mock data when the API is absent. No browser console warning/error was emitted during this route matrix. Credential, invitation, MFA, support-session, and customer magic-link completion still require the connected non-production Supabase/database environment described below.

## Environment status

The repository migration is committed but is not applied automatically. Remote Supabase Auth, SMTP, users, redirect allowlist, RLS, grants, advisors, and migration history still require an authorised environment connection. Record that evidence here when completed; do not substitute mock or seeded results for live verification.
