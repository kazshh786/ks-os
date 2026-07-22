# Customer Portal Security — Phase 10.1

## Design Principles

1. **No passwords**: Customers authenticate via Supabase magic-link only.
2. **No raw token storage**: Claim tokens are stored only as SHA-256 hashes.
3. **Staff sessions cannot access customer portal data**.
4. **Email alone cannot link accounts**: A valid claim token is required.
5. **Sensitive fields are never exposed**: Notes, Stripe identifiers, and internal booking states are stripped before returning data to the portal.
6. **Row-level isolation**: All portal queries are gated behind `customer_client_links` JOINs.

## Authentication

See [customer-authentication.md](./customer-authentication.md) for the full authentication flow.

### Session Guard

Every customer portal route handler calls `CustomerAuthService.requireIdentity()` first. This:
- Throws `403 CUSTOMER_ACCESS_DENIED` if `request.auth` is set (staff session present).
- Throws `401 CUSTOMER_AUTH_REQUIRED` if `request.authIdentity` is absent or has no `authUserId`.
- Returns the normalised identity on success.

Most routes additionally call `CustomerAuthService.requireCustomer()` which verifies the `customer_accounts` record exists and has `status = ACTIVE`. A suspended or deactivated account receives `403 CUSTOMER_ACCOUNT_SUSPENDED`.

## Claim Token Security

| Property | Implementation |
|---|---|
| Token entropy | 256 bits (`randomBytes(32)`) |
| Token encoding | base64url (43+ characters) |
| Storage | SHA-256 hex hash only — raw token lives in memory transiently |
| Logging | Raw token is never logged (Fastify redacts `req.params.token`) |
| Expiry | Configurable via `CUSTOMER_CLAIM_EXPIRY_DAYS` (default 7 days) |
| Single-use | Claim is marked `USED` atomically on completion (FOR UPDATE lock) |
| Revocation | New booking claim revokes prior PENDING claims for the same appointment |

## Tenant Isolation

All data-access queries in `CustomerPortalService` JOIN through `customer_client_links`:

```sql
SELECT ... FROM appointments
JOIN customer_client_links
  ON customer_client_links.customer_account_id = :customerAccountId
  AND customer_client_links.status = 'ACTIVE'
  AND customer_client_links.tenant_id = appointments.tenant_id
  AND customer_client_links.client_id = appointments.client_id
WHERE appointments.public_reference = :ref
```

This means:
- A customer cannot access appointments from a salon they haven't linked.
- A customer cannot access another customer's appointments even if they know the booking reference.
- Revoked links stop providing access immediately.

## Row-Level Security (Database)

The migration enables RLS on all customer portal tables and revokes direct Supabase Data API access:

```sql
ALTER TABLE customer_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_client_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_account_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_accounts, customer_client_links, customer_account_claims FROM anon, authenticated;
```

The API accesses these tables via the Postgres service role (bypasses RLS), which is acceptable because the API enforces access control at the application layer.

## Sensitive Field Exclusions

### Appointments

| Field | Excluded |
|---|---|
| `notes` / `internalNote` | ✅ Excluded |
| `medicalNotes` | ✅ Excluded |
| `userId` (staff user ID) | ✅ Excluded |
| `BLOCKED` status appointments | ✅ Excluded from queries |

### Payments

| Field | Excluded |
|---|---|
| `stripePaymentIntentId` | ✅ Excluded |
| `stripeAccountId` / `connectAccountId` | ✅ Excluded |
| `stripeCheckoutSessionId` | ✅ Excluded |

The `paymentSource` field uses customer-friendly labels (e.g., "Online payment", "Cash recorded by salon") rather than internal payment method codes.

## Rate Limiting

Customer portal routes inherit the global rate limit (100 requests per minute per IP). Claim completion (`POST /claims/:token/complete`) is additionally rate-limited to 10 per minute at the prefix level.

## Error Messages

`CustomerPortalError` is handled explicitly in the error handler:
- Domain errors log at `warn` level (not `error`) to avoid alert fatigue.
- Messages are customer-friendly — never expose internal Postgres constraint names, field names, or Drizzle query details.
- The login form never reveals whether an email address has an account (enum protection).

## Logging Redaction

`req.params.token` is in the Fastify logger redact list. Raw tokens cannot appear in structured logs.
