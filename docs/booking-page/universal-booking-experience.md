# Universal Booking Experience

## Product invariant

Every KS OS business uses the same conversion-optimised public booking experience. The customer journey, information architecture, interaction patterns, typography, spacing, cards, progress indicator, availability picker, details form, review screen, confirmation screen and payment handoff are controlled by the platform.

The only tenant-specific visual controls are:

- logo
- primary colour
- accent colour

Business data still changes dynamically: business name, services, descriptions, prices, duration, locations, staff, availability, payment requirement and cancellation policy.

## Conversion principles

The shared `/book` journey uses:

- one clear objective: complete a booking
- progressive disclosure across Service, Date & time, Details and Confirm
- live availability before personal details
- minimum required customer fields
- persistent booking summary
- predictable action labels
- grouped morning, afternoon and evening times
- “Anyone available” as the fastest-slot option
- mobile sticky actions
- trust and security cues adjacent to confirmation
- no fabricated reviews, scarcity or unsupported credentials

## Payment boundary

KS OS never renders a custom card-number form in the booking experience. When a deposit or full payment is required, the server creates the existing Stripe Checkout session and the customer continues into Stripe’s prebuilt secure checkout. The booking page communicates the exact amount due before the handoff.

## Settings boundary

Tenant settings may change operational behaviour without changing the universal design:

- online booking enabled/published state
- booking notice and future window
- allowed services, staff and locations
- payment mode and deposit percentage
- cancellation policy
- custom booking domain

Legacy title, description, cover image, layout and corner-style fields may remain in storage for backwards compatibility, but the public booking renderer does not use them.

## Measurement

The universal journey retains the existing source and campaign attribution and records funnel events including page view, service selection, booking start, date selection, time selection, details completion, checkout start, payment redirect and booking completion.
