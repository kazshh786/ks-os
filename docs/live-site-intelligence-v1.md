# KS OS Live Site Intelligence V1 — implementation report

Status: implemented on `feat/live-site-intelligence-v1`; not deployed. This change does not mutate, generate, approve, or publish Luma.

## Executive outcome

KS OS public rendering now has three deliberately separate data classes:

```text
PUBLISHED immutable snapshot
  + server-resolved anonymous LIVE DTO
  + future request-private PERSONAL context
  = deterministic server-rendered page
```

The public renderer no longer rewrites an integrity-checked snapshot with booking-system names, descriptions, prices, durations, or hours. Stable title/H1/canonical/indexation/navigation/copy remain owned by the reviewed publication. Safe live facts are supplied through `LiveSiteDataResolver`, consumed only by registry-declared component slots, and fail back to usable published content or a standard booking CTA.

## Architecture inspection and reusable systems

The implementation reuses these existing KS OS systems:

- immutable `site_render_snapshots` and publication pointers for PUBLISHED state;
- canonical services, staff assignments, locations, schedules, overrides, and booking eligibility data;
- existing controlled `KS_OS_BOOKING` public references and `/book` server redirect;
- existing public booking preselection for service, staff, location, and campaign attribution;
- Search Intelligence page briefs and approved internal-link relationships;
- agency authentication/capabilities, append-only audit service, Site Studio, and publication review controls;
- site renderer SSR, CSP with scripts disabled, and current public health/runtime services.

The previous `OperationalPublicSiteRepository.hydrate()` behaviour mixed PUBLISHED and LIVE by overwriting snapshot fields and allowed an operational read failure to fail the page. Runtime use of that path has been removed. Domain/indexation governance remains separate and unchanged.

## Data boundaries

| Class | Allowed in shared public output | Cache | Ownership |
|---|---|---|---|
| PUBLISHED | reviewed page structure/copy, SEO, canonical, navigation, components, media, approved relationships | immutable/versioned | Search Intelligence + publication workflow |
| LIVE | public price only when opted in, existence/bookability, public entity relationships, opening state, bounded availability summary, waitlist eligibility, approved campaign state | short shared cache | canonical KS OS operations |
| PERSONAL | future bookings/history/preferences/account or personalised rebooking | private/no-store only | authenticated request context |

PERSONAL is modelled but deliberately not enabled in V1 public component metadata. It cannot enter the public DTO, shared cache, structured data, or telemetry.

## Public DTO and privacy boundary

`PublicLiveSiteData` is a strict, versioned allowlist containing only:

- canonical public UUID references;
- booleans for existence, active state, booking and waitlist eligibility;
- public price only when `services.public_price_enabled = true`;
- service/staff/location public relationships;
- public opening labels derived from canonical hours and active closures;
- precomputed non-granular availability messages;
- explicitly approved, time-bounded PUBLIC campaigns and controlled booking actions;
- bounded warnings and privacy-safe resolution telemetry.

It excludes names/copy, customer identity/history, appointment or occupancy counts, raw slots, internal staff fields, private prices, CRM notes, analytics, arbitrary IDs, secrets, and database payloads. Queries resolve the site and tenant together, then restrict entity reads to public references already present in the validated snapshot.

## Deterministic rules and components

`LiveConditionRuleV1` is a closed schema with `all`, `any`, and `none` groups. It accepts only controlled facts such as `SERVICE_BOOKABLE`, `LOCATION_OPEN`, and `CAMPAIGN_ACTIVE`. Duplicate facts, unknown keys, expressions, JavaScript, `eval`, and database queries are rejected.

The component registry remains the single component framework. Each component now declares:

- `liveDataCapabilities`;
- `supportedConditions`;
- `conditionalVisibility` (`NEVER` or `OPTIONAL_LIVE_SECTION`);
- `liveContentSlots`;
- `fallbackBehaviour`;
- `cacheClass`;
- `personalisationMode`;
- `seoImpact`.

