# Phase 15.8 — SEO, UX, accessibility and conversion quality gates

## Scope and boundary

Phase 15.8 adds a durable, exact-version quality system for generated public
sites. It evaluates whether a reviewed structured draft is ready for a future
publication workflow. It does not publish, deploy, activate a hostname, alter
DNS, submit a sitemap, call a live AI model, send email, or create a booking.

The intended lifecycle is:

```text
Generated structured draft
→ agency review
→ approved site version
→ full quality audit
→ remediation
→ re-audit
→ publication readiness
→ Phase 15.9 publishing
```

The final arrow is an integration boundary. Phase 15.9 must consume the
publication-readiness service; it must not reconstruct or bypass its decision.

## Architecture

`@ks-os/site-quality` contains framework-neutral contracts, the server-owned
check registry, versioned policy, deterministic validators, browser and
AI-provider interfaces, finding comparison, client-safe summaries, waiver
guards, and the reusable publication-readiness evaluator.

The agency API resolves all tenant, site, version, page, section, review,
knowledge-pack and actor ownership from public references. It creates a
digest-bound run and enqueues an existing durable site job. The site worker
executes checks and persists bounded results. The public renderer supplies a
bearer-only, no-store, noindex exact-version preview. Site Studio presents the
same persisted records through capability-gated actions.

Raw preview tokens, page bodies, private uploads, prompts, model responses,
provider credentials, payment data and medical/intake data are not quality
records or audit metadata.

## Audit types

The finite server-side audit types are:

- `FULL_SITE_QUALITY`
- `TECHNICAL_SEO`
- `ON_PAGE_SEO`
- `LOCAL_SEO`
- `STRUCTURED_DATA`
- `ACCESSIBILITY`
- `RESPONSIVE_UX`
- `CONVERSION`
- `BOOKING_INTEGRITY`
- `CONTENT_INTEGRITY`
- `PERFORMANCE`
- `INTERNAL_LINKING`
- `ASSET_READINESS`
- `PUBLICATION_READINESS`

The browser cannot submit a check definition, rule, arbitrary audit type,
severity, model, policy version, or publication effect.

## Run lifecycle and idempotency

Run states are `PENDING`, preparation and execution states, `EVALUATING`,
`READY`, `FAILED`, cancellation states, and `SUPERSEDED`. `READY` means the
audit finished; the separate `publicationGateStatus` may still be `BLOCKED`.
No run state performs publication.

The idempotency digest includes tenant, site, exact version and content digest,
active knowledge pack and digest, policy version, engine version, renderer
version, audit type, and controlled reason. An identical request reuses its
eligible run. Changed content creates a distinct run.

Every run pins:

- the tenant-owned site and version;
- the immutable generation content digest;
- generation and review provenance;
- the one active `PUBLIC_SITE` knowledge pack, its semantic version and digest;
- selected accepted rules and applicable page/section playbooks;
- the selection digest;
- policy, engine and renderer versions;
- audit type and reason;
- the requesting agency actor and durable site job.

Database triggers enforce the same ownership boundaries. Browser roles have no
direct table access; raw tables use RLS plus explicit `service_role` grants.

## Knowledge pack and quality policy

The API requires exactly one active `PUBLIC_SITE` pack. It selects accepted
rules and the page/section playbooks applicable to the exact snapshot, then
stores public references and digests on the run. The worker rejects a run if
the active pack no longer matches the pin.

`KS_OS_PUBLICATION_POLICY_V1` is server-owned. It defines required categories,
five stable viewports, check IDs, human-review requirements and advisory lab
thresholds. `15.8.0` is the current quality-engine version. A policy, pack,
renderer or content change makes previous evidence unsuitable for a new
readiness decision.

## Check registry and result semantics

Each registered check has a stable ID, category, method, rules, applicability,
severity, publication effect, waiver policy, evidence requirements, guidance,
and engine version. Methods are deterministic, rendered browser, mixed,
optional AI review, human review, or data required.

Results are `PASS`, `FAIL`, `WARNING`, `NOT_APPLICABLE`, `DATA_REQUIRED`, or
`ERROR`. Automation never converts inability to evaluate into `PASS`.
Severity and publication effect come from policy and structured results, not
from textual sentiment.

## Deterministic checks

Deterministic validation covers snapshot schema and ownership, current version
status, required pages and sections, executable-content rejection, native
booking actions, same-snapshot booking references, canonical structured facts,
claims, metadata, internal references, approved public assets, template
licensing, and exact-digest approvals.

These checks consume database records and the stored preview snapshot. They do
not read the original CSV paths. The active imported knowledge records are the
source of expert rules and playbooks.

## Secure rendered-browser checks

