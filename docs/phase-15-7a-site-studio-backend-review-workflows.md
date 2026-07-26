# Phase 15.7A — Site Studio backend and review workflows

## Scope

Phase 15.7A adds the backend boundary for agency-controlled review of structured,
AI-generated draft sites. It builds on the Phase 15.0–15.6C site, renderer,
worker, generation, knowledge, booking, email-outbox, RBAC, and audit
foundations.

This phase does not add the Site Studio user interface, a page builder, a
general CMS, client content editing, publishing, deployment, domain automation,
or infrastructure-provider integration. Agency and client approval are quality
workflow decisions only; neither changes a site version to `PUBLISHED` or a site
to `LIVE`.

## Architecture

The implementation has four layers:

1. `packages/site-review` contains framework-neutral Zod contracts and pure
   policy code for lifecycle transitions, participant permissions, safe review
   text, anchors, approval invalidation, readiness, secure tokens, client-safe
   shaping, summaries, and structured version comparison.
2. The additive Phase 15.7A database migration stores version-pinned review
   state and extends the existing `site_approvals` and
   `site_change_requests` aggregates.
3. `apps/api` exposes capability-protected agency routes and a separate,
   session-derived client review surface. It uses existing agency audit and
   email-outbox services.
4. `apps/site-worker` links bounded Phase 15.6C page or section regeneration
   back to the originating request and review revision. `apps/sites` renders
   only positively validated, cycle-bound preview sessions.

Database IDs remain server-side. APIs and notification payloads use public
references.

## Review-cycle lifecycle

Every cycle pins one tenant, site, draft site version, content digest, review
revision, agency owner, and, when generation-backed, the exact generation run,
blueprint and revision, approved template version, and knowledge pack and
semantic version. Database triggers reject cross-tenant or inconsistent pinned
provenance and prevent the pinned context from being changed.

The controlled lifecycle is:

```text
DRAFT
  -> INTERNAL_REVIEW
       -> INTERNAL_CHANGES_REQUIRED -> INTERNAL_REVIEW
       -> READY_FOR_CLIENT_REVIEW
            -> CLIENT_REVIEW
                 -> CLIENT_CHANGES_REQUESTED -> INTERNAL_REVIEW or CLIENT_REVIEW
                 -> CLIENT_APPROVED
                      -> AGENCY_FINAL_REVIEW
                           -> AGENCY_APPROVED
```

Relevant active states may also transition to `REJECTED`, `CANCELLED`, or
`SUPERSEDED` according to the explicit transition map. Terminal reviews cannot
be reopened. A newer material revision supersedes the previous cycle and
creates an explicit next review revision; it never silently changes the
version pinned by an existing cycle.

When `clientApprovalRequired` is false, an internally ready cycle may move from
`READY_FOR_CLIENT_REVIEW` directly to `AGENCY_FINAL_REVIEW`; the API rejects
that shortcut when client approval is required, and final readiness still
applies.

Supported scopes are `FULL_SITE`, `PAGE`, `SECTION`, `FACTS_ONLY`,
`COPY_ONLY`, `DESIGN_AND_STRUCTURE`, and `FINAL_APPROVAL`. Page and section
scopes require owned targets from the pinned version. Client list, mutation,
comparison, and renderer-preview operations enforce the same scope.

## Participants and authorization

Participant types are `AGENCY_USER`, `TENANT_USER`, and
`EXTERNAL_REVIEWER`. Roles are `AGENCY_OWNER`, `AGENCY_REVIEWER`,
`CLIENT_APPROVER`, `CLIENT_REVIEWER`, `FACT_VERIFIER`, and `VIEW_ONLY`.
External participants are attached to one review cycle only.

Pure participant policy distinguishes read, comment, own-comment resolution,
general resolution, change-request, fact, client-approval, and agency-approval
permissions. The client API additionally checks the current cycle state before
accepting a mutation.

Agency routes use these capabilities:

- `sites.review.read`
- `sites.review.create`
- `sites.review.manage`
- `sites.review.invite`
- `sites.review.comment`
- `sites.review.resolve`
- `sites.review.approve`
- `sites.review.reject`
- `sites.review.change_requests`
- `sites.review.fact_verification`
- `sites.review.compare`

Platform owners receive the complete set. Support is read/compare only.
Fulfilment administrators can operate the review workflow but cannot make a
final approval decision. Tenant users and client sessions do not authenticate
to the agency API.

## Review items, comments, and anchors

Review items use finite target and status enums. They may represent a site,
page, section, field, metadata, navigation, booking action, structured-data
input, fact, or generation finding. Generation errors are seeded as
agency-only blocking items; clients cannot dismiss platform or booking
findings as not applicable.

Comments are structured records, not content edits. Bodies are trimmed,
length-limited plain text and reject HTML delimiters, script/embed markers, and
executable URL schemes. Database constraints provide a second enforcement
layer. Replies must share the parent cycle. Pages, sections, review items,
authors, and resolvers are ownership-checked.

