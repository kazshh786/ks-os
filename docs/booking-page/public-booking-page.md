# Public booking page

## Lifecycle

Every tenant receives a booking-page record with a collision-safe slug. The staff settings route is `/app/settings/booking-page`; the public route is `/book/:slug`. Publishing requires at least one active service and one active, booking-enabled team member. Unpublish immediately disables public resolution; publish re-enables it.

A slug change writes a bounded history entry so old links can be redirected. The public API resolves only enabled, published pages belonging to active tenants. It returns public branding, eligible services/staff/locations, safe form metadata and payment mode, but not an internal tenant ID.

## Customer journey

1. Select an eligible location, service and staff member.
2. Select a date and a live availability slot.
3. The server validates that slot and returns a short-lived opaque hold.
4. Enter contact details and optional customer notes.
5. Review the appointment and payment rule derived by the server.
6. Submit with a required idempotency key; the transaction validates/consumes the hold and creates the booking once.
7. Continue to Stripe when payment is required, otherwise show confirmation.
8. Receive secure booking-management and customer-account links by email when configured.

If the hold expires or another actor wins the slot, the API returns a conflict rather than creating an overlapping appointment. The customer can keep their entered details and choose another slot.

## Security and privacy

- Rate limits apply to catalogue, availability, holds, analytics and booking creation.
- Slugs, UUIDs, contact fields, notes and attribution are strictly validated.
- Payment policy comes from the saved page, never from a client-controlled `payNow` flag.
- Hold and management tokens are generated from strong secrets; stored values are hashes where the workflow permits.
- Public analytics is a strict, PII-free event stream. Referrers are reduced to a validated hostname.
- Raw provider credentials are not stored by this feature.
- Database writes run through the trusted API with explicit tenant constraints.

## Intake forms

The data model supports page-wide or service/staff/location-specific published forms, whether a form is required, and whether it belongs before or after confirmation. The booking transaction verifies submitted IDs, attaches them to the created appointment and derives intake state. The public wizard currently explains and supports the post-confirmation path; rendering forms inline before confirmation remains a separate UI integration.

## Payments and notifications

Page payment modes are `NONE`, `PAY_LATER`, `DEPOSIT`, `FULL`, and `CUSTOMER_CHOICE`. The route maps that rule to the existing booking and Stripe services after the booking transaction commits. Existing webhook state remains the source of truth for successful payment.

The existing email/SMS infrastructure handles management links, confirmations, cancellation/reschedule notifications and reminders. Delivery failures do not roll back a successfully committed appointment; they must remain observable and retryable through the existing outbox/provider workflow.

## Analytics and SEO

The page records page view, funnel selection, checkout, completion and abandonment events against a hashed random session. Staff see aggregate counts and completion rate. Booking rows separately retain an allowlisted source, medium, campaign and referrer host for operational reporting.

Settings include title, description, social title/description/image, indexability and canonical URL. The app stores and returns this metadata; deployment-specific server rendering, sitemap and social-crawler behavior should be validated in the chosen hosting setup.
