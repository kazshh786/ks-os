# Sales and booking workflow

Deployment: **VPS only. No Cloudflare deployment required.**

Sales tracks commercial progress; appointments track scheduling and attendance.
Both keep `clients` as the canonical customer. This feature connects those engines
without another customer, calendar, pipeline, event store or scheduling service.

## Owner journey

An open opportunity offers **Book site visit**, **Book discovery call**,
**Schedule consultation**, **Schedule viewing**, or **Schedule appointment**.
The resolved Business Profile supplies this action language. The existing service
catalogue supplies the actual appointment purpose/name; no competing purpose enum
or vertical service list is introduced.

The action opens the existing calendar booking dialog with the canonical customer
and sale selected. The opportunity owner is suggested only when present in the
calendar's staff options. The owner still chooses the service, date and time.
The existing manual-booking transaction, staff/service validation, advisory lock,
overlap check, history and notification handling remain authoritative.

Customer 360's Create booking action offers an optional **Related sale** selector
when accessible open opportunities exist. **General appointment** always remains
available. Context errors disable saving rather than silently losing provenance.
Selected customers retain their identity even if submitted form text is changed;
their profile contact fields are read-only here. Existing customers without contact
details can still be scheduled; the normal notification service only sends when a
recipient exists. New-customer bookings retain their existing contact requirements.

Sales is hidden for Salon/Barber defaults. Combined functionality requires **both**
Sales and Bookings enabled in the configured Business Profile. Enabling Sales alone
does not enable Bookings for an agency or trades business. No opportunity is assumed
to require an appointment.

## Relationship and integrity

Migration **87**, `20260921140000_sales_booking_relationship.sql`, adds nullable
`appointments.sales_opportunity_id`, a composite foreign key to
`sales_opportunities(id, tenant_id, client_id)`, a non-null customer check for linked
appointments, and a partial tenant/sale/start-time index. A composite unique index
on the referenced columns supports the constraint. It is additive and rerunnable.

PostgreSQL 15+ column-specific `ON DELETE SET NULL (sales_opportunity_id)` clears
only Sales provenance when an opportunity is deleted; the appointment, customer
and tenant remain intact. Updates cannot move an opportunity's tenant/customer
under existing appointments. There is no backfill and no migration of existing
booking identities. Production migration is a separate deployment step.

The staff creation contract accepts optional `clientReference` and
`salesOpportunityReference`. A Sales link requires both. Only **public references**
are resolved, within authenticated membership tenant context. Internal opportunity
IDs, arbitrary tenant fields and public-booking Sales fields are rejected. Creation
resolves and locks the accessible open opportunity and customer in the same
transaction as the canonical booking insert. The database constraint closes the
remaining concurrent-update/insertion integrity boundary. Linking to closed sales
or walk-ins is deliberately not offered; already-linked appointments remain valid
when their sale subsequently closes.

The staff-only `GET /api/v1/bookings/sales-context` accepts exactly one customer or
opportunity public reference and supplies bounded options (100, with a `hasMore`
flag), canonical customer details and a suggested owner. It requires booking-create
permission; opportunity context requires Sales visibility, and customer context
requires customer visibility. Unrelated/general staff and all public booking
contracts continue to work without Sales provenance.

## Visibility and presentation

Each combined read checks both Business Profile modules and both existing source
permissions. `SALES_VIEW_OWN` uses opportunity ownership; `BOOKINGS_VIEW_OWN` uses
appointment assignment. No parallel role system exists. Queries repeat tenant and
customer predicates even when the database foreign key already guarantees them.
No Sales title, value, stage, reference or indication of a hidden link is returned
to booking-only staff. Sales-only users receive no appointment context.

Calendar list/detail responses have an optional, explicitly selected `relatedSale`
with public reference, title, stage, state, value and currency. Compact/month cards
stay lightweight; detailed cards show a short line and appointment detail shows
the richer context and a View opportunity link. Private metadata is never joined.

Sales lists return one relevant appointment per card; detail returns up to five,
with progressive disclosure and an overflow indicator. A per-sale lateral query
fetches at most six records, prioritising upcoming active appointments then recent
history, so one busy sale cannot crowd out another. Links open the canonical
calendar detail, where normal rescheduling permission and lifecycle checks apply.
There is no Sales-owned scheduling state.

Customer 360 keeps both source records visible and adds a **For [sale]** association
on the appointment. Booking timeline titles include related sale context only when
visible. Completion events use `booking_audit_events` status-change evidence;
timestamps are never invented from current status. Existing Sales activity stays
in its source. There is no duplicate timeline event table.

## Deterministic next steps

No stage is moved automatically. For an open sale, a recent completed appointment
with no active quote suggests preparing a quote/proposal. A cancelled/missed
appointment suggests another appointment or contacting the customer. Suggestions
are bounded to 30 days and suppressed when a newer active appointment exists.
Customer 360 uses the latest visible meeting and suppresses completed suggestions
when quote visibility is unavailable. Actions respect source update permissions;
the quote button also requires the canonical quote-management and Sales-update
permissions. Read-only Customer 360 support mode has no mutation suggestions.

## Automation hooks and deliberate deferrals

Existing booking audit/status and business-event infrastructure remains unchanged.
A future governed automation consumer can resolve appointment Sales provenance
inside the tenant transaction for confirmed/completed/cancelled events, deduplicate
by the existing event identity, and invoke the canonical Sales/task service under
an explicit rule and actor. This PR emits no new cross-module automation and never
implicitly changes commercial state.

Deferred: editing/reassigning links on existing appointments, linking closed sales
or walk-ins, a dedicated appointment-purpose taxonomy, automatic stage transitions,
historical completion backfills, a full related-appointment archive in Sales, AI
scoring/recommendations, custom objects, transcription, telephony and workflow
designers. Work conversion and public booking/payment journeys are unchanged.

## Verification

Focused PostgreSQL tests use only `SALES_BOOKING_TEST_DATABASE_URL`, restricted to
localhost database `sales_booking_test`, and a disposable per-run schema. They run
the migration twice, test cross-tenant/customer constraints and delete behaviour,
exercise canonical manual booking with conflict rejection and customer-count
invariance, and check own/all visibility and Customer 360 composition. Web tests
cover prefill, canonical submission, optional keyboard selection, denied context,
Salon simplicity, bounded Sales presentation and calendar disclosure.

Run the repository build, lint, typecheck, test and migration-plan commands before
opening the PR. On the VPS checkout, Wrangler's existing `.env` generated-type
mismatch requires `CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false pnpm typecheck`.
This does not alter a Cloudflare runtime or deployment.