The worker adapter uses Playwright Chromium and axe-core. A fresh isolated
browser context is created for each page and viewport. It sends a short-lived
quality token only in the `Authorization: Bearer` header. The preview endpoint
rejects query-token quality requests, mixed query/bearer requests, inactive
sessions, another run/site/version, stale content digests and paths outside
the exact version.

Preview responses use `Cache-Control: no-store`, `X-Robots-Tag: noindex`,
robots metadata and no-cache compatibility headers. The canonical URL remains
the public canonical host and page path; a preview host canonical is blocking.
The token itself is stored only as a SHA-256 digest and is never logged.

Required viewport profiles are:

| Key | Width × height | Class |
| --- | --- | --- |
| `SMALL_MOBILE` | 320 × 568 | Mobile/touch |
| `STANDARD_MOBILE` | 390 × 844 | Mobile/touch |
| `TABLET_PORTRAIT` | 768 × 1024 | Tablet/touch |
| `DESKTOP` | 1440 × 900 | Desktop |
| `WIDE_DESKTOP` | 1920 × 1080 | Wide desktop |

The adapter checks render status, main content, head metadata, canonical path,
JSON-LD types, heading count, internal links, image alternatives, overflow,
clipped or obscured controls, touch targets, booking visibility, bounded
keyboard reachability, console/resource failures, automated accessibility and
lab performance. Browser processes and contexts close after success, failure,
cancellation and worker shutdown.

Screenshots are not retained by default because no approved private evidence
store is configured. The durable evidence model supports a storage reference,
but Phase 15.8 records bounded summaries and digests instead of pretending an
unretrievable screenshot exists.

## SEO and local SEO

Technical SEO checks renderability, canonical correctness, secure-preview
indexing controls and internal links. On-page checks cover title,
description, one primary heading and structured metadata. Structured-data
generation remains server-owned and canonical-record-derived; arbitrary raw
JSON-LD scripts, fabricated ratings and self-serving review markup are outside
the allowed content model.

Local business, service, location, staff, opening-hours, price and duration
claims remain tied to canonical KS OS records. Phase 15.8 reports readiness; it
does not promise rankings or make optional experimental SEO practices blockers.

## Accessibility and responsive UX

Automated coverage uses applicable WCAG 2.2 A/AA axe rules plus platform checks
for keyboard reachability, focus behaviour, image alternatives, responsive
overflow, clipping, obscuring and touch targets. Serious or critical automated
failures, missing keyboard access to the primary booking action, focus traps,
missing required alternatives and broken primary layouts block readiness.

Automated tooling cannot prove every cognitive, screen-reader, language,
motion, date-picker or subjective focus-order concern. The human trust review
therefore remains explicit and cannot be silently auto-completed.

## Conversion and native booking integrity

The site and booking journey use the same canonical tenant, services,
locations, staff, eligibility and preselection records. The public renderer
generates native `/book` actions server-side. External booking destinations,
cross-tenant references, invalid native actions and an unusable primary booking
journey are non-waivable blockers.

Browser audits do not create bookings. They stop at bounded public journey
evidence and never call a live tenant fixture. No external booking integration
is added.

## Performance

Phase 15.8 records isolated lab measurements for page load, main-content time,
cumulative layout shift, transferred bytes and failed critical resources. It
also records bounded counts for client-side console exceptions, images above
the policy's 500 kB transfer threshold and images missing intrinsic width or
height metadata. Thresholds are policy-versioned. These are lab observations,
not real-user field data and not ranking guarantees. A critical resource or
render failure blocks; client exceptions, asset sizing and advisory threshold
breaches produce explicit warnings unless they also prevent rendering or the
native booking journey.

## Assets and content integrity

Public assets must be approved, HTTPS, dimensioned and supplied with an
appropriate alternative when informative. Executable content, unsafe
arbitrary HTML, unapproved assets, unsupported claims, fabricated prices,
credentials, testimonials, ratings or sensitive claims block readiness
according to policy.

Private questionnaire uploads, intake answers, payment data and internal notes
never become public assets or quality evidence.

## Findings, evidence and remediation

A finding retains a public reference, stable check and code, category, severity,
publication effect, current status, optional page/section/field anchors, rule
references, bounded explanation, evidence summary, guidance, digest and
timestamps. Evidence is append-only and records type, bounded safe metadata,
content/evidence digests, optional approved storage reference, tool version,
viewport and capture time.

Finding states support open, acknowledged, in remediation, resolved, waived,
not applicable and superseded. Re-detection reopens an eligible resolved
finding and is audited. Completed results are not erased by a later operational
failure.

Remediation reuses Phase 15.7A structured change requests and Phase 15.6C
bounded page/section regeneration. There is no arbitrary site-JSON editor.
Post-remediation work creates a new exact-digest run; old runs remain auditable
and same-site comparison reports new, recurring, resolved and severity changes.

