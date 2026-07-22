# Platform analytics

Agency analytics reports commercial and operating health across tenants. Current measures include GoCardless MRR, at-risk MRR, active subscriptions, tenant lifecycle, launches, median time to launch, 30-day usage, fulfilment workload/cost and offboarding count.

MRR is calculated only from `tenant_subscriptions` in active/trialling states. Setup payments are not recurring revenue. Stripe Connect payments, refunds, fees, disputes and payouts are not Kasim Shah LTD subscription revenue and are excluded.

All currency uses integer minor units until presentation. Browser queries are bounded. `agency_export_jobs` provides the private asynchronous export record; the worker should upload to private Supabase Storage and issue short-lived signed download URLs using the existing report-storage pattern.

Analytics access and export requests are audited. Export filters must remain allowlisted and output must remain formula-safe before the worker is enabled in production.

