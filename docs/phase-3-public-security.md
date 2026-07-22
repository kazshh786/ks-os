# Public Security Mechanisms

The booking system exposes several endpoints directly to unauthenticated public users via the `/:subdomain` paths. To secure these, we've implemented the following strategies:

## Rate Limiting
- Configured using `@fastify/rate-limit`.
- Limits:
  - **Catalogue**: 30 requests per minute.
  - **Availability**: 20 requests per minute.
  - **Booking Creation**: 10 requests per minute (strictest).

## Validation Boundaries
- All path parameters (`subdomain`, `reference`) are explicitly matched against strict regex patterns (e.g. `^[a-z0-9][a-z0-9-]{1,62}$`).
- Object payloads are validated strictly against `Zod` schemas (`.strict()`) to prevent JSON pollution and reject unknown fields.
- PII limits are strictly enforced (e.g., Names `max(255)`, Phone numbers `max(30)`).

## Idempotency
- Booking creation requires an `idempotencyKey` to prevent accidental double-billing or double-booking during network retries.

## Error Privacy
- Internal errors return generic `INTERNAL_ERROR` codes.
- No stack traces, raw database IDs, or Personally Identifiable Information (PII) are ever exposed in error messages.
