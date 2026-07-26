# Phase 15.4 — Site Blueprint Engine

## Scope

Phase 15.4 plans and approves the page architecture of an agency-managed KS OS
website. It is deterministic, uses verified KS OS records, and produces no
renderable site content.

This phase does not generate copy or images, render or publish a website,
connect domains, integrate analytics, generate monthly pages, or call an AI
service. It does not add an external booking provider. Those concerns remain
outside the blueprint engine.

## Architecture

The implementation extends the Phase 15.1 `site_blueprints` and
`site_blueprint_pages` records. It does not create a parallel site model.

- `@ks-os/contracts` defines the strict public-reference API contracts.
- `@ks-os/site-blueprints` contains framework-neutral normalisation, scoring,
  selection, slug, navigation, booking, comparison, override, and validation
  logic.
- `SiteBlueprintService` resolves tenant-owned records, plan entitlements,
  approved template compatibility, and licence state before invoking the pure
  engine.
- PostgreSQL stores pages as relational rows. Service, location, staff, layout,
  plan, and template ownership-critical links are typed foreign keys.
- `site_blueprint_generation_runs` records deterministic runs and replays.
- `site_blueprint_action_items` stores safe, structured readiness work.

The browser can submit preferences and agency-reviewed overrides. It cannot
submit an authoritative tenant, page limit, service inventory, staff inventory,
location inventory, layout compatibility result, or licence result.

## Deterministic generation

Generation resolves these inputs on the server:

1. Site and tenant.
2. Active plan assignment.
3. `sites.initial_marketing_pages` plan entitlement and a currently active,
   approved server-side override, if one exists.
4. The explicitly selected approved template version.
5. Approved and enabled layout/page-type compatibility from Phase 15.3.
6. Current site-specific template licence state.
7. Real services, locations, and eligible staff memberships for the tenant.
8. Business and branding readiness data already held by KS OS.
9. Existing canonical site paths and agency planning preferences.

The engine sorts records and preferences before calculating a SHA-256 source
digest. The digest also includes the engine version. A repeated request with
the same source digest returns the existing active proposal instead of creating
another blueprint. Changed source inputs create a later revision.

Generation persistence is one transaction protected by a site-scoped
transaction advisory lock. The blueprint, relational pages, booking
requirements, entitlement summary, action items, generation run, and audit
event therefore succeed or fail together.

## Page allowances

The commercial source of truth is the existing plan entitlement system:

| Plan | Initial marketing-page maximum |
| --- | ---: |
| Core | 10 |
| Growth | 20 |
| Scale | 30 |

`BOOKING` is functional and does not consume this allowance. `POLICIES` uses
the existing required-legal classification. The engine reports marketing,
functional, required-legal, and unused counts separately.

The maximum is not a target. Missing or weak source data produces an action
item and unused allowance; it never produces a fake service, person, location,
town, qualification, facility, price, or filler page.

## Readiness and selection

Each candidate records named scoring reasons. The weights favour required
booking paths, real active source records, booking eligibility, agency priority,
complete commercial data, approved compatible layouts, and useful navigation
or objection-handling roles. Missing required data, missing layouts,
duplication risk, and thin-content risk have named penalties.

Typical baseline candidates are Home, Services, About, Contact, FAQ, Policies,
and Booking. A candidate is selected only when its verified readiness and score
justify inclusion, except that Home and Booking are always retained so missing
layouts become explicit blocking findings.

Service detail pages require one active bookable tenant service. Location
detail pages require one active tenant location with a complete verified
address. A location hub is offered only for multiple usable locations. Team
detail pages require an active, booking-enabled public profile with meaningful
role, biography, image, or service-assignment data. Incomplete staff becomes an
action item. A team hub is useful only when multiple public profiles exist.

Results is opt-in and requires both an explicitly compatible layout and real
approved result assets. Guide page types are agency-selected, approved semantic
types rather than generic blog pages.

## Layout compatibility and licensing

Every selected layout comes from the Phase 15.3 compatibility service. The
engine uses the deterministic first approved compatible layout unless a valid
agency preference selects another compatible layout.

Compatibility is never inferred from a filename, source classification, or
browser claim. A portfolio-derived layout can serve `RESULTS` only when that
exact compatibility was approved. A layout must belong to the pinned template
version, be enabled, and include the exact approved semantic page type.

Envato drafts may be planned while their site-specific licence is pending, but
the licence appears as a blocking approval finding. Google Stitch and internal
templates do not require an Envato licence.

