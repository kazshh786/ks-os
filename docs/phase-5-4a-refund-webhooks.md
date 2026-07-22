# Phase 5.4A: Refund Webhooks

## Supported Events
- `refund.created`
- `refund.updated`
- `refund.failed`

## Idempotency
- All events are processed exactly once.
- Duplicate events are ignored or handled gracefully.
- Refunds created directly from the Stripe Dashboard are correctly imported into the system.