## Waivers

Only an agency administrator or platform owner with
`sites.quality.waive` may create a policy-permitted waiver. The waiver records
the finding, run, version/content digest, evidence digest, rule, policy, pack,
risk acceptance, approver and optional expiry.

Tenant clients cannot waive. External booking, cross-tenant, executable,
fabricated, critical accessibility, required page/section, approval, template,
asset, render and other policy-listed failures are non-waivable in both service
logic and a database trigger. Expired, revoked, invalidated, digest-mismatched,
policy-mismatched or pack-mismatched waivers cannot satisfy readiness.

## AI-assisted and human review

AI review is an optional adapter with structured inputs and outputs. The
production flag is disabled and fails closed because no governed live provider
is configured. Tests use the deterministic fake provider. AI findings are
advisory and cannot override a deterministic blocker, approve a site or choose
a model from browser input. Raw prompts and responses are not stored.

An agency human-review check is durable and starts as `DATA_REQUIRED`. An
authorised agency reviewer records `PASS`, `FAIL` or `DATA_REQUIRED` with
notes. Until `PASS`, its non-waivable blocking task remains open. Clients
cannot complete agency human review.

## Publication-readiness evaluator

The reusable evaluator checks:

- latest full run existence, completion and freshness;
- exact content digest and non-superseded complete version;
- current agency and required client approvals;
- unresolved review items, facts and human tasks;
- open blocking and non-waivable findings;
- warning and waiver counts;
- stale waivers;
- booking, accessibility, SEO, performance, content and asset category states.

It returns `BLOCKED`, `READY_WITH_WARNINGS` or `READY`, explicit reason codes,
category states and `publicationPerformed: false`. A partial or failed run,
missing browser evidence, cancellation or `DATA_REQUIRED` check cannot satisfy
readiness.

## Site Studio and client visibility

The existing Site Studio has one Quality section with overview, SEO,
accessibility, UX, conversion, booking, performance, content, assets and
publication-readiness tabs. It shows the pinned digest and versions, explicit
gate, counts, findings, evidence summaries, category/page status, human tasks,
waivers, run controls and previous-run comparison.

Actions are rendered only when the current agency session has the corresponding
capability. Higher-authority waiver controls are not shown to fulfilment or
support users. The client-safe mapper includes only explicitly client-visible
accessibility, booking, asset and approval actions; it excludes security,
infrastructure, provider, prompt, raw evidence, private asset and agency-note
details.

## API and audit events

Agency endpoints under `/api/v1/agency/sites/:siteReference` create, list,
inspect, cancel, retry and compare runs; list findings/evidence/summary;
acknowledge, remediate, resolve and waive findings; complete human review; and
evaluate publication readiness. All identifiers are public references.

Audit events cover run request/start/completion/failure/cancellation, finding
creation/reopening/acknowledgement/resolution, waiver creation/revocation/
invalidation, human review, and readiness evaluated/blocked/ready. Safe
metadata contains public references, codes, counts and pinned versions only.

## Environment

Tracked files contain placeholders only:

```dotenv
SITE_QUALITY_ENABLED=false
SITE_QUALITY_BROWSER_ENABLED=false
SITE_QUALITY_BROWSER_CONCURRENCY=2
SITE_QUALITY_PAGE_TIMEOUT_MS=30000
SITE_QUALITY_RUN_TIMEOUT_MS=900000
SITE_QUALITY_PREVIEW_ORIGIN=https://preview.sites.example.com
SITE_QUALITY_AI_ENABLED=false
SITE_PREVIEW_TOKEN_SECRET=generate-a-distinct-secret-at-least-32-characters
```

Browser auditing requires quality execution, preview origin and token secret.
Production requires HTTPS. The platform still builds with browser and AI
features disabled.

## Partial failure and operational limitations

A failed category or viewport preserves completed checks and evidence, records
a bounded failure code, revokes its audit session and marks the run failed.
Targeted retry uses the existing site-job service. Previous valid runs remain
auditable but stale results are never silently reused.

Automated audits are representative, not exhaustive. They cannot guarantee
rankings, legal/regulatory approval, subjective visual quality, all assistive
technology behaviour, real-user performance, or future browser behaviour.
These limitations are why explicit approval, human review, exact-version
evidence and a separate publication gate remain mandatory.

## Deferred to Phase 15.9

Publication jobs, fallback/custom-domain activation, deployment providers,
Cloudflare, IONOS, SSL, cache invalidation, production sitemap submission,
analytics activation and client publication controls are deliberately absent.
Phase 15.9 may consume only a current, ready result through the
publication-readiness service and must record its own publication decision.
