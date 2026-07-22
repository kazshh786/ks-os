# Customer Account Linking — Phase 10.1

## Overview

"Account linking" describes the secure association between a `customer_accounts` record (the global customer identity) and a `customer_client_links` record (the per-tenant CRM client relationship). This document explains the claim-based linking process, its security model, and the database constraints that enforce correctness.

## Why Not Email-Based Linking?

Email matching alone is insufficient for several reasons:

1. **Email address reuse**: A salon CRM may contain historical client records with email addresses that no longer belong to the same person.
2. **Typos**: A client may have booked under a slightly different email.
3. **Shared email addresses**: Family members may book under the same email.
4. **No proof of ownership**: An email in a CRM record proves only that the salon recorded it; it doesn't prove the current user controls that address.

The claim-based flow requires the customer to prove they received an email to a specific address by clicking a one-time token link. This is cryptographically equivalent to email proof of ownership.

## Claim Token Flow

### Step 1: Claim Created at Booking Time

When a customer completes a public booking, `CustomerClaimsService.createForAppointment()` is called:

1. Retrieves the client record's email from the CRM.
2. Revokes any existing PENDING claims for the same appointment (prevents token accumulation).
3. Generates a 256-bit cryptographically random token via `randomBytes(32).toString('base64url')`.
4. Stores only the SHA-256 hash of the token in `customer_account_claims.token_hash`.
5. Returns the raw token to the caller **once** — it is placed directly into the claim email body.

The raw token is **never** written to any database table or log.

### Step 2: Claim Email Sent

`CustomerClaimEmailService` sends an email with a deep-link:

```
{PUBLIC_APP_ORIGIN}/customer/claim/{rawToken}
```

This is sent in the booking confirmation flow, separate from the standard booking confirmation email.

### Step 3: Customer Signs In and Clicks Claim Link

The customer:
1. Clicks `/customer/claim/:token` in their browser.
2. If not authenticated, they are redirected to `/customer/login?claim=:token`.
3. They sign in via magic link.
4. After sign-in, they land back at `/customer/claim/:token`.
5. The frontend calls `POST /api/v1/customer/claims/:token/complete`.

### Step 4: Claim Verification (server-side)

`CustomerClaimsService.complete()` runs inside a database transaction:

1. Hashes the incoming token with SHA-256.
2. Looks up the `customer_account_claims` row by `token_hash` with `FOR UPDATE` lock.
3. Validates: status = PENDING, not expired, `revokedAt` and `usedAt` are null.
4. **Email match**: normalises `identity.email` and compares to `claim.email_normalized`. If they differ → `CUSTOMER_CLAIM_INVALID (400)`.
5. Upserts the `customer_accounts` row (creates if first sign-in).
6. Checks for existing `customer_client_links` for this tenant+authUserId. If one exists for a different clientId → `CUSTOMER_CLAIM_INVALID (400)` (prevents silent duplicate CRM linking).
7. If no link exists, inserts `customer_client_links`.
8. Marks the claim as `USED`.
9. Returns the linked business slug for post-redirect navigation.

## Database Constraints

```sql
-- One client per tenant per customer account
CONSTRAINT customer_client_links_tenant_client_unique UNIQUE (tenant_id, client_id)

-- One customer account per tenant
CONSTRAINT customer_client_links_tenant_auth_unique UNIQUE (tenant_id, auth_user_id)
```

These constraints are enforced at the database level in addition to the application-level checks above. They prevent race conditions during concurrent claim attempts.

## Status Lifecycle

```
PENDING → USED      (successful claim completion)
PENDING → EXPIRED   (claim expired on read; scheduled cleanup also applies)
PENDING → REVOKED   (a new claim was created for the same appointment)
```

Claims in status `USED`, `EXPIRED`, or `REVOKED` cannot be completed.

## Multi-Salon Support

A single `customer_accounts` record may link to multiple tenants:

```
customer_accounts (id = A)
  └── customer_client_links (tenant = salon-1, client = client-X)
  └── customer_client_links (tenant = salon-2, client = client-Y)
```

Each link was independently verified through its own claim flow.

## Session Expiry and Stale Links

`customer_client_links.status` can be `ACTIVE` or `REVOKED`. Revoked links do not appear in the portal and do not grant access to salon data.

Salon owners can revoke links through the staff portal (future phase). Customer deactivation sets `customer_accounts.status = DEACTIVATED`, which blocks all portal access.
