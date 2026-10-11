# Managed Service Autopilot

Automate routine work first, ask the owner for a decision second, and surface exceptions to the managed-service team. KS OS identifies its work as automation; it never invents a staff identity or a personal review.

**Deployment: VPS only. No Cloudflare deployment required.** Apply migration 89 before starting the updated API/workers. This PR does not deploy or apply production migrations.

## One execution engine

The existing `business_events`, `automation_rules`, `automation_rule_actions`, `automation_runs` and `automation_action_runs` remain authoritative. Managed and custom rules use the same worker endpoints and action executor. Approvals extend action runs; failures and human review reuse `operations_issues`. Email, SMS, form delivery and reputation retain their specialist services and outboxes.

The existing schedules worker now installs bounded batches of profile defaults, reconciles exceptions and runs deterministic detectors. Existing worker authentication is unchanged. Events do not require a running worker to commit. An unavailable worker delays processing without blocking source writes.

## Event catalog and mutation capture

`packages/contracts/src/automations.ts` and `autopilot.ts` govern names, source types and a strict payload allowlist. `BusinessEventsService.emit` validates, supports a caller transaction and inserts idempotently. Existing booking, form assignment/submission and payment/refund event IDs remain compatible. Customer portal booking payloads retain their bounded identifiers and timestamps.

Migration 89 adds transactional capture for canonical mutations that previously had no event emitter. These triggers only observe domain-service writes; they do not perform domain transitions. They insert into the existing event table in the same transaction. A rollback removes both mutation and event. There is no historical backfill and no second event log.

| Source | Captured evidence |
| --- | --- |
| Customer / sales lifecycle | Customer inserted; lifecycle inserted or changed |
| Opportunity | Created, stage changed, entered Won/Lost |
| Quote | Created; changed to Sent, Accepted, Declined or Expired |
| Work | Created, Ready, Started, Blocked, Completed, Cancelled, Reopened |
| Task | Created, Completed |
| Form | Opened; existing Assigned/Submitted emissions retained |
| Checkout payment | Failed status persisted |
| Booking | No-show; existing lifecycle emissions retained |
| Invoice activity | Issued, Partially Paid, Paid |
| Review invitation | Scheduled, first sent timestamp, confirmed-review evidence |

Provider clicks are not treated as reviews received. External reviews without a canonical customer association are not converted into customer events. Quote expiry is emitted only when status actually changes; the waiting detector independently excludes elapsed validity dates. This does not invent a quote-expiry mutation.

New capture payloads contain only `{version: 1}`. Source identity lives in the envelope. Stable IDs use event type, source UUID and mutation transaction ID; invoice/review evidence uses the canonical evidence ID. Existing emitters keep their domain-specific stable keys. Safe payload contracts allow bounded identifiers, enums, money and timestamps, never notes, answers, message bodies, credentials, tokens or provider responses. Existing marketing/source provenance remains in the canonical source tables, not duplicated in payloads.

## Context and freshness

Explicit adapters cover appointment, opportunity, quote, Work, task, customer, form assignment, checkout payment and invoice. Each projects named columns and scopes the source, customer, staff and related booking by tenant. Context includes the current Business Profile, safe status/timing/money and approved communication destinations. Medical notes, private descriptions and form answers are not loaded.

Planning loads context for an event; execution reloads the canonical source. Action execution holds a source row lock, action-run lock and rule/control locks. A source that is gone, belongs to another tenant, no longer matches conditions or no longer supports the follow-up is skipped. Approval does not freeze the source state or override consent.

The invoice adapter reads the canonical refund-aware `invoice_balances` view. Invoicing is on main; no invoice, allocation or payment model is duplicated.

## Actions and server policy

| Policy | Current actions |
| --- | --- |
| AUTO | Existing constrained booking email/SMS, scheduling/cancellation, form assignment, internal notification, canonical follow-up task, Operations Issue escalation |
| APPROVAL_REQUIRED | `REVIEW_FOLLOW_UP`: owner reviews a waiting quote and authorises an internal follow-up task |
| HUMAN_ONLY | `HUMAN_REVIEW`: records an Operations Issue; no financial, legal, destructive or security action is executed |

