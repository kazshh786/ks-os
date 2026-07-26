# Phase 15.6B — Expert Knowledge Engine

## Purpose and boundaries

The Expert Knowledge Engine is the agency-controlled methodology layer for
public-site planning and later quality evaluation. It stores reviewed,
distilled rules rather than books, source files, generated copy, or executable
instructions.

Phase 15.6B does not call NotebookLM, Google Drive, an AI model, an embedding
service, or any external provider. `AI_REVIEW` is a stored validation
classification only. It does not execute a model review. Website generation,
AI review, publication enforcement, and all Phase 15.6C behaviour remain
deferred.

The intended operational flow is:

```text
Expert sources in NotebookLM
  -> human-reviewed reports
  -> human-reviewed spreadsheet
  -> controlled CSV or JSON export
  -> KS OS DRAFT pack
  -> import validation
  -> REVIEW_REQUIRED
  -> governance validation
  -> READY_FOR_APPROVAL
  -> agency approval
  -> explicit activation
  -> bounded Phase 15.6C context (future)
```

No source PDF, book, arbitrary URL, stored module path, or executable code is
accepted by the import contracts.

## Architecture

`packages/site-knowledge` contains framework-neutral Zod contracts and pure
functions. The API service owns PostgreSQL persistence, transactions, agency
authorisation, and audit writes. The agency routes never mount under a tenant
or public prefix.

The package is split into:

- `contracts.ts`: controlled schemas for packs, rules, provenance, playbooks,
  imports, findings, and conflicts.
- `normalization.ts`: stable whitespace/list normalisation, stable
  serialisation, SHA-256 digests, and deterministic text similarity.
- `import.ts`: bounded CSV and JSON parsing plus mapping from the reviewed v3
  export columns.
- `validation.ts`: provenance, copyright, duplicate, conflict, playbook,
  booking, and approval-readiness checks.
- `lifecycle.ts`: status transitions, immutability, and selection policy.
- `selection.ts`: applicability filtering, ordering, size control, and safe
  generation-context preparation.
- `comparison.ts`: deterministic comparison between pack versions.

The database stores normalized records. CSV paths are never persisted and
Phase 15.6C consumers must load the recorded pack version and its relational
records—not re-read local CSV files.

## Lifecycle and governance

The lifecycle is:

```text
DRAFT -> IMPORTING -> REVIEW_REQUIRED -> READY_FOR_APPROVAL
      -> APPROVED -> ACTIVE -> RETIRED or SUPERSEDED
```

A draft may also be rejected. Import never approves or activates a pack.
Governance validation is a separate operation, approval is separately
capability-protected, and activation is a third explicit operation.

Approved, active, retired, rejected, and superseded content is immutable.
Changing approved knowledge requires a new semantic-versioned `DRAFT`
revision. The database transition trigger duplicates these application
invariants.

Activation takes a scope-level PostgreSQL advisory transaction lock, locks the
current active row, supersedes it, activates the approved target, and verifies
that exactly one active row exists. A partial unique index independently
enforces one `ACTIVE` pack per intended scope. Retired and superseded packs
remain queryable for audit and reproduction.

Only `ACTIVE` packs are selected by default. A caller must explicitly request
the `APPROVED_OR_ACTIVE` policy to select an approved pack for controlled
pre-activation review. Draft, review, retired, rejected, and superseded packs
are never selectable.

## Contracts

### Knowledge rule

Rules have stable uppercase snake-case identifiers and controlled:

- scopes: `PUBLIC_SITE`, `CONTENT_GENERATION`, `SEO_AUDIT`, `BOOKING_FLOW`,
  `PLATFORM_SECURITY`;
- domains: `UX`, `MOBILE`, `ACCESSIBILITY`, `TECHNICAL_SEO`, `LOCAL_SEO`,
  `CONTENT_SEO`, `COPYWRITING`, `CONVERSION`, `TRUST`, `BOOKING`,
  `PERFORMANCE`;
- priorities: `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`;
- validation types: `DETERMINISTIC`, `AI_REVIEW`, `HUMAN_REVIEW`,
  `DATA_REQUIRED`, `MIXED`;
- publication effects: `BLOCK`, `WARNING`, `RECOMMENDATION`;
- enforcement authorities: `PLATFORM`, `OFFICIAL_STANDARD`,
  `OFFICIAL_DOCUMENTATION`, `EXPERT_APPROVED`, `ADVISORY`.

The two official authority values preserve the reviewed v3 export’s
distinction between current official requirements and expert guidance.
Advisory rules cannot be blockers. Phase 15.6B reports publication effects but
does not enforce them against publication.

