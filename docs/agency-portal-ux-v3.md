# Agency Portal UX V3

Agency Portal UX V3 organises KS OS around the work an agency operator needs to complete, rather than exposing internal subsystems as the primary information architecture.

## Product rule

Every primary screen should answer three questions quickly:

1. Where am I?
2. What is happening?
3. What do I need to do next?

Technical state, artifact IDs, HTTP codes and provenance remain available when useful, but they should not compete with the primary task.

## Agency navigation

The primary agency navigation is grouped as:

- **Home** — priority work and agency pulse.
- **Clients** — client directory and client entry point.
- **Work** — cross-client work queue and managed delivery.
- **Agency** — appointments, billing, packages, team and security.
- **Platform** — design/template libraries, analytics, support, system issues, jobs, integrations and audit.

Legacy fact-finding and provisioning routes remain available for contextual deep links, but they are no longer primary top-level mental models.

## Client workspace

Each selected client uses one consistent navigation:

- **Overview** — dominant next action, launch progress and recent activity.
- **Launch** — the guided pre-launch workflow.
- **Website** — pages, design entry point, search, quality and launch state.
- **Operations** — post-launch/client operational health with technical detail on demand.
- **Account** — billing, package features and users/access.

Advanced existing routes are preserved behind explicit links so capability coverage is not lost.

## Launch model

The underlying governed stages remain intact, but the user experience groups them into five human phases:

1. **Understand**
   - Client details
   - Discovery
   - Confirm business information
2. **Set up**
   - Booking
   - Brand & images
3. **Plan website**
   - Pages & priorities
   - Website structure
   - Search strategy
4. **Build & review**
   - Generate website
   - Design & quality review
5. **Go live**
   - Domain
   - Publish

The current recommended action receives dominant visual weight. Existing low-level launch controls are retained behind **Advanced controls** rather than shown as the default operating interface.

## Website workspace

The client Website workspace uses:

- **Overview** — structure, search, brand/assets and design entry points.
- **Pages** — understandable current page list.
- **Search** — human-facing Search Intelligence V2 review and governed research import.
- **Quality** — pre-launch check status and link to detailed review.
- **Launch** — primary address, quality and publication readiness.

Detailed design editing remains in Site Studio and is linked contextually as the design editor.

## Assets

Assets remain governed by client discovery because the current upload contract is questionnaire-bound and records classification, digest, permissions and approval.

UX V3 surfaces **Brand & assets** prominently from the client Website and Launch experiences and takes the operator to the relevant discovery record. A future general asset-library API can replace this contextual entry point without changing the information architecture.

## Search research

Search Intelligence V2 remains pinned to the exact approved website structure.

The Website → Search experience:

- prevents draft creation before website-structure approval,
- describes the prerequisite in plain English,
- shows when real search research is still required,
- exposes the governed JSON research import in the expected place,
- shows page-level search ownership and intent,
- retains immutable approval and backend enforcement.

## Human status vocabulary

Primary UX language uses:

- **Needs you** — a human decision/action is required.
- **Waiting** — waiting on a client, prerequisite or external dependency.
- **In progress** — work is underway.
- **Ready** — the next governed action is available.
- **Complete** — the step is finished.
- **Problem** — an unexpected failure needs attention.

Internal values such as `NEEDS_AGENCY`, `READY_FOR_REVIEW`, `BLOCKED` and `PROCESSING` remain implementation details unless technical detail is explicitly opened.

## Error and prerequisite language

Predictable prerequisites are not presented as system errors.

A primary message should communicate:

1. what happened,
2. why,
3. what to do next.

Technical diagnostics belong under progressive disclosure when they are relevant to support or engineering.

Examples:

- `SEARCH_INTELLIGENCE_BLUEPRINT_NOT_APPROVED` → **Approve the website structure first**.
- `PUBLISHED_SNAPSHOT_REQUIRED` before launch → **Available after the website goes live**.
- Unexpected save failure → **We couldn't save your change. Your previous version is still safe. Try again.**

Server-side guards remain authoritative and must not be weakened to make the UX quieter.

## Governance preserved

UX V3 does not auto-approve or auto-publish anything. The following remain explicit governed decisions:

- facts and evidence,
- asset permissions,
- exact website structure,
- exact search strategy/page briefs,
- website review,
- quality checks,
- final version approval,
- publication.

## Future work

The next UX extensions should reuse this IA rather than adding new top-level modules. Likely additions include a general client asset library and provider-backed search research imports (Search Console, SERP/keyword providers and local-search data).
