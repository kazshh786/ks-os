# Booking operations implementation matrix

Status meanings: **Complete** is usable in this repository; **Partial** has a working foundation or primary flow with a documented follow-up; **Deferred** requires product or infrastructure authority not present in the repository.

| Capability | Status | Notes |
| --- | --- | --- |
| Dashboard booking command centre | Complete | Today metrics, next-booking schedule, current-time marker, attention queue, availability hint, primary actions, tenant timezone, polling. |
| Dedicated Booking Calendar navigation | Complete | Calendar is the primary booking workspace; a separate Bookings list route is available. |
| Day/week/work-week/month/agenda/staff/location views | Complete | Views use one operational API and visible date ranges. |
| URL-backed date/view/filter/search state | Complete | Deep-linkable date, status, staff, service, location, payment, intake, source, attention and search parameters. |
| Non-colour status language | Complete | Text labels and symbols in cards, badges, legends and compact modes. |
| Quick view and operational actions | Complete | Detail, status changes, reschedule, cancel, checkout handoff, notes, payment/intake/source context. |
| Exact conflict checks | Complete | Reschedule and holds reuse server availability plus overlap/resource/location checks. |
| Keyboard rescheduling | Complete | Quick view supports an explicit date/time/staff change form. |
| Drag/drop and resize | Partial | The architecture supports server-validated mutations, but pointer drag/resize was not introduced because the repository has no scheduler library and keyboard-safe semantics must be designed first. |
| Bulk actions, saved views, column customization | Deferred | Requires product definitions for roles, persistence and destructive-action confirmation. |
| Automatic tenant booking page | Complete | Migration backfill, insert trigger and lazy API creation. |
| Branding/settings and live preview | Complete | Slug, logo/cover URLs, colors, typography, layout, rules, payment, cancellation, SEO and responsive preview. Preview uses live catalogue for a published page. |
| Draft preview while unpublished | Partial | Saved settings remain previewable in the current session; a refresh of an unpublished page needs an authenticated preview-catalog endpoint. |
| Publish/unpublish and share URL | Complete | Publishing validates that an active service and a bookable team member exist. Re-publishing enables the page. |
| Public location/service/staff/date/time flow | Complete | Eligibility and exact slots come from the live catalogue and availability APIs. |
| Public mobile-appointment channel selector | Complete | The customer can select the live catalogue channel; mobile bookings require and submit a validated appointment address. |
| Temporary slot holds | Complete | Configurable 10-minute default, idempotent HMAC token, expiry, conflict response and transaction consumption. |
| Idempotent booking creation | Complete | Client key is required; tenant/key database uniqueness is added. |
| Server-owned payment policy | Complete | Client payment hints cannot override page payment settings. Existing Stripe/session infrastructure is reused. |
| Intake form completion before confirmation | Partial | Booking-page/form relationships, submission verification, appointment linking, status and post-booking workflows exist; inline public form rendering is not yet embedded in the new wizard. |
| Secure customer management after booking | Complete | Existing claim and guest-management tokens, cancellation/rescheduling policy and email delivery are reused. |
| Booking source attribution | Complete | Allowlisted source, medium, campaign and safe referrer host are persisted. |
| Privacy-safe funnel analytics | Complete | Strict events, hashed session ID, no customer PII, staff summary endpoint. |
| Custom domain state and DNS instructions | Partial | Pending domain and TXT proof are stored; provider verification, certificate issue/renewal and hostname activation require deployment infrastructure. |
| SEO fields and canonical foundation | Complete | Page configuration covers metadata, social preview, indexability and canonical URL. Host renderer wiring remains deployment-specific. |
| QR code and embeddable widget generator | Deferred | Public URL is stable, but asset generation and cross-origin embed policy need product/deployment decisions. |
| Google/Meta direct integrations | Deferred | Source values exist; provider OAuth, API credentials and external listing mutation require explicit integration authority. |
| Realtime updates | Partial | Visible ranges refresh on focus/actions and poll every 30 seconds. Supabase Realtime subscription can replace or augment polling later. |
| Browser end-to-end against live database | Deferred | Requires applying the new migration to a disposable environment and valid tenant/auth/payment fixtures. Unit, contract and focused API/component tests are included. |

## Stakeholder decisions still needed

1. Which deployment/DNS provider owns custom-host verification and TLS certificates?
2. Should an expired hold release the customer silently, preserve their form progress, or offer a grace-period renewal?
3. Which intake forms must block confirmation versus being completed after booking?
4. What is the deposit rounding/refund policy and how should promotion codes and gift cards interact?
5. Which roles may export customer booking data, run bulk operations, or see customer contact details?
6. Is mobile-service pricing based on postcode, radius, travel time, fixed zones, or a manual review?
7. What are the retention periods for analytics events, booking audit events, expired holds and exported files?