Rule fields also cover the principle, implementation instruction, why it
matters, page/section/conversion applicability, required business data,
prohibited behaviour, anti-patterns, deterministic/AI/human review
instructions, provenance references, temporal classification, confidence,
status, and content digest. Page types and conversion roles are imported from
`@ks-os/contracts`; section types are imported from `@ks-os/site-schema`.

### Page and section playbooks

A page playbook binds an existing page type to an existing conversion role and
an ordered collection of section playbooks. Section playbooks have controlled
section type and requirement (`REQUIRED`, `RECOMMENDED`, `OPTIONAL`,
`CONDITIONAL`, or `PROHIBITED`), an order range, intent, objective, purpose,
business-data needs, discipline-specific instructions, controlled CTA types,
blocking conditions, anti-patterns, rule/source references, confidence, and a
digest.

CTA types deliberately exclude arbitrary URLs. Booking and service-detail
playbooks that require conversion must include `KS_OS_BOOKING`; external
booking instructions create a blocking finding and critical conflict.

### Source provenance

Provenance records contain a stable source ID, bibliographic summary, controlled
source/evidence/support/temporal classifications, topic catalogue labels, short
citation locations, optional copyright/review notes, review dates, and a
digest. They do not contain source files or full source text.

Support is `DIRECT`, `SYNTHESISED`, or `INFERRED`; strength is `STRONG`,
`MODERATE`, or `LIMITED`. Missing claimed sources block approval. Inferred
support creates an explicit blocking review finding.

## Persistence

The additive migration creates:

- `knowledge_packs`;
- `knowledge_sources`;
- `knowledge_rules`;
- `knowledge_rule_page_types`;
- `knowledge_rule_section_types`;
- `knowledge_rule_conversion_roles`;
- `knowledge_rule_sources`;
- `knowledge_page_playbooks`;
- `knowledge_section_playbooks`;
- `knowledge_import_runs`;
- `knowledge_import_findings`;
- `knowledge_conflicts`;
- `knowledge_rejected_rules`.

Applicability and provenance links are relational. Bounded arrays without
independent identity remain JSONB and have array checks. Foreign-key indexes,
deterministic selection indexes, uniqueness constraints, status checks, digest
checks, confidence checks, row-ownership triggers, and lifecycle triggers are
included.

All tables have RLS enabled. `PUBLIC`, `anon`, and `authenticated` receive no
table access. The server role receives the minimum table operations used by
the service, while immutable-state triggers continue to guard content. No
browser-facing RLS policy is created.

## Import formats and safety

CSV and JSON are supported. Both are mapped into the same strict
`KnowledgeImportBundleSchema` and receive the same governance validation.
Markdown, URLs, Google Docs, Google Drive, NotebookLM, PDFs, and public uploads
are not supported.

CSV import expects the five reviewed datasets:

1. source provenance;
2. platform rules;
3. expert knowledge rules;
4. page/section playbooks;
5. rejected or pending rules.

The parser supports quoted commas and newlines but requires exact known
headers. Each dataset is limited to 5 MB, rows to 20,000, and individual cells
to 20,000 characters. It rejects malformed quoting, control/binary content,
unknown columns, unknown enums, unknown page/section types, invalid
identifiers, invalid confidence, and schema-limit violations. Normalisation
trims whitespace, normalises line endings and enum casing, deduplicates stable
lists, preserves punctuation and meaning, and derives stable SHA-256 source and
content digests.

Import uses one database transaction. A digest-keyed advisory lock serialises
duplicate attempts. A completed matching source digest is an idempotent replay;
a changed digest requires a new draft revision. Valid and invalid reviewed
records are stored as a draft/review pack with findings and conflicts—nothing
is partially activated.

### Local command

The command takes paths only at runtime:

```powershell
pnpm knowledge:import -- `
  --name "KS OS Public Website Knowledge" `
  --version "1.0.0" `
  --scope "PUBLIC_SITE" `
  --sources "<path-to-source-provenance.csv>" `
  --platform-rules "<path-to-platform-rules.csv>" `
  --expert-rules "<path-to-expert-rules.csv>" `
  --playbooks "<path-to-page-section-playbooks.csv>" `
  --rejected-rules "<path-to-rejected-or-pending-rules.csv>" `
  --validate-only
