# Phase 15.6C — Structured AI website generation

## Boundary

Phase 15.6C turns an approved site blueprint into a structured, incomplete
`DRAFT` site version for agency review. It does not publish a version, make a
site live, create a domain, deploy an application, generate images, run later
quality gates, or expose generation to tenant/client users.

The production flow is:

```text
approved blueprint
→ pinned approved template version and layouts
→ pinned ACTIVE PUBLIC_SITE knowledge pack
→ verified KS OS business facts
→ controlled structured AI generation
→ Zod and semantic validation
→ factual-integrity, template and native-booking validation
→ incomplete DRAFT version becomes READY_FOR_REVIEW
→ agency internal review
```

The model produces data only. It cannot produce or execute HTML, CSS,
JavaScript, Astro, React, imports, embeds, tracking code, or booking URLs.

## Packages and runtime boundaries

`packages/site-generation` is framework-neutral and contains:

- generation run, fact, claim, finding, page, section, metadata, structured-data
  and provenance contracts;
- deterministic prompt/context composition and SHA-256 digests;
- a controlled provider interface, Gemini adapter, and deterministic fake;
- active knowledge-context inputs from `packages/site-knowledge`;
- generation planning, template compatibility and licence checks;
- strict page validation using the Phase 15.5 `SiteSectionSchema` union;
- native-booking, reference ownership, metadata, internal-link, claim and
  executable-content checks;
- duplicate-content detection, explicit lifecycle transitions, deterministic
  idempotency and bounded repair;
- a persistence-port-driven site orchestrator that supports page-level resume
  without duplicating completed pages.

`apps/site-worker` registers only these Phase 15.6C production handlers:

- `GENERATE_SITE`
- `GENERATE_PAGE`
- `REGENERATE_SECTION`
- `GENERATE_METADATA`
- `GENERATE_STRUCTURED_DATA`

The handlers validate the strict stored payload before delegating to the
server-side PostgreSQL generation executor. With generation disabled they
remain registered but fail safely if a generation job is somehow inserted.
When generation is enabled, the worker constructs the pinned Gemini adapter,
database context loader and transactional persistence runtime; incomplete
provider configuration fails readiness. It never silently falls back to
another provider.

## Provider abstraction

`SiteGenerationProvider` accepts a deterministic prompt, a Zod output schema,
a provider JSON schema, an output-size limit and an optional cancellation
signal. It returns validated data plus safe provider/model, response reference,
model version and usage metadata. It never returns credentials or headers.

Gemini is the initial selected adapter because the repository already declares
server-side Gemini capability. The adapter uses the official `generateContent`
REST contract with `application/json` and `responseJsonSchema`, an
`x-goog-api-key` server header, one candidate, a strict timeout, cancellation,
rate-limit classification and local Zod validation. No SDK or browser package
is required. No automatic provider fallback exists.

The deterministic fake provider covers valid fixtures, invalid schema,
malformed output, retryable/terminal errors, timeout, cancellation and repair.
Automated tests inject it and never call a live provider.

## Environment

All settings are server/worker-only. The platform builds with generation off.

```dotenv
SITE_AI_GENERATION_ENABLED=false
SITE_AI_PROVIDER=gemini
SITE_AI_MODEL=
SITE_AI_API_KEY=
SITE_AI_REQUEST_TIMEOUT_MS=60000
SITE_AI_MAX_REPAIR_ATTEMPTS=2
SITE_AI_MAX_OUTPUT_CHARACTERS=250000
SITE_AI_MAX_CONCURRENT_REQUESTS=2
SITE_AI_TEMPERATURE=0.2
SITE_AI_GENERATOR_VERSION=1.0.0
```

Do not create `VITE_` equivalents. Provider and model selection are not browser
inputs. Enabling generation without a model or API key is a readiness error.

For the explicitly designated development project, verify the database-backed
knowledge precondition with:

```powershell
pnpm knowledge:verify-active:dev
```

The command loads the ignored root `.env.development.local`; it must never be
used with staging or production credentials. Live generation additionally
requires `SITE_AI_GENERATION_ENABLED=true`, a server-selected
`SITE_AI_MODEL`, and `SITE_AI_API_KEY` in the server environment. Provider
credentials are intentionally absent from the repository.

## Agency control plane

Only authenticated agency routes exist:

- `POST /api/v1/agency/sites/:siteReference/generation-runs`
- `GET /api/v1/agency/sites/:siteReference/generation-runs`
- `GET /api/v1/agency/sites/:siteReference/generation-runs/:runReference`
- `GET /api/v1/agency/sites/:siteReference/generation-runs/:runReference/findings`
- `POST .../:runReference/cancel`
- `POST .../:runReference/retry`
- `POST .../versions/:versionReference/pages/:pageReference/regenerate`
- `POST .../pages/:pageReference/sections/:sectionReference/regenerate`
- `POST .../versions/:versionReference/metadata/generate`
- `POST .../versions/:versionReference/structured-data/generate`

Capabilities are split into `sites.generation.read`, `.create`, `.cancel`,
`.retry` and `.regenerate`. There is no tenant route, client route, generic
prompt route, arbitrary rule input, provider input or model input.

Create validates site and tenant lifecycle, exact ownership, blueprint and
template approval, layout/page-type compatibility, ready renderer mappings,
Envato licence applicability and the sole active knowledge pack. Google Stitch
and internal sources do not require an Envato licence. The API derives the
agency public reference and all tenant identity server-side.

## Durable generation records

Migration `20260725170000_phase_15_6c_structured_ai_generation.sql` adds:

- `site_generation_runs`
- `site_generation_page_runs`
- `site_generation_section_runs`
- `site_generation_findings`
- `site_generation_claims`
- `site_generation_contexts`
- generation state/provenance columns on `site_versions`

