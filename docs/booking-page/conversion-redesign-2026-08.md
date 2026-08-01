# Public booking conversion redesign — August 2026

## Scope

This change applies the supplied online-booking conversion research to the native KS OS public booking journey and its payment return states. The work deliberately preserves the existing server-authoritative booking, hold, payment and idempotency contracts.

The objective is sustainable completed-booking conversion, not more clicks at any cost. The design therefore prioritises clarity, low effort, genuine availability, transparent pricing, recoverable payment states, accessibility and trust. It does not introduce fabricated reviews, fake scarcity, hidden charges, forced registration or unsupported conversion claims.

## Deployment classification

**Vercel only.** All production code changes are within `apps/web`. No API, database, migration, worker or VPS service change is included. The repository's Vercel configuration builds `apps/web/dist` and proxies API requests to the existing API origin.

## What changed

### Outcome-led page introduction

`BookingWizardPage` now begins with a single, explicit outcome: choose a service and book a live appointment time. It explains that the journey has four steps and that availability, the full price and the exact payment commitment are visible before confirmation.

Why: the research consistently recommends making the value and next action understandable within the first moments of the visit. The previous route opened directly on the application card and relied on the internal wizard heading to explain the task.

### Conversion promises above the interaction

Three concise promises now appear before the wizard:

- Live availability.
- Clear total and commitment.
- No account required.

Why: these address the main booking anxieties before data entry begins: whether a suitable time exists, what the booking will really cost, and whether an account or unwanted commitment will be imposed. The statements are supported by current system behaviour rather than marketing invention.

### More accessible entry into the booking task

A keyboard-accessible skip link moves directly to the booking options. The booking flow is a named focus target, and preview mode has an explicit status message explaining that it cannot create bookings or payments.

Why: semantic navigation and predictable focus improve usability for keyboard users, assistive technology and agentic browsers. Preview clarity also prevents mistaken expectations during staff testing.

### Single-column customer forms

All labels in the public booking form now span the full form grid, creating a consistent single-column entry sequence at every breakpoint. Mobile inputs use a 16-pixel font size, and interactive controls use `touch-action: manipulation`.

Why: the supplied research identifies zig-zag scanning in multi-column forms as a source of cognitive load and missed fields. A single vertical path is easier to scan and complete. The mobile font-size rule prevents browser zoom during entry, while direct touch handling improves tap responsiveness.

### Reduced-motion support

The booking flow now respects `prefers-reduced-motion`, reducing animation and transition duration for customers who request it.

Why: conversion should not depend on motion that creates discomfort or makes the interface harder to follow. This also reinforces accessibility and predictable state changes.

### Stronger public booking shell

The public layout was simplified into a neutral, low-distraction surface with restrained background detail. Its footer now states that customer details are used to manage the booking securely, confirmation is sent by email, and the experience is powered by KS OS.

Why: the booking task should dominate the visual hierarchy. Security and data-use reassurance should appear near the transaction without pretending that decorative badges are third-party certifications.

### Cancelled-payment recovery

The cancelled-payment page now:

- States clearly that payment was not completed and the appointment still needs payment.
- Keeps the existing booking reference visible.
- Explains that retrying creates a fresh secure payment session for the same booking.
- Explains that the retry does not resubmit the booking form or intentionally create another charge.
- Validates that a non-empty checkout URL was returned before redirecting.
- Uses explicit loading, disabled, busy and error states.
- Uses a specific primary CTA: “Retry secure payment”.

Why: payment interruption is a high-intent recovery moment. Sending the customer back to restart the whole journey increases abandonment and duplicate-booking anxiety. The updated logic preserves context and reopens payment against the existing booking.

### Payment-verification recovery

The payment-success route now:

- Continues to treat the server payment-status endpoint as the source of truth.
- Shows a dedicated verification state instead of implying that returning from Stripe proves success.
- Displays success only after a successful server payment state is returned.
- Preserves the booking reference in success and delayed-verification states.
- Adds “Check payment again”, which restarts the status reconciliation without creating a new booking.
- Warns customers not to create a second booking solely because payment verification is delayed.
- Removes decorative bounce motion from the success state.

Why: a redirect from a payment provider is not itself authoritative proof of payment. The retry logic reduces uncertainty while protecting against duplicate bookings and avoidable repeat payments.

### Automated coverage

Tests now cover:

- The outcome-led booking proposition.
- All three conversion promises.
- The skip link.
- Preview-mode disclosure and propagation.
- Cancelled-payment reassurance and retained reference.
- The rule that a booking is shown as confirmed only after the server reports a successful payment state.

