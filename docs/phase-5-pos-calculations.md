# Phase 5.1 POS MVP Calculations

## Pure Integer Money Calculations

To ensure absolute financial accuracy and prevent insidious floating-point arithmetic errors, the KS OS POS MVP mandates pure integer money calculations across the entire stack.

### Principles

1. **Cents as the Base Unit**: All monetary values are stored, transmitted, and calculated in their smallest currency unit (e.g., cents for USD/EUR, pence for GBP). A $10.50 item is represented as `1050`.
2. **No Floats**: Floating-point numbers are strictly prohibited in any calculation involving currency.
3. **Frontend Formatting**: The frontend receives the integer value (`1050`) and is solely responsible for formatting it into a localized display string (`$10.50`).
4. **Backend Validation**: Zod contracts enforce that incoming monetary values must be integers.

### Calculation Flow

During a checkout:
- Item prices are retrieved from the database as integers.
- Quantities are multiplied by the integer price.
- Discounts (whether fixed or percentage-based) are calculated and rounded to the nearest integer cent *before* final summation.
- Tax calculations follow the same rule, ensuring that the `total_amount = subtotal - discounts + tax` formula holds perfectly true at the integer level.
