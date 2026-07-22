# Phase 8.2 operational reports

Phase 8.2 adds read-only owner reporting at `/app/reports` with detailed appointments, clients, services, staff activity, product sales, current stock, payments, refunds, forms, and communications pages. Each page uses a live Fastify endpoint under `/api/v1/reports/*`; production failures produce an error and retry state and never fall back to mock records.

All time-bounded reports reuse Phase 8.1 tenant-timezone periods and its 366-calendar-day maximum. Amounts are integer minor units until formatted by the web client using the tenant currency. Queries derive the tenant from authenticated request context, use deterministic allowlisted ordering, paginate in Postgres at 50 rows by default (100 maximum), and fetch one extra row only to determine whether a next cursor exists.

The product report is intentionally a sales-derived view, not a stock ledger. Checkout JSON reliably preserves product IDs and quantities but not historical product line prices, so gross product sales are returned as `null` instead of being reconstructed from current catalogue prices. Current stock comes from `products.stock_quantity`; low stock means one to five units because no tenant-specific threshold exists.

No export, scheduled delivery, saved report, commission, payroll, tax, profit, or provider-live-query functionality was introduced. Dispute and payout reports remain in the existing local finance module and were not duplicated.

Report source availability is explicit. Environments that have not installed the prerequisite refund, secure-form, email, or SMS migrations receive `REPORT_DATA_UNAVAILABLE`; relation names and database errors are not returned to the browser. Phase 8.2 does not auto-apply those earlier migrations because their reviewed files explicitly prohibit automatic production application.
