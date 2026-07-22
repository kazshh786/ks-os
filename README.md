# KS OS - Production Multi-Tenant Platform Monorepo

Welcome to the production repository for **KS OS Platform**, a modern, multi-tenant scheduling, POS, and CRM suite. This project is a pnpm monorepo structure separating the frontend client, the Node.js Fastify API server, and shared package utilities.

## Technology Stack

- **Runtime**: Node.js `v24` (LTS)
- **Monorepo Manager**: `pnpm` workspaces
- **Frontend Client (`apps/web`)**: Vite + React + TypeScript + React Router
- **Backend API (`apps/api`)**: Fastify + TypeScript
- **Shared Contracts (`packages/contracts`)**: Zod data validation schemas
- **Shared Database (`packages/database`)**: Drizzle ORM client skeleton
- **Shared Auth (`packages/auth`)**: Roles, permissions, and session validators

## Port Assignments

- **Vite Frontend Client**: `http://localhost:3000`
- **Fastify API Server**: `http://localhost:5000`

---

## Local Development Setup

### 1. Prerequisites
- Ensure you have Node.js version `24` installed (verify with `node -v`).
- Configure `.nvmrc` using NVM if needed (`nvm use`).
- Install pnpm version `11.13.1` (or run via `npx pnpm`).

### 2. Configure Environment Variables
Copy `.env.example` into a local configuration file inside `apps/api` (and at the root if needed):
```bash
cp .env.example .env
```
Ensure `DEV_AUTH_ENABLED=true` is set *only* in your local development environment to enable the simulated developer login session.

### 3. Bootstrap & Install Dependencies
Run package installation from the root workspace directory:
```bash
npx pnpm install
```

### 4. Running the Project Locally
Start the development server for all apps (frontend and API in parallel):
```bash
npx pnpm dev
```
Alternatively, start individual targets:
- **Run Frontend only**: `npx pnpm dev:web`
- **Run Fastify API only**: `npx pnpm dev:api`

---

## Workspace Scripts

- **`npx pnpm typecheck`**: Run TypeScript compiler checks across all workspaces.
- **`npx pnpm lint`**: Enforce syntax guidelines.
- **`npx pnpm test`**: Run automated test suites.
- **`npx pnpm verify`**: Execute verification checks.
- **`npx pnpm build`**: Compile production builds for both client and server applications.
- **`npx pnpm build:web`**: Build the production Vite bundle.
- **`npx pnpm build:api`**: Compile the production Fastify bundle.

---

## Current Status
**Phase 6.1 (Live Consent Forms)** is implemented in source: strict live templates, immutable versions, secure assignments, public acknowledgement/submission, and appointment-scoped staff access. Apply migration `0004_phase_6_1_secure_forms.sql` in a controlled environment before enabling the routes.
**Phase 5.1 (POS MVP)** has been completed and integrated.
**Phase 5.2 (Stripe Connect & Webhooks)** is finalized. The live POS system now correctly processes checkouts via Stripe, enforces strict idempotency, uses pessimistic stock locking, applies integer-based arithmetic, ensures role-based execution boundaries, securely verifies webhooks, and supports full Stripe Connect onboarding.
**Phase 5.3 (Online Booking Payments)** is finalized. The public booking flow is now integrated with Stripe Checkout, using webhooks to handle `checkout.session.completed` and `checkout.session.expired` to confirm bookings and unlock slots.
**Phase 5.4A (Payment History & Refunds)** is in progress. The API enforces strict role-based access for payment history and processes refund creation and webhooks securely.

**Phase 6.3 (Transactional SMS)** adds a platform-owned Twilio Messaging Service, UK mobile normalisation, an asynchronous SMS outbox/worker, booking reminders, signed status and opt-out webhooks, and owner-only SMS settings/history. See `docs/phase-6-3-sms-report.md` and `docs/phase-6-3-twilio-setup.md`.

**Phase 4.1 (Live Client CRM)** has been completed. The client directory, client profiles, and booking histories are now fully connected to the live Postgres database with complete tenant isolation and RBAC for medical notes.
