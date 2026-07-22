# Phase 10.2 — Customer Rescheduling and Cancellation

## Outcome

Phase 10.2 adds policy-controlled self-service cancellation and same-service rescheduling to the authenticated customer portal and to a secure one-booking guest flow. Owner settings, strict API contracts, canonical availability reuse, optimistic versions, row/advisory locks, scoped idempotency, lifecycle history, notification outboxes, workflow events, form-reminder handling, and payment-impact review are implemented.

The migration is additive and has **not** been applied automatically. Production readiness still requires applying and verifying it in the configured Supabase development workflow, followed by live browser/provider verification.

## Access paths

| Path | Authorization | Data scope |
|---|---|---|
| Authenticated portal | Supabase identity → active customer account → active `customer_client_links` row matching both appointment tenant and client | Linked appointment only |
| Guest link | SHA-256 hash of a 256-bit token → active, unexpired `customer_booking_management_tokens` row | One appointment only |

Public booking confirmation email now includes a separate one-booking management link. Issuing a replacement locks the appointment and revokes older active management tokens. The raw token is sent directly through the existing claim-email path, is never stored, and is redacted from URLs and route params.

## Policy and owner settings

Owners can configure `/settings/booking/customer-management`. Backend authorization is owner-only and is not based on navigation visibility.

Approved notice choices are 0, 2, 6, 12, 24, 48, or 72 hours. Approved customer-reschedule limits are 0, 1, 2, 3, 5, or 10. Customer-visible wording is bounded plain text; HTML and template expressions are rejected. Defaults enable both actions, require 24 hours' notice, allow three customer reschedules, and do not require a reason.

The backend policy evaluator is the only authority for action eligibility. It returns deadlines, remaining reschedules, safe blocked explanations, and payment-impact wording. Only `PENDING` and `CONFIRMED` appointments are manageable.

## Rescheduling

Rescheduling preserves tenant, client, service, booking channel, location, resource, quoted amount, payments, form assignments, and completed submissions. A staff change is accepted only through an opaque public staff reference when the active same-tenant staff member supports the service, channel, location, duration, and exact existing price.

The customer availability endpoint calls the existing `calculateAvailability` service with the current appointment excluded. It adds preserved location/resource constraints and returns no internal IDs or private schedule data.

Final mutation runs in one transaction. It locks the appointment, verifies the supplied version, acquires deterministic staff and resource advisory locks, recalculates canonical availability inside the transaction, performs a version/status-guarded update, increments only `customer_reschedule_count`, records immutable history, shifts pending form reminders, replaces appointment reminders, cancels superseded automation actions, emits one event, and inserts idempotent email/SMS outbox rows.

## Cancellation

Cancellation locks and version-checks the appointment, re-evaluates policy, records customer source and validated reason data, and updates status to `CANCELLED`; it never deletes the appointment. Appointment status releases staff/resource availability. Pending reminders and future automation actions are cancelled. Pending/opened form assignments are cancelled while submitted forms remain unchanged.

Pending payment attempts are marked cancelled. Stripe success webhook handling re-locks and revalidates the appointment, so a late provider event cannot reconfirm a cancelled hold.

## Payment behavior

Cancellation never initiates a Stripe refund and customers cannot provide an amount. No payment, direct payment, and remaining online payment use distinct messages. An online amount still available for refund creates one deduplicated `CUSTOMER_CANCELLATION_REFUND_REVIEW` Operations issue with safe references and policy context. Fully refunded amounts do not create another review.

See [customer-booking-payment-impact.md](./customer-booking-payment-impact.md).

## Main files

- `packages/contracts/src/customer-booking-management.ts`
- `packages/database/migrations/20260720135949_phase_10_2_customer_booking_management.sql`
- `apps/api/src/modules/customer-portal/customer-booking-management.policy.ts`
- `apps/api/src/modules/customer-portal/customer-booking-management.service.ts`
- `apps/api/src/modules/customer-portal/customer-portal.routes.ts`
- `apps/api/src/modules/customer-portal/customer-booking-policy.routes.ts`
- `apps/web/src/features/customer-portal/CustomerBookingManagement.tsx`
- `apps/web/src/pages/settings/CustomerBookingManagementSettings.tsx`

## Known exclusions

- Service, channel, tenant, client, location, price, and refund-amount changes
- Group/family bookings, waitlists, chat, loyalty, packages, and saved cards
- Automatic refunds or cancellation-fee negotiation
- Arbitrary policy scripts or expressions
- Direct Stripe Checkout Session expiration; the local attempt is cancelled and late fulfillment is blocked, while provider-side expiration remains an operational follow-up where desired

## Verification status

Focused policy/security and UI-flow suites pass, typechecks pass, lint scripts pass, and the production build passes. The full workspace test command retains pre-existing failures caused by an unavailable local Postgres service and an obsolete `/api/v1/session` assertion. Details and production gates are in [phase-10-2-verification.md](./phase-10-2-verification.md).
