# Current System Inventory (KS OS)

This document provides a comprehensive inventory of the production-ready Next.js application in **KS OS**, which serves as the backend source of truth for the migration.

## 1. Directory Structure and Files

```
KS OS/
├── app/                              # Next.js App Router root
│   ├── (tenants)/                    # Multi-tenant route group
│   │   └── [subdomain]/
│   │       ├── book/
│   │       │   ├── manage/[reference]/ # Public booking management (reschedule/cancel)
│   │       │   │   └── page.tsx
│   │       │   └── page.tsx          # Public scheduling wizard
│   │       ├── book-manual/
│   │       │   └── page.tsx          # Staff direct walk-in / manual booking portal
│   │       ├── page.tsx              # Tenant workspace dashboard (Calendar, CRM, POS)
│   │       └── tenant.module.css     # CSS module for white-label styling
│   ├── admin/                        # Agency Admin Dashboard
│   │   ├── login/
│   │   │   ├── login.module.css
│   │   │   └── page.tsx              # Master admin login screen
│   │   ├── onboard/
│   │   │   └── page.tsx              # Automated workspace onboarding wizard
│   │   ├── admin-experience.module.css
│   │   ├── admin.module.css
│   │   └── page.tsx                  # Master admin control panel
│   ├── api/                          # Next.js API Routes
│   │   ├── admin/
│   │   │   ├── delete/route.ts       # Tenant deletion API
│   │   │   ├── domain/update/route.ts # Custom domain setup & DNS orchestration
│   │   │   ├── provision/route.ts    # Automated tenant provisioning & seeding
│   │   │   └── reset-password/route.ts
│   │   ├── internal/
│   │   │   └── bookings/route.ts     # Internal bookings controller (RPC hooks)
│   │   └── v1/
│   │       ├── public/[subdomain]/
│   │       │   └── booking/route.ts  # Public client booking endpoint
│   │       ├── service/
│   │       │   ├── automation-events/dispatch/route.ts # Outbox dispatcher
│   │       │   ├── health/route.ts
│   │       │   ├── tenants/[tenantId]/
│   │       │   │   ├── automation-link/route.ts
│   │       │   │   ├── availability/route.ts # Availability checker
│   │       │   │   ├── bookings/
│   │       │   │   │   ├── [reference]/route.ts
│   │       │   │   │   └── route.ts
│   │       │   │   ├── catalog/route.ts      # Service catalog exporter
│   │       │   │   └── status/route.ts       # Active tenant check
│   │       └── webhooks/
│   │           └── stripe/route.ts   # Stripe webhook handler
│   ├── auth/
│   │   └── reset-password/
│   │       └── page.tsx
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx                      # Public landing page
├── components/                       # Shared Components
│   ├── admin/
│   │   ├── OnboardingWizard.tsx      # Multi-step tenant creation UI
│   │   └── OnboardingWizard.module.css
│   ├── booking/
│   │   ├── BookingScheduleManager.tsx # Staff scheduling editor
│   │   └── PublicBookingWidget.tsx   # Client self-service booking form
│   ├── calendar/
│   │   ├── TimeSlotPicker.tsx        # Inline scheduler widget
│   │   ├── TimeSlotPicker.module.css
│   │   ├── WeeklyCalendar.tsx        # Weekly timeline planner grid (Drag & Drop)
│   │   └── WeeklyCalendar.module.css
│   ├── crm/
│   │   ├── ClientTimeline.tsx        # CRM client card history timeline
│   │   └── ClientTimeline.module.css
│   ├── forms/
│   │   ├── FormBuilder.tsx           # Intake consent form designer
│   │   ├── FormBuilder.module.css
│   │   ├── FormRenderer.tsx          # Intake consent form responder
│   │   └── FormRenderer.module.css
│   └── pos/
│       ├── CheckoutDrawer.tsx        # Point of Sale slide-out till
│       └── CheckoutDrawer.module.css
├── db/
│   └── schema.ts                     # Drizzle ORM database schema
├── lib/
│   ├── booking-contract.ts           # Validation routines & timezone helpers
│   └── service-api.ts                # Stripe client, signing, and rate limiting
├── middleware.ts                     # Multi-tenant subdomain router
├── utils/
│   ├── domain-service.ts             # Vercel & Cloudflare API CNAME orchestration
│   ├── useRealtimeAppointments.ts    # Supabase realtime listener hook
│   └── supabase/
│       └── client.ts                 # Client component Supabase client builder
├── package.json
└── tsconfig.json
```

---

## 2. Database Schema (Drizzle ORM)

The PostgreSQL schema contains **19 tables** managing workspaces, authentication, products, bookings, waitlists, forms, and audit trails.

### Summary of Tables
1. **`tenants`**: Core workspace configuration, styling colors, billing tier, timezone, currency, and loyalty settings.
2. **`users`**: Public user profile corresponding to `auth.users`, role mapping (`owner` or `staff`), and permission overrides.
3. **`services`**: Salon service definitions, price, duration, and resource requirements.
4. **`staff_schedules`**: Operating days and hours for staff members.
5. **`booking_channel_schedules`**: Specific days/times allocated to `'in_shop'` vs `'mobile'` booking channels.
6. **`clients`**: CRM client database, contact information, medical notes, patch test dates, and accumulated loyalty points.
7. **`appointments`**: Central schedule entries with visit type, booking channel, status state-machine, payment metadata, resource association, and notes.
8. **`forms`**: Dynamic intake consent form metadata and JSON layouts.
9. **`client_form_submissions`**: Completed intake forms mapped to specific clients.
10. **`products`**: POS inventory item definitions, price, stock tracking, and SKU references.
11. **`checkout_transactions`**: POS checkouts, total amount, payment status, split-methods (Cash/Card), and product attachments.
12. **`loyalty_ledger`**: Audit trail of point increments/decrements mapped to checkouts.
13. **`resources`**: Physical salon equipment (rooms, chairs) and capacity boundaries.
14. **`service_resources`**: Relational junction table mapping services to required physical equipment.
15. **`waitlist`**: Client waiting list entries mapped to specific preferred dates and stylists.
16. **`client_wallets`**: Client credit balances, gift card values, and package bundles (e.g. 5x cuts).
17. **`staff_pricing`**: Custom price and duration overrides per stylist.
18. **`automation_rules`**: Message templates triggered on booking actions.
19. **`off_peak_rules`**: Dynamic off-peak discounts applied at specific time windows.

