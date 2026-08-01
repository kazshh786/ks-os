# Premium compact booking-page redesign

## Goal

Retain the conversion principles and information introduced in the previous booking-page work while replacing the heavy dark hero and stacked page composition with a lighter, premium workspace that puts the booking task above the fold on desktop.

## Visual and interaction changes

- Replaced the oversized dark hero with a compact left-hand conversion rail.
- Kept the original outcome-led heading, four-step explanation, live-availability reassurance, price/commitment transparency and guest-booking reassurance.
- Added a viewport-bound desktop workspace so the booking flow begins immediately without page-level scrolling.
- Moved longer service lists into a contained internal scroller instead of pushing the booking flow below the fold.
- Simplified the public canvas, borders, radii, shadows and footer to create a quieter, more premium visual hierarchy.
- Removed the duplicate internal booking header when the external catalogue has loaded, while preserving business branding in the conversion rail.
- Kept mobile layouts naturally scrollable because forcing a desktop-height constraint on small screens would harm usability and accessibility.

## Service categories

- The public catalogue now exposes the existing service `category` value.
- Category controls are only rendered when one or more services have an assigned non-empty category.
- Customers can view all services or filter the service picker by category.
- Every categorised service shows its category alongside duration and price.
- Selecting a service updates the existing public `service` query parameter and remounts the established booking flow, preserving its current preselection, availability, hold, staff and payment logic.
- If the external catalogue cannot load, the native service chooser remains available as a safe fallback.

## Conversion principles preserved

- Value and next action are visible immediately.
- Services and live availability remain before personal details.
- The four-step progress model remains unchanged.
- Full price and amount due remain visible before confirmation.
- Guest booking remains explicit.
- Trust information remains factual and contextual.
- No fabricated urgency, reviews, scarcity or guarantees were added.
- Server-authoritative availability, slot holds, payment status, idempotency and analytics remain unchanged.

## Logic impact

The only API response change is adding the existing service category column to the public catalogue payload. There is no schema or migration change. Booking creation, availability, hold, payment and webhook contracts are unchanged.

## Deployment

**Both Vercel and VPS.** The web redesign deploys through Vercel. The public catalogue response change requires the VPS API to be rebuilt and restarted. No database migration is required.
