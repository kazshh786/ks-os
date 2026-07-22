# Database Reuse Plan

This document outlines the reuse of existing database schemas and configurations for the KS OS platform.

---

## 1. Drizzle Architecture

Our database package `@ks-os/database` is located in [packages/database](file:///c:/Users/syedk/Documents/ks-os-antigravity-starter/KS-OS-Platform/packages/database):

- `src/schema.ts` $\rightarrow$ Exposes compiled tables mapped directly to the production Postgres database.
- `src/index.ts` $\rightarrow$ Exports table definitions, relationships, and queries.

---

## 2. Table Mappings & Schema Parity

The backend integrates with existing production tables from the "KS OS" directory. We do not modify schemas or run migrations, ensuring complete safety:

| Table Name | Primary Purpose | Key Fields | Gaps & Reviews |
| :--- | :--- | :--- | :--- |
| `tenants` | Multi-tenant namespaces | `id`, `name`, `subdomain`, `custom_domain`, `plan` | Needs auditing for custom primary domains verification. |
| `bookings` | Appointments ledger | `id`, `tenant_id`, `client_name`, `date`, `start_time`, `end_time` | Requires index on `(tenant_id, date)` for collision checking. |
| `services` | Treatment pricing catalog | `id`, `tenant_id`, `name`, `price`, `duration_min` | Needs category taxonomy alignment. |
| `staff` | Business specialist roster | `id`, `tenant_id`, `name`, `role`, `schedules` | Schema uses jsonb for specialist schedules and rotas. |
| `clients` | CRM database | `id`, `tenant_id`, `name`, `email`, `phone`, `loyalty_points` | Currently integrated for Phase 4.1 live CRM directory and profile. Requires future trigram indexing on name/email/phone. |
| `products` | Retail inventory ledger | `id`, `tenant_id`, `name`, `price`, `stock` | Requires SKU field uniqueness constraint. |
| `consent_submissions` | Digital form answers | `id`, `tenant_id`, `client_name`, `answers_json` | Contains medical/personal data (requires row-level encryption). |
| `outbox_events` | Integration events | `id`, `tenant_id`, `event_type`, `payload_json`, `attempts` | Tracks delivery attempts and failures for automations. |
| `stripe_connections` | Stripe Connect Accounts | `tenant_id`, `stripe_account_id`, `status` | Phase 5.2 Connect models. |
| `stripe_webhook_events` | Webhook Deduplication | `id`, `event_id`, `created_at` | Phase 5.2 idempotency. |

---

## 3. Row-Level Security (RLS) & Tenant Isolation

Tenant isolation is critical for security:
1. **Tenant Filtering**: Every query is filtered on the `tenant_id` column to prevent data leakage between workspaces.
2. **Postgres RLS**: Production Supabase tables leverage RLS policies checking the authenticated user's metadata claims to enforce boundaries:
   ```sql
   ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant_isolation_policy ON bookings
     FOR ALL TO authenticated
     USING (tenant_id = (auth.jwt() ->> 'user_metadata')::jsonb ->> 'tenant_id');
   ```
3. **Database Rules Warning**: Sibling folders must not run database migrations or execute direct schema changes. Any schema changes will be coordinated with Phase 2 integrations.
4. **Phase 5.1 POS MVP & Phase 5.2 Stripe**: Integrated with the Postgres database for transaction handling. We use `FOR UPDATE` queries to ensure pessimistic stock locking and integer-based calculations for payment records. Phase 5.2 Finalized Stripe Connect models. Check `docs/phase-5-pos-report.md` and `docs/phase-5-2-stripe-connect-report.md` for full details.
5. **Phase 5.3 Online Booking Payments**: Integrated with `bookings` and `transactions` tables to hold temporary bookings locked under `PENDING_PAYMENT` state, using Stripe Checkout for fulfillment.
6. **Phase 5.4A Refunds**: Integrates with the Stripe Client to issue refunds securely, updating or inserting transaction records idempotently.
# Phase 6.1 extension

The legacy `forms` and `client_form_submissions` tables are retained and extended additively. New `form_versions` and `form_assignments` tables provide immutable wording/schema snapshots and secure public workflow state. Legacy response rows are not rewritten.
