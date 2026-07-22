# Phase 5.3 Payment State Machine

## Overview
The payment state machine governs the status of a booking as it goes through the payment process.

## Booking Status States

1. **PENDING_PAYMENT**: The initial state when a booking is created via the public flow. The slot is locked. The Stripe Checkout session is active.
2. **CONFIRMED**: The state when the payment is successfully captured (`checkout.session.completed`). The booking is finalized and fully locked.
3. **EXPIRED / CANCELLED**: The state when the Stripe Checkout session expires (`checkout.session.expired`) or is explicitly cancelled. The slot is freed for others to book.

## State Transitions

- `null` -> `PENDING_PAYMENT`: Created upon POST to public booking endpoint.
- `PENDING_PAYMENT` -> `CONFIRMED`: Webhook receives `checkout.session.completed`.
- `PENDING_PAYMENT` -> `EXPIRED`: Webhook receives `checkout.session.expired` or a background cleanup job detects a timeout.
- `EXPIRED` -> `CONFIRMED`: (Edge Case - Race condition) Handled by rejecting the webhook or processing a refund, or verifying Stripe captures. In KS OS, if a late payment is captured after expiration, we must either re-book or issue an automatic refund if the slot was taken.

## Transaction Status States

- **COMPLETED**: Transaction successfully inserted upon webhook confirmation.
