# Neutral review-invitation policy

## Eligibility

One invitation may be created for a genuine appointment when all of the following are true:

- appointment status is `COMPLETED`;
- tenant and applicable location are active;
- the appointment has a canonical client and a valid selected channel;
- it is not test, internal, blocked, cancelled, no-show, abandoned, or explicitly excluded for a neutral legal/safety reason;
- an active rule and every selected provider destination resolve for the same location scope;
- no prior invitation exists for that appointment/provider mode.

Refunds and complaints are intentionally absent from eligibility. There is no rating, satisfaction, sentiment, staff-selection or predicted-outcome input.

## Timing and delivery

Rules allow only 0, 120, 360, 1,440, 2,880, 4,320, or 10,080 minutes after completion. UTC timestamps are stored; owner-facing times use the tenant timezone. Scheduling and delivery use durable database workers, never `setTimeout` or `setInterval`.

Email requires a syntactically valid, non-suppressed address. Review SMS is treated conservatively as marketing-like follow-up: `sms_marketing_status` must be `OPTED_IN`, and transactional/STOP suppressions still apply. Customer portal delivery requires an active linked customer account. An opt-out becomes `SUPPRESSED`; it is never overridden.

## Wording

The approved default asks for honest feedback and states there is no obligation. Editing is plain-text and bounded. Validation rejects HTML and obvious manipulation/incentive phrases including five-star/5-star, positive review, reward, free gift, discount for review, and remove your review.

When `BOTH` is configured, the landing page always shows Google and Trustpilot as equal visual actions. The optional private-contact action is shown to everyone and never replaces either provider.

## Lifecycle truthfulness

`SCHEDULED`, `QUEUED`, `SENT`, `DELIVERED`, `OPENED`, and provider-click timestamps represent only observed facts. A provider click sets `PROVIDER_CLICKED`; it does not set `CONFIRMED_REVIEW`. Confirmation is reserved for evidence returned by a provider integration.

