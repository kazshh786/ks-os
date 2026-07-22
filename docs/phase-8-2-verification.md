# Phase 8.2 verification

## Automated coverage

Focused API tests cover strict allowlisted sorts, limit/range validation, opaque cursors, payment-source distinctions, partial/full refund state, masked recipients, authenticated tenant propagation, timezone period reuse, owner denial, stable errors, and strict rejection of sensitive appointment fields.

Focused web tests cover the ten-report navigation, live loading, currency formatting, responsive semantic tables, period/status filters, next/previous cursors, error/retry, honest empty state, and absence of mock rows after failure.

Pre-change baseline on 19 July 2026:

- `pnpm typecheck`: passed;
- `pnpm lint`: passed;
- `pnpm build`: passed with the existing Vite chunk-size warning;
- web tests: 17/17 passed;
- API tests: 75/81 passed. Six existing failures were caused by missing local database/bootstrap/session conditions.

Post-change focused commands:

- `node --import tsx --test tests/reports.test.ts`: 8/8 passed;
- `pnpm exec vitest run src/features/reports/OperationalReports.test.tsx`: 5/5 passed;
- web typecheck: passed.

Final workspace results:

- `pnpm typecheck`: passed across all ten projects;
- `pnpm lint`: passed;
- `pnpm build`: passed, with the existing Vite chunk-size warning;
- web tests: 22/22 passed, including all five report UI tests;
- API tests: 90/96 passed, including all eight report tests. The same six pre-change database/bootstrap/session tests remain failing, so Phase 8.2 introduced no additional full-suite failure.

## Connected Supabase verification

Read-only verification against the connected main Supabase branch on 19 July 2026 confirmed that the project is active and has three tenant rows. All 17 existing public tables have RLS enabled. No migration, seed, or data mutation was performed.

The report SQL was parsed with PostgreSQL `EXPLAIN` for all ten report endpoints. Appointments, clients, services, products, and stock planned successfully. The staff query initially exposed two Phase 8.1 compatibility defects that mocks could not detect: a Phase 9.1-only direct reference to `users.account_status`, and use of the reserved `day` alias. The repository now reads the optional account status through `to_jsonb(u)` with an `ACTIVE` fallback and uses `calendar_date`. `EXPLAIN (ANALYZE, BUFFERS)` then completed the live staff query in 1.623 ms with 12 shared cache hits and no disk reads on the current small dataset.

Two-tenant aggregate verification used authenticated-tenant-shaped predicates without returning names, contact details, or notes. For the July test period, the tenant with activity returned two appointments, one reporting client, and one reporting service; the second tenant returned zero for each metric. This verifies that the live query shapes preserve tenant boundaries, including an honest empty tenant result.

The connected database is behind the repository's prerequisite feature migrations:

- payments and refunds cannot plan because `stripe_refunds` is absent;
- forms cannot plan because `form_assignments` and `form_versions` are absent;
- communications cannot plan because `email_outbox` and `sms_outbox` are absent.

Those existing prerequisite migrations explicitly state that they must not be applied automatically to production. They were therefore not applied to the connected main branch. Missing relations are now mapped to a safe `404 REPORT_DATA_UNAVAILABLE` response without disclosing relation names, rather than a generic server error.

Supabase advisors reported pre-existing project-wide findings outside Phase 8.2: 21 security notices and 69 performance notices. The main remediation categories are [RLS enabled without a policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [permissive RLS policies](https://supabase.com/docs/guides/database/database-linter?lint=0024_permissive_rls_policy), [publicly executable security-definer functions](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), and [multiple permissive policies](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies). No out-of-scope security or policy changes were made.

## Browser/two-tenant checklist

Use two seeded tenants and an owner plus staff account for each. For every page under `/app/reports`, verify period boundaries in the tenant timezone, reconciliation with Phase 8.1, integer-minor-unit formatting, filter/sort/pagination behaviour, fixed drill-down routes, owner success, staff 403, and absence of the other tenant's known reference. Inspect network requests to confirm no provider API and no live-to-mock retry. Inspect payloads for all prohibited sensitive fields. Product gross sales should display `Unavailable`, missing staff schedules should display `Unavailable`, and empty filters should show a truthful empty state.

The `pnpm dev` smoke check served the web app on port 3000. Browser automation confirmed meaningful login content, the protected redirect `/app/reports` → `/login?returnTo=%2Fapp%2Freports`, and no Vite error overlay. It also confirmed existing environment warnings: Supabase URL/publishable key are absent and the global workspace provider still calls the pre-existing unimplemented `getTenants` method. The standalone `agent-browser` binary was unavailable, so the installed in-app browser was used as the verification fallback.

The Supabase connector is now authenticated and supports read-only SQL verification, but the application process still has no `DATABASE_URL`, Supabase URL, or publishable key in its local environment. It also has no authenticated owner/staff browser credentials. Consequently, the SQL-level two-tenant exercise is complete, while authenticated browser rendering and owner-versus-staff staging checks remain blocked on application environment configuration and the prerequisite migrations above.
