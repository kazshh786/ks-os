# Customer Booking Payment Impact

Cancellation and refund are deliberately separate operations. Customer routes never call Stripe, accept a refund amount, or claim that a refund has completed.

| Recorded state | Customer impact type | Customer wording/behavior | Operations behavior |
|---|---|---|---|
| No remaining payment | `NONE` | “No online payment was recorded for this booking.” | No review issue |
| Cash or external/direct payment | `NO_AUTOMATIC_REFUND` | Contact the salon regarding payment made directly | Never sent to Stripe |
| Remaining online card payment | `REFUND_REVIEW_REQUIRED` | Tenant's bounded payment-policy wording; no refund promise | One deduplicated refund-review issue |
| Online payment already fully refunded | `NONE` | No remaining online payment is represented | No duplicate review |

Payment context uses successful/refunded checkout transactions and completed refund records to calculate the remaining amount. Financial rows remain unchanged when an appointment is cancelled.

`CUSTOMER_CANCELLATION_REFUND_REVIEW` includes the public appointment reference, internal transaction references, remaining paid amount in minor units, currency, cancellation time, and coarse policy state. It excludes provider IDs, card/bank data, customer contact details, tokens, and free-text cancellation reasons.

For a payment-pending hold, cancellation marks the local payment attempt `CANCELLED` and the appointment `CANCELLED`. Stripe webhook fulfillment treats cancelled/expired attempts as terminal and also locks/rechecks the appointment before confirmation. Provider-side Checkout Session expiration is not invoked by Phase 10.2; no late webhook can resurrect the local hold.
