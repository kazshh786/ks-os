# Customer Cancellation Policy

## Eligibility

Online cancellation is allowed only when all of the following are true:

- the appointment is `PENDING` or `CONFIRMED`;
- the tenant has enabled customer cancellation;
- the current instant is strictly before the cancellation deadline;
- authenticated customer-client linkage or the one-booking guest token authorizes the appointment; and
- the submitted appointment version is still current.

At the deadline instant the action is late and is rejected. `CHECKED_IN`, `IN_SERVICE`, `AWAITING_PAYMENT`, `COMPLETED`, `CANCELLED`, `NO_SHOW`, and `BLOCKED` are not customer-manageable.

## Notice calculation

Appointments are stored as UTC instants. The deadline is:

```text
appointment start instant - minimum cancellation notice minutes
```

That calculation remains correct across tenant-local daylight-saving transitions. The API returns an ISO UTC instant; the UI displays it in the appointment tenant's IANA timezone.

## Confirmation and reasons

The customer sees the appointment, salon policy wording, payment impact, and an explicit acknowledgement before the cancellation button is enabled. Reason codes are allowlisted. Free text is optional, limited to 500 characters, accepted only with `OTHER`, and rejects HTML. An owner may require a reason code.

## Transactional effects

Cancellation performs a version/status-guarded update inside a row-locked transaction. It:

- retains the appointment with status `CANCELLED`;
- records source `CUSTOMER`, cancellation time, and safe reason data;
- creates immutable cancellation history;
- releases staff/resource availability through the terminal status;
- cancels appointment and form reminders;
- cancels pending automation actions;
- cancels pending/opened form assignments but preserves submitted forms;
- cancels open local payment attempts;
- emits `BOOKING_CANCELLED` once;
- queues deterministic email and SMS confirmations; and
- creates a refund-review Operations issue only for a remaining online-paid amount.

Idempotent replay returns the stored response. Reuse of a key with different input returns `CUSTOMER_BOOKING_IDEMPOTENCY_CONFLICT`. A stale version returns `CUSTOMER_BOOKING_STATE_CHANGED`.

## Payment separation

Appointment cancellation is not a refund. The route never invokes Stripe refund APIs, never accepts an amount, and never promises that money has been refunded. See [customer-booking-payment-impact.md](./customer-booking-payment-impact.md).
