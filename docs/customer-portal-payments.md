# Customer Portal — Payments

## Overview

The payments section provides a read-only view of the customer's payment and refund history across all linked salons. No payment actions (initiate, retry, save card) are available from the customer portal in Phase 10.1.

## Data Shown

| Field | Source | Notes |
|---|---|---|
| Salon name | `tenants.name` | |
| Date | `stripe_payment_attempts.created_at` | Formatted with Intl.DateTimeFormat |
| Payment source | Derived from `payment_method` + `purpose` | See label mapping below |
| Net paid | `transactions.net_settled_amount` | Minor currency units |
| Currency | `tenants.currency` | |
| Payment status | Customer-friendly label | See mapping below |
| Refunded amount | `transactions.refunded_amount` | Minor currency units, if > 0 |

## Fields Excluded (Never Returned)

| Field | Reason |
|---|---|
| `stripe_payment_intent_id` | Internal Stripe identifier |
| `stripe_account_id` / `connect_account_id` | Internal Stripe identifier |
| `stripe_checkout_session_id` | Internal Stripe identifier |
| `idempotency_key` | Internal deduplication key |

## Payment Source Labels

Internal payment method codes are translated to customer-friendly descriptions:

| `payment_method` | `purpose` | Customer label |
|---|---|---|
| `CARD` | `booking_payment` | Online payment |
| `CASH` | any | Cash recorded by salon |
| `SPLIT` | any | Split payment |
| `CARD` | `point_of_sale` (or other) | External card-terminal payment |

## Payment Status Labels

| Internal status | Customer label |
|---|---|
| `SUCCEEDED` | Paid |
| `PARTIALLY_REFUNDED` | Partially refunded |
| `FULLY_REFUNDED` | Refunded |
| `FAILED` | Failed |
| `PENDING` | Pending |

## Isolation

Payment records are retrieved via a JOIN through `customer_client_links`, ensuring a customer can only see payments associated with appointments belonging to their linked client records.

## API Endpoint

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/customer/payments` | List payment and refund history |

## Frontend Route

| Path | Component |
|---|---|
| `/customer/payments` | `CustomerPaymentsPage` |

## Out of Scope (Phase 10.1)

The following payment-related features are explicitly excluded:

- Initiating or retrying payments
- Viewing and saving payment cards
- Requesting refunds
- Dispute management
