# Universal Work foundation

PR #229 adds the reusable execution layer that sits after Sales and before invoicing.

## Purpose

KSOS now has one tenant-scoped Work engine for operational records that different businesses call Jobs, Projects, Deliveries, Cases or Orders. Business Profiles control terminology and default work type; they do not create separate industry applications.

The supported types are:

- `JOB`
- `PROJECT`
- `DELIVERY`
- `CASE`
- `ORDER`

The lifecycle is explicit and shared:

`DRAFT → READY → IN_PROGRESS → COMPLETED`

`READY` and `IN_PROGRESS` may move to `BLOCKED`; active work may be cancelled. Completed/cancelled work can be deliberately reopened to `READY`. Block/cancel actions require a reason and all meaningful transitions are written to append-only Work activity.

## Sales handoff

A won Sales opportunity can be converted into Work through the authenticated tenant API. Conversion:

- requires the opportunity to belong to the authenticated tenant
- respects Sales visibility
- requires a `WON` Sales stage
- is idempotent: at most one Work item may originate from a Sales opportunity per tenant
- carries the canonical CRM client, opportunity owner, title and description
- stores Sales opportunity provenance
- links the latest accepted quote when one exists
- starts as `READY`

Work does not turn a quote into revenue and does not create an invoice. Universal invoicing remains a later phase.

## Tasks

Work does not introduce a second task/checklist system.

The existing `tasks` table remains canonical. Tasks created from a Work item use:

- `source_type = 'WORK_ITEM'`
- `source_id = work_items.id`
- the existing Task activity, permissions and notification model

A lightweight `work_task_links` table supplies an FK-backed projection for reporting and cleanup. Generic Task-create requests cannot forge a `WORK_ITEM` source; Work-linked tasks are created through the tenant-validated Work service.

## Permissions

Work extends the existing capability architecture:

- `WORK_VIEW_OWN`
- `WORK_VIEW_ALL`
- `WORK_CREATE`
- `WORK_ASSIGN`
- `WORK_UPDATE_OWN`
- `WORK_UPDATE_ALL`
- `WORK_COMPLETE_OWN`
- `WORK_COMPLETE_ALL`

Owners inherit all capabilities through the existing owner rule. Practitioner-style staff receive own-work capabilities; reception/manager profiles receive broader assignment and all-work capabilities. Work does not create a new role system.

## Tenant isolation

Every Work business table stores `tenant_id` directly. Client, assignee, Sales opportunity and quote references are resolved within authenticated tenant context. The API never trusts a browser-supplied tenant ID.

Visibility is assignment-aware for `VIEW_OWN` staff and tenant-wide for owners / `VIEW_ALL` staff.

## Business Profiles

The Business Profile registry promotes `work` to an implemented route at `/app/work`.

Examples:

- Plumbing / Electrical → Jobs
- Agency / Consultancy / Construction → Projects
- Logistics / Courier → Deliveries
- Estate Agency / Professional Services → Cases
- Retail / E-commerce / Restaurant → Orders

Appointment-first profiles such as Salon / Barber continue using the mature booking engine and do not receive Work by default.

The specialised future `projects`, `fleet`, `routes`, `dispatch` and class/attendance engines remain separate optional engines. Project-style onboarding now points to universal Work rather than exposing a planned, non-functional Projects route.

## UI

`/app/work` provides:

- open / in-progress / blocked / overdue / completed summaries
- search and status filtering
- business-specific Work terminology
- direct Work creation
- conversion from won Sales opportunities
- customer, assignee, due date and location context

`/app/work/:reference` provides:

- lifecycle actions
- Sales provenance
- canonical linked Tasks
- append-only Work activity

The status controls are explicit buttons rather than drag-and-drop-only interactions, preserving keyboard and touch usability.

## Migration

Migration 81 is:

`20260906180000_universal_work_foundation.sql`

It is additive. It creates `work_items`, `work_item_activity` and `work_task_links`, and extends the existing Task source constraint to include `WORK_ITEM`. It does not delete or rewrite CRM, Sales, bookings or payment data.

## Deferred

This phase intentionally does not implement:

- universal invoices
- project-specific milestones/budgets
- class attendance
- fleet or route optimisation
- field-worker mobile/offline mode
- asset management
- universal Customer 360
- customer-facing Work portal
- AI next-best-action

These should build on this Work record rather than introduce duplicate job/project/delivery records.

## Deployment

**VPS only.**

The PR changes React, Fastify and PostgreSQL schema. It does not require Cloudflare DNS, Workers, Access or routing changes. Production deployment must inspect and apply pending migrations; do not use `APPLY_MIGRATIONS=0` while migrations 79, 80 or 81 are pending.
