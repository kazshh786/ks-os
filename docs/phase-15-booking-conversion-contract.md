# Phase 15 Native Booking Conversion Contract

## Invariant

Every website's primary conversion destination is the native KS OS booking
journey for the same tenant as the website. External booking providers and
arbitrary primary CTA URLs are unsupported.

The current fallback route remains `/book/:subdomain`. A future verified custom
domain renderer exposes `/book` and resolves it to the same native journey.

## Structured action model

Primary booking actions use:

```ts
{
  type: 'KS_OS_BOOKING',
  label: 'Book now',
  serviceReference?: string,
  locationReference?: string,
  staffReference?: string,
  campaignReference?: string
}
```

Secondary or navigational actions may be `INTERNAL_PAGE`, `PHONE` or `EMAIL`.
Phone and email actions must be explicitly secondary. No action variant accepts
an arbitrary external primary URL.

## URL resolution

The shared resolver receives only public references:

```ts
resolveKsOsBookingUrl({
  publicOrigin,
  tenantReference,
  tenantSubdomain,
  serviceReference?,
  locationReference?,
  staffReference?,
  campaignReference?,
  routeMode?: 'FALLBACK' | 'CUSTOM_DOMAIN'
})
```

`publicOrigin` comes from configured `PUBLIC_APP_ORIGIN`; it is never inferred
from untrusted request input and the resolver contains no production localhost
fallback. The fallback path uses the validated tenant subdomain. Custom-domain
mode uses `/book`.

Allowlisted query parameters are `service`, `location`, `staff` and `campaign`.
All values are validated and URL encoded. Internal tenant, service, location and
staff database IDs are never emitted.

## Tenant ownership validation

Before a CTA or preselection is persisted or served:

- The site is resolved to one tenant server-side.
- `tenantReference` must match that tenant's public business reference.
- A service reference must select an active service with the same `tenant_id`.
- A location reference must select an active location with the same
  `tenant_id`.
- A staff reference must select an active, bookable membership with the same
  `tenant_id`.
- Invalid or cross-tenant references are rejected; the server does not silently
  drop them or reinterpret them as another tenant.
- Public browsers cannot submit an internal tenant ID.

## Mandatory conversion placement

Future template and site-quality phases enforce:

- Header contains a Book Now action.
- Hero contains a Book Now action.
- Mobile navigation contains a Book Now action.
- Every service card links to its service page or relevant booking flow.
- Every service-detail page has a service-aware booking action.
- Every non-exempt page ends with a booking conversion section.
- Footer contains a booking action.
- A sticky mobile booking bar may be enabled.
- Every booking action resolves to the site tenant.
- A site cannot publish when its booking route fails validation.

The reusable validator reports `BOOKING_CONVERSION` findings. They become
blocking publication findings in Phase 15.8; Phase 15.2 does not implement the
publication blocker or public renderer.

## Compatibility and non-goals

This contract does not change public booking payments, Stripe Connect account
resolution, direct-charge behaviour, webhooks, slot selection, confirmation
semantics or the existing booking APIs. It only provides safe structured links
and ownership validation for website conversion paths.