```

Database import additionally requires `--actor-reference`. Approval and
activation additionally require `--approve --activate`; they call the same
agency-governed service methods as the API.

The command rejects production and blocks remote database hosts by default.
The exceptional development override requires all three of:
`--allow-remote-development`, `NODE_ENV=development`, and
`KNOWLEDGE_IMPORT_ALLOW_REMOTE_DEVELOPMENT=true`. This is not permission to
operate on staging or production.

## Validation, duplicates, and conflicts

Validation produces explicit findings and conflicts, never silent merges.
Approval readiness requires no blocking finding and no unresolved critical
conflict, valid controlled values and references, safe booking behaviour, and
launch playbooks for `HOME`, `SERVICE_DETAIL`, and `BOOKING`.

Deterministic duplicate checks include case-insensitive rule/source IDs,
normalized-content digests, 0.82 Jaccard token overlap for near duplicates,
priority/effect mismatches, and duplicate playbook section rows.

Conflict checks cover contradictory publication effects and priorities,
required/prohibited sections, external booking, accessibility/animation,
urgency/evidence, thin or duplicate SEO content, unsupported claims, and
mutually exclusive instructions. Conflicts remain open until an authorized
agency action records a resolution reason and audit event.

Copyright safeguards reject binary content, embedded file-like content,
book-sized fields, chapter/full-source markers, and schema-limit overflows.
Quoted passages over 25 consecutive words create blocking review findings.
The system stores original distilled guidance and short traceability
references, not a plagiarism corpus.

## Selection and safe context

Selection is pack-version-bound and filters by page, section, conversion role,
domain, validation type, priority, publication effect, status, caller policy,
and unresolved conflicts. It excludes rejected/deprecated rules and never
mixes packs.

Ordering is deterministic:

1. enforcement authority;
2. publication effect;
3. priority;
4. explicit domain order;
5. rule ID.

The context builder returns only the pack public reference, semantic/schema
versions, applicable stable rule IDs, required and prohibited instructions,
missing business-data requirements, deterministic/AI/human review
instructions, relevant playbooks, short source references, omission metrics,
and a reproducible digest. It excludes internal database IDs, credentials,
source notes, source files, source text, and irrelevant rules.

`maxRuleCount` and `maxEstimatedCharacterCount` provide provider-neutral size
limits. Lower-priority optional rules trim deterministically. Platform rules,
blockers, critical rules, critical accessibility/data requirements, native
booking requirements, fabrication prohibitions, and any explicit prohibited
behaviour are preserved even when the result exceeds the requested limit; the
result reports that condition and its omitted count.

Pack comparison reports added, removed, and changed rules; priority,
publication-effect, validation-type, applicability, source, page-playbook, and
section-playbook changes; and new or resolved conflicts. Comparison never
activates either version.

## Agency API and audit

Agency routes expose pack CRUD, import runs/findings, rules, playbooks,
provenance, conflicts/resolution, validation, approval, activation, retirement,
revision, and comparison. They use public references and omit database IDs and
raw files.

Capabilities are:

- `sites.knowledge.read`;
- `sites.knowledge.manage`;
- `sites.knowledge.import`;
- `sites.knowledge.approve`;
- `sites.knowledge.activate`.

Support is read-only. Fulfilment may edit/import but cannot approve or
activate. Agency administrators and platform owners control governance.

Audit events cover creation, import start/completion/failure, rule changes,
conflict resolution, validation, approval, activation, retirement, and
revision creation. Metadata contains references, digests, counts, changed
field names, outcomes, and reason codes—not rule bodies or copyrighted text.

## Synchronous import decision

The reviewed initial pack has only 57 rows and less than 30 KB of CSV input.
Parsing is bounded and deterministic, and persistence is a single short
transaction. A site-worker job would add leases and retry state without
improving this workload, so import remains synchronous.

No `IMPORT_KNOWLEDGE_PACK` site-job type was added and no raw file content is
placed into a job payload. If future imports become materially larger, use a
server-managed import asset reference and source digest in a strict job
payload; never accept arbitrary filesystem paths through the API.

## Initial v3 pack verification

The five supplied v3 files were parsed unchanged through the application
parser and governance validator as:

- name: `KS OS Public Website Knowledge`;
- semantic version: `1.0.0`;
- intended scope: `PUBLIC_SITE`;
- 26 sources, 22 rules, 8 page playbooks, 8 section playbooks, and 1 rejected
  rule;
- source digest:
  `1f764b1e02c437a5c3149abd4466bdde3ea5db9eefcf1d0bdd9cc9bf0b0f357d`;
- content digest:
  `bd9e2ac1cf09cfbd97bb7bb8720c2366b640cebb0d786a6b5dc3ec884b459b9e`;
- zero findings and zero conflicts; ready for approval.

This validation does not substitute for the stored-record governance pass.
The repository’s configured database was classified as remote, so the
migration, database import, approval, and activation were deliberately not
executed. Those operations require a local development database (or a
separately confirmed non-staging/non-production development database) and an
authorized agency actor.
