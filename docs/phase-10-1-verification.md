# Phase 10.1 — Verification Checklist

This document defines the verification steps that should be completed before Phase 10.1 is declared production-ready.

## Automated Checks (CI)

Run these in order:

```bash
pnpm typecheck   # Must: 0 errors
pnpm lint        # Must: 0 errors
pnpm test        # Must: 0 failures (customer-portal.test.ts: 69 pass)
pnpm build       # Must: all 10 workspace packages build successfully
```

## Migration Verification

Apply `packages/database/migrations/20260720100000_phase_10_1_customer_portal.sql` to the Supabase project and verify:

- [ ] `customer_accounts` table exists with correct columns and constraints
- [ ] `customer_client_links` table exists with both UNIQUE constraints
- [ ] `customer_account_claims` table exists with `token_hash` column (NOT raw token)
- [ ] `form_assignments.public_reference` column added (uuid, NOT NULL, unique index)
- [ ] RLS is enabled on all three new tables
- [ ] `anon` and `authenticated` roles have no direct access to the three tables

## Authentication Verification

- [ ] `GET /customer/login` renders the magic-link form without error
- [ ] Submitting an email on the login form triggers a Supabase magic-link email (no error regardless of whether the email exists)
- [ ] Clicking the magic-link lands at `/customer/auth/callback` and completes sign-in
- [ ] After sign-in, the customer is redirected to `/customer`
- [ ] Signing out redirects to `/customer/login`

## Staff Session Isolation

- [ ] A logged-in staff user who navigates to `GET /api/v1/customer/session` receives `403 CUSTOMER_ACCESS_DENIED`
- [ ] A logged-in staff user who navigates to `/customer` (in the frontend) sees the portal loading… then an error, not their staff workspace data

## Claim Flow Verification

- [ ] After creating a public booking (with a client email set), a claim email is sent to the client
- [ ] The claim email contains a link to `/customer/claim/<token>`
- [ ] Clicking the claim link while signed in completes the account linking
- [ ] After linking, the salon appears in the "Your salons" section
- [ ] Clicking the same claim link a second time returns an error (link already used)
- [ ] A claim link older than 7 days returns an error (expired)

## Multi-Tenant Isolation

- [ ] A customer linked to salon A cannot see appointments for salon B by guessing booking references
- [ ] A customer linked to both salon A and salon B sees both in "Your salons"
- [ ] Filtering appointments by `?business=salon-a-slug` shows only salon A's appointments

## Appointment Access

- [ ] Upcoming appointments appear in the "Upcoming" tab
- [ ] Past appointments appear in the "Past" tab
- [ ] Cancelled appointments appear in the "Cancelled" tab
- [ ] `BLOCKED` appointments never appear in any tab
- [ ] Appointment detail shows service name, staff name, time, status badge, and payment breakdown
- [ ] Internal notes are not visible in appointment detail
- [ ] Payment shows quoted, paid, and outstanding amounts in minor currency units converted to display currency

## Form Access and Submission

- [ ] Forms assigned to the customer's client record appear in the Forms section
- [ ] Forms with status PENDING or OPENED show a "Complete" button
- [ ] Submitting a form marks it SUBMITTED and redirects to /customer/forms
- [ ] Submitting the same form a second time returns a graceful error (idempotency)
- [ ] Completed forms show their submission date

## Payment History

- [ ] Payments made for the customer's appointments appear in the Payments section
- [ ] Refunds are displayed with the correct refunded amount
- [ ] Stripe payment intent IDs are not visible in the payment list
- [ ] Payment source labels are customer-friendly ("Online payment", not "CARD booking_payment")

## Profile Management

- [ ] The verified email is shown as read-only
- [ ] Display name can be updated
- [ ] Phone can be updated (E.164 format) or cleared
- [ ] Updating the profile does not modify the salon's CRM client record

## Security Spot-Checks

- [ ] `req.params.token` does not appear in Fastify logs after a claim request
- [ ] `customer_account_claims.token_hash` is a 64-character hex string (not base64url)
- [ ] The `customers_account_claims` table has no column named `token` or `raw_token`
- [ ] A request with a staff JWT to a customer portal endpoint returns 403, not 200
- [ ] The login form returns the same "check your inbox" message for both registered and unregistered emails
