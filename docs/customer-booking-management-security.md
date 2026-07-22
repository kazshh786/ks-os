# Customer Booking Management Security

## Authorization

Authenticated access uses this database relationship for every appointment lookup:

```text
customer account
→ active customer_client_links row
→ matching tenant_id and client_id
→ appointment public reference
```

Guest access hashes the supplied token and joins one active, unexpired token row to the same tenant and appointment. It does not expose the client profile, other appointments, unrelated forms, cross-salon data, or payment history.

Both paths return the same safe not-found response when lookup fails. Staff sessions remain separated from customer identity by the Phase 10.1 customer-auth guard.

## Token handling

- Tokens use `randomBytes(32)` (256 bits) and base64url encoding.
- Only a SHA-256 hash is stored.
- Issuing a replacement locks the appointment and revokes older active tokens.
- Public booking email receives the raw URL transiently; it is not put in an outbox or database field.
- Fastify redacts the full request URL and `req.params.token`.
- The web document uses `Referrer-Policy: no-referrer` to reduce path-token leakage.
- Guest rate-limit keys use the token hash, never the raw token.

## Browser input boundaries

Strict Zod contracts reject unknown fields. Mutation requests contain only expected version, new start/staff public reference or cancellation reason, and an idempotency UUID. Tenant ID, client ID, appointment ID, service ID, channel, location, resource, price, payment provider identifiers, and refund amounts are not accepted.

Customer-visible owner text is bounded plain text. HTML and template expressions are rejected by API contract and migration constraints. Cancellation reason text is bounded and redacted from structured logs.

## Concurrency and replay

Each mutation holds an appointment row lock. Rescheduling additionally acquires staff and resource advisory locks and rechecks canonical availability inside the transaction. Updates require the expected integer version and an eligible status. The database trigger increments appointment versions for other update paths.

Idempotency uniqueness is scoped to hashed actor identity, appointment, action, and caller key. The stored request fingerprint detects conflicting reuse; the stored safe response supports retry after a lost response. History IDs drive stable event and outbox idempotency keys.

## Database exposure

The new token, history, and idempotency tables have RLS enabled and all privileges revoked from Supabase `anon` and `authenticated` roles. They are API-only. Tenant/appointment foreign keys and lookup indexes support scoped access. Production migration application is a separate reviewed operation.

## Sensitive-data exclusions

Management responses and events contain no internal notes, medical data, form answers, customer contact details, raw tokens, management URLs, provider secrets, card/bank data, or Stripe identifiers. Guest payment display is limited to the selected appointment's customer-safe amount/status summary.

## Rate limiting

Policy, availability, reschedule, cancellation, and invalid guest-token requests have route limits. Keys combine IP with customer identity plus booking reference, or IP with a guest token hash. Global API rate limiting remains in place as an additional ceiling.
