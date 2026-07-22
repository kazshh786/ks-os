# Phase 13 integration assessment

## Existing architecture

KS OS is a pnpm TypeScript monorepo: Vite/React web, Fastify API, Zod contracts, Drizzle/Postgres on Supabase, Supabase Auth, private Storage, and DB-backed outbox/worker patterns. Tenant membership is resolved server-side. Booking availability and price are revalidated by the API, and Stripe Connect/webhook reconciliation already owns online payments.

Phase 13 adds a provider-neutral control plane: encrypted connections, idempotent integration events, revocable iCalendar feeds, accounting mappings, signed webhook subscriptions/deliveries, hash-only API credentials, and location-scoped hardware records. Public-schema tables have RLS enabled and no browser-role grants.

## Commercial decisions

| Capability | Value | Decision | Activation dependency | Complexity/risk |
|---|---|---|---|---|
| Google Calendar | High staff utility | Foundation implemented; OAuth activation requires credentials | Google Cloud OAuth app, verified redirect/scopes | Medium; token/webhook lifecycle |
| Microsoft Outlook | High for Microsoft 365 businesses | Foundation implemented | Entra app registration and tenant consent | Medium/high; subscription renewal |
| Apple/iCalendar | Broad reach, no vendor account | Implemented now | Public HTTPS API URL | Low; feed URL is a bearer secret |
| Xero | High UK accounting value | Provider-neutral foundation and safe export implemented | Xero app and accounting-policy mappings | High; tax/account decisions |
| QuickBooks | Valuable secondary provider | Foundation implemented | Intuit app and stakeholder mapping choices | High |
| Zapier / Make | High automation reach | Scoped API and signed webhook foundation implemented | Platform publication/approval only for public listing | Medium |
| Booking widget | Existing public booking flow has highest reuse value | Existing responsive booking link retained; embed guidance added | Allowed-origin/domain policy | Medium |
| Stripe Terminal | Fits existing Stripe architecture | Secure connection-token foundation implemented | Readers, Stripe Terminal locations, live device tests | High; physical/payment reconciliation |
| Receipt printers | Useful for POS | Browser print/PDF path recommended | OS printer driver | Low |
| Cash drawers | Limited, hardware-specific | Foundation/documentation only | Supported printer bridge or native wrapper | High; no generic browser API |
| Barcode scanners | Useful lookup accelerator | Keyboard-wedge approach recommended | USB/Bluetooth scanner | Low |

## Remaining risks and decisions

- Live provider callbacks, refresh, subscriptions, and accounting writes must not be enabled until sandbox credentials, tax mappings, reconciliation ownership, and disconnect policy are approved.
- External delivery workers need deployment scheduling and egress controls. DNS must be revalidated at delivery time to prevent rebinding.
- Terminal readers require physical test coverage; an uncertain client result must always reconcile with Stripe webhooks.
- The current Fastify/Drizzle dependency audit has known high-severity advisories and requires a coordinated upgrade.

Status: Apple feeds, accounting exports, scoped credentials, external reads, webhook registration security, and Terminal token boundary are implemented. Google, Microsoft, Xero, and QuickBooks are credential-gated foundations. Public Zapier/Make apps and hardware claims are intentionally not made.
