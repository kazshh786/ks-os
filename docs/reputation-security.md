# Reputation security

## Isolation and authorisation

Every connection, mapping, rule, invitation and cached review is tenant-scoped. Location IDs are checked against the authenticated tenant and active-location state. Owner access is mandatory for connection, rule, sync and reply mutations. `REPUTATION_VIEW` may be explicitly granted for read-only reputation access; staff receive none by default.

New public-schema tables enable RLS and revoke `anon`/`authenticated`; only the server-side `service_role` receives table access. API queries also include tenant predicates, because RLS does not replace application authorisation.

## Secrets and OAuth

Provider credentials use AES-256-GCM with a random 96-bit IV, authentication tag, envelope version, and a 32-byte `INTEGRATION_ENCRYPTION_KEY`. Credentials never enter tenant settings JSON or API responses. Google OAuth state is 256-bit random, stored as SHA-256 only, single-use and ten-minute expiry. OAuth codes and URLs are redacted by request logging.

## Public tokens

Invitation IDs are random UUIDs. A server-only `REVIEW_INVITATION_TOKEN_SECRET` derives an unlinkable 256-bit HMAC token; only its SHA-256 hash is stored. The email/SMS outbox stores an invitation reference—not a raw token. Delivery workers derive the URL in memory immediately before rendering. Tokens expire after 30 days and token reads/clicks are rate-limited by IP plus a short token fingerprint. Raw request URLs and token parameters are redacted.

## URL and data minimisation

Provider destinations must be HTTPS, credential-free, bounded and on explicit provider hosts/paths. Public click requests submit only a provider enum and cannot supply a redirect URL. Provider metadata is limited to opaque reference, customer name/email when Trustpilot requires it, locale, and provider location. No medical notes, treatment/service details, forms, payment data, internal notes, or staff-performance data are sent.

Public replies are length-bounded plain text and rejected when they appear to contain emails, phone numbers, appointment/treatment, medical, diagnostic or internal-note data. The UI requires a privacy acknowledgement and warns that replies are public.

## Deployment secrets

```text
INTEGRATION_ENCRYPTION_KEY       # 32 bytes, base64 or 64 hex characters
REVIEW_INVITATION_TOKEN_SECRET  # at least 32 characters
PUBLIC_APP_ORIGIN
```

Rotate provider credentials through disconnect/reconnect. Encryption-key rotation needs a planned decrypt/re-encrypt migration; do not replace the key while encrypted rows still use it.
