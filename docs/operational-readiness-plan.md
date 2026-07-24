# KS OS Operational Readiness Plan

## Audit scope

This plan is based on the current `main` codebase at commit `12d14a346bea30f0564e55e9cf66ca8ab49c2f77`, the deployment automation, the 25-entry database migration manifest, the Vercel project state, and the implemented Phase 13/14 assessments.

The product already has broad functional coverage. The remaining path is primarily release engineering, controlled data migration, infrastructure activation, and production verification.

## Phase O1 — Release configuration and deployment recovery

**Goal:** produce a deployable frontend and a deterministic release path.

- [x] Override the stale Vercel Next.js preset with repository-owned Vite configuration.
- [x] Build only `apps/web` on Vercel and publish `apps/web/dist`.
- [x] Add SPA deep-link fallback.
- [x] Proxy browser `/api/*` requests to `https://api.kasimshah.com/api/*` before the SPA fallback.
- [x] Make VPS dry-run execute build, environment preflight, and migration planning.
- [x] Make database migration application explicit through `APPLY_MIGRATIONS=1`.
- [x] Make application rollback restore the previous commit, rebuild, and restart.
- [ ] Merge this release-foundation PR and confirm a green Vercel preview.
- [ ] Confirm the Vercel project framework is no longer reported as Next.js after deployment.

**Exit criteria:** Vercel preview is READY, deep routes render, `/api/health` reaches the Fastify service, and VPS dry-run passes.

## Phase O2 — Environment and secrets inventory

**Goal:** prove that staging and production have complete, non-placeholder configuration.

- [ ] Create an environment matrix for Vercel preview/production and VPS staging/production.
- [ ] Validate required production variables enforced by `apps/api/src/config/env.ts`.
- [ ] Confirm `DEV_AUTH_ENABLED=false` everywhere except local development.
- [ ] Set HTTPS origins and redirects for tenant, agency, customer, booking, Stripe, email, SMS, and OAuth flows.
- [ ] Confirm Vercel/Cloudflare credentials are scoped and rotated.
- [ ] Confirm worker secrets are independent values, at least 32 characters, and not reused.
- [ ] Confirm the browser receives only publishable Supabase credentials.

**Exit criteria:** `pnpm deploy:preflight` passes in staging and production with no placeholder values.

## Phase O3 — Database reconciliation and controlled migration

**Goal:** align the live KS OS database with the 25 ordered migrations without data loss.

- [ ] Identify and connect the actual KS OS Supabase project. The currently connected Supabase project appears to belong to the unified dashboard and does not contain the KS OS schema.
- [ ] Take a verified database backup and record restore instructions.
- [ ] Run `pnpm db:reconcile:report` against staging.
- [ ] Establish or reconcile `ks_os_schema_migrations`; do not assume all historical migrations can be replayed blindly.
- [ ] Review the additive production reconciliation migration before application.
- [ ] Run `pnpm db:migrations:plan` and approve every pending migration.
- [ ] Apply migrations in staging, validate checksums, then run security/performance advisors.
- [ ] Repeat through the controlled production procedure.

**Exit criteria:** all 25 manifest entries are accounted for, checksums match, no incompatible schema differences remain, and the readiness endpoint reports the database reachable.

## Phase O4 — Core business journey verification

**Goal:** prove the platform works as a business system with real persistence and tenant isolation.

Run end-to-end tests with fictitious staging data for:

- [ ] Tenant/agency login, MFA, invitations, session revocation, and support mode.
- [ ] Tenant provisioning, plan/entitlement assignment, domain setup, and owner onboarding.
- [ ] Service, staff, schedule, location, resource, and availability setup.
- [ ] Public booking, slot hold, payment-required and no-payment booking paths.
- [ ] Staff calendar, reception booking, reschedule, cancellation, no-show, and waitlist handling.
- [ ] Client CRM, medical-note RBAC, forms, uploads, submissions, and appointment-scoped access.
- [ ] POS, stock, split payments, Stripe Connect, refunds, payouts, and disputes.
- [ ] Customer account claim, guest/customer booking management, forms, payments, and profile.
- [ ] Reports, exports, schedules, advanced analytics, audit export, and privacy workflows.

**Exit criteria:** every critical journey has recorded evidence, expected database mutations, tenant-boundary tests, and no mock-data fallback.

## Phase O5 — Workers, webhooks, and scheduled operations

**Goal:** activate every asynchronous path that the code assumes exists.

- [ ] Deploy schedules for email, SMS, automation, task, report, operations, privacy, agency, and integration workers.
- [ ] Register and verify Stripe, GoCardless, Resend, and Twilio webhooks.
- [ ] Confirm webhook idempotency by replaying test events.
- [ ] Configure retry monitoring and dead-letter/manual recovery procedures.
- [ ] Configure report/private export object lifecycle cleanup.
- [ ] Validate external delivery egress and DNS-rebinding protections.

**Exit criteria:** workers process due rows, retries are visible, webhook replays do not duplicate effects, and failed jobs surface operational alerts.

## Phase O6 — Provider and hardware activation

**Goal:** activate only approved integrations and keep credential-gated foundations disabled otherwise.

- [ ] Google Calendar OAuth credentials and callback lifecycle.
- [ ] Microsoft/Outlook app registration and subscription renewal.
- [ ] Xero and/or QuickBooks mappings, tax policy, reconciliation ownership, and disconnect policy.
- [ ] Google Business Profile/Trustpilot approvals for reputation features.
- [ ] Stripe Terminal locations, physical readers, and live reconciliation tests.
- [ ] Barcode scanner and receipt-printer operational tests where required.

**Exit criteria:** each enabled provider has sandbox evidence, disconnect/recovery procedures, and an accountable business owner.

## Phase O7 — Security, observability, resilience, and launch gate

**Goal:** establish evidence that the service can be safely operated.

- [ ] Resolve the known Fastify/Drizzle high-severity dependency advisories through coordinated upgrades and regression testing.
- [ ] Make CI and Security workflows required branch checks.
- [ ] Replace placeholder echo lint scripts with real ESLint checks.
- [ ] Establish a real staging promotion gate; `main` and `staging` are currently identical.
- [ ] Archive/close obsolete pre-monorepo pull requests and stale branches.
- [ ] Configure hosted error tracking, metrics, traces, log retention, and alert destinations.
- [ ] Run the k6 smoke/load harness and approve a measured capacity baseline.
- [ ] Test backup restoration and incident procedures.
- [ ] Arrange an independent penetration test before handling live sensitive/medical data at scale.
- [ ] Obtain stakeholder approval for retention, deletion, RPO/RTO, alert thresholds, and legal bases.

**Exit criteria:** green required checks, measurable SLOs, tested restore/rollback, approved security findings, and a signed launch checklist.

## Recommended release order

1. Complete O1 and restore a green preview.
2. Complete O2 and O3 in staging.
3. Execute O4 using one fully configured fictitious tenant.
4. Activate O5 workers and webhooks.
5. Enable only the O6 providers required for the first customer.
6. Complete O7 launch controls, then promote the tested staging commit to production.

## Out of scope for initial launch

The static `agent` and `ks-social` repositories are separate prototype/product surfaces. They should not block KS OS launch unless they are explicitly made dependencies. Integrations from those repositories should be exposed through versioned APIs rather than copied into the KS OS runtime.
