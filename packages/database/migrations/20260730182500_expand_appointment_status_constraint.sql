-- Reconcile the production appointment status constraint with the operational
-- lifecycle already used by the API, calendar and database schema.
--
-- Older databases only allow PENDING, CONFIRMED, COMPLETED, CANCELLED,
-- NO_SHOW and BLOCKED. That rejects walk-ins created as CHECKED_IN and also
-- prevents the IN_SERVICE and AWAITING_PAYMENT workflow states.

ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_status_check;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_status_check
  CHECK (
    status IN (
      'PENDING',
      'CONFIRMED',
      'CHECKED_IN',
      'IN_SERVICE',
      'AWAITING_PAYMENT',
      'COMPLETED',
      'CANCELLED',
      'NO_SHOW',
      'BLOCKED'
    )
  ) NOT VALID;

ALTER TABLE appointments
  VALIDATE CONSTRAINT appointments_status_check;
