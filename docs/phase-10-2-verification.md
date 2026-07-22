# Phase 10.2 — Verification

## Automated results (20 July 2026)

| Check | Result | Notes |
|---|---|---|
| API typecheck | Pass | `pnpm --filter api typecheck` |
| Web typecheck | Pass | `pnpm --filter web typecheck` |
| Focused API suite | Pass | 18/18 in `customer-booking-management.test.ts` |
| Focused web suite | Pass | 6/6 in `CustomerBookingManagement.test.tsx`; full web suite 31/31 |
| Email templates | Pass | Registered templates render HTML and text |
| SMS package | Pass | Existing notification tests pass |
| Workspace lint | Pass | Current scripts are echo-only and do not run a static linter |
| Production build | Pass | All 10 workspace projects; Vite reports only the existing large-chunk warning |
| Full workspace tests | Baseline-blocked | API: 186/192 pass; six counted failures from missing local Postgres plus obsolete `/api/v1/session` expectation. Web and notification/email suites pass. |

The Phase 10.2 focused API suite covers policy flags, status eligibility, deadlines, DST, reschedule limits, payment messages, strict unknown-field rejection, reason validation, approved owner choices, token hashing, RLS/revokes, scoped idempotency, canonical availability reuse, row/advisory locks, form/reminder integration, stable events, guest-link issuance, refund review, no Stripe refund call, and late-webhook protection.

The focused frontend suite covers allowed/blocked actions, canonical availability selection, review-before-reschedule, success, no-slot behavior, stale-state refresh, explicit cancellation confirmation, and cancellation success. Layout uses mobile-first base classes with wider-screen enhancements.

## Migration gate

Migration: `packages/database/migrations/20260720135949_phase_10_2_customer_booking_management.sql`

The repository has no `supabase/` declarative schema workflow and the Supabase CLI is not installed in this environment, so the established `packages/database/migrations` path was used. The migration was inspected and statically tested but **not applied**.

After applying it to a disposable Supabase development database, verify:

- tenant policy fields and defaults/approved-choice constraints;
- `users.public_reference` backfill, not-null, and unique index;
- appointment version, customer count, cancellation metadata, and version trigger;
- token, history, and idempotency tables plus foreign-key indexes;
- RLS enabled and browser-role grants revoked;
- token replacement leaves one active token per issued appointment flow;
- staff edits increment appointment version;
- SQL functions and triggers execute under the intended API database role.

## Required live integration matrix

Use fictitious tenants and customers only.

### Access and policy

- [ ] Linked customer can open their appointment and sees tenant-local deadlines.
- [ ] Unlinked and cross-tenant customers receive the same safe not-found response.
- [ ] Staff JWT cannot become a customer session.
- [ ] Active guest link opens one booking; another booking/reference is inaccessible.
- [ ] Replaced, revoked, and expired guest tokens fail safely.
- [ ] Owner can update approved settings; staff receives 403; arbitrary values/HTML fail.

### Rescheduling

- [ ] Only canonical slots for the preserved service/channel/location/resource appear.
- [ ] Same staff is preferred; eligible equal-price/equal-duration staff changes work.
- [ ] Ineligible or price/duration-changing staff choices fail safely.
- [ ] A valid reschedule releases the old slot and reserves the new slot.
- [ ] Concurrent booking/reschedule attempts allow only one conflicting result.
- [ ] A staff edit after page load causes `CUSTOMER_BOOKING_STATE_CHANGED`.
- [ ] Customer count increments once; staff changes do not increment it.
- [ ] Old reminders are cancelled, new reminders scheduled once, and form reminders move.
- [ ] Completed forms and their submissions remain intact; no duplicate assignment appears.

### Cancellation and payments

- [ ] Eligible cancellation retains the appointment/history and releases staff/resource availability.
- [ ] Duplicate request returns the stored response without duplicate event or message.
- [ ] Pending reminders/actions and pending/opened form assignments are cancelled.
- [ ] No-payment and direct-payment messages are accurate and no Stripe call occurs.
- [ ] Remaining online payment creates one owner-visible refund-review issue.
- [ ] Fully refunded payment does not create another review.
- [ ] Pending hold is cancelled and a delayed successful webhook cannot confirm it.

### Communications and logs

- [ ] Reschedule and cancellation email/SMS each queue once with required safe content.
- [ ] Worker delivery succeeds with configured non-production provider accounts.
- [ ] Logs contain no raw token/management URL, reason text, contact data, notes, form answers, or provider secrets.
- [ ] Failed availability/API calls display an error/retry state and never mock data.

## Browser verification status

Live browser verification was not performed in this environment because no applied development migration, local `DATABASE_URL`, or authenticated fictitious customer/owner identities were available. Run `pnpm dev` after the migration and complete the matrix above before production release. This limitation is recorded rather than treating compile-time UI tests as browser sign-off.
