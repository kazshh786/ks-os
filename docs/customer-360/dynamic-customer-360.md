# Dynamic Customer 360

One customer. One living operational picture.

`/app/clients/:reference` is the canonical customer page. The existing CRM directory opens it; there is no second directory or customer table. `clients` remains authoritative. Customer 360 is a read model over canonical records, with a small command boundary that delegates creation to the existing engines.

## Experience

Identity and permitted actions lead, followed by Now, deterministic attention, a compact relationship summary and a single chronological timeline. Five active items and three attention items are shown initially; users can disclose more. A new customer has one relationship-created event and contextual actions rather than empty engine widgets. Mobile preserves this order, with 44px controls, visible keyboard focus and semantic date-grouped lists. Inline creation uses an ordinary labelled form, moves focus to its input and restores focus when closed. Owners can open the existing advanced profile at `:reference/details`, preserving salon-care and loyalty information without adding private content to the shared overview or timeline.

Business Profile supplies customer/work terminology and module relevance. Salon and class profiles prioritise appointments among equally urgent items; overdue/blocked/failed items retain priority. Agency, trades, logistics and professional-services profiles use their existing Project, Job, Delivery and Case terminology. Recommendations never enable a planned module. `canUseProfileModule` checks implemented status, enabled modules, permissions and any registry entitlements before an adapter is constructed.

## Endpoints and contracts

All paths are under `/api/v1/clients/:reference`:

| Method / suffix | Purpose |
| --- | --- |
| GET `overview` | Safe identity, available sources, Now, attention, permitted creation actions, summary and first timeline page |
| GET `timeline` | Cursor-paginated history, `source`, `importantOnly`, `limit` (1–50, default 20) |
| GET `attention` | Attention and bounded source diagnostics |
| GET `actions` | Permitted contextual creation actions |
| POST `actions` | Strict command: create task, opportunity or work, or convert a won sale to work |

`packages/contracts/src/customer-360.ts` defines strict schemas. No endpoint accepts tenant IDs, arbitrary metadata, private payloads or arbitrary action routes. The only command inputs are an enumerated kind, bounded title and optional public source reference for conversion. Tenant/user identity comes exclusively from authenticated membership. Responses contain public references. Existing CRM bookmarks using the legacy client UUID are accepted within the authenticated tenant; new links use public references.

The overview prevents a browser request per engine. Independent server queries run in parallel. Source errors are captured through the PR #229 `PlatformErrorLogService` using a safe fixed message and request ID, without passing SQL parameters or source payloads into diagnostics. A failed adapter leaves the remaining page usable; missing information is distinguished from an empty relationship.

## Canonical adapters

| Source | Now | Timeline evidence |
| --- | --- | --- |
| CRM | Basic identity; Sales lifecycle/owner only with Sales visibility | `clients.created_at` |
| Sales | Open opportunities; sent quotes; accepted quotes/won sales eligible for Work conversion | Allowlisted `sales_opportunity_activity`; quote creation/sent/accepted/declined timestamps |
| Work | Nonterminal `work_items`, assignee and due date | Allowlisted `work_item_activity`, including status transitions, completion and reopening |
| Tasks | Open/in-progress canonical customer-linked `tasks` | Allowlisted `task_activity` |
| Bookings | Upcoming active appointments, responsible staff | Actual creation/cancellation timestamps |
| Communications | Unread conversation count expressed as a generic unread item | Email/SMS sent, delivered and failed timestamps |
| Payments | Failed checkout records and latest failed online attempts | Checkout recorded; successful online-payment completion; refund request/success timestamps |
| Forms | Pending/opened assignments that have not expired | Assignment created/opened/submitted timestamps |
| Reputation | Scheduled/sent review requests without confirmed reviews | Invitation sent and confirmed-review timestamps |
| Operations | Open/acknowledged issues linked through customer appointments | Issue opened/resolved timestamps |

Adapters project selected columns only. They never select medical notes, blocker explanations, form titles/answers, private task descriptions/notes, message previews/bodies, provider secrets, tokens or arbitrary metadata. Work and Sales titles are shown only under their own visibility policies. Email is associated through canonical client, appointment or form-assignment links; shared email addresses are never treated as customer identity. Historical email records without those links are omitted.

Timeline events have a public source reference, stable public event key, type, plain-language title, timestamp, importance flag and controlled source route. Activity keys use public activity references while the source reference identifies the parent record. Quotes use their own public reference and open the parent opportunity. Work/task links open their source records; booking links locate the correct date and open the matching booking. Engines without an existing record-level public route currently link to their authorised module page.

No event is fabricated from a mutable `updated_at` field. Consequently historical CRM lifecycle changes and booking reschedules/completions/no-shows are not reconstructed when the canonical model has no immutable event timestamp. Current state still appears in Now where supported. Conversion eligibility checks existing Work provenance without copying it.

## Now, attention and actions

`CustomerNowItem` normalises source, type, public reference, bounded title/status, occurrence/due timestamps, owner, optional minor-unit money/currency, attention level and a controlled source action. Each adapter returns at most 21 current rows: 20 are used and the extra row detects overflow. The combined list is capped at 100 with an explicit more-items indication. This cap also bounds attention candidates; attention is not an exhaustive enterprise-wide alert feed.

The deterministic rules are:

- Blocked or overdue active Work → IMPORTANT.
- Overdue open/in-progress task → IMPORTANT.
- Quote still sent after seven days → ATTENTION (fixed initial default).
- Accepted quote on a won opportunity, or won opportunity, without linked Work → ATTENTION and conversion when permitted.
- Pending/opened unexpired form → ATTENTION.
- Failed payment → IMPORTANT; later online attempts supersede earlier failures.
- Upcoming appointment within 24 hours → INFO.
- Unread customer conversation → ATTENTION.

