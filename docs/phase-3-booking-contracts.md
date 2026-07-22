# Booking Contracts

The booking domain uses shared Zod schemas to ensure consistent validation between the frontend and the backend.

- **`CreateBookingRequestSchema`**: Used for public and reception booking creation. Validates customer details, service/staff IDs, and restricts paymentMode to `pay_later` for Phase 3.
- **`BookingConfirmationSchema`**: Defines the response structure upon successful booking, providing a secure `reference` instead of a database ID.
- **`UpdateBookingStatusSchema`**: Authorizes status transitions (e.g., `PENDING` -> `CONFIRMED`, `CONFIRMED` -> `CANCELLED`) ensuring logical workflows.
- **`AvailabilityQuerySchema` & `AvailabilityResultSchema`**: Define how availability is queried and safely returned.

These contracts prevent overposting, extraneous fields, and invalid type casting, providing a secure data boundary for the application.
