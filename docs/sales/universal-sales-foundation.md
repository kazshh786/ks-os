# Universal Sales, Pipeline and Quotes Foundation

PR #228 introduces the first universal Sales engine for KSOS. It is a tenant-scoped business capability, not an industry application.

## Scope

The implemented lifecycle is:

```text
Lead / existing CRM customer
  -> Opportunity
  -> Sales pipeline stage
  -> Quote / proposal
  -> Customer accepts or declines
  -> Won / lost sales state
```

The universal Work/Jobs engine and universal Invoice engine are intentionally not part of this phase. A quote is not an invoice and an opportunity is not revenue.

## CRM identity

`clients` remains the canonical CRM identity. Sales does not create a second lead/contact table.

`client_sales_profiles` is a one-to-one extension containing sales-specific lifecycle metadata:

- `LEAD`
- `PROSPECT`
- `CUSTOMER`
- `FORMER`
- source
- tenant-team owner

Existing client rows have no extension row until Sales needs one and are treated as customers by the Sales read model. Existing salon/aesthetics fields remain untouched.

A new lead creates a normal tenant-scoped `clients` row plus a `client_sales_profiles` row. Obvious email/phone matches are linked to the existing client rather than silently creating a duplicate. Ambiguous records are never automatically merged.

Winning an opportunity or accepting its quote promotes the linked sales profile to `CUSTOMER`; it does not create another CRM record.

## Pipelines

`sales_pipelines` and `sales_pipeline_stages` provide the reusable pipeline foundation.

Pipelines currently have purpose `SALES`, while the persistence model keeps the pipeline and stage concepts independent enough for future governed extensions.

Stages have explicit categories:

- `OPEN`
- `WON`
- `LOST`

Terminal behaviour never depends on the stage name. Positions are persisted and unique within a pipeline.

Every tenant can have multiple sales pipelines. The first default pipeline is initialised transactionally and idempotently from the authenticated tenant's Business Profile/business type.

Business-aware examples include:

- Agency: New lead -> Discovery -> Proposal -> Negotiation -> Won/Lost
- Logistics: Enquiry -> Qualified -> Pricing -> Quote sent -> Won/Lost
- Plumbing/Electrical: Enquiry -> Qualified -> Site visit -> Quote prepared -> Quote sent -> Won/Lost
- Other businesses receive safe generic stages.

Once created, database pipeline data is authoritative; Business Profiles only supply defaults.

## Opportunities

`sales_opportunities` records:

- tenant
- canonical client
- pipeline and stage
- title/description
- owner
- source
- value in integer minor currency units
- tenant currency
- expected close date
- close state/reason
- creator/timestamps

All referenced client, team member, pipeline and stage lookups are constrained to the authenticated tenant. Staff with own-only Sales capability are additionally constrained to opportunities assigned to their tenant-membership ID.

Meaningful mutations append to `sales_opportunity_activity`, including stage, owner and value changes plus quote lifecycle actions. This is deliberately usable by a later Customer 360 timeline without pretending this PR implements the complete universal event timeline.

## Quotes

Quotes are real database-backed records in `sales_quotes` and `sales_quote_items`.

Lifecycle:

```text
DRAFT -> SENT -> ACCEPTED
              -> DECLINED
DRAFT/SENT -> VOID
SENT past valid_until -> EXPIRED
```

Only drafts can be edited. Accepted, declined, expired and void quotes are immutable.

Line totals, tax amounts, subtotal and grand total are calculated on the Fastify server using integer minor units. Browser-supplied totals are never trusted.

This phase supports straightforward percentage tax rates in basis points. It does not claim to be a tax/accounting engine.

Quote numbers are tenant-unique and human-readable. Public UUID references remain the API URL identity.

## Secure public quote links

`POST /api/v1/sales/quotes/:reference/share` creates an opaque 256-bit random token.

Only its SHA-256 hash is stored in `sales_quote_access_tokens`. The clear token exists only in the returned public path:

```text
/quote/:token
```

Public API endpoints are isolated from tenant-authenticated APIs and rate-limited.

The public quote page may:

- view business branding
- view the exact stored quote/version
- accept
- decline

Acceptance stores the timestamp and supplied customer name/email against the immutable quote. Repeated accept/decline requests are idempotent for the same terminal state. Expired, void or otherwise terminal quotes cannot be newly accepted.

Accepting a quote promotes the CRM sales lifecycle to `CUSTOMER` and moves the linked opportunity to the pipeline's explicit `WON` stage if available.

Voiding a quote revokes all active public access tokens for it.

## Capabilities

The existing owner/staff + access profile + capability override architecture remains authoritative.

New capabilities:

- `SALES_VIEW_OWN`
- `SALES_VIEW_ALL`
- `SALES_CREATE`
- `SALES_UPDATE_OWN`
- `SALES_UPDATE_ALL`
- `QUOTES_VIEW`
- `QUOTES_MANAGE`
- `PIPELINES_MANAGE`

Owners still receive all capabilities through the existing owner path. Practitioner/receptionist/manager profile defaults extend the established access-profile model instead of adding business-job-title auth roles.

Frontend navigation/route guards are UX controls only. Fastify services enforce tenant scope and capabilities server-side.

## Business Profiles and navigation

PR #227 introduced the Business Profile and module registries. This phase promotes the existing `sales` module from planned to implemented with route `/app/sales`.

Sales is recommended for reusable operating models such as jobs, projects, deliveries, orders and cases, and when product onboarding selects quotes, leads or sales.

The existing salon profile does not suddenly receive Sales by default. A configured salon can enable Sales by selecting it through product onboarding.

Final navigation remains the intersection of:

```text
Business Profile enabled modules
+ implementation status
+ plan/entitlements
+ user capabilities
```

## API surface

Authenticated tenant API:

- `GET /api/v1/sales/summary`
- `GET/POST /api/v1/sales/pipelines`
- `GET/POST /api/v1/sales/opportunities`
- `GET/PATCH /api/v1/sales/opportunities/:reference`
- `POST /api/v1/sales/opportunities/:reference/stage`
- `POST /api/v1/sales/opportunities/:reference/quotes`
- `GET/PATCH /api/v1/sales/quotes/:reference`
- `POST /api/v1/sales/quotes/:reference/share`
- `POST /api/v1/sales/quotes/:reference/void`

Public quote API:

- `GET /api/v1/public/quotes/:token`
- `POST /api/v1/public/quotes/:token/accept`
- `POST /api/v1/public/quotes/:token/decline`

## Reporting semantics

The Sales workspace exposes only directly supported facts:

- open opportunity count/value
- won opportunity count/value
- quotes awaiting customer decision

Pipeline/quote values are not injected into finance reports as revenue.

## Deliberately deferred

- Universal Work / Jobs / Projects conversion
- Universal invoice lifecycle
- Accounting balances
- Dedicated sales forecasting/scoring
- Proposal document templates/PDF generation
- Quote revision chains beyond immutable terminal-state protection
- Quote email sending (this phase uses secure share links; it does not pretend to send email)
- Automation-domain event trigger wiring
- Custom objects
- Full Customer 360 timeline

These should extend this Sales domain rather than duplicating it.

## Migration and deployment

Migration manifest order **80** is:

`20260906120000_universal_sales_foundation.sql`

It creates new additive Sales tables and does not delete or rewrite existing CRM, booking, payment or salon records.

PR #227 migration 79 may still be pending in production, so the VPS deployment dry-run must verify the actual sequence before applying this feature.

**Deployment classification: VPS only.**

This work changes the React application, Fastify API and PostgreSQL schema. It does not require Cloudflare DNS, Workers, Access or routing changes.
