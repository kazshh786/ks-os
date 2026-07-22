# Phase 5.3 Webhook Fulfillment

## Overview
Webhooks ensure that payment state correctly updates booking state, bypassing any unreliability of browser redirects.

## Webhook Endpoint
- **URL**: `POST /api/v1/webhooks/stripe/payments`
- **Security**: Validates the `stripe-signature` header against `STRIPE_PAYMENTS_WEBHOOK_SECRET`.

## Idempotency
Each incoming webhook event ID is checked against the `stripe_webhook_events` table. If it has been processed, the system returns `200 OK` early without performing any database mutations. This ensures robust deduplication.

## Handled Events
1. `checkout.session.completed`
   - Fetches the booking ID from `metadata.bookingId`.
   - Checks if the booking is `PENDING_PAYMENT`.
   - Updates booking status to `CONFIRMED`.
   - Inserts a new POS `transaction` record associated with the booking, using integer calculations.
   - Marks the webhook event as `PROCESSED`.
   
2. `checkout.session.expired`
   - Fetches the booking ID from `metadata.bookingId`.
   - If the booking is still `PENDING_PAYMENT`, it is transitioned to `CANCELLED` (or `EXPIRED`), releasing the locked slot.
   - Marks the webhook event as `PROCESSED`.

## Future Integrations
- **Phase 5.4A Refunds**: Expanding webhook fulfillment to support `refund.created`, `refund.updated`, and `refund.failed` to maintain transaction parity.

## Error Handling
If any database error occurs during fulfillment, the endpoint returns a non-200 status code, prompting Stripe to automatically retry the webhook later.
