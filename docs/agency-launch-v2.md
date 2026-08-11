# Agency Launch V2

Agency Launch V2 makes the Agency Portal the governed path for taking a new client from discovery to a reviewable website. It deliberately separates completeness from approval: automated work may prepare drafts and validation findings, but only an agency user may cross an approval or publication gate.

## Intended agency experience

```text
Create client
→ Send discovery
→ Client responds
→ Review facts
→ Complete booking/brand/assets
→ Generate blueprint
→ Approve
→ Generate Search Intelligence
→ Approve
→ Generate website
→ Review
→ Quality
→ Publish
```

The client launch command centre presents eleven progressively disclosed stages:

1. Client
2. Discovery
3. Facts
4. Booking
5. Brand & assets
6. Website plan
7. Blueprint
8. Search Intelligence
9. Website build
10. Review & quality
11. Domain & launch

Each stage reports an owner, blockers, next action and produced artifact. Its visible state is one of `NOT_STARTED`, `NEEDS_CLIENT`, `NEEDS_AGENCY`, `PROCESSING`, `BLOCKED`, `READY_FOR_REVIEW`, `APPROVED` or `COMPLETE`. A complete form or successful background job never implies approval.

## Client discovery model

An agency user creates a version-pinned questionnaire and obtains a client discovery link. The link carries a high-entropy opaque token; only its digest is persisted. Token exchange and all subsequent discovery operations are handled by the API, not direct database access. Discovery access is tenant scoped, expiring, revocable, rate limited and rejected after expiry, revocation or completion. Responses use public references rather than tenant database identifiers.

The public discovery surface emits `Cache-Control: private, no-store`, `Pragma: no-cache` and `X-Robots-Tag: noindex, nofollow, noarchive`. The client page also supplies robots and referrer metadata. Invitation mail derives the client token only at send time so neither the database invitation nor email outbox stores the raw secret.

The V2 questionnaire extends the existing onboarding template with trust/evidence, brand direction, image policy, requested and explicitly named pages, commercial priorities, prioritised services and locations, required/prohibited content, and five separate consent decisions. Follow-up and more-information requests stay attached to the same client workspace.

## Trust and data boundaries

Raw client input is not a verified public fact:

```text
RAW_CLIENT_INPUT
→ AGENCY_REVIEW
→ VERIFIED | AGENCY_CONFIRMED | TENANT_CONFIRMED
→ PUBLIC_GENERATION_FACTS
```

Each question and response has a closed classification: `PUBLIC_FACT`, `PRIVATE_OPERATIONAL`, `CONSENT`, `EVIDENCE`, `CONTENT_PREFERENCE` or `ASSET`. The production-fact brief admits only appropriately reviewed public facts and governed content preferences. Private operational values, consent details, raw client PII and evidence payloads are excluded even if an upstream flag is accidentally permissive. They cannot enter generation context, Search Intelligence, public snapshots, structured data, public telemetry or shared caches.

Consent is stored separately in an append-only, version-pinned tenant ledger. The raw token is never stored. Consent is not a website fact and cannot grant publication by itself.

Asset records carry provenance (`CLIENT_SUPPLIED`, `AGENCY_SUPPLIED`, `APPROVED_STOCK` or `AI_GENERATED`), intended use and publication permission. Only approved, publicly permitted assets with the required consent can reach generation. Missing suitable assets produce a visible gap; generation must not invent arbitrary external image URLs.

## Agency fact review

The review screen supports accept, edit-and-accept, reject, request-more-information, evidence-required and not-applicable decisions. The selected verification basis is persisted with the reviewed answer. Evidence-required claims cannot be accepted without an evidence reference. Unsupported comparative language is therefore kept as an unresolved review item instead of becoming a public claim.

## Blueprint rules and gate

KS Native launches default to approved V3 template `e054818e-c185-44fd-b453-010000000005`. Blueprint generation creates a draft and normal validation produces `READY_FOR_REVIEW`; the worker no longer approves it as a provisioning side effect. Approval is an explicit agency action against the exact revision.

An explicitly requested page is required architecture. The engine retains it even when supporting content is incomplete and emits a deterministic blocking action item instead of dropping the page. This also applies when a plan entitlement would otherwise truncate required architecture. The command centre shows revision, template, page architecture, routes, relationships, layout/renderer choices and validation findings before approval.

## Search Intelligence rules and gate

After a blueprint is explicitly approved, Agency Portal can create a DRAFT Search Intelligence strategy through the normal site service. The deterministic platform draft is bound to the exact site, blueprint reference and revision, records honest blueprint-context provenance, and contains exactly one governed brief for every approved blueprint page. It does not fabricate SERP research, metrics or freshness evidence.

The strategy exposes topic ownership, intent, title, description, headings, canonical path, internal-link direction, structured-data eligibility, content depth and validation findings. Human approval remains a separate action. Website generation fails closed unless an approved strategy is pinned.

## Provider readiness and generation boundary

Provisioning and standalone generation share provider-specific semantics:

- `gemini` requires generation enabled, a model and `SITE_AI_API_KEY`.
- `vertex-gemini` requires generation enabled, a model, Google Cloud project/location and `GOOGLE_APPLICATION_CREDENTIALS`; it does not require or fall back to `SITE_AI_API_KEY`.

The command centre enables governed website generation only after production facts, booking readiness, brand/design, approved blueprint, approved Search Intelligence, active knowledge, READY V3 template and AI provider prerequisites succeed. The browser calls the existing agency generation API; it never invokes Vertex or inserts generation rows directly.

Generation produces an immutable draft site version and must stop at `READY_FOR_REVIEW`. Current prices, availability, booking/waitlist eligibility, campaigns, recommendations and location state remain supplied by Live Site Intelligence at preview/render time and are never baked into the generated snapshot.

## Review, quality and publication boundary

The post-generation path is:

```text
READY_FOR_REVIEW
→ signed, noindex preview
→ agency visual review
→ quality audit
→ explicit final approval
```

Agency Launch V2 does not publish. Publication still requires the exact approved site version, a passing publication quality gate, managed-hostname/domain readiness and an explicit human publication action. Existing immutable publication snapshots and routing policies remain authoritative.

## Migration impact

Migration 73, `20260811190000_agency_launch_v2.sql`, is additive. It:

- adds classification and consent metadata to existing fact-finding templates, questionnaire snapshots and versioned responses;
- adds upload provenance metadata;
- creates a tenant-scoped, version-pinned consent ledger with foreign keys, ownership validation, indexes, RLS, append-only controls and revoked `anon`/`authenticated` access;
- seeds the V2 discovery template by cloning V1 and adding governed trust, requirements and separate consent sections.

The migration is intentionally not applied by this PR. It must be applied once, through the normal migration job, before the new API/web/worker release is enabled.

## Deployment requirements

This is a coordinated database + API + site-worker + web release. The safe production sequence is:

1. approve and merge the PR after CI/security and human review;
2. back up and run migration 73 through the normal production migration workflow;
3. deploy the API, site worker and Agency web application from the same reviewed commit;
4. confirm API health, worker readiness and Agency Portal access;
5. verify provider-specific readiness with production secrets present, without printing ADC or API-key contents;
6. smoke-test a non-production client workspace through discovery, fact review, blueprint draft and Search Intelligence draft creation;
7. stop before generation/publication unless those later actions are separately authorised.

No Luma records, production site generation, domains, routing or publication are part of this deployment validation.
