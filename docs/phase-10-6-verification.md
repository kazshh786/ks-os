# Phase 10.6 verification

## Automated verification

Run from `KS-OS-Platform`:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Focused reputation tests cover eligibility, status exclusions, refunds/complaints remaining eligible, SMS opt-in, scope fallback, BOTH ordering, deterministic/unique invitation creation, provider URL validation, redirect rejection, neutral wording, reply privacy, AES-GCM, hash-only tokens, RLS/browser revocation, click truthfulness, sensitive metadata exclusion, credential redaction and absence of mock fallback.

## Local verification record — 20 July 2026

- `pnpm typecheck`: passed across all 10 workspaces.
- `pnpm lint`: passed; the current API/web lint scripts are placeholder echo checks.
- `pnpm build`: passed. Vite reported the existing large-chunk advisory (main bundle approximately 1.04 MB minified).
- Web: 32/32 passed; email: 1/1 passed; notifications: 2/2 passed.
- Focused reputation/automation/SMS: 28/28 passed, including 20 reputation-specific tests.
- Full API: 207/213 passed. The six failures are outside Phase 10.6: unavailable/missing local PostgreSQL for health and booking integration cases, the obsolete `/api/v1/session` expectation, and their suite-level aggregate failures.
- `pnpm dev`: Vite started at `http://localhost:3000`; the API stopped at the existing `DATABASE_URL` prerequisite. No process started for this verification was left running.
- In-app browser: the public `/review/:token` route rendered a safe unavailable/expired-style state for a fictitious token. The successful BOTH state is covered by a component test that verifies equal provider buttons, no rating question, and unconditional private contact.

The database migration was not applied and live provider calls were not attempted because this environment has no running PostgreSQL database or tenant-owned Google/Trustpilot approvals and credentials.

## Browser and worker checklist

Use only fictitious data and non-production provider profiles:

1. Apply the Phase 10.6 migration and configure the two reputation secrets plus any approved provider credentials.
2. Sign in as owner and open `/app/settings/integrations/reviews`.
3. Save and test one Google review link for a fictitious location.
4. Save and test one Trustpilot profile/evaluation link, or connect an approved API account.
5. Create a BOTH/email/24-hour rule and verify the neutral wording validation.
6. Complete a fictitious appointment through normal status update, then through POS in a separate case.
7. Run the business-event worker; confirm one `review_invitations` row.
8. Replay the same event; confirm the appointment/provider uniqueness leaves one row.
9. Advance/run the existing automation action worker; confirm an existing outbox row is queued and its JSON contains an invitation ID but no `/review/{token}` URL.
10. Deliver the email/SMS through a test provider and verify `SENT`/`DELIVERED` callbacks.
11. Open `/review/:token`; verify equal Google and Trustpilot buttons, no star selector, and an unconditional private-contact option.
12. Click each provider. Confirm the genuine external URL opens and only the relevant click timestamp changes; `confirmed_review_at` remains null.
13. Set SMS marketing opt-out/STOP and confirm a due SMS invitation is suppressed.
14. Confirm cancelled, no-show, test and internal appointments produce no invitation.
15. Confirm a refunded or complaint-associated completed appointment remains eligible.
16. Attempt cross-tenant connection, rule, invitation and review IDs; confirm 403/404 safe denial.
17. With approved API credentials, run manual sync and verify provider-attributed, separate metrics and original links where the provider supplies them.
18. Post, update and delete a privacy-safe test reply; verify the provider is authoritative.
19. Search structured logs/outboxes for raw tokens, OAuth credentials, treatment data and medical notes; none should be present.
20. Disable provider access and verify a safe error appears with no sample review fallback.

## Environment limitations

Provider OAuth/API calls cannot be proven without tenant-owned Google/Trustpilot approvals and test credentials. Local database/browser verification also requires `DATABASE_URL`, Supabase Auth and configured workers. Record screenshots and provider request IDs in the deployment runbook, never in customer-visible records or logs containing secrets.