Why: the most important conversion claims and transaction states should be protected from accidental regression.

## Existing conversion behaviour deliberately preserved

The current `PublicBookingFlow` already implements many of the strongest recommendations. These were reviewed and retained rather than rewritten.

| Research recommendation | Existing KS OS behaviour retained | Reason |
|---|---|---|
| Break complex booking into steps | Four steps: service, date/time, details and confirm | Reduces visible cognitive load while preserving necessary data collection. |
| Show progress | Numbered progress navigation and completion state | Supports momentum and gives customers a predictable sense of remaining effort. |
| Ask low-friction questions first | Service and availability precede contact details | Customers receive useful availability information before sharing personal data. |
| Make availability primary | Live availability is loaded after service/date selection | Prevents lead capture before the system can show a useful answer. |
| Provide zero-result alternatives | Next-date and “anyone available” recovery actions | Converts a dead end into a recoverable search. |
| Use genuine inventory | Slots come from the availability API | Avoids fabricated scarcity and stale availability claims. |
| Hold the selected slot | Server-created, short-lived opaque hold with countdown | Provides authentic urgency and protects the selected time during checkout. |
| Prevent impossible or stale bookings | Server revalidates and consumes the hold | Client state cannot force an invalid or overlapping appointment. |
| Preserve correct entries after slot conflict | Contact state remains while the customer returns to time selection | Reduces repeated effort after a recoverable conflict. |
| Avoid compulsory accounts | Public booking is guest-first | Removes a major abandonment cause without blocking future account use. |
| Use persistent labels | Labels remain visible above inputs | Avoids placeholder-only ambiguity and improves accessibility. |
| Use appropriate mobile fields | `email`, `tel`, date controls and autocomplete metadata | Reduces typing and invokes more suitable device keyboards and autofill. |
| Keep optional fields visibly optional | Notes and secondary address fields are marked optional | Prevents optional questions from appearing mandatory. |
| Use specific CTAs | “See available times”, “Review booking”, “Continue to secure payment” and “Confirm booking” | Communicates the next commitment instead of using generic “Submit”. |
| Show the total price early | Service cards and persistent summary show the total | Prevents end-of-flow sticker shock and supports comparison. |
| Show amount due now | Review and CTA state distinguish total, deposit, pay-now and pay-later | Makes the immediate financial commitment explicit. |
| Do not let the browser choose payment policy | Effective payment mode is derived from server page/service rules | Prevents client-controlled payment bypass. |
| Use contextual security reassurance | Security, server verification and Stripe messaging appear near confirmation/payment | Reassures at the point of highest perceived risk. |
| Keep one dominant action | Each step has one primary progression action | Reduces competing conversion paths. |
| Mobile sticky progression | Step actions remain reachable at the bottom of small screens | Reduces scrolling effort and lost progression. |
| Use sufficiently large controls | Primary buttons and slot controls use approximately 44–48 pixel minimum heights | Supports one-handed mobile selection and reduces mistaps. |
| Make errors actionable | Slot conflicts, expired holds and booking failures explain the next action | Allows recovery instead of a generic failure state. |
| Prevent duplicate submissions | Booking creation uses an idempotency key | Protects customers when connections are slow or buttons are retried. |
| Record the funnel | Page view, service, staff, date, time, checkout, payment redirect and completion events are recorded | Supports diagnosis beyond final CTA clicks. |
| Keep analytics free of direct PII | Public analytics uses a random session and allowlisted attribution | Preserves measurement without placing contact data in event payloads. |
| Use semantic and accessible controls | Buttons, fieldsets, legends, labels, `aria-current`, live regions and focus states are present | Improves human accessibility and machine readability. |
| Confirm what happened | Confirmation shows reference, service, staff, location, time and payment state | Removes ambiguity after the commitment. |
| Provide next steps | Calendar and contact actions are available after confirmation | Helps customers retain and manage the appointment. |

## Recommendations not implemented, with reasons

This section is explicit so the research is not selectively applied or silently omitted.

### Verified reviews and testimonials

Not added. The current public catalogue does not supply a verified, service-specific review data contract. Adding invented quotes, hard-coded review counts or generic stars would be misleading and would contradict the research requirement that proof be recognisable and verifiable.

Recommended future implementation: expose verified review source, score, volume, date and service/provider relationship through the public catalogue, then place the proof beside the relevant service or team member.

### Popularity claims and scarcity banners

Not added. The only urgency displayed remains the real server-backed slot hold. Claims such as “five people are viewing” or “only two left” require trustworthy real-time inventory or demand data. Hard-coded urgency would be a dark pattern and create legal and brand risk.

### Countdown sales timers