Representative SSR integrations cover service cards/details, staff cards/profiles, locations, opening hours, booking CTAs, campaign announcements, and approved-semantic/live-eligible recommendation filtering. Temporarily unavailable services retain their stable page and copy while booking is disabled or waitlist eligibility is offered by the DTO.

Whole-section conditional visibility is closed and deterministic. Only `ANNOUNCEMENT_BAR`, an intentionally optional non-critical live experience, is registered as `OPTIONAL_LIVE_SECTION`; all chrome, hero, service, staff, location, hours, contact, editorial, primary content, conversion, and footer components are `NEVER`. A `showIf` rule on a `NEVER` component cannot remove its published markup. Every fact key is validated against the selected component's `supportedConditions`, and an unsupported pairing is rejected before rendering. `RENDER_PUBLISHED` therefore retains the published section on missing or unknown live state, while governed slots alone may change booking eligibility, availability messaging, waitlist eligibility, opening state, or public price.

## Booking and recommendation integration

Controlled page context is carried into `/book` server-side. A generic CTA on a service, staff, or location page inherits the page's canonical public reference; explicit action context remains authoritative. The existing booking flow validates those references against the tenant catalogue and preserves campaign attribution. Generated content still cannot contain a raw booking destination.

Search Intelligence continues to define semantic relationships. `eligibleLiveRecommendations()` only filters an already approved relationship set by current operational eligibility; it cannot create a new SEO link or promote unrelated capacity.

Availability is read only from `site_live_availability_summaries`. Results are tenant/site scoped and snapshot bounded: the service must be published, and every non-null staff or location reference must also be present in the validated published snapshot. A missing/stale or out-of-snapshot summary becomes UNKNOWN or the normal booking CTA—never invented availability, scarcity, slot counts, or unpublished entity references.

## Cache, performance, and failure strategy

| Class | TTL | stale-if-error | Use |
|---|---:|---:|---|
| PUBLISHED | 1 year/versioned | 0 | immutable artifacts |
| LIVE_SLOW | 300 s | 900 s | price/hours/eligibility metadata |
| LIVE_FAST | 30 s | 120 s | availability/temporary state/campaign activation |
| PERSONAL | 0 | 0 | private/no-store |

The resolver executes one bounded batch adapter, has a 1.5 second default timeout, a bounded in-process cache, stale-on-error behaviour, and a public fallback DTO. The current adapter uses one site/tenant scope query plus a fixed number of batched queries; it does not issue per-component or per-entity queries. Telemetry records resolution latency, fallback activation, cache hit, and query count without personal data.

Public responses use the LIVE_FAST cache header when live resolution is enabled. A resolver timeout or operational database failure does not remove critical published content or return a website 500. Preview and published snapshot integrity checks remain unchanged.

## SEO and schema boundary

LIVE data cannot rewrite title, H1, canonical URL, primary copy, page ownership, sitemap membership, indexation, navigation, or approved internal links. Those changes are classified as PUBLISHED and require a new reviewed site version.

V1 does not emit appointment availability in structured data. Current Service schema does not emit price, and current LocalBusiness schema does not emit opening hours, so no live value can contradict existing markup. Registry metadata marks components where a future live price/hours schema projection must be updated in the same SSR pass as visible content.

## Change-impact architecture

Database triggers automatically emit privacy-minimised `site_operational_change_events` containing the public entity reference, controlled change kind, and changed field names—never old/new values. Public rendering automatically consumes safe current LIVE state through the resolver. V1.1 adds a bounded API background cycle that claims pending events through the existing transactional processor, maps each event across the published snapshot, Search Intelligence brief identity, structured-data eligibility, internal links, and booking journeys, then persists a strict `SiteImpactAssessment` and any governed proposal. Sites without a published snapshot are skipped, duplicate site work is collapsed, and the explicit Site Studio impact-queue action remains available.

Safe operational changes are `AUTO_APPLY_LIVE`. Permanent removals, staff deactivation, address/phone changes, major descriptions, new/closed locations, and authority changes are `REQUIRE_SITE_REVIEW`. The latter create a `SiteChangeProposal` that always requires an explicit agency decision. Approving the proposal records review only; it does not publish, change routing, create a snapshot, or apply a redirect.

