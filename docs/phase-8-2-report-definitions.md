# Phase 8.2 report definitions

## Common period and money rules

Periods are tenant-local inclusive calendar dates converted to half-open UTC timestamps by the Phase 8.1 period resolver. Presets are `TODAY`, `YESTERDAY`, `LAST_7_DAYS`, `LAST_30_DAYS`, `THIS_MONTH`, `LAST_MONTH`, and `CUSTOM`. Custom periods require ISO `from` and `to` dates and cannot exceed 366 calendar days. Money is returned in integer minor units with the tenant ISO currency.

## Appointments

Rows are appointments whose `start_time` is in the period. `BLOCKED` entries are always excluded. Status summaries use exact statuses. `quotedAmountTotal` sums the appointment's stored `quoted_amount`, never the current service catalogue price. This is the currently stored booking quote and is not an immutable accounting ledger.

## Clients

A client appears when they have an eligible appointment in the period. Eligible statuses match Phase 8.1: `CONFIRMED`, `CHECKED_IN`, `IN_SERVICE`, `AWAITING_PAYMENT`, `COMPLETED`, `CANCELLED`, and `NO_SHOW`. A new client has no earlier eligible tenant appointment; otherwise they are returning. First/last appointment timestamps are all-history eligible timestamps. Recorded spend is successful or historically successful (`REFUNDED`) checkout total created in the period. Future counts include future pending/confirmed/check-in appointments.

## Services

Bookings exclude `BLOCKED`; completion, cancellation and no-show use exact appointment statuses. Recorded revenue follows Phase 8.1 by assigning successful or historically successful checkout totals to the transaction's single appointment service. A point-of-sale total can also contain retail or tips, because checkout transactions do not store service/product/tip allocations. The report states this limitation and does not invent an allocation. `rebookingIndicator` is `null` because no reliable causal rebooking link exists.

## Staff activity

Scheduled minutes sum `staff_schedules` across local calendar days. Booked minutes include `CONFIRMED`, `CHECKED_IN`, `IN_SERVICE`, `AWAITING_PAYMENT`, and `COMPLETED` appointment duration, matching Phase 8.1. Utilisation is booked divided by scheduled minutes; missing/zero schedules return `null`. Inactive staff remain visible. Recorded revenue is transaction attribution, not commission, payroll, or staff earnings.

## Products and stock

Quantity sold and transaction count come from `checkout_transactions.purchased_products` for successful or historically successful transactions in the period. The JSON stores product ID and quantity but no immutable line price, so `grossRecordedSales` is `null`. Current stock is `products.stock_quantity`. The stock report is current as of generation time; low stock is 1–5 units and out of stock is zero or below. Last sale uses local checkout history. There is no stock movement, cost, profit, or valuation calculation.

## Payments and refunds

Payment source mapping reuses the existing payment module:

- `CARD` plus `booking_payment` → `STRIPE_ONLINE`;
- `CASH` → `MANUAL_CASH`;
- `SPLIT` → `MANUAL_SPLIT`;
- other `CARD` point-of-sale records → `EXTERNAL_TERMINAL`.

External-terminal entries are manually recorded and not provider verified. Gross is checkout total. Refunded is the sum of completed Stripe refund rows. Net is gross minus completed refunds. Partial and full refund states are derived from those values. Refund periods use request (`created_at`) time; completion time is separately returned. Internal notes, Stripe IDs, payment intent IDs, account IDs, and idempotency keys are excluded.

## Forms

The period uses linked appointment start time, or assignment time for assignments without an appointment. A pending/open assignment past `expires_at` is reported as expired. Completion rate is submitted divided by all filtered assignments. Rows contain snapshot title/version and lifecycle timestamps only—never answers, acknowledgement names, response JSON, token hashes, or public tokens.

## Communications

The period uses outbox `created_at`. Email and phone recipients are masked in SQL. Category is the local template key; safe related type/UUID, queued/sent/delivered timestamps, delivery status, SMS segment count, and a coarse failure category are returned. Message bodies, template data, secure links, provider identifiers, webhook payloads, phone numbers, email addresses, and provider error details are excluded.
