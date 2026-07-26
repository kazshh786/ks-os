# Phase 15.3 Template Intelligence Engine

## Status and scope

Phase 15.3 implements deterministic, agency-controlled inspection and approval
for `ENVATO_HTML`, `GOOGLE_STITCH` and `INTERNAL` template sources. It produces
strict, reusable template manifests for future site planning. It does not
generate, render, edit or publish client websites.

The implementation has three boundaries:

1. `@ks-os/contracts` defines the source, analysis, classification, manifest,
   override and licence inputs.
2. `@ks-os/template-intelligence` performs framework-neutral inspection and
   validation without database access or code execution.
3. The agency API persists lifecycle records, applies capabilities and writes
   platform audit events.

Analysis completion is never approval. A version becomes production-usable only
after an agency user with `sites.templates.approve` explicitly approves it.

## Safe import boundary

The repository does not currently contain a complete, established combination
of multipart intake, private object storage, bounded archive extraction and
malware scanning suitable for untrusted template packages. Phase 15.3
therefore does not expose an upload or archive-extraction endpoint.

The pure analyser accepts trusted server-side file inventories and file
contents. A future worker or private storage adapter can supply that input
without changing the classification interface. The API stores an opaque
artefact reference and SHA-256 digest, but never returns the reference or a
local absolute path.

The ingestion helpers enforce:

- normalised forward-slash relative paths;
- rejection of absolute, drive-qualified, parent-traversal and null-byte paths;
- rejection of symbolic links and hard links;
- root-containment checks;
- configurable file-count, total-size and individual-file-size limits;
- controlled file categories and extension safety;
- SHA-256 file and deterministic inventory digests; and
- inventory-only handling for executable files.

HTML is parsed structurally with `parse5`. JavaScript, PHP, shell scripts,
binaries, npm lifecycle scripts and template build tools are not executed.
Scripts may be inventoried and surfaced as review findings. Source HTML, CSS,
JavaScript and archive bytes are not copied into audit metadata or general API
responses.

## File and analysis records

The additive Phase 15.3 migration extends template versions, layouts,
layout/page-type compatibility records and licences. It adds:

- `template_analysis_runs` for idempotent lifecycle and analyser provenance;
- `template_files` for safe relative-path inventory metadata;
- `template_analysis_findings` for security and quality review; and
- `template_layout_sections` for ordered semantic section detections.

An analysis is unique by template version, artefact digest and analyser version.
An advisory transaction lock prevents concurrent callers from creating
conflicting runs. Repeated requests return the existing analysis. Failed runs
remain explicit and auditable.

Full source files are not stored in JSONB. Summary JSON contains only controlled
design and layout signals. New control-plane tables have RLS enabled, browser
roles revoked and service-role access granted. Foreign-key and query-path
indexes cover version, run, layout, actor and tenant/site licence lookups.

## Semantic inspection

The HTML inspector records document metadata and structural signals including:

- title, meta description, canonical URL and language;
- header, navigation, main and footer landmarks;
- heading hierarchy and breadcrumbs;
- forms, links, buttons, images and responsive-image attributes;
- structured-data types;
- script and stylesheet references;
- inline-style presence and internal-page links; and
- CTA labels and booking-related attributes.

Section detection combines semantic elements, ARIA landmarks, IDs, classes,
headings, text, actions and DOM position. It can identify all Phase 15.3 section
types, including hero, service, benefit, process, pricing, team, gallery,
results, testimonial, trust, FAQ, location, opening-hours, map, contact,
booking, final-CTA and footer structures. Each section records a confidence
score, order, safe structural reference, required-state recommendation,
booking-action presence and review state.

## Classification and conversion

The deterministic classifier uses filenames, document metadata, headings,
breadcrumbs, navigation, content-card patterns, forms, maps, ecommerce,
portfolio, article and booking signals. It produces:

- detected source page type;
- recommended KS OS page type;
- incompatible page types;
- conversion role;
- normalised confidence and `LOW`, `MEDIUM` or `HIGH` band;
- explainable reason codes;
- missing expected sections;
- booking CTA coverage;
- responsive, accessibility and security concerns; and
- an agency-review requirement.

Low and medium confidence require review. High confidence may preselect a
recommendation, but cannot approve a layout or version.

Portfolio and ecommerce signals are evaluated before service terminology.
`PORTFOLIO` and `PRODUCT_DETAIL` are never silently treated as
`SERVICE_DETAIL`. A portfolio layout may be manually approved for `RESULTS`.

Conversion roles are restricted to the Phase 15 contract:
`PRIMARY_LANDING`, `SERVICE_CONVERSION`, `LOCAL_DISCOVERY`, `TRUST_BUILDING`,
`OBJECTION_HANDLING` and `BOOKING`.

## Booking CTA detection

Booking detection examines link or button text, `aria-label`, `href`, data
attributes and form actions. It recognises booking, scheduling, reservation and
availability language. Ecommerce, portfolio, article, contact and subscription
labels are not treated as booking CTAs.

