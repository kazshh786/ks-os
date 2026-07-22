# Phase 10.1 — Customer Self-Service Portal: Completion Report

## Overview

Phase 10.1 introduces a secure, multi-tenant customer self-service portal for KS OS. It enables customers who have previously booked appointments through a salon's public booking page to sign in and view their relationship with one or more salons — without creating a traditional password.

## Scope

| Included | Excluded (explicitly out of scope) |
|---|---|
| Passwordless magic-link authentication | SMS OTP sign-in |
| Customer account creation on first claim | Saved payment cards |
| Appointment history (upcoming, past, cancelled) | Appointment rescheduling |
| Appointment detail with payment breakdown | Appointment cancellation |
| Form viewing and completion | Loyalty and membership |
| Payment and refund history | Gift cards, marketing preferences |
| Basic profile (name, phone) management | Reviews, chat |
| Multi-salon (multi-tenant) account | Customer-to-staff CRM merging |

## Architecture Decisions

### Customer-Account Model

A `customer_accounts` table holds the canonical customer identity, linked to a Supabase Auth UID. Separately, `customer_client_links` represents a verified relationship between a customer account and a tenant's CRM client record. This allows a single customer to maintain relationships with multiple salons without merging their identity.

### Authentication Separation

The same Supabase project serves both staff and customers. The application distinguishes their contexts:

- **Staff sessions**: `request.auth` is populated after workspace-member lookup.
- **Customer sessions**: only `request.authIdentity` is populated; `request.auth` is never set.

If a staff user navigates to a customer portal endpoint, `CustomerAuthService.requireIdentity()` throws `CUSTOMER_ACCESS_DENIED (403)` because `request.auth` is truthy.

### Claim-Based Account Linking

Customers are not linked to salon CRM records by email matching alone. Instead:

1. A one-time claim token is created after a public booking.
2. The token is emailed to the client immediately after booking (never stored in logs or outbox tables).
3. The customer clicks the claim link, signs in via magic link, and the claim is verified.
4. The `customer_client_links` record is created only after successful claim verification.

This prevents account hijacking via email address reuse or guess.

## Files Modified / Created

### Backend

| File | Change |
|---|---|
| `packages/database/src/schema.ts` | customer_accounts, customer_client_links, customer_account_claims tables |
| `packages/database/migrations/20260720100000_phase_10_1_customer_portal.sql` | Database migration with RLS and index creation |
| `apps/api/src/modules/customer-portal/customer-portal.errors.ts` | CustomerPortalError class |
| `apps/api/src/modules/customer-portal/customer-auth.service.ts` | Identity/account resolution; staff session guard |
| `apps/api/src/modules/customer-portal/customer-claims.service.ts` | Claim token lifecycle |
| `apps/api/src/modules/customer-portal/customer-portal.service.ts` | Portal data access (appointments, forms, payments, profile) |
| `apps/api/src/modules/customer-portal/customer-portal.routes.ts` | All API endpoints under /api/v1/customer |
| `apps/api/src/modules/customer-portal/customer-claim-email.service.ts` | Claim email via Resend |
| `apps/api/src/modules/forms/forms.service.ts` | Added submitCustomerPortal() method |
| `apps/api/src/plugins/error-handler.ts` | Explicit CustomerPortalError handling |
| `apps/api/src/plugins/auth.ts` | authIdentity separated from auth context |
| `apps/api/src/routes/public/booking.ts` | Claim creation after booking confirmation |
| `apps/api/src/app.ts` | customerPortalRoutes registered |
| `packages/contracts/src/customer-portal.ts` | Zod schemas for all portal contracts |
| `packages/contracts/src/index.ts` | Export customer-portal contracts |
| `packages/email/src/templates/customer-portal-claim.tsx` | Claim email template |
| `packages/email/src/index.ts` | Template registered |

### Frontend

| File | Change |
|---|---|
| `apps/web/src/features/customer-portal/CustomerPortal.tsx` | All portal page components with premium design |
| `apps/web/src/features/customer-portal/customer-portal-provider.ts` | API client provider |
| `apps/web/src/App.tsx` | /customer/* routes registered |

### Tests

| File | Coverage |
|---|---|
| `apps/api/tests/customer-portal.test.ts` | 69 tests — token security, email normalisation, error types, auth separation, status labels, phone validation, payment calculation, Stripe ID exclusion, claim lifecycle, contract schemas, multi-tenant isolation |

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /api/v1/customer/session | Customer JWT | Get session and linked businesses |
| GET | /api/v1/customer/businesses | Customer JWT | List linked salons |
| GET | /api/v1/customer/appointments | Customer JWT | List appointments (filterable by status/business) |
| GET | /api/v1/customer/appointments/:ref | Customer JWT | Appointment detail with payment and forms |
| GET | /api/v1/customer/forms | Customer JWT | List form assignments |
| GET | /api/v1/customer/forms/:ref | Customer JWT | Form detail for completion |
| POST | /api/v1/customer/forms/:ref/submissions | Customer JWT | Submit completed form |
| GET | /api/v1/customer/payments | Customer JWT | Payment and refund history |
| GET | /api/v1/customer/profile | Customer JWT | Get profile |
| PATCH | /api/v1/customer/profile | Customer JWT | Update display name and phone |
| POST | /api/v1/customer/claims/:token/complete | Customer JWT | Complete a claim and link the account |

## Frontend Routes

| Path | Component | Description |
|---|---|---|
| /customer/login | CustomerLoginPage | Magic-link sign-in |
| /customer/auth/callback | CustomerAuthCallbackPage | OTP/magic-link callback handler |
| /customer/claim/:token | CustomerClaimPage | Claim completion |
| /customer | CustomerPortalLayout + CustomerHomePage | Portal home |
| /customer/businesses | CustomerBusinessesPage | Linked salons |
| /customer/appointments | CustomerAppointmentsPage | Appointment list |
| /customer/appointments/:ref | CustomerAppointmentDetailPage | Appointment detail |
| /customer/forms | CustomerFormsPage | Form list |
| /customer/forms/:ref | CustomerFormPage | Form completion |
| /customer/payments | CustomerPaymentsPage | Payment history |
| /customer/profile | CustomerProfilePage | Profile management |

## Security Properties

- Passwords are never created or stored for customer accounts.
- Claim tokens use 256 bits of cryptographic randomness and are hashed (SHA-256) before storage.
- The raw claim token exists transiently in memory only; it is never written to the database or logged.
- Staff sessions cannot access customer portal endpoints; the guard checks `request.auth` at the application layer.
- Email matching alone cannot link an account; only a valid claim token proves ownership.
- Appointments, forms, and payments are gated behind a JOIN on `customer_client_links` to enforce tenant isolation.
- `BLOCKED` appointments are excluded from all customer portal queries.
- Internal notes, medical notes, and Stripe payment identifiers are never returned to the customer portal.
- All customer portal tables have RLS enabled and are revoked from `anon` and `authenticated` Supabase roles (API-only access).