Anchors retain stable page and section public references, an optional bounded
field path, the original content digest, a short excerpt, and optional bounded
offsets. References and field paths are authoritative; offsets alone are not.
Material changes retain the original anchor and mark it `OUTDATED` or
`REQUIRES_REANCHOR` rather than silently attaching it to new content.

Comments support `OPEN`, `RESOLVED`, `DISMISSED`, and soft-deleted `DELETED`
states. Client reviewers see only `CLIENT_VISIBLE` comments. A client may
resolve only a permitted comment, including ownership checks for
`RESOLVE_OWN`.

## Change requests and regeneration

The existing `site_change_requests` aggregate is extended with review,
structured target, priority, assignment, resolution, regeneration, and result
links. `site_change_request_events` provides an append-only transition history.

Change requests are bounded instructions. They cannot mutate page JSON,
publish, submit arbitrary AI prompts or code, redirect booking externally,
fabricate testimonials, prices, or credentials, bypass tenancy, or request
private data. Agency users can triage, assign, accept, reject, resolve, and
choose a controlled resolution type.

Section and page regeneration call the existing Phase 15.6C handlers with the
bounded regeneration-reason schema. The worker:

- associates the job and result with the originating request and cycle;
- recomputes the version content digest and generation provenance;
- invalidates affected approval records and decisions with a reason;
- marks old anchors, items, and facts as stale or superseded;
- marks the prior cycle `SUPERSEDED`;
- creates the next `DRAFT` review revision with the same pinned provenance and
  new content digest;
- copies participants and rebuilds scoped items and facts;
- records change-request events, activity, agency audit, and a revision-ready
  notification.

The old revision and its decisions remain audit-visible.

Successful structured generation also persists a validated immutable
`PREVIEW` render snapshot. The snapshot has its own integrity digest and a
separate `source_content_digest_sha256` linking it to the exact structured
version digest. Review readiness accepts only a preview with that exact source
digest. This path never creates a `PUBLISHED` snapshot.

## Fact verification

Facts are seeded from existing tenant, service, location, and eligible staff
records, plus controlled generation claims where applicable. Each item stores
a typed source reference, display label, proposed value, value digest, review
status, evidence policy, and agency/client decisions.

Client confirmation records a decision only; it does not edit master business
data. Disputing a fact creates a structured fact-correction change request.
Service prices and durations, staff facts, and locations are revalidated
against tenant-owned source records. Unsupported or prohibited generated
claims cannot be confirmed. Evidence references and internal agency decisions
are excluded from normal client DTOs.

## Approval, invalidation, and readiness

Approval decisions extend the existing approval aggregate and are immutable,
version-, revision-, scope-, and digest-bound records. They capture approver
type and role, item or page scope, decision, open blocking-item count, open
change-request count, notes, and decision time. Invalidation is a one-way,
audited update; deletion is forbidden.

Client final and agency final decisions atomically write their approval record
and lifecycle transition. Client approval is distinct from agency approval and
neither publishes.

Deterministic invalidation rules cover section content, page metadata,
navigation, booking actions, verified facts, and asset references. Section
changes invalidate item, page, full-site, client-final, and agency-final
approvals as applicable. Operational-only changes do not invalidate content
approval.

Readiness returns stable machine-readable reasons and counts. It checks:

- draft completeness, generation success, and supersession;
- required pages and sections;
- unresolved blocking findings and prohibited claims;
- malformed native booking and external booking actions;
- disputed or unverified required facts;
- open required change requests and stale approvals;
- required client and agency approvers;
- cross-tenant references;
- availability of an exact-digest validated preview snapshot.

Open non-blocking comments are warnings. Approval fails while any blocking
reason remains.

## Preview and invitation security

An invitation is a single-cycle, single-revision exchange credential.
Invitation public references are random UUIDs; the emailed token is derived
with HMAC using `SITE_REVIEW_INVITATION_SECRET`. Only its SHA-256 digest is
stored. The email worker derives the raw invitation token only while rendering
the outbox message.

An accepted invitation is exchanged for a short-lived opaque session token
generated from 32 random bytes. Only the token digest is persisted. Sessions
pin the review cycle, participant, site, version, purpose, scope, preview-token
JTI, and expiry. Validation checks the digest, current participant and cycle
state, expiry, and revocation. Session exchange and token-backed mutations are
rate-limited. Raw tokens are redacted from request logs and never written to
audit metadata.

The signed renderer token contains public site, version, and cycle references
and the same session JTI. The renderer performs a positive database check for
that exact active session. `FACTS_ONLY` sessions cannot render site pages;
`PAGE` and `SECTION` sessions can render only their scoped page. Cancellation,
supersession, rejection, or final agency approval revokes invitations,
sessions, and preview JTIs.

All client-review and preview responses use `private, no-store` and
`noindex, nofollow, noarchive`. Preview URLs are never canonical URLs and
drafts do not resolve through the normal public-hostname path.

