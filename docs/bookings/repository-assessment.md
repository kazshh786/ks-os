# Booking operations repository assessment

## Existing architecture

KS OS is a pnpm workspace with a Vite/React staff application, a Fastify API, shared Zod contracts, Drizzle models, and Supabase Postgres/Auth. Booking behavior was already distributed across:

- authenticated booking routes and a `BookingService`/`BookingRepository` pair;
- a public tenant catalogue, availability calculation, and `create_public_booking` database function;
- service schedules, staff/service assignments, time off, appointment overlaps, resources, and locations;
- Stripe checkout and webhook-backed payment state;
- email/SMS outboxes, reminders, cancellation/rescheduling, and secure guest/customer management links;
- forms and form assignments;
- tenant-scoped auth middleware and permission policies.

The implementation extends those seams instead of introducing a second booking engine. Exact slot decisions remain server-side and use the availability service. Existing payment, notification, customer-management, and form systems remain authoritative.

## Problems found

The previous staff calendar was a large demo-oriented component with fixed sample dates and local busy blocks. It was not backed by a bounded, filterable operations endpoint and its status language did not cover the complete booking lifecycle. The public wizard depended on authenticated workspace context, so a signed-out customer could reach a page with no active tenant. Public URLs mapped directly to tenant subdomains and had no page-level publish state, scoped catalogue, slug history, custom-domain state, or safe conversion analytics.

Booking authorization also mixed the Supabase auth-user identifier with the tenant-user identifier stored on appointments. The booking policy now carries both identifiers and compares appointment ownership with the tenant user.

## Target journeys

1. Staff opens the dashboard and sees today's bookings, operational counts, the next appointments, and attention items in the tenant timezone.
2. Staff opens Booking Calendar, changes views/filters through URL-backed controls, opens a quick view, creates a booking, or makes an availability-checked status/reschedule change.
3. An owner configures and publishes the automatically created booking page, copies its URL, and previews desktop/tablet/mobile layouts.
4. A customer opens `/book/:slug`, chooses eligible location/service/staff/date/time, receives a short server-side hold, enters details, and confirms under the server's payment policy.
5. The resulting appointment carries its booking-page, source, hold, intake, payment, and customer-note context and appears through the same operational API used by the dashboard and calendar.

## Architectural decisions

- `booking_pages` is one tenant-owned public configuration record, created automatically for existing tenants by migration and lazily ensured for safety.
- Public resolution is by published slug or a verified custom hostname. Historic slugs may redirect for a bounded period.
- Public APIs never return a tenant database identifier. Server code resolves the page and adds the tenant scope internally.
- Slot holds use opaque HMAC tokens; only a token hash is persisted. Appointment creation validates and consumes a hold inside the booking transaction.
- Public analytics accepts a strict event allowlist and hashes its random session identifier. Customer name, email, phone, notes, addresses, free text, IP addresses, and user-agent strings are not stored in analytics events.
- Booking source and attribution fields are allowlisted and length/character constrained.
- Status, payment, and intake labels are text-and-symbol based; color is supplementary.
- Large calendar queries are bounded to 93 days and paginated. The UI queries only the visible window and polls every 30 seconds as a safe realtime fallback.
- Custom-domain setup records a pending verification state. DNS proof, provider ownership verification, certificate issuance, and canonical activation stay outside application code until the deployment provider is selected.

## Data and index review

Migration `20260723020000_booking_operations_platform.sql` adds booking pages, slug history, page/form relationships, holds, privacy-safe analytics, and audit events. It also adds appointment provenance, intake, hold, location, and attention fields.

Indexes cover:

- tenant plus appointment start time;
- tenant/staff plus start time for schedule lanes;
- tenant/location plus start time;
- tenant/status plus start time;
- active hold lookup by tenant/staff/time and expiry;
- page analytics by event/time and source/time;
- tenant audit events by creation time;
- tenant/idempotency key uniqueness.

All new tenant data tables have RLS enabled, browser-role table privileges revoked, and `service_role` access granted for the trusted API. No live migration was applied during implementation.