Not added. The hold countdown describes a real reservation expiry. No promotional countdown exists because there is no authenticated expiring offer in the booking contract.

### Coupon-code field changes

Not applicable to this public booking form. Promotion-code entry is not currently rendered in the reviewed flow, so there is no prominent coupon field sending customers away to search for codes.

### Unit-price reframing

Not added. The reviewed service is an appointment with one total price rather than a multi-night, per-person or recurring unit where a secondary unit price aids comparison. The full total remains the primary amount. A unit price should only be introduced for a service model where it is truthful and useful, never as a substitute for the total.

### Digital wallets

No custom wallet buttons were added to the booking page because payment entry is handled by Stripe’s hosted secure checkout. Supported wallets should be configured and measured in Stripe according to tenant/payment-account eligibility rather than imitated in the booking UI.

### Inline bespoke validation messages

The flow currently uses semantic input types, required constraints and server error states. A custom per-field validation layer was not added in this change because it requires a shared validation contract and localisation approach to avoid inconsistent browser and API rules. This is a valid future experiment, especially for email, phone and mobile-service addresses.

### Address lookup

Not added because no address-lookup provider, privacy contract or tenant-level configuration exists in the reviewed public catalogue. The current address inputs retain browser autocomplete. A postcode/address lookup should be added only with an approved provider and clear fallback to manual entry.

### Automatic persistence of personal details

Not added. Persisting name, email, phone, address or notes in browser storage can create privacy risk on shared devices. The current in-memory state survives normal step navigation and recoverable slot conflicts. Any future restoration should be consent-aware, time-bounded and should prefer non-sensitive selection state.

### Marketing qualification questions

Not added. This is a direct appointment journey, not a B2B lead-qualification funnel. Additional budget, source or marketing questions would increase effort without helping booking fulfilment.

### Immediate live call or sales routing

Not applicable to a self-serve appointment booking flow. The research’s speed-to-lead findings are relevant to consultation lead forms; KS OS already gives customers immediate self-scheduling rather than an asynchronous “we will contact you” response.

### Forced registration after confirmation

Not added as a compulsory step. Optional account creation can be tested after a confirmed booking, but it must not interrupt confirmation or imply that the booking depends on registration.

### A/B-tested conversion lift claims

No percentage uplift is claimed. Published cases are context-dependent and often bundle multiple changes. This branch creates evidence-based hypotheses; its effect must be measured against KS OS baseline traffic, device mix, service mix, cancellations and contribution.

## Logic and data changes

### Changed

- Payment cancellation reuses the existing booking reference and requests a new payment session for that booking.
- Payment return continues polling the server-authoritative status and can now restart verification on customer request.
- Checkout redirects are accepted only when the API returns a non-empty string URL.
- Preview status is derived once by the route and passed explicitly to the booking flow.

### Intentionally unchanged

- Booking creation payload and API route.
- Slot availability calculation.
- Hold creation, expiry, release and consumption.
- Booking idempotency.
- Tenant, service, staff and location ownership validation.
- Stripe account resolution and webhook authority.
- Payment mode derivation.
- Database schema and migrations.
- Public analytics event contract.

## Measurement plan

The change should be evaluated on completed and net booking outcomes rather than hero clicks alone.

Primary metric:

- Confirmed bookings per qualified booking-page session.

Diagnostic funnel metrics:

- Page view to booking start.
- Service selection to valid results.
- Result view to time selection.
- Time selection to details completion.
- Details completion to confirmation/payment redirect.
- Payment submission to server-verified payment.
- Cancelled-payment retry success.

Guardrails:

- Payment failures and duplicate-payment reports.
- Slot conflicts and hold expiry.
- Booking cancellation, rescheduling and no-show rates.
- Support contacts.
- Mobile versus desktop completion.
- Core Web Vitals and JavaScript errors.
- Contribution per visitor, not only raw booking count.

The page introduction, form layout and payment recovery can be tested as a grouped redesign because they address separate but connected friction points. Reporting should still preserve absolute conversion rates, sample counts, device segments and payment outcomes.

## Files changed

- `apps/web/src/pages/BookingWizardPage.tsx`
- `apps/web/src/pages/BookingWizardPage.css`
- `apps/web/src/layouts/PublicBookingLayout.tsx`
- `apps/web/src/pages/book/PaymentCancel.tsx`
- `apps/web/src/pages/book/PaymentSuccess.tsx`
- `apps/web/src/pages/BookingWizardPage.test.tsx`
- `apps/web/src/pages/book/PaymentRecovery.test.tsx`
- `docs/booking-page/conversion-redesign-2026-08.md`
