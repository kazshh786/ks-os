# Phase 5.3 Payment Security

## Overview
Payment security is paramount to protect both tenant revenue and customer data.

## Stripe Security Measures
- **No Direct Card Handling**: KS OS never handles raw credit card information. All payments are securely collected via Stripe Checkout's PCI-compliant hosted pages.
- **Webhook Signatures**: Incoming webhooks are strictly verified using Stripe's cryptographically signed signatures to prevent spoofed events.

## Application Security Measures
- **Pessimistic Locking**: The booking system ensures slots are locked temporarily during the checkout process to prevent double-booking.
- **Integer Arithmetic**: As in POS operations, all financial figures are calculated in cents using pure integers to avoid floating-point inaccuracies.
- **Idempotency**: Webhook deduplication using `stripe_webhook_events` prevents the same successful payment from being registered twice.
- **RBAC Limitations**: Public users can only create bookings in a `PENDING_PAYMENT` state. Only secure webhooks can transition them to `CONFIRMED`.