Unknown action configurations fail closed. Browser policy fields, arbitrary routes, template keys, URLs, code and SQL are rejected. Risk is derived from the server catalog. Generic form emails and SMS cannot bypass the secure form-assignment workflow. Booking templates cannot be reused against arbitrary source contexts.

There is no approved quote-follow-up email template on current main. Consequently the first quote playbook asks the owner to approve a **task**, clearly stating that no customer message will be sent. This avoids generating or sending unapproved copy. A future approved quote template must integrate with the same policy gate and communication services, including delivery-time source checks.

Task actions call `TaskService`. Its managed follow-up entry point is a bounded internal capability: it accepts an existing tenant-scoped run, a stable key, customer and allowlisted title template. It cannot accept arbitrary task copy, impersonate an owner, choose arbitrary assignees or mutate Sales/Work. The task is assigned to an active owner, while creation and activity carry system provenance without a fabricated human creator. Existing custom automation APIs remain available.

## Approval lifecycle

`automation_approval_requests` references an existing action and run with composite tenant constraints. It has a public UUID, safe fixed copy, strict source/effect preview, configuration hash, expiry and resolved actor. Status is PENDING, APPROVED, REJECTED, EXPIRED or CANCELLED. Owners cannot submit another tenant, change risk, edit the effect or supply an action payload.

The first approval lasts three days. Resolving requires a current active owner in the authenticated tenant; agency support sessions are excluded. Concurrent decisions lock the action, and replay returns the existing decision. The worker rechecks the configuration hash, source, active modules, entitlement and controls before using an approval. A changed quote, expired decision or changed rule skips execution. The scheduled reconciliation also cancels approvals whose quote is no longer awaiting a response. Approvals never substitute for a refund decision or publishing authorisation.

## Managed templates and profiles

Templates have stable keys and pinned semantic versions on canonical rules. Installation is idempotent and does not alter existing custom rules or previously installed managed versions. Onboarding/profile saves install relevant missing templates; the schedules worker introduces defaults in bounded batches for existing businesses.

Initial playbooks cover new enquiries, waiting quotes, blocked/overdue/completed Work, overdue tasks, pending forms, failed checkout payments, overdue invoices and missed appointments. Sales/Work/Invoice playbooks appear only for enabled profile modules. Salon defaults do not expose Sales or Work. Existing booking confirmation/reminder, form and review workflows remain responsible for their established delivery flows; installation does not duplicate them.

Defaults create internal work or exceptions, not marketing sends. Outbound customer communication remains subject to tenant switches, suppression, provider configuration, templates and specialist eligibility. Execution rechecks the current automation entitlement. A paused plan or missing entitlement leaves work scheduled, not executed.

### Upgrade policy

Version 1 uses **pinned assignments, no automatic behavioural upgrades**. Deploying a changed catalog never overwrites an existing version. Managed rules cannot be edited through the custom-rule editor. Owners can pause a managed playbook, archive a rule or create their own custom automation. A future template upgrade UI must show the behavioural/risk difference and explicitly install the reviewed version; merely changing a catalog version is not an upgrade mechanism. This deliberately prevents silent higher-risk changes.

## Owner experience and controls

`/app/autopilot` answers what KS OS handled today, what needs the owner and which managed playbooks are enabled. Counts come from canonical action rows in the tenant's timezone. “Completed actions” includes enqueue actions and says so. History labels distinguish messages queued from provider-evidenced sends; it makes no time-saved claims. Approvals are separate from tasks. Operations Issues remain the place to resolve exceptions. Advanced custom rules remain at `/app/automations`.

Controls support pausing individual rules/playbooks, outbound automation pause, and managed-service emergency stop. Pauses retain history and defer work. The outbound pause also applies to appointment reminders, form reminders and review requests at delivery, including queued messages. Specialist review dispatch checks the same stop. Account-access communications remain available. Messages already handed to a provider cannot be recalled.

## Managed-service boundary