Human-approved campaigns are DRAFT first and require a separate `sites.studio.approve` action. Time activation within that exact approved campaign is live-safe. The API and database both reject common deceptive urgency forms.

## Site Studio

The Live Site Intelligence panel exposes:

- PUBLISHED/LIVE/PERSONAL boundaries;
- exact published snapshot/version identity;
- resolver health, query count, latency, fallback and current public state;
- every component's published source, live bindings, conditions, fallback, cache, personalisation, and SEO impact;
- operational events, assessments, proposals, and campaigns;
- an explicit impact-queue action for managers;
- explicit approve/reject proposal controls for authorised human reviewers, with confirmation and audit.

No panel action publishes the site or changes public routing.

## Migration 71

`20260811120000_live_site_intelligence_v1.sql` is additive and required before deploying the new API/renderer. It adds public price/waitlist/temporary-unavailability controls, canonical location hours/closures, precomputed availability summaries, approved campaigns, operational change events, impact assessments, and change proposals.

Security properties include tenant-scope triggers, foreign keys and FK indexes, bounded constraints, partial queue/active indexes, RLS enabled on every new table, no `anon` or `authenticated` privileges, least-privilege `service_role` grants, and trigger-function execute revocation. Migration validation/dry-run is required before application. Migration 71 was applied as part of the separately reviewed V1 foundation release, before the VPS services were updated.

## V1.1 dynamic-site completion

The V1.1 follow-up completes the deliberately bounded public dynamic-site surface:

- a cursor-bounded producer computes short-lived, service-level availability summaries for services in the exact published snapshot without persisting raw slots or counts;
- an unavailable but active service may expose a governed waitlist CTA through the existing KS OS booking journey while retaining its published service section and H1;
- exact-version Search Intelligence internal-link records render as visible recommendations, with LIVE state permitted only to remove an operationally ineligible service target;
- approved active campaigns render in every governed placement (`ANNOUNCEMENT`, `HERO`, `PAGE_BODY`, and `PAGE_END`) without rewriting published SEO content; and
- operational events are processed automatically into impact assessments and human-reviewed draft proposals, with no autonomous approval or publication path.

Migration 72 only pins `ks_validate_live_site_scope()` to the trusted `public, pg_temp` search path after the production security-advisor review of migration 71. It is additive and must remain unapplied until the V1.1 PR is approved and deployed.

## V1 compatibility and deferred scope

- Existing V1 snapshots remain valid because `showIf` is optional and legacy component selection remains deterministic.
- Existing explicit booking actions behave unchanged; generic actions gain safe page context.
- Existing published price/hours remain the fallback until the corresponding live feature is opted in and available.
- No client-rendered SPA dependency or new public API is introduced.
- PERSONAL customer experiences, private waitlist details, raw availability slots, invasive attribution/fingerprinting, automatic redirect application, and autonomous publication are deliberately deferred.

## Deployment classification

Classification: **BOTH + DATABASE MIGRATION**.

- VPS: API, site renderer, and any site-worker change processing/runtime package build.
- Cloudflare: Site Studio web bundle only.
- Database: migration 71 for the V1 foundation; migration 72 for the V1.1 trusted search-path hardening, each after explicit dry-run/review.

The merge/deployment sequence must be migration-aware and fail closed: validate the pending migration, apply it, deploy VPS services, verify health/readiness and renderer fallback/live paths, then verify the Cloudflare UI. The V1.1 implementation PR does not apply migration 72 or deploy its branch.

## Luma proof plan (not executed here)

After review, migration, and deployment approval, Luma can be used without publishing a new site version to verify live price opt-in, availability, staff bookability, opening hours/temporary closure, approved campaign timing, booking context, recommendation eligibility, and resolver fallback. The proof must confirm stable SEO snapshot/canonical/indexation, no privacy leak, valid booking, and no material LCP/CLS regression. Any material proposal stops for human review.
