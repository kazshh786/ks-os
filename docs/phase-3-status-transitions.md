# Status Transitions

Appointments flow through a logical lifecycle governed by the API.

## Allowed Transitions

- **PENDING**: Initial state for unconfirmed bookings (especially if payment was deferred but required, though Phase 3 defaults to CONFIRMED).
- **CONFIRMED**: Default state upon successful booking.
- **COMPLETED**: The appointment has taken place successfully.
- **NO_SHOW**: The customer did not arrive.
- **CANCELLED**: The appointment was cancelled either by the customer or the staff.

Transitions are strictly checked by the `UpdateBookingStatusSchema` and the `updateBookingStatus` backend method.

## Authorization
- **Owner**: Can transition any booking for their tenant.
- **Staff**: Can transition bookings assigned to them (where `appointments.user_id = authUserId`). They may NOT transition bookings assigned to other staff members, nor can they alter an already completed or cancelled booking.
