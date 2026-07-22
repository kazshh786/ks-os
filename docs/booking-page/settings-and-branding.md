# Booking page settings and branding

The settings screen reads and writes `/api/v1/booking-page` and uses the same public flow as its responsive desktop/tablet/mobile preview. Owners can configure page copy, public slug, externally hosted logo/cover assets, theme colors, font family, corner style, layout density, booking rules, payment rules, cancellation policy, SEO, and analytics.

## Recommended setup order

1. Activate at least one service and make at least one staff member bookable.
2. Confirm service/staff assignments, schedules, locations, resources, buffers and time off.
3. Choose a stable slug and preview the live eligible catalogue.
4. Set minimum notice, future window and payment/cancellation policy.
5. Link published intake forms and decide which ones block confirmation.
6. Publish and open the public URL in a signed-out browser.
7. Complete one non-payment and one payment-required booking in a disposable environment.
8. Verify the appointment appears in the dashboard/calendar and the customer receives management links.

Only HTTPS image URLs should be used in production. Uploaded asset storage, transforms and moderation are outside this screen; integrate those with the existing storage/provider policy before offering direct uploads.

The preview flag prevents a preview interaction from creating a live appointment. A published page uses its live catalogue. Fully refreshed preview of an unpublished draft needs a future authenticated preview-catalog endpoint so private services are never exposed through the public API.
