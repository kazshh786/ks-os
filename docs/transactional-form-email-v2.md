# Transactional form email V2

## Current behaviour and fix

Form assignments always create a hashed public token and return a public completion path. Previously, the email branch in `FormsService.createAssignment()` ran whenever a client email, secure URL, and tenant email setting were present. It did not require `deliveryMethod === 'EMAIL'`.

V2 explicitly gates assignment email and reminder scheduling on the EMAIL delivery method. SMS remains independently gated on SMS, and COPY_LINK only creates the secure assignment/link.

## Branding and metadata

Form emails use the existing communications branding model through `emailBrandingTemplateData()`. The existing model supports business identity, contact details, logo, website, Instagram, Facebook, and TikTok. No additional schema fields are required.

Optional form description, estimated completion time, appointment date/time, service, staff, location, and due date are included when already available. Legacy outbox payloads remain renderable.

## Booking confirmation integration

The booking-confirmed template now accepts an optional `outstandingForms` array containing only:

- `formName`
- an already-created public `formLink`
- optional `estimatedMinutes`

The current booking confirmation assembler does not receive public assignment URLs. Only token hashes are stored, and the public token is available only while an assignment is created. The backend therefore does not populate this block in this iteration.

A follow-up can enable it safely by creating assignments before the booking confirmation is enqueued, capturing each returned completion path in the booking orchestration layer, and passing those already-created links as `outstandingForms`. The renderer must never create assignments, generate tokens, or query unrelated form data.

## Reminder lifecycle

Immediately before sending a queued form reminder, the email worker reloads the tenant-scoped assignment. Missing, submitted, cancelled, expired, or time-expired assignments are cancelled in the outbox and are not sent to Resend.

## Deployment

Cloudflare: NO  
VPS: YES

No database migration is required.
