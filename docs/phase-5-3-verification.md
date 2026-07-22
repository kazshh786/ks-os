# Phase 5.3 Verification

## Overview
This document ensures the correct functioning of the online payments features through specific verification checks.

## End-to-End Tests
The core verification relies on the `booking-payments.e2e.test.ts` suite, which covers:
1. **Checkout Session Creation**: Ensuring `POST /api/v1/public/:subdomain/bookings` properly generates and returns a Stripe Checkout URL.
2. **Payment Completion Webhook**: Verifying that `checkout.session.completed` successfully confirms the booking and inserts the transaction record.
3. **Payment Expiration Webhook**: Verifying that `checkout.session.expired` correctly cancels the pending booking to unlock the slot.
4. **Idempotency**: Ensuring the same webhook event ID cannot be processed twice.

## Manual Testing Workflow
1. Navigate to the public booking frontend.
2. Select a service, date, and staff member.
3. Submit the booking details.
4. Confirm redirection to the Stripe Checkout page.
5. In Stripe Test Mode, use a test card to complete the payment.
6. Return to the application and verify that the backend webhook properly updated the booking to `CONFIRMED`.
7. Repeat the process but let the checkout page expire (or trigger an expiration via Stripe CLI) to verify the slot becomes available again.
