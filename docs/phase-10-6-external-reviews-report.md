# Phase 10.6 — External Reviews and Reputation Management

## Outcome

KS OS is an automation and reputation-management layer for Google Reviews and Trustpilot. It does not host public reviews, create an internal star score, publish testimonials, or calculate a combined trust score. Provider reviews remain authoritative and every displayed rating is attributed to its provider.

The implementation includes tenant/location-scoped manual review links, optional encrypted Google OAuth and Trustpilot API connections, one neutral rule per scope, durable invitation records, existing email/SMS outbox delivery, a tokenised neutral choice page, click-only tracking, provider review sync, and public reply operations.

## Architecture

`APPOINTMENT_COMPLETED` is the sole scheduling trigger. `BookingService` already emitted it; POS checkout now emits the same stable event when it performs the genuine status transition. The existing business-event worker calls `ReviewInvitationService.scheduleFromCompletion`. Deterministic idempotency and a database uniqueness constraint prevent replay duplicates.

The existing automation action worker claims due rows with `FOR UPDATE SKIP LOCKED` and reclaims abandoned claims after a bounded lease. It resolves a location-specific provider destination, using a tenant-wide fallback only when explicitly configured. It queues `review-invitation` through the existing email or SMS outbox. Resend/Twilio delivery callbacks update the invitation lifecycle.

The same worker claims due API connections for background review sync. Successful connections refresh at six-hour intervals; safely coded failures back off for 15 minutes. Trustpilot pagination follows `nextPageToken`, provider verification is preserved, and official review web links are cached for normal UI reads.

Review landing tokens are HMAC-derived from random invitation UUIDs, but only SHA-256 hashes are stored. Delivery workers derive the raw token just before rendering, so outbox rows do not contain a raw review URL.

## Controls delivered

- Provider modes: `GOOGLE`, `TRUSTPILOT`, `BOTH`.
- Delays: immediate, 2h, 6h, 24h, 2d, 3d, 7d; default 24h.
- Channels: email, SMS, customer portal.
- Neutral plain-text template validation with prohibited incentive/manipulation terms.
- Exclusion flags for test, internal, and explicit neutral legal/safety exclusions.
- No refund/complaint exclusion and no sentiment input.
- Separate Google and Trustpilot metrics; no KS OS score.
- Owner-only connection/rule/reply mutations; explicitly granted `REPUTATION_VIEW` supports read-only staff/manager-style access.
- API-only RLS tables with browser-role revocation.

## Provider limitations

Manual links are always independent of provider API approval. Google OAuth requires a Google Cloud project approved for Business Profile APIs. Trustpilot Invitations and private reply APIs require appropriate Business user OAuth/API access. When credentials, approval, mappings, or quota are absent, API-only features return `REVIEW_PROVIDER_NOT_AVAILABLE` or an authentication/rate-limit error; they never return mock reviews.

## Baseline

Before Phase 10.6 changes, typecheck, lint and build passed. Web tests passed 31/31, notification tests 2/2 and email tests 1/1. API tests passed 187/194; seven counted failures were pre-existing missing-local-Postgres and obsolete session-route failures.

See the provider, policy, security, and verification documents in this directory for operational detail.
