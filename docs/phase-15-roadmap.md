# Phase 15 Website Platform Roadmap

Phase 14 remains reserved for Stripe Terminal and integrated in-person
payments. The managed website platform begins at Phase 15.

## Implemented foundation

### Phase 15.0 — Architecture and monorepo foundation

- Managed-service product and control boundaries.
- One future public multi-tenant renderer.
- Structured database content and immutable published versions.
- Future worker, template, infrastructure and AI safety boundaries.

### Phase 15.1 — Site domain model and plan entitlements

- Site, version, page, section, asset, approval, change-request, publication,
  domain, job, blueprint, template and monthly-opportunity records.
- Core/Growth/Scale website entitlements resolved from active plan assignments.
- Server-side page-allowance checks.
- Agency-only foundation routes and audit events.

### Phase 15.2 — Native KS OS booking conversion contract

- Structured `KS_OS_BOOKING` actions.
- Public-reference booking URL generation.
- Tenant-owned service, location and staff validation.
- No external primary booking destination.
- Reusable booking conversion findings for future quality gates.

### Phase 15.3 — Template Intelligence Engine

Implemented as a deterministic, agency-only engine for `ENVATO_HTML`,
`GOOGLE_STITCH` and `INTERNAL` sources. It inventories trusted server-side
artefacts, classifies layouts and sections, detects booking and responsive
signals, creates strict manifests, requires explicit approval, retains
site-specific Envato licence records, and rejects unapproved compatibility.
Untrusted upload/extraction and all generation/rendering work remain deferred.

## Documented extension points

The phases below remain deliberately unimplemented.

### Phase 15.4 — Site Blueprint Engine

Generate evidence-based architectures within 10, 20 and 30-page allowances.
Plans must reflect actual services and validated locations. Staff pages require
enough useful source material. Layout assignment must be compatible, agency
overrides explicit, and thin or duplicate pages prohibited.

### Phase 15.5 — Public multi-tenant renderer

Use one renderer with verified hostname resolution, immutable published
snapshots, fallback subdomains, custom domains, native `/book`, sitemaps,
metadata, structured data, responsive output and deliberate cache invalidation.

### Phase 15.6 — Site worker

Use PostgreSQL-leased jobs with idempotency, retry/backoff and structured AI
outputs. Jobs cover generation, template analysis, image optimisation and
audits. Generated arbitrary executable code is prohibited.

### Phase 15.7 — Agency Site Studio

Future agency routes:

- `/agency/sites`
- `/agency/sites/:siteId`
- `/agency/sites/:siteId/blueprint`
- `/agency/sites/:siteId/editor`
- `/agency/sites/:siteId/pages`
- `/agency/sites/:siteId/versions`
- `/agency/sites/:siteId/domains`
- `/agency/sites/:siteId/quality`
- `/agency/sites/:siteId/analytics`

Clients receive a separate, limited factual preview, approval, comment and
managed change-request experience.

### Phase 15.8 — Quality gates

Blocking checks cover technical and content SEO, accessibility, responsive UX,
booking conversion, performance, broken links, missing CTAs, tenant mismatch,
thin content and duplicate metadata. `BOOKING_CONVERSION` findings are
publication-blocking.

### Phase 15.9 — Publishing and infrastructure automation

Add audited provider adapters for Vercel, Cloudflare and IONOS. Do not create a
source repository or independent production application for each tenant.

### Phase 15.10 — Rapid Business Launch

Orchestrate tenant creation, owner invitation, locations, services, staff,
hours, booking, payment state, site, fallback domain, blueprint, preview,
quality checks and launch. Each step remains independently auditable and
idempotent.

### Phase 15.11 — Website analytics

- Plausible: public website traffic.
- KS OS database: verified bookings and revenue.
- PostHog: internal KS OS product usage.
- Search Console: organic search.
- GA4: optional future advertising integration only if commercial policy
  changes.

No analytics provider is integrated in the foundation.

### Phase 15.12 — Monthly SEO page automation

Create opportunities at Core 1, Growth 2 and Scale 3 pages per month. Agency
approval is mandatory and publication is never automatic. Inputs can include
Search Console opportunities, services without detail pages, aftercare,
consultation and seasonal subjects. Keyword-swapped thin pages are prohibited;
every approved page requires native booking conversion.

### Phase 15.13 — Production hardening

Validate tenant isolation, load, rollback, backup restoration, worker retries,
domain collisions, preview security, booking-link monitoring, licence
enforcement and golden Core/Growth/Scale tenants before commercial launch.