`/agency/autopilot` uses existing agency `fulfilment.read` / `fulfilment.manage` capabilities. Only active/onboarding, active businesses with a current agency-assigned plan are included. Unmanaged or offboarded tenants are excluded, including from stop operations. Agency users do not acquire tenant-owner privileges and cannot decide owner approvals. Emergency stop/resume is recorded in the existing agency audit log.

The centre has bounded business pages and a prioritised Operations Issue/approval queue. Rows show business, category, severity, age, safe next step and a managed-workspace link. Counts are explicitly labelled for the current page. It does not load private message, form or provider payloads. Health is deterministic:

* DEGRADED: emergency stop, critical issue or failed action.
* ACTION_REQUIRED: an owner approval waiting over 24 hours.
* ATTENTION: another issue or pending approval.
* HEALTHY: no currently detected open issue or pending approval.

Every state includes its reason. Healthy means no exception in these sources, not a claim that every aspect of a business has been inspected.

## Exceptions, site work and reconciliation

Exhausted actions and permanent invalid configuration generate deduplicated Operations Issues. A successful retry resolves the corresponding failure issue. Blocked/overdue work creates a source-linked exception; reconciliation resolves it when that condition clears. Terminal site-worker failures enter the same Operations Inbox using safe fixed copy and job identity, and resolve when the job succeeds. No site job payload, generated content or provider secret is copied. Autopilot does not rewrite or publish websites.

The existing Customer 360 attention service is unchanged. Autopilot acts on equivalent evidenced conditions; it does not replace customer attention with a score.

## Workers, idempotency and performance

Event claims use SKIP LOCKED and a recoverable lease. Run creation and all its action rows commit atomically. Action workers claim one bounded row per transaction, retaining the lock through execution; a process crash rolls back the claim. Canonical task keys and outbox keys prevent duplicates if a domain action committed before a worker retry. Internal notifications have a unique action reference. Terminal FAILED actions are not automatically reclaimed. Explicit owner retry resets the attempt budget.

Transient failures back off to a maximum of one hour, with five attempts. Stale work is skipped. Invalid contracts, unsupported templates and permanent missing resources/configuration fail safely and raise an issue. Paused work defers without consuming its retry budget. Worker responses expose bounded processed/created/reconciled counts without customer labels.

Scheduled detectors use source-specific indexed conditions, bounded batches and `NOT EXISTS` before LIMIT so completed first pages do not starve later candidates. Keys include condition, source, threshold version and canonical anchor timestamp. They cover seven-day waiting quotes, overdue tasks/Work, two-day pending forms, unresolved checkout failures, and invoice due-soon/overdue conditions. Changing a due-date anchor permits a new logical condition. Scheduled booking generation retains the existing event key format and excludes already-emitted events before batching.

## Verification

`apps/api/tests/autopilot.test.ts` exercises strict contracts, safe payloads, transaction rollback, idempotent event inserts, concurrent workers, managed defaults, canonical tasks, approvals, replays, expiry, state changes, all nine adapters, tenant isolation, failures, owner summaries and managed-business filtering. The database suite requires a disposable localhost database named `autopilot_test` through `AUTOPILOT_TEST_DATABASE_URL`; it creates and removes a private test schema and applies migration 89 twice. It must never point at production.

The web tests exercise clear queued/sent language, real counts, keyboard decisions, errors, accessible controls and agency read-only permissions. Repository build, lint, typecheck, tests and migration-plan output are recorded in the PR.

## Extension boundary and deliberate deferrals

Growth, SEO, Content/Social, Sales, Customer Success and Operations specialists must all propose actions through this catalog, context, policy, approval and audit boundary. They are not separate workflow engines. A future proposal may contain bounded evidence references and evidence quality, but model confidence can never grant execution authority.

Future approved quote communication, won-sale Work creation, booking invitations, SEO proposals and content approvals require canonical service APIs and explicit action policies before activation. Social publishing, full attribution, autonomous refunds/pricing, legal responses, unrestricted website publishing, arbitrary HTTP/code/SQL, AI churn/deal scores and workflow scripting remain out of scope. Current source and campaign provenance is preserved for later attribution. This foundation does not claim those deferred actions are running.
