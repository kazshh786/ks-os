# Phase 7.2 retry safety

Email and SMS retry resets the existing tenant-scoped outbox record; existing idempotency keys remain unchanged. Automation retry resets only the failed action run and preserves its action idempotency key. Retrying resolved/dismissed issues or unsupported financial/Stripe operations returns a conflict rather than improvising a new side effect.

An issue remains actionable after queueing. It resolves only when an authoritative delivery/action success is observed.
