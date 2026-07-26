# Phase 15.7B — Unified workspace provisioning and Site Studio

## Scope

Phase 15.7B adds an agency-controlled workflow that collects client facts, produces an approved and immutable production brief, and provisions one KS OS tenant workspace plus one structured website draft. The workflow deliberately stops at internal review. It does not publish a website, configure a domain, change DNS, deploy infrastructure, or run a payment transaction.

The migration is `20260726130000_phase_15_7b_unified_provisioning_site_studio.sql`, manifest order 35. It is additive and must be applied through the repository migration process only after the preceding Phase 15 migrations. This implementation did not apply it to any environment.

## Authority and data flow

The control plane is agency-only. Agency capabilities separately govern fact-finding, production briefs, provisioning, and Site Studio. Tenant users cannot call these routes. A client can access only the public fact-finding session endpoints using an expiring, revocable invitation exchanged for an opaque session. Client routes cannot change questionnaire structure, approve facts, provision a workspace, invoke generation, or publish.

The controlled flow is:

1. An agency user creates a questionnaire from a versioned template and prequalifies its questions.
2. The client invitation is queued through the existing email outbox.
3. The client saves versioned answers and private uploads through a session-scoped API.
4. The agency approves, rejects, or requests clarification per response and reviews upload safety and permissions.
5. The production-brief builder includes approved facts and approved assets only, retains source provenance, and records deterministic content, fact-set, and asset-set digests.
6. An authorised agency user approves and locks the brief. Database triggers prevent a locked brief or its approved facts from being changed in place.
7. The agency provisioning wizard saves and resumes a server-owned draft, validates all pinned references, and starts one durable `PROVISION_WORKSPACE` job.
8. The site worker creates or reuses canonical operational records, generates a structured site draft, validates native booking, and creates the internal review aggregate.
9. Site Studio reads the same canonical records and delegates review or bounded regeneration to the existing Phase 15.7A and Phase 15.6C services.

Raw questionnaire responses are not a provisioning input. The locked production brief and its approved fact records are the only business-fact source for provisioning. Private intake answers, rejected or unverified claims, raw uploads, payment information, prompts, and generated bodies are excluded from audit metadata.

## Agency and client routes

Agency fact-finding is mounted at `/api/v1/agency/fact-finding` and includes template, questionnaire, response-review, upload-review, and production-brief build routes. Exact production-brief aliases are mounted at `/api/v1/agency/production-briefs/:briefReference` with readiness, approval, and lock operations.

Client fact-finding is mounted at `/api/v1/fact-finding`. It exposes invitation exchange, session-scoped questionnaire reads, controlled response updates, upload initiation, submission, clarification reads, and clarification responses. It has no generic JSON mutation endpoint.

Provisioning routes are mounted at `/api/v1/agency`:

- `POST /provisioning-drafts`
- `GET|PATCH /provisioning-drafts/:draftReference`
- `POST /provisioning-drafts/:draftReference/validate`
- `POST /provisioning-runs`
- `GET /provisioning-runs/:runReference`
- `POST /provisioning-runs/:runReference/retry`
- `POST /provisioning-runs/:runReference/cancel`
- `GET /tenants/:tenantReference/readiness`

Site Studio is read through `GET /api/v1/agency/sites/:siteReference/studio`. Native booking links are available at both `/studio/booking-links` and `/booking-links`. Page and section regeneration and review transitions continue to use the existing Phase 15.6C and 15.7A endpoints rather than duplicating those workflows.

## Provisioning draft and locked inputs

A provisioning draft pins the production brief, active plan version, approved template version, workspace settings, page plan, and payment preference. It accepts public references, never a browser-supplied tenant database ID. The API resolves tenant ownership, active plan assignment, entitlement, template approval, licensing, brief status, and brief readiness on the server. Starting a run pins the brief version and all three digests and makes the draft input immutable.

The 15-step UI groups the detailed orchestration into plan, business, locations, services, staff, availability, booking, forms, payments, brand, template, page plan, review, progress, and completion. The worker ledger is more granular and records 25 ordered steps from `VALIDATE_DRAFT` through `RECORD_AUDIT`.

## Durable orchestration and idempotency

`PROVISION_WORKSPACE` uses the existing site-job lease, heartbeat, retry, and attempt system. The run has a unique server identity derived from its draft, locked brief, brief digest, and request idempotency key. Each ledger step has a canonical idempotency key and a database uniqueness constraint. Advisory transaction locks serialize work for a run and for finalization.

Steps reuse existing records where a stable business key exists and persist public record links plus source-fact digests. Unique constraints and explicit existence checks prevent duplicate staff/service assignments, location/service assignments, booking-form links, sites, generation runs, review cycles, and preview sessions. A retry resumes completed steps instead of replaying them.

