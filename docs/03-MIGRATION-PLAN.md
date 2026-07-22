# Migration Plan

## Stage 0 — Inventory
Map current routes, tables, policies, jobs, environment variables, and redesign screens. Produce a gap matrix before implementation.

## Stage 1 — Bootstrap
Create the pnpm monorepo, copy the current app into `apps/legacy-next`, and copy the clean redesign source into `apps/web`. Both apps must build independently.

## Stage 2 — Application shell
Add React Router, public/staff/agency layouts, error boundaries, loading states, and route guards.

## Stage 3 — Authentication and tenant context
Connect Supabase Auth, establish current-user and current-tenant endpoints, and enforce tenant and role boundaries in the API.

## Stage 4 — First vertical slice
Connect read-only dashboard metrics and booking calendar to real data.

## Later vertical slices
1. Services and staff
2. Booking and availability
3. Reception
4. CRM
5. POS
6. Consent forms
7. Agency control plane
8. Premium operational modules