Detected positions are restricted to `HEADER`, `HERO`, `MOBILE_NAVIGATION`,
`SERVICE_CARD`, `SERVICE_DETAIL`, `FINAL_SECTION`, `FOOTER`, `STICKY_MOBILE`
and `OTHER`. Phase 15.3 describes source CTA locations only; it does not rewrite
them. The Phase 15.2 `KS_OS_BOOKING` action remains the future destination
contract.

A layout cannot receive `BOOKING` compatibility unless analysis or an explicit
agency classification provides booking-structure evidence.

## Design and responsive signals

CSS analysis extracts controlled summaries for custom properties, colours,
font families and weights, spacing values, radii, shadows, container widths,
button variants, common aspect ratios and framework indicators. Raw copyrighted
stylesheets are not returned through the API.

Responsive analysis reports viewport metadata, media-query count, breakpoints,
responsive images, `picture`, responsive navigation, grid and flex usage,
fixed-width risks, horizontal-overflow risks and absent mobile-navigation
signals. This is static structural analysis, not browser-based visual QA.

## Validated manifest

Every manifest must pass the strict `TemplateManifestSchema`. Unknown fields
are rejected. The versioned schema contains:

- source type, version reference, name and industry tags;
- controlled design signals;
- layout identity and relative source file;
- detected, recommended, compatible and incompatible page types;
- conversion role, confidence, reason codes and review state;
- ordered sections and booking CTA positions;
- responsive, accessibility and security signals; and
- bounded, structured findings.

The manifest never contains a raw archive, complete DOM, script body, stylesheet
body, local absolute path or provider credential.

## Manual agency review

Users with `sites.templates.manage` can rename layouts, change recommendations
and conversion roles, add or remove approved page types, disable layouts,
confirm mappings through the structured records, resolve findings and add
agency notes. Version approval and rejection require
`sites.templates.approve`. Licence mutations require
`sites.templates.licenses.manage`.

Validation rejects disabled-layout compatibility, unsupported conversion roles,
unapproved browser-supplied compatibility and unsupported booking assignments.
Blocking findings prevent approval. At least one enabled `HOME`-compatible
layout is mandatory. Missing `SERVICE_DETAIL` compatibility creates an advisory
warning rather than an absolute block.

After approval, database triggers and service guards make the version, manifest,
layouts, compatibility assignments, section mappings and approved analysis
immutable. A change requires a new template version. Earlier approved versions
remain queryable so existing sites cannot silently change.

## Compatibility service

`TemplateCompatibilityService` is backed by repository-controlled approved
records and exposes:

- `isLayoutCompatible`;
- `assertLayoutCompatible`;
- `listCompatibleLayouts`; and
- `explainLayoutCompatibility`.

It requires an approved template version, an enabled layout and an explicitly
approved layout/page-type record. Browser-submitted compatibility is never
trusted. This is the stable boundary intended for the future Site Blueprint
Engine.

## Envato licences

Envato use is recorded per tenant, site and template version. A record contains
the Envato item and licence references, an optional project-registration
reference, dates, actor and status. An optional evidence reference points to
private storage; certificate binary data is not stored in ordinary text or
returned by licence views.

`TemplateLicenceGuard` requires a valid, active, non-expired, site-specific
licence for `ENVATO_HTML`. `GOOGLE_STITCH` and `INTERNAL` bypass the Envato
requirement. Publication remains deferred, so this phase supplies the reusable
guard without invoking a publishing workflow.

Licence queries constrain both the site and tenant relationship. Tenant
contexts cannot enter the agency routes.

## Google Stitch

Google Stitch is an imported source type only. No Google API is called.
Analysable HTML exports use the same safe parser. Design-only exports can be
registered with agency-controlled manual layouts, page types, conversion
roles, section mappings and design signals. Unsupported proprietary formats
remain `REVIEW_REQUIRED`; the platform does not claim to interpret them.

## Agency API

Phase 15.3 adds agency-only routes under `/api/v1/agency` for source and version
registration, analysis lifecycle and manifest review, layout overrides,
compatibility assignments, finding resolution, version approval/rejection and
site-scoped licence management. All identifiers use public references.

There are no public or tenant template-management routes, raw-template
downloads, multipart endpoints or archive endpoints.

Agency mutations use the existing platform audit service. Events contain safe
references, status changes, counts, fields and reason codes; they do not contain
manifests or source contents.

## Deferred work

The following remains intentionally outside Phase 15.3:

- live Google Stitch API integration;
- AI-assisted classification;
- screenshot-based visual classification;
- full browser rendering and responsive visual QA;
- a private upload, object-storage, archive-extraction and malware-scan worker;
- template conversion into production components;
- Phase 15.4 Site Blueprint Engine;
- website generation and public site renderer;
- visual or client editing;
- publishing and rollback orchestration;
- Vercel, Cloudflare or IONOS integration;
- custom domains, analytics and monthly SEO pages.