A failure records the failed step and safe failure code, leaves the run `PARTIALLY_FAILED`, and never reports `READY`. Terminal data or permission failures are not automatically retryable. Provider configuration can leave the run `ACTION_REQUIRED`; an agency user can resolve the server configuration and retry. Cancellation uses the normal run service and audit path.

## Canonical booking and website records

Provisioning writes the existing tenant, location, service, staff user, staff/service assignment, service/location assignment, staff schedule, booking page, form, and booking-page form tables. It does not introduce a second service catalogue or booking engine.

Each service must have an approved name, duration, and minor-unit price. Each physical location requires an approved name, address, and postcode. When several staff/service or service/location combinations are possible, the locked brief must explicitly identify the approved relationships; provisioning does not infer an all-to-all mapping. Staff availability and native booking configuration are mandatory before readiness.

Structured generation uses public references from those canonical service, location, and staff records. Every booking action must have type `KS_OS_BOOKING`. URLs are constructed and cross-tenant references are validated on the server by `NativeSiteBookingService`; Site Studio can test the result but cannot edit a destination URL. Private intake responses never enter website generation context.

## Payments

Payment preference is provisioning input, but readiness is based on existing server-side payment state. The worker never marks Stripe ready without an existing ready connection. When pay later is permitted, provisioning may complete with a `PAYMENT_ACTION_REQUIRED` warning so native booking remains usable. Restricted or disabled payment state blocks readiness when pay later is not allowed. No live Stripe operation belongs to this workflow.

## Template, blueprint, and structured generation

The selected template version must be approved, analysed, compatible, and licensed. The page plan is checked against the active plan's marketing-page entitlement; functional booking pages do not consume that allowance. Blueprint generation uses actual canonical business records and approved layouts. Automatic blueprint approval is allowed only when there is no blocking action item.

Generation requires exactly one active `PUBLIC_SITE` knowledge pack and a configured server-side structured-generation provider. It pins the template, blueprint revision, knowledge-pack version, verified-source digest, prompt-template version, generator version, and idempotency key. If the provider is unavailable, the run becomes `ACTION_REQUIRED`; provisioning does not fake generated content or readiness.

After successful structured generation, finalization validates canonical services, locations, staff, schedules, assignments, booking configuration, and site actions. It then creates or reuses a version-pinned internal review cycle, agency reviewer participant, review items, and a private preview session whose raw token is never stored. The site and version enter `INTERNAL_REVIEW`, never `PUBLISHED`.

## Site Studio

The agency Site Studio route is `/agency/sites/:siteReference/studio`. The UI provides page navigation, responsive structured preview, generated metadata, current findings, review state, comments and change-request counts, native booking actions, and detailed canonical service/location/staff connections. It renders controlled JSON content as React text and fields; it does not evaluate HTML, CSS, or JavaScript.

Regenerate-page and bounded regenerate-section controls use the existing generation APIs. Agency final approval uses the existing review service. Approval is a review decision and does not publish. Arbitrary page types, arbitrary sections, drag-and-drop layout editing, freeform client editing, publication, and booking-URL editing are unavailable.

## Combined readiness

The combined dashboard reports workspace, booking, website, review, and payment states with blocking issues and warnings. `ready` requires workspace, booking, website, and review readiness. Payment may remain action-required only where pay later is allowed. Publication always reports `NOT_AVAILABLE_UNTIL_PHASE_15_9`.

## Audit and privacy

Agency services and the worker record questionnaire creation and prequalification, invitation queueing, response save and submission, clarification, fact approval or rejection, upload review, production-brief creation/approval/lock, provisioning request/retry/cancel/failure/completion, blueprint approval, generation request, and review creation. Metadata is restricted to public references, safe status data, step keys, failure codes, and boolean publication state.

The Phase 15.7B tables use RLS. Browser roles have table access revoked; service-role access is explicit. Tokens and sessions store digests rather than bearer material. Public DTOs recursively remove internal IDs, tokens, secrets, digests, storage paths, provider details, prompts, and raw payloads.

## Operations and deferred work

Before use, apply all manifest migrations through the approved migration process, provision a private fact-finding storage bucket, and configure distinct server-only invitation and preview secrets. Configure the generation provider only in an approved non-test environment. Verify exactly one active public-site knowledge pack.

Phase 15.9 owns publication, production domains, DNS, SSL, and deployment. Phase 15.10 owns advanced and bulk launch automation. Monthly SEO automation, analytics integrations, external booking providers, Stripe Terminal, and Phase 15.8 quality gates are also outside this implementation.
