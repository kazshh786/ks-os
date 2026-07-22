# Migration Plan

This document outlines the step-by-step roadmap for migrating **KS OS** and **KS-OS Redesign** into the new monorepo workspace (**KS-OS-Platform**).

---

## Migration Steps

### Stage 1: Workspace Bootstrapping
- Configure the root `package.json` and `pnpm-workspace.yaml`.
- Set up shared package stubs under `packages/`:
  - `packages/config/`: tsconfig, build tooling.
  - `packages/database/`: Drizzle schemas, migrations, client export.
  - `packages/contracts/`: Shared Zod schemas.
  - `packages/auth/`: Supabase Auth helpers and session validators.
  - `packages/ui/`: Styled design tokens.
- Copy the legacy Next.js application into `apps/legacy-next`.
- Create a clean Vite-React app under `apps/web`.
- Initialize Fastify in `apps/api`.
- Run `pnpm install` and verify both applications build independently.

### Stage 2: Database Setup & Drizzle Integration
- Configure `packages/database/` to connect to the Supabase database instance.
- Port Drizzle schema definitions from `KS OS/db/schema.ts` to `packages/database/schema.ts`.
- Ensure migrations and kit configuration allow pushes to Supabase database.
- Export pre-configured database client handlers for use in `apps/api`.

### Stage 3: Fastify Setup & Authentication Guard
- Initialize Fastify server under `apps/api`.
- Create a custom plugin to validate Supabase JWT tokens via `Authorization: Bearer <token>` headers.
- Extract `tenant_id` and role permissions (`owner`/`staff`) from the verified token claims.
- Register global CORS policies to accept requests from localhost and production domains.

### Stage 4: Frontend App Shell
- Install React Router v7 inside `apps/web`.
- Implement public routes for client booking widgets and protected routes for staff dashboards.
- Add route guards to redirect unauthenticated requests to `/login`.
- Extract design variable color configurations based on subdomain/domain headers and inject them as global CSS properties:
  ```css
  :root {
    --primary-color: #b45309;
    --secondary-color: #1e293b;
  }
  ```

### Stage 5: Vertical Slices Migration
For each vertical slice, build the endpoint, validation schemas (Zod contracts), frontend API layer, and interface components:

1. **Dashboard Analytics**:
   - Backend: Get KPIs and SVG line chart historical revenue details.
   - Frontend: Connect `SaaSDashboard.tsx` to real endpoints.
2. **Staff Diary Calendar**:
   - Backend: Fetch active schedules, available resources, and calendar appointments. Implements RPC `public.create_internal_booking` and `public.update_internal_booking` for transactional drag-and-drop.
   - Frontend: Connect `StaffCalendar.tsx` to real diary timelines.
3. **CRM Client Directory**:
   - Backend: Fetch client database profiles, allergy history, color formulas, and prebought package allocations.
   - Frontend: Connect `ClientCRM.tsx` to read/write real profile records.
4. **Point of Sale (POS) & Billing**:
   - Backend: Create transactions, decrement stock quantity, credit loyalty points.
   - Frontend: Connect `POSCheckout.tsx` till to record cash/card split checkouts.
5. **Dynamic Consent Forms**:
   - Backend: Fetch questionnaire designs, submit client intake forms.
   - Frontend: Connect `ConsentFormBuilder.tsx` and renderer screens.
6. **Online Booking Wizard**:
   - Backend: Check available time slots, coordinate Stripe payment intents, enforce public rate limits.
   - Frontend: Connect `BookingWizard.tsx` self-booking journey.

### Stage 6: Staging and Cutover
- Deploy the Fastify API and Vite React client.
- Route default domain mappings.
- Rehearse tenant onboarding.
- Once verified, toggle custom domain configurations to transition active traffic over to the Vite React platform.
- Archive `apps/legacy-next`.
