# Slot holds and booking conflicts

## Hold algorithm

`POST /api/v1/public/:slug/holds` accepts a strict service/staff/location/resource/start/channel tuple plus an idempotency key. The server:

1. resolves an enabled, published page and verifies catalogue eligibility;
2. starts a transaction and takes a Postgres advisory transaction lock for the tenant/staff/start tuple;
3. marks expired holds inactive;
4. returns the existing hold for a repeated idempotency key;
5. recalculates exact availability with the transaction-bound database client;
6. rejects overlapping active holds;
7. stores the hold with an expiry and token hash;
8. returns the opaque token once to the customer.

The default duration is controlled by `BOOKING_SLOT_HOLD_MINUTES` and is 10 minutes. Do not extend it casually: long holds reduce apparent capacity and invite denial-of-inventory abuse.

Booking creation verifies page, hold ID, token hash, service, staff, location, resource, start, active state and expiry. It consumes the hold in the same transaction that records the created appointment context. Idempotency protects retries after network failures.

## Error semantics

- `409 SLOT_UNAVAILABLE`: availability rules or an appointment conflict rejected the slot.
- `409 SLOT_HELD`: another active hold owns the time.
- `409 HOLD_EXPIRED`: the customer must choose a slot again.
- `404 HOLD_NOT_FOUND`: the page/hold pair is not visible or was removed.
- `400 INVALID_HOLD_REQUEST`: malformed input or token.

Clients should keep customer-entered fields, clear only the invalid slot/hold, refresh availability and move focus to the conflict message.

## Cleanup and monitoring

Expired holds are ignored by conflict queries and are opportunistically marked expired. A scheduled cleanup may delete old expired/released/consumed rows after the approved retention period. Monitor hold creation, conflict, expiry and conversion ratios without recording customer PII.
