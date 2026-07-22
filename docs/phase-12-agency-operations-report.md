# Phase 12 agency operations report

Phase 12 adds the Kasim Shah LTD control plane without turning agency operators into tenant staff. The implementation shares one agency identity, audit, entitlement, onboarding, billing, fulfilment, support and analytics foundation.

## Delivered

- Independent Supabase-backed agency identities, roles, sessions and MFA enforcement.
- Expiring audited tenant support access with no tenant password sharing.
- Versioned Core, Growth and Scale packages, typed entitlements, timed overrides and downgrade checks.
- Twelve-stage sale-to-launch onboarding and launch readiness checks.
- GoCardless Billing Requests, Hosted Payment Pages, mandate capture, subscriptions and signed idempotent webhooks.
- Managed-service deliverables, activity, approvals, effort and cost storage.
- Platform health, incident, failure, safe retry, agency-only note and export foundations.
- GoCardless-only MRR and agency activation, usage, workload and churn metrics.
- Live `/agency` UI; the former mock tenant-switching screen is no longer routed.

The migration is `packages/database/migrations/20260720230000_phase_12_agency_operations.sql`. Apply it before deploying the API and agency web routes.

## Provider separation

GoCardless records contain only Kasim Shah LTD setup fees and tenant subscriptions. Existing Stripe Connect records remain tenant appointment payments. Agency MRR queries read `tenant_subscriptions` only.

## Deployment dependencies

Configure the environment in `gocardless-subscription-billing.md`, apply the migration, bootstrap the first platform owner, verify MFA, configure the private export bucket/worker, and execute `phase-12-verification.md`.

