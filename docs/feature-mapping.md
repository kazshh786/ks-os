# Feature Mapping Matrix

This document maps features between the legacy Next.js application (**KS OS**) and the new React redesign (**KS-OS**). It identifies functional gaps, prototype-only behaviors, security requirements, and migration priority.

---

## 1. Feature Map

| Feature Area | Working Legacy (KS OS) | Redesigned (KS-OS) | Status & Migration Strategy |
| :--- | :--- | :--- | :--- |
| **Tenant Provisioning** | Yes (RPC + Auth signup + Vercel & Cloudflare Domain API orchestration) | Yes (`AgencyAdmin.tsx` lists salons, packages, billing configurations) | **Backend Working, Frontend Prototype**. Redesign uses mock data. Needs transition to real API endpoint. |
| **Custom Domains** | Yes (Vercel Project Domains API + Cloudflare CNAME DNS records) | Yes (Visualized in Tenant configurations page) | **Backend Working, Frontend Prototype**. Crucial domain orchestration script in `utils/domain-service.ts` must be ported to Fastify or remain proxy-routed. |
| **Interactive Calendar** | Yes (Radix UI Weekly scheduler, drag & drop, drag-to-resize, blocks) | Yes (`StaffCalendar.tsx` with Staff Columns, Resource Columns) | **Backend Working, Frontend Prototype**. Redesign uses localStorage; needs connection to `/api/internal/bookings` endpoints. |
| **Waitlist Matching** | Yes (Triggers on cancellation, scans waitlist table for matching PENDING clients) | Yes (Visualized alerts sidebar in `ReceptionDesk.tsx`) | **Backend Working, Frontend Prototype**. Connect Fastify cancel actions to scan the database. |
| **Client CRM Directory** | Yes (`ClientTimeline.tsx` lists notes and submissions) | Yes (`ClientCRM.tsx` details allergies, formulas, patch test dates, LTV spend) | **Backend Working, Frontend Prototype**. Redesign calculates LTV and stores notes locally. Needs SQL hooks. |
| **Dynamic Consent Forms** | Yes (Form rendering + responses stored in JSON database columns) | Yes (`ConsentFormBuilder.tsx` intake form builder UX) | **Backend Working, Frontend Prototype**. Needs integration with Fastify JSON save/load. |
| **Point of Sale (POS)** | Yes (`CheckoutDrawer.tsx` triggers SQL inventory decrements & loyalty updates) | Yes (`POSCheckout.tsx` till register, split card/cash, tip select, invoice) | **Backend Working, Frontend Prototype**. Legacy executes logic at the DB trigger layer; redesign simulates it in JS. |
| **Loyalty Ledger** | Yes (Audit trail ledger, credits points on checkouts via trigger) | Yes (Points balance display on client CRM files) | **Backend Working, Frontend Prototype**. Database triggers must be mapped to POS till transactions in Fastify. |
| **Public Booking Wizard**| Yes (Rate limiting, Stripe deposit payment intents, slot booking) | Yes (`BookingWizard.tsx` multi-step scheduler with white-label brand theme) | **Backend Working, Frontend Prototype**. Redesign uses mock cards. Must connect to live Stripe webhooks. |

---

## 2. Categorization of Features

### A. Prototype-Only Functionality (In Redesign)
- **LocalStorage Data Engine**: All data loads and updates in `KS-OS` are handled by `KSOSEngine` reading/writing to browser `localStorage`.
- **Payment Verification**: `BookingWizard.tsx` features a simulated payment flow using a simple `setTimeout` function.
- **Printed Receipt Invoicing**: POS checkouts display invoice PDFs computed on the client side without database backing.
- **Activity Webhook Logs**: SaaS overview shows live logs based on client-side JS events instead of real transactional outbox feeds.

### B. Missing Backend Functionality (In Redesign)
- **Advisory Locking for Conflicts**: Redesign lacks database-level advisory locking for concurrently booked stylists/rooms, leading to race conditions.
- **Transactional Outbox Worker**: No automated worker exists to claim and dispatch outbox event entries using cron jobs.
- **Client Auto-creation**: No logic exists to find matching client emails on walk-ins and avoid duplicate profiles.

### C. Security-Sensitive Functionality (Requires Server Enforcement)
- **Tenant Isolation**: Direct database references must enforce `tenant_id` scopes to prevent salons from accessing each other's data.
- **Master Admin Actions**: Tenant provisioning, domain updates, and deletions must restrict calls to the master administrator (`kasimashah@gmail.com`).
- **Payments & Webhooks**: Stripe credentials and signature validations must be securely managed on the backend.
- **Public Rate Limiting**: Limit API booking submission rates by hashing client IP addresses and enforcing quotas to block reservation spam.

### D. Migration Order

#### Phase 1: Core Shell & Context
1. **Authentication**: Integrate Supabase Auth.
2. **Tenant Context**: Fetch styling variables and timezone information.

#### Phase 2: Operations Client (High Priority Slices)
3. **Staff Diary Calendar**: Port the redesigned `StaffCalendar.tsx` and hook up to Fastify backend using database advisory locks.
4. **CRM Directory**: Connect `ClientCRM.tsx` to read/write real client notes, patch tests, and packages.

#### Phase 3: POS & Business Settings
5. **Till checkout (POS)**: Hook up `POSCheckout.tsx` to record transactions, decrement stock, and credit loyalty points.
6. **Consent Forms**: Connect dynamic intake templates.

#### Phase 4: Public Scheduler & Agency Admin
7. **Online Booking Wizard**: Port `BookingWizard.tsx` and connect to Fastify Stripe endpoints and public rate limits.
8. **Agency Provisioning**: Port custom domains and workspace creation endpoints.

### E. Legacy App Dependencies (Temporary Maintained)
- **Vercel/Cloudflare Domain Orchestration**: Keep Next.js routes `/api/admin/provision` and `/api/admin/domain/update` running temporarily. The legacy Next.js app is hosted on Vercel and is best suited to execute Vercel API and DNS CNAME updates during initial client cutovers.
