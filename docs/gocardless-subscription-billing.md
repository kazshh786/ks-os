# GoCardless subscription billing

GoCardless is the sole provider for client-business setup fees and recurring KS OS subscriptions. Stripe Connect remains exclusively for the client's customer appointment payments.

The API creates a GoCardless Billing Request containing a Bacs mandate request and, when applicable, a one-off setup payment request. It then creates a Hosted Payment Page flow. KS OS stores provider resource IDs and lifecycle state, never raw bank details.

Required environment:

```text
GOCARDLESS_ENVIRONMENT=sandbox|live
GOCARDLESS_ACCESS_TOKEN=...
GOCARDLESS_WEBHOOK_SECRET=...
```

Provider requests use `GoCardless-Version: 2015-07-06` and deterministic idempotency keys. Webhooks require the `Webhook-Signature` HMAC over the unmodified raw body. Provider event IDs are unique; duplicate delivery is acknowledged without reapplying state. Unknown resources are ignored rather than guessed into a tenant.

Payment failure enters a seven-day grace period and does not abruptly disable bookings. Upgrade/downgrade changes are tied to immutable plan versions; immediate changes update the provider amount before committing local state and scheduled changes run at the next known billing boundary. Offboarding honours the minimum term, then the authenticated worker cancels at GoCardless and retains tenant data.

Before live launch, exercise Billing Request fulfilment, mandate activation/failure/cancellation, setup payment confirmation/failure/refund, subscription create/active/failure/recovery/pause/cancel and duplicate/out-of-order webhook cases in the GoCardless sandbox.
