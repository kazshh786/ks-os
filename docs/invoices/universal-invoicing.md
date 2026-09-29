# Universal invoicing and money owed

KS OS answers “Who owes me money?” with canonical invoices and payment evidence. It does not turn quotes, opportunity estimates, Work values or unreconciled historic payments into revenue. `clients` remains the customer; `checkout_transactions` remains the payment transaction.

## Owner experience

`/app/invoices` shows outstanding money, overdue money, the next seven days and customers owing money, separately for each currency. Lists use bounded keyset pagination. Owners can create a draft from a customer, accepted quote, active/completed Work or an optional booking; review and edit it; issue it; record payments already received; allocate an eligible existing deposit; and record an offline refund already returned. A customer search and Customer 360 prefilled action avoid depending on the first page of the customer directory.

The invoice detail puts customer, total, paid, remaining and due date first, followed by items, payments, permitted source links and recent activity. Controls are labelled, keyboard accessible and at least 44px high. Status is written in text. Empty views explain the next action.

“Record payment received” records evidence; it does not charge a card. “Record refund” requires explicit confirmation that cash/bank/external-terminal money has already been returned. There are no pretend send/reminder/online payment actions.

## Canonical records and lifecycle

Migration **88**, `20260921160000_universal_invoices.sql`, adds:

- `invoices`: tenant/customer, tenant invoice number, currency, immutable commercial snapshot after issue, due/issue/void dates and optional canonical source references.
- `invoice_items`: quantity, unit amount, tax in basis points and calculated amounts.
- `invoice_settings`: terms, prefix, footer/payment instructions and a locked tenant counter.
- `invoice_payment_allocations`: canonical payment evidence allocated to an invoice.
- `invoice_activity`: actual lifecycle/allocation/offline-refund events.
- `checkout_payment_reversals`: immutable evidence of confirmed offline refunds, linked to the existing payment transaction. Stripe refunds remain in `stripe_refunds`.
- Nullable customer/currency evidence on existing checkout transactions. No historical monetary backfill or payment duplication occurs.

Stored states are `DRAFT`, `ISSUED`, `VOID`. Effective `PARTIALLY_PAID`, `PAID` and `OVERDUE` are derived. An unpaid issued invoice past its due instant is overdue, including partially paid overdue invoices. Draft/void invoices have no receivable; drafts still show their commercial total. Issuing requires matching line totals. Issued values, items, customer and provenance cannot be rewritten. Void is irreversible and requires net allocated paid = zero; refund money first. This is not a credit-note workflow.

All stored amounts are integer minor units with a positive total and a per-invoice signed-32-bit bound. Calculations use BigInt intermediates; quantity is an integer and tax uses the existing quote model, rounded half up per line in basis points. Currency groups are never added together. Workspace aggregate amounts travel as decimal integer strings. The UI presents amounts using the existing two-decimal money convention and accepts decimal text without multiplying floating-point currency.

Due dates are stored as UTC instants. The date input uses end-of-day UTC, and invoice date labels use UTC to preserve the selected day across browser timezones. Defaults are due now, 7, 14 or 30 days. This is basic quote-aligned tax support, not jurisdiction-specific VAT compliance.

Numbers are allocated under a tenant settings row lock, e.g. `INV-2026-000123`. The counter continues across years and prefix changes, is independent per tenant, and rolls back with failed creation. Numbers are reserved at draft creation; voided numbers are not reused. There is no global counter or `max(number)+1`.

## Quotes, Work, bookings and deposits

An accepted quote explicitly converts to an invoice. The server copies items and currency from the accepted quote, recalculates totals, retains quote/opportunity provenance and leaves the quote unchanged. Conversion is tenant-scoped and idempotent by quote ID: repeated requests return the same invoice, including a subsequently voided one. Draft invoice edits remain possible and do not edit the quote.

Work supports multiple invoices regardless of completion status. Work-derived invoices retain same-customer quote and opportunity lineage. An accessible accepted quote can prefill the editor, but Work invoice amounts remain a deliberate commercial decision; there is no automatic milestone, remaining-contract-value calculation or prevention of intentionally repeated Work billing.

Booking invoice creation is optional. It preserves booking and related sale lineage without changing appointment scheduling or existing booking checkout. Internal/test bookings are excluded. Appointment-first salon defaults do not gain invoicing; configured invoicing can enable it.

The deposit model preserves the full commercial invoice total and explicitly allocates an actual prior payment. No amount/date matching is used. A legacy payment is eligible only when customer and currency are evidenced: customer from its canonical appointment, and currency from an exact successful Stripe attempt matching tenant, appointment, payment intent and amount, or an already explicit canonical checkout currency. Uncertain legacy cash/POS deposits are omitted. Allocation safely snapshots this evidence onto the checkout row. A staff member must choose to allocate it; merely creating an invoice never silently assigns payments.

## Payments, concurrency and refunds

`paid = sum(allocation gross - confirmed refunds/reversals)` and `remaining = total - paid` for issued invoices. Successful Stripe refunds and offline refund evidence reduce net paid; a fully refunded canonical payment has zero net. Pending or failed refunds do not reduce paid. The refund example £1,000 paid less £200 refunded yields £800 paid and £200 remaining.

