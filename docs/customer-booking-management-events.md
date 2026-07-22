# Customer Booking Management Events

## Source of truth

The customer booking management service owns immediate transactional confirmation email/SMS insertion through the existing outboxes. It does not call Resend or Twilio. The automation engine receives business events for tenant-configured downstream workflows; built-in mutation confirmation is not separately implemented in route handlers.

## `BOOKING_RESCHEDULED`

Emitted in the appointment transaction after immutable change history is inserted. Its stable ID uses event type, appointment ID, and change-history ID.

Safe payload:

- tenant ID;
- appointment ID;
- public booking reference;
- change source `CUSTOMER`;
- previous time;
- new time; and
- occurrence time.

Before emission, old reminders and superseded future automation actions are cancelled and pending form reminders are shifted to the new appointment time. New configured appointment reminders and confirmation messages use history-derived deterministic keys.

## `BOOKING_CANCELLED`

Emitted in the cancellation transaction with a stable history-derived ID. Its payload contains tenant ID, appointment ID, public booking reference, source, previous appointment time, and occurrence time.

Cancellation stops appointment/form reminders and future automation actions before the event is queued. Confirmation email/SMS rows and any refund-review issue are written transactionally and deduplicated.

## Excluded event data

Events never include email, phone, client name, medical information, notes, form answers, cancellation free text, raw tokens, management URLs, payment provider identifiers, or secrets.

## Idempotency

The business-events table uses stable event IDs. Mutation requests first replay a successfully stored idempotency response. Email and SMS use action-specific keys containing the immutable change ID, so transport retries do not create another logical confirmation.
