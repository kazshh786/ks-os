# Phase 5.1 POS MVP API & Contracts

## Endpoints

The POS MVP introduces the following critical endpoints under `/api/v1/pos`:

- **`POST /api/v1/pos/checkout`**
  - **Purpose**: Processes a completed order, deducts stock, creates a transaction record, and finalizes the checkout.
  - **Payload**: Includes items (services, products), applied discounts, and payment methods.
  - **Idempotency**: Requires an idempotency key (`x-idempotency-key`) in the headers to prevent duplicate checkouts.

- **`GET /api/v1/pos/transactions`**
  - **Purpose**: Retrieves a history of transactions scoped to the current tenant.

- **`GET /api/v1/pos/transactions/:transactionId`**
  - **Purpose**: Retrieves details of a specific transaction.

## Contracts & Validation

All API inputs and outputs are strictly validated using Zod contracts shared in `packages/contracts`. 

### Payment Method Meanings

The POS system accepts various payment methods, structured in the contracts as an enumeration. A critical distinction in the MVP is the definition of **External Card**:

- **External Card**: This represents a transaction processed via a third-party, non-integrated card terminal (e.g., a standard Verifone or SumUp terminal not connected via API). **This is a dummy wrapper**. It records the *fact* that a card payment occurred but does not trigger any Stripe API calls or electronic fund transfers within the system.
- **Cash**: Standard physical currency.
- **Bank Transfer**: Manual reconciliation of a direct bank deposit.