Configure only server-side placeholders:

```dotenv
SITE_REVIEW_INVITATION_SECRET=generate-a-distinct-site-review-invitation-secret-at-least-32-characters
SITE_PREVIEW_TOKEN_SECRET=generate-a-site-preview-signing-secret-at-least-32-characters
PUBLIC_SITES_PREVIEW_ORIGIN=https://preview.sites.example.com
```

## Client-safe DTOs and comparison

Client DTOs are assembled from allowlisted public fields and passed through a
defence-in-depth recursive shaper. They exclude database IDs, tenant IDs,
provider/model details, prompts and raw responses, credentials, token
digests, knowledge provenance, licences, infrastructure/deployment details,
private evidence, internal notes, private findings, and audit metadata.

Structured comparison uses stable page and section references. It reports
added, removed, changed, and moved pages/sections plus field-level changes for
slugs, metadata, navigation, content/actions, booking, internal links,
structured-data inputs, assets, and review facts. For review revision `N`, the
client comparison first uses the immutable exact-digest preview snapshots and
fact records for revisions `N−1` and `N`; it falls back to the prior site
version only when no adjacent review snapshot exists. Cross-tenant and
cross-site comparisons are rejected. Output is bounded; the digest and summary
describe the comparison even if visible changes are truncated. Client
comparisons are further filtered to their review scope and exclude generation
findings. Agency comparisons may additionally report safe generation-finding
changes without exposing prompts, raw provider responses, or private evidence.

## APIs

Agency routes are under `/api/v1/agency/sites`. They provide:

- cycle create/list/get/policy update;
- explicit internal, client, final-review, reject, and cancel transitions;
- readiness and review-item reads;
- comment create/update/resolve;
- change-request create/update/accept/reject/resolve and bounded page/section
  regeneration;
- fact list and agency decision;
- participant list/add/invite/revoke;
- expiring agency preview-session create and self-revoke;
- approval and activity history;
- same-site version comparison.

Client routes are under `/api/v1/site-review`. They provide:

- invitation exchange and session get/revoke;
- client-safe site, scoped page, comments, change requests, facts, summary, and
  comparison reads;
- comment, reply, permitted resolve, change-request, fact confirm/dispute,
  request-changes, approve, and reason-required reject operations.

Every client operation derives participant, cycle, tenant, site, exact version,
revision, and scope from the validated session header. Browser-supplied tenant,
site, version, or status values are not accepted as authority. There is no
generic site-JSON mutation, arbitrary prompt, domain, template, publishing, or
deployment endpoint.

## Email, audit, and observability

Review invitations, scheduled reminders, comment/change events, revision-ready
events, client decisions, and final agency approval use the existing durable
email outbox. Idempotency keys include cycle, revision, participant, event,
and target references as applicable. The email worker rechecks invitation and
cycle status before rendering; reminders are suppressed after approval,
cancellation, or supersession. Templates contain no internal IDs or sensitive
review content. Tests use only outbox records and do not send live email.

The existing agency audit service records lifecycle, participant, invitation,
comment, change-request, fact, approval, invalidation, and supersession events.
The dedicated `site_review_activity` timeline is append-only. Safe metadata
contains only public references, types, decisions, and transitions—never
comment bodies, full change descriptions, private evidence, raw content,
tokens, prompts, provider credentials, or customer-private data.

Application logs redact the review-session header, token fields, and request
URLs. Errors expose stable policy codes without logging submitted content.

## Database security and migration operation

Migration `20260726090000_phase_15_7a_site_review_workflows.sql` is additive
and ordered after Phase 15.6C. It creates:

- `site_review_cycles`
- `site_review_participants`
- `site_review_items`
- `site_review_comments`
- `site_change_request_events`
- `site_fact_verifications`
- `site_approval_decisions`
- `site_review_invitations`
- `site_review_sessions`
- `site_review_activity`

It extends `site_approvals`, `site_change_requests`, and
`site_render_snapshots`. Foreign keys are indexed, ownership and lifecycle
triggers provide database-level defence, review/event records are retained,
and browser-role grants are revoked. New review tables have RLS enabled and
are accessed through the service role only.

The migration is checked into the repository but is not applied by Phase
15.7A. Apply it later through the normal reviewed migration workflow for the
intended environment.

## Deferred work

Phase 15.7B will build the visual agency Site Studio and client review
experience on these contracts and APIs. Publishing, deployment, custom
domains, provider calls, and full SEO/UX/accessibility/conversion quality gates
remain later-phase work. Final agency approval in this phase is only the input
to those later gates.

The intended end-to-end workflow is:

```text
structured generated draft
  -> internal agency review
  -> controlled corrections
  -> client invitation and secure session
  -> fact verification, comments, and change requests
  -> bounded regeneration or manual revision
  -> new review revision and re-review
  -> client approval
  -> agency final approval
  -> later quality gates and publication
```
