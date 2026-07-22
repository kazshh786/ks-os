# Calendar and accounting integrations

## Calendar setup

Create separate OAuth applications for development, staging, and production. Configure the exact callback variables in `.env.example`; never use wildcard redirects. Google requires Calendar event/read scopes. Microsoft requires `offline_access`, `User.Read`, and `Calendars.ReadWrite`. OAuth state is signed, expires after ten minutes, and binds provider, tenant, user, nonce, and return path. Provider tokens belong only in the encrypted `token_ciphertext` envelope.

Apple-compatible feeds are created by a business owner. The URL is shown once and acts as a credential. A feed can be business-, staff-, or location-scoped and defaults to busy-only titles. Rotation invalidates the old URL immediately; revocation returns 404. Feeds use UTC timestamps, stable UIDs, booking versions as `SEQUENCE`, escaped/folded lines, cancellation status, and five-minute private caching.

Calendar write adapters must enqueue `integration_events` using `provider + idempotency_key`; store the external event ID before acknowledging success. Only explicit `TWO_WAY` connections may affect local busy time. Provider failures degrade availability with a visible warning rather than silently treating external time as free.

## Accounting

`GET /api/v1/integrations/accounting/export` exports only `SUCCEEDED` or `REFUNDED` checkout transactions. It supports date range, location, status, CSV and JSON. Gross, refund and net values use minor currency units. Pending/failed payments are excluded. Missing tax/account mappings remain blank and must be resolved before a live provider write.

For Xero or QuickBooks, configure service/account, tax-code, payment clearing, refund, location/class, deposit, tip and fee mappings. Use the local transaction ID as the stable external reference. Never rewrite a posted record: create a credit/refund/adjustment and retain both external IDs. Reconciliation should review local-only records, duplicates, refunds, fee/tax/currency differences, and partial failures.

Troubleshooting: `REAUTHORISATION_REQUIRED` means consent/token refresh is needed; `REQUIRES_MAPPING` means no provider write should be attempted; `MANUAL_REVIEW` means retry is unsafe.