V1 deliberately allocates **one entire canonical payment to one invoice**, with any prior confirmed refunds deducted. Multiple payments can settle one invoice; multiple invoices can belong to one customer or Work item. Splitting a single payment across invoices is deferred so refund attribution stays unambiguous. The unique payment allocation also prevents using the same deposit twice.

Offline recording creates one canonical checkout transaction plus its existing staff-confirmed payment component, then allocates it atomically. It does not invoke booking payment emails or simulate a provider charge. Idempotency keys bind the invoice/payment request and reject reuse with different amounts or methods. Allocation locks invoice then payment; database triggers enforce same tenant/customer/currency, valid successful payment, positive net and no overpayment. Simultaneous payments cannot over-allocate. Financial evidence already allocated cannot be rewritten or deleted; successful refund evidence is monotonic. Refunds restore receivables without silently crediting or adjusting the original invoice.

Existing Payments history reads invoice customer/currency snapshots and includes offline reversal amounts in refund totals. Stripe refund creation remains in the established provider workflow. Invoice detail exposes safe public payment references, never provider secrets or raw webhook metadata.

## Business Profile, capabilities and Customer 360

Invoicing is recommended for jobs, projects, deliveries, cases and orders, and enabled when onboarding payment configuration includes invoices. Salon appointment defaults stay unchanged. Business Profile is checked server-side, independently of capability checks.

`INVOICES_VIEW`, `INVOICES_CREATE`, `INVOICES_MANAGE`, `INVOICES_RECORD_PAYMENT` extend the existing capability system. Owners retain broad access; staff require explicit grants and receive none of these by default. View grants operational invoice/customer money across the tenant; there is no new finance role. Settings remain owner-only. The existing Staff access screen has explicit invoice permission checkboxes, including a clear statement that invoice visibility covers all customer money in the business. Source access additionally requires the existing module and own/all Work, Sales, quote or booking visibility. Invoice permission does not reveal otherwise inaccessible source references. The shared authentication layer continues to reject mutations in read-only support sessions.

Customer 360 adds permitted active invoice balances, invoice-only total/paid/owed/overdue metrics grouped by currency, due-soon attention within three days, and important overdue attention. Created/issued/void/payment/refund events come from stored evidence; overdue is not fabricated as an immutable timeline event. Metrics explicitly cover issued KS OS invoices and their allocations, not lifetime customer value or all historical business revenue. Customer 360 offers a prefilled create-invoice action where allowed.

Work and Sales show related invoices and creation entry points. Accepted quotes have a direct create-invoice entry. Booking Quick View only shows the invoice section when the profile and capability permit it. Context list queries independently enforce source visibility.

## Isolation and performance

Tenant comes only from authenticated request context. Input schemas are strict and accept public references, never tenant IDs, internal source IDs or browser totals. Composite foreign keys constrain source/customer and allocation/payment identity. API joins include tenant scope. New tables enable RLS with no permissive browser policies; balance views and tables revoke public/anon/authenticated access. The backend database role must retain its established table-owner/BYPASSRLS access.

Invoice lists cap at 50 and use due-date/public-reference cursors; source previews cap at five. Items cap at 100; detail activity/payments and customer search cap at 100; eligible existing payments cap at 50. Customer 360 retains its existing bounded source and timeline strategy; its compact invoice summary shows the first five currencies, while Money Owed supports up to 100 currency groups. Tenant/status/due, tenant/customer, source, payment-allocation and refund indexes support summaries and drill-down. Queries have a four-second statement timeout and three-second lock timeout. Totals are computed server-side using tenant-filtered indexed balance views, with no N+1 customer lookup. Very large tenant aggregates may need a maintained summary projection later; a timeout must not be presented as zero money owed.

## Validation and rollout

The dedicated integration suite is `apps/api/tests/invoices.test.ts`; it only accepts a localhost database named `invoices_test` through `INVOICES_TEST_DATABASE_URL`. It tests rerunnable migration, strict contracts, exact tax, tenant/customer/source isolation, own/all visibility, quote snapshot/idempotence, multiple Work invoices, immutable issued values, partial/full payments, concurrent overpayment, retries, exact historical deposits, canonical provider/offline refunds, keyset lists and Customer 360 balances/attention/history. Separate disposable Customer 360 and Sales↔Booking suites exercise existing composition and booking behavior.

Run build, lint, typecheck, test and `db:migrations:plan` before review. On this checkout, Wrangler's type-check command must run with `CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false` to avoid unrelated server environment variables being treated as Worker bindings. This does not change deployment configuration.

Deployment: **VPS only. No Cloudflare deployment required.** The migration must be applied before starting the new API. This PR does not run production migration or deployment, does not merge itself, and does not change Workers, DNS, Access or routing.

## Boundaries and follow-ups

KS OS is the operational source for invoices, their payment status and collection actions. This is not double-entry bookkeeping, a general ledger, a VAT return engine, bank reconciliation, statutory accounts or payroll, and does not replace Xero/QuickBooks.

Deferred: public invoice links, PDF/email delivery, reminders, invoice-specific online Stripe collection, accounting exports/integrations, credit notes, expenses, purchases/supplier bills, recurring billing/contracts, retainers, time billing, milestone/progress billing, project profitability, automatic debt collection and attribution. Source references and canonical allocations provide extension points; none of these are marked complete. Owner-dashboard receivables cards are also deferred to keep the initial dashboard uncluttered.
