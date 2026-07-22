# Phase 5.1 POS MVP Security

## Idempotency Transaction Boundaries

To guarantee that network failures, user double-clicks, or retry logic do not result in duplicate checkouts, the `POST /api/v1/pos/checkout` endpoint enforces strict idempotency transaction boundaries.
- Every checkout request must supply an idempotency key.
- The transaction begins by verifying if the idempotency key exists in the database for the current tenant.
- If it does, the system immediately returns the cached successful response.
- If it doesn't, the database transaction executes the checkout and atomically saves the idempotency key along with the transaction record.

## Pessimistic Stock Locking

When a checkout involves physical retail products, the system uses pessimistic locking to prevent race conditions during concurrent checkouts.
- **`FOR UPDATE` Clause**: Inventory rows are queried using a `SELECT ... FOR UPDATE` clause inside the checkout transaction. 
- **Guarded Queries**: This ensures that once a checkout transaction reads the current stock level, no other transaction can modify it until the first checkout completes and commits the new stock level.

## Role-Based Execution Boundaries

The POS system enforces strict Role-Based Access Control (RBAC) differentiating Owner vs. Staff capabilities:
- **Owner**: Has unrestricted access to process checkouts, apply manual arbitrary discounts, and override stock warnings.
- **Staff**: Can process checkouts but is restricted by policy. They cannot apply arbitrary discounts beyond predefined limits and cannot process a checkout if inventory drops below zero.

## Stripe Webhook Security (Phase 5.2)

With Phase 5.2 finalized:
- **Signature Verification**: All Stripe webhook events are cryptographically verified to ensure authenticity.
- **Webhook Deduplication**: Handled via the `stripe_webhook_events` table to prevent duplicate processing.
- **Master-Admin Read-Only Restrictions**: The KS OS Master-Admin dashboard has read-only access to Stripe Connect properties to ensure platform integrity.
