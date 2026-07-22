# Phase 6.1 forms report

Phase 6.1 replaces the disconnected localStorage prototype with live Fastify APIs and focused React routes. Owners can create/edit drafts, publish immutable snapshots, archive templates, assign published versions, copy one-time secure links, and view authorised responses. Staff can see published templates and only operate on assignments linked to their own appointments.

The additive migration is `packages/database/migrations/0004_phase_6_1_secure_forms.sql`. It is intentionally not applied automatically. Phase 6.2/6.3 delivery, conditional logic, uploads, signatures and PDFs remain excluded.

Known deployment work: apply the reviewed migration in a controlled environment, run Supabase database/security advisors, and execute browser verification against seeded fictitious tenants/users/clients/appointments.