---

## 3. Database Triggers and Stored Procedures (PL/pgSQL)

Critical transactional logic is implemented directly at the database layer using Postgres SQL procedures:

1. **`public.handle_new_user()`**
   - **Trigger**: Executed `AFTER INSERT ON auth.users`.
   - **Function**: Automatically provisions a corresponding entry in `public.users` with the default Master Agency Tenant (`00000000-0000-0000-0000-000000000000`) and assigns the default role (`owner` for `kasimashah@gmail.com`, `staff` for others).

2. **`public.provision_new_tenant(p_name, p_subdomain, p_industry, p_owner_email, p_owner_id)`**
   - **Type**: Stored Procedure RPC.
   - **Function**: Runs inside a transaction. Creates a new workspace in `public.tenants`, re-associates the owner user record with the new workspace, and inserts vertical-specific seed data (initial services, schedules, and forms based on the specified industry).

3. **`public.decrement_stock_on_transaction()`**
   - **Trigger**: Runs `AFTER INSERT ON public.checkout_transactions`.
   - **Function**: Loops through the `purchased_products` JSONB array. Automatically decrements `stock_quantity` on matching entries in `public.products`. If `enable_loyalty` is active on the workspace, it calculates spent value and credits loyalty points (e.g. 1 point per $1 spent) to the client's record, while writing a ledger audit row to `public.loyalty_ledger`.

4. **`public.create_internal_booking(...)`**
   - **Type**: Stored Procedure RPC.
   - **Function**: Handles atomic booking inserts from the staff workspace. Incorporates:
     - **Idempotency**: Prevents double-submitting using `idempotency_key`.
     - **Stylist / Resource Locks**: Employs `pg_advisory_xact_lock` to block race conditions on overlapping stylists or rooms.
     - **Availability Checks**: Validates that the stylist and resource are free (ignoring CANCELLED/NO_SHOW or expired holds) before booking.
     - **Client Autocreation**: Searches for a matching client by email. If not found, it inserts a new client record in `public.clients` automatically.

5. **`public.update_internal_booking(...)`**
   - **Type**: Stored Procedure RPC.
   - **Function**: Performs atomic booking updates (rescheduling, resizing, drag-and-drop). Uses staff/resource advisory locking and conflict checking.

6. **`public.claim_automation_outbox_events(...)`** and **`public.complete_automation_outbox_event(...)`**
   - **Type**: Outbox worker helpers.
   - **Function**: Handles secure, reliable message delivery queue (Transactional Outbox Pattern) using `SKIP LOCKED` concurrency claiming and exponential backoff retry states (up to 8 attempts).

---

## 4. API Endpoints

### Agency Admin API
- **`POST /api/admin/provision`**
  - **Auth**: Service Role / Bearer (Master Admin only).
  - **Purpose**: Triggers `provision_new_tenant` database procedure, creates the tenant, configures domains on Vercel and Cloudflare, and registers the owner.
- **`POST /api/admin/domain/update`**
  - **Auth**: Service Role / Bearer (Master Admin only).
  - **Purpose**: Moves a tenant's routing between the testing subdomain (`[subdomain].kasimshah.com`) and a verified custom domain. Handles Vercel Project Domains addition/removal and Cloudflare CNAME record setup.
- **`POST /api/admin/delete`**
  - **Purpose**: Cleans up a tenant database footprint and rolls back Vercel/Cloudflare configurations.

### Internal Operations API
- **`POST /api/internal/bookings`**
  - **Auth**: Authenticated User Session.
  - **Purpose**: Triggers `public.create_internal_booking` for manual walk-ins.
- **`PATCH /api/internal/bookings`**
  - **Auth**: Authenticated User Session or Customer Magic Link.
  - **Purpose**: Triggers `public.update_internal_booking` for calendar rescheduling.
- **`GET /api/internal/bookings?reference=[ref]&subdomain=[sub]`**
  - **Purpose**: Retrieves public, sanitized booking details for client self-service management.

### Public Client API
- **`POST /api/v1/public/[subdomain]/booking`**
  - **Auth**: Anonymous with Rate Limiting.
  - **Purpose**: Validates availability, coordinates payment requirements, creates pending slots, and initiates Stripe checkouts.

### Service Webhooks and Automation APIs
- **`POST /api/v1/webhooks/stripe`**
  - **Auth**: Stripe Signature Verification.
  - **Purpose**: Receives transaction updates, transitions pending appointments to `CONFIRMED`, and generates POS transaction entries.
- **`POST /api/v1/service/automation-events/dispatch`**
  - **Auth**: Bearer Service Worker Secret.
  - **Purpose**: Invoked by a cron task to claim and dispatch outbox events to the Agency automation platform.