The additive runtime follow-up migration
`20260725180000_phase_15_6c_generation_runtime.sql` stores the validated page
envelope on `site_pages`: navigation label, SEO metadata, internal public-page
references, controlled structured-data inputs and later-phase asset
requirements. These are parsed structured values, never raw provider output.

Rows are tenant-scoped, use restrictive foreign keys, enable RLS, revoke
browser roles and grant only `service_role`. A partial unique index permits one
active run per site. Ownership triggers reject cross-tenant child records. A
database lifecycle trigger allows only:

```text
PENDING → PREPARING_CONTEXT → GENERATING → VALIDATING
                                      ↘ REPAIRING ↗
VALIDATING → READY_FOR_REVIEW
active states → CANCEL_REQUESTED → CANCELLED
active states → FAILED
READY_FOR_REVIEW / terminal → SUPERSEDED where applicable
```

`READY_FOR_REVIEW` is not approval or publication. The version remains
`DRAFT`. Partial, failed and cancelled versions remain explicitly incomplete.

Every complete version provenance object pins the blueprint reference and
revision, template version, exact layouts and renderer keys, knowledge-pack
reference/version/context digest, generator and prompt versions, provider and
model keys, verified-data digest, generation timestamp, requesting agency
actor, run reference and output digest.

The schema deliberately has no credential, authentication header, raw prompt,
raw response, chain-of-thought, source book, NotebookLM report, customer,
medical/intake or payment field. Section regeneration history retains the
previous structured section content/actions and digest, not provider prose.

## Facts and claims

Generation context accepts only public-reference-based fact records with one of
`VERIFIED`, `AGENCY_CONFIRMED`, `TENANT_CONFIRMED`, `UNVERIFIED`, `UNKNOWN` or
`NOT_APPLICABLE`. Only the first three may be stated directly. The safe
projection omits unverified/unknown values and every internal database ID.

Canonical KS OS business, service, location and public staff records are read
server-side. Customer/CRM records, intake or medical forms, payments and
private agency notes are not part of the fact contract.

Claims are classified as grounded, requiring review, unsupported, prohibited
or not applicable. Reviews, testimonials, credentials, qualifications, awards,
experience, guarantees, outcomes, health/treatment claims, comparisons and
superlatives require explicit verified fact keys. Unsupported or prohibited
claims block readiness; superlatives also create review findings. Repair
instructions ask for neutral wording and cannot relax platform rules.

## Knowledge and prompts

The API pins the sole `ACTIVE` `PUBLIC_SITE` pack. Page execution consumes a
bounded `SiteGenerationKnowledgeContext` prepared by the Phase 15.6B selection
engine. Required platform, booking, factual-integrity, prohibited-fabrication,
critical accessibility and page/section rules survive trimming. Rejected rules,
irrelevant scopes and source bodies are absent. Only safe source title/author/
version references may appear.

Prompt order is deterministic:

1. system generation contract;
2. platform rules;
3. page schema;
4. template constraints;
5. approved blueprint page;
6. safe verified facts;
7. page and section playbooks;
8. applicable expert rule identifiers/instructions;
9. native booking requirements;
10. required structured output;
11. prohibited claims and behaviour;
12. bounded repair findings, when repairing.

Prompts and contexts are hashed. The database stores selected rule IDs, missing
data keys, safe summaries, size estimates and digests—not the prompt itself.

## Structured output and booking

The top-level generated page is strict and pins page reference, slug, page
type, conversion role and layout reference to server-approved values. Content
uses the Phase 15.5 section union. Unknown fields, page types, section types or
actions fail validation.

Only `KS_OS_BOOKING` may be a primary conversion. It carries public service,
location, staff and optional campaign references. The model cannot return a
destination URL; the Phase 15.5 renderer resolves the native `/book` flow
server-side. Header (including responsive/mobile navigation), primary hero or
detail placement, service actions, page-end CTA and footer are validated.
External booking actions fail closed.

Internal links contain approved page references and anchor text only. They do
not store absolute production domains. Metadata is plain text with bounded
lengths and site-relative canonical paths. Structured-data output is controlled
input (`LOCAL_BUSINESS`, `SERVICE`, `FAQ`, `BREADCRUMB`), not raw JSON-LD or a
`<script>` block. Ratings/reviews are not accepted fields.

## Idempotency, persistence and recovery

The run key hashes tenant, site, blueprint/reference revision, template,
knowledge pack/reference version, verified-data digest, generator version and
generation reason. An identical request returns or resumes the existing run;
changed data or pinned versions produce a new run and draft version. Keys are
never shared across tenants.

Creation writes the run, incomplete draft version, durable job and audit event
as one database transaction. The orchestrator skips already completed page
runs, never adds pages outside the blueprint, never uses unused entitlement as
filler and rejects duplicate completion. Page persistence is the transaction
boundary for sections, context, claims, findings and progress. A complete run
requires every blueprint page; partial failure cannot mark a version
reviewable or replace a valid/published version.

Regeneration is draft-only. Instructions are length-limited and reject external
booking, fabrication, executable content and instruction-override language.
Published versions cannot be edited in place. The prior structured section
revision remains available in the section-run history.

Audit actions use safe references/counts/digests and include generation request,
start, completion/failure/cancellation, page/section regeneration, metadata,
structured data and finding resolution. Logs may include operational IDs,
counts, duration, provider/model and failure codes, but never prompts, raw
responses, credentials or private tenant/customer data.

## Deferred work

Phase 15.7 Site Studio/client factual approval, image generation/optimisation,
full SEO/UX/accessibility/conversion audits, monthly page generation,
publication, deployments, domains/DNS/SSL and analytics integrations remain
deferred. No external booking provider is introduced.