## Conversion roles and native booking

Default conversion roles follow the Phase 15 contracts:

- Home: `PRIMARY_LANDING`
- Service pages: `SERVICE_CONVERSION`
- Location pages: `LOCAL_DISCOVERY`
- About, Team, and Results: `TRUST_BUILDING`
- FAQ, Policies, and Guides: `OBJECTION_HANDLING`
- Booking: `BOOKING`

An agency may select only another enumerated role.

Booking requirements are structured `KS_OS_BOOKING` actions, never arbitrary
URLs. Every blueprint requires Header, Hero, Mobile Navigation, Page End, and
Footer booking placements and the functional `/book` route. Service detail
actions include their service public reference. Location and team detail
actions include their corresponding public references. The API reconstructs
agency-added page booking requirements after resolving ownership server-side.

## Slugs and navigation

Canonical paths are lowercase, root-relative, query-free, fragment-free, and
traversal-free. UUIDs and absolute URLs are invalid. Required routes include:

- `/`
- `/services` and `/services/{service-slug}`
- `/locations` and `/locations/{location-slug}`
- `/team` and `/team/{staff-slug}`
- `/about`
- `/contact`
- `/frequently-asked-questions`
- `/book`

Collisions receive deterministic numeric suffixes. Reserved paths cannot be
reassigned, and Booking is always `/book`.

Navigation groups are `PRIMARY`, `SECONDARY`, `CONTEXTUAL`, and `FUNCTIONAL`.
Only high-level discovery pages belong in primary navigation. Detail pages and
guides are contextual or secondary, while Booking is a functional Book Now
action. A Scale blueprint therefore does not place every page in primary
navigation.

## Action items

Action items have a category, severity, reason code, safe message, optional
subject public reference, and primitive safe metadata. Categories cover
business, service, location, staff, template, licence, layout, booking, brand,
content, assets, and entitlement readiness.

Examples include incomplete primary-location address, incomplete staff
profile, missing approved page-type layout, pending Envato licence, and unused
allowance. They do not contain customer, medical, credential, archive, or
generated-content data. Agency resolution is audited.

## Validation and overrides

Reusable validation checks:

- site and blueprint tenant ownership;
- current server-resolved entitlement and overrides;
- marketing/functional/legal accounting;
- unique and reserved paths;
- pinned approved template status;
- exact layout version, enabled state, and approved compatibility;
- active service, location, and staff ownership;
- duplicate subject mappings;
- structural native booking actions;
- site-specific Envato licensing;
- exactly one Home and one Booking route; and
- complete booking-conversion coverage.

Draft and review-required revisions can be edited. Agency users can add an
eligible approved page type, remove non-required pages, reorder pages, change
navigation, select another compatible pinned layout, select an enumerated
conversion role, change a valid path, and resolve action items.

The service rejects entitlement overflow, unapproved or cross-version layouts,
cross-tenant or inactive subjects, Home or Booking removal, external CTAs, and
edits to approval-frozen records.

## Lifecycle and authorization

The lifecycle is:

`DRAFT → GENERATING → REVIEW_REQUIRED → READY_FOR_APPROVAL → APPROVED`

`REJECTED` and `SUPERSEDED` are terminal revision states. Generation moves
through `GENERATING` within the atomic transaction and exposes the completed
proposal as `REVIEW_REQUIRED`.

Validation moves a proposal to `READY_FOR_APPROVAL` only without blocking
findings. Approval re-runs validation, records the agency actor and timestamp,
and writes the approval audit event. Database triggers freeze the approved
blueprint, pages, and action items. Revising creates a new draft revision and
copies the approved architecture; it never mutates the approved source.

The API has independent `sites.blueprints.read`,
`sites.blueprints.manage`, and `sites.blueprints.approve` capabilities.
Support can inspect. Fulfilment can plan and edit. Agency administrators and
platform owners can approve. Tenant and customer contexts cannot access these
routes.

## Audit events

The service records generation, update, page add/update/remove, reorder,
validation, approval, rejection, revision creation, and action-item resolution.
Metadata contains safe public references, status/count summaries, page type,
and reason codes only.

## Phase 15.5 hand-off

Phase 15.5 may consume one approved blueprint as follows:

Approved blueprint → immutable draft site version → structured page content →
multi-tenant renderer → preview → quality checks → agency publication.

That flow is intentionally not implemented here. Phase 15.4 creates no site
version, copy, image, renderer output, preview, domain, publication, analytics,
monthly SEO page, worker, or provider call.
