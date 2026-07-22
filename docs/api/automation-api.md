# External API, Zapier, Make, and webhooks

Create an API credential as an owner with the smallest scopes required. The full `ks_live_…` or `ks_test_…` key is returned once; only its SHA-256 hash is stored. Send `Authorization: Bearer <key>`. Keys support expiry, revocation, environment separation and last-used tracking.

Available foundation endpoints:

- `GET /api/external/v1/auth/test` (`bookings:read`) — Zapier test authentication.
- `GET /api/external/v1/bookings` (`bookings:read`) — filtered/paginated trigger/search source.
- `GET /api/external/v1/services` (`services:read`) — dynamic dropdown source.

Responses use `{ data, meta? }`; errors use the platform standard and include request IDs. Use booking public references as Zapier/Make deduplication IDs. Write actions remain blocked until the provider callback and idempotent booking-action contract receive product approval.

Webhook event names are versioned, for example `booking.created.v1`. Production targets must be HTTPS and cannot resolve to loopback, link-local, RFC1918, or unique-local addresses. Deliveries use `KS-Webhook-Id`, `KS-Webhook-Timestamp`, and `KS-Webhook-Signature: v1=<hex>`, where the signature is HMAC-SHA256 over `<timestamp>.<raw-body>`. Reject timestamps older than five minutes and deduplicate webhook IDs. Secrets are shown once and encrypted at rest.

Delivery workers must use a five-second timeout, no redirects, a 256 KiB payload ceiling, DNS revalidation, exponential backoff with jitter, and dead-letter after the configured attempt ceiling. Never block booking/payment commits on an outbound request. Zapier REST hooks and Make custom webhooks subscribe to these same events; public marketplace publication requires separate approval.