Every recommendation explains the observed condition and links its source. Mutation-oriented links require the corresponding update capability and ownership. Read-only users can inspect visible source records but receive no mutation recommendation. Conversion is deliberately limited to users who can see all Work and create Work: it avoids disclosing the existence/absence of another assignee's hidden Work. The existing Work service checks the won status, Sales visibility and uniqueness again when executing the command. Actions in support sessions are rejected.

Task, Sales and Work creation resolve the canonical customer ID on the server and call the existing services with the real actor. No extra customer is created. Task creation is assigned to the actor. Booking creation uses the existing booking dialog with the customer prefilled through its tenant-scoped profile read; normal booking validation and customer matching remain authoritative. Sending messages, payment collection, form assignment/reminders and review sending remain in their canonical flows until safe customer-specific action orchestration exists.

## Summary and money

Summary contains the customer-since date, visible lifecycle/owner, open Sales value grouped by currency, visible active/completed Work counts and upcoming booking count. Counts and sums aggregate the full visible scope, not the truncated Now list. Amounts remain integer minor units. Quotes and opportunities are never treated as revenue.

No universal outstanding balance or lifetime revenue is claimed. Legacy checkout transactions do not persist a complete immutable currency/refund-aware customer ledger, and standalone POS transactions do not have a canonical customer link. A complete lifetime-value metric must wait for that evidence; estimating it from quotes, booking prices or the tenant's current currency would be misleading.

## Security

- CRM requires `CLIENTS_VIEW_BASIC` and an enabled CRM module.
- Every source and join is tenant-scoped, including activity tables and customer-parent joins.
- Sales uses `SALES_VIEW_ALL` or owner assignment with `SALES_VIEW_OWN`; quote content also requires `QUOTES_VIEW`.
- Work uses all/assigned Work visibility. Tasks use all/assigned task visibility and exclude finance-source tasks without `FINANCE_VIEW`.
- Bookings use all/own staff visibility and exclude test/internal appointments.
- Forms preserve the existing stricter rule: staff see assignments through their own appointments, even with a broad forms capability.
- Payments and communications are owner-only, matching their existing module access. No communication body or private inbox preview is returned even to owners.
- Operations preserve assigned/all scope and finance-category protection. Reputation uses its existing capability.

There is no parallel Customer 360 role system. Public UUIDs are identifiers, never authorisation. Mutation services remain the enforcement point after discovery, including stale recommendations.

## Pagination and performance

Each timeline adapter produces bounded rows in the same order: timestamp descending, stable event key descending using PostgreSQL C collation. Timestamps are normalised to milliseconds **before** cursor comparison, matching JavaScript precision. Each source returns `limit + 1`; a server-side merge selects the global page. The cursor binds the customer reference, filter, snapshot upper bound and last tuple. A changed filter/customer or malformed cursor is rejected. Every page rechecks current permissions.

When any selected source fails, the server withholds the next cursor. The browser retries the same page and never advances past missing history. Snapshot bounds exclude newly occurring events; as with any live canonical read model, backdated edits/deletions or changed permissions can change later pages. It is not a transactionally frozen history export.

Queries use tenant/customer or tenant/parent indexes and no per-record lookup loops. Repository reads run read-only transactions with a four-second statement timeout; underlying pool limits still govern queueing. Aggregate metrics are distinct from bounded detail reads. On larger datasets, measure query plans and latency before considering materialisation; there is no duplicate permanent all-events table in this version.

Migration **86** adds public references to eleven older canonical tables and customer/parent/date indexes. It is additive and rerunnable, leaves RLS/privileges intact, and creates no new customer, relationship or event tables. Apply through the normal manifest migration process before deploying code that selects these references. Index creation and UUID backfill take normal DDL locks and should follow the repository's production migration practice. This task does not apply migrations to production.

## Extension boundaries

A future engine adds a source enum/contract entry and an adapter with its own scoped current query, safe timeline projection and optional aggregate metrics. It must declare implemented module access and source visibility, emit public identifiers and add bounded-query indexes/tests. Private engine payloads must never become generic metadata in Customer 360.

Future AI may rank or explain already-permitted deterministic signals. It must not invent triggers, execute arbitrary actions, grant permissions or override the deterministic command boundary. No scoring, sentiment, churn prediction or generative recommendation is implemented.

Client-to-client relationship types can later bind canonical clients with tenant-scoped, directed relationships and explicit visibility. No relationship table is warranted merely for this read-model foundation. Assets, properties, vehicles, guardians, organisations, custom objects and documents require their own governed ownership models and adapters; they are not implemented here. Fleet/routes/dispatch, social publishing, universal invoicing, milestones/budgets and attribution also remain deferred.

## Verification

`apps/api/tests/customer-360.test.ts` covers strict contracts, profile composition, actual PostgreSQL adapter execution, forged cross-tenant links across every adapter, own-only visibility, quote/finance/private restrictions, equal-timestamp cursor traversal, filters, attention, empty customers and failure isolation. Integration mode requires `CUSTOMER360_TEST_DATABASE_URL` pointing to a loopback database named `customer360_test`; it creates and removes only a unique fixture schema. The fixtures use canonical column names/types and intentionally permit invalid links to test defensive tenant joins.

`Customer360Page.test.tsx` covers loading, empty/partial states, server-authorised actions, keyboard input and focus restoration, strict command bodies, timeline filtering, retry without cursor loss and reading order.

Deployment classification: **VPS only**. No Cloudflare runtime, DNS, Access, routing or Workers change is included. Open the PR for review; do not merge or deploy as part of this task.
