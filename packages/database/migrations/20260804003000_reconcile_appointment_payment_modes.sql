-- Public booking payments introduced explicit API-facing payment modes after
-- the original appointments constraint was created. Keep the legacy values
-- for existing/manual bookings and admit the three current public-booking
-- states without removing validation from the column.

ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_payment_mode_values;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_payment_mode_values
  CHECK (
    payment_mode IN (
      'no_payment',
      'pay_later',
      'deposit',
      'full_payment',
      'customer_choice',
      'not_required',
      'pay_now',
      'deposit_required'
    )
  ) NOT VALID;

ALTER TABLE public.appointments
  VALIDATE CONSTRAINT appointments_payment_mode_values;

COMMENT ON CONSTRAINT appointments_payment_mode_values ON public.appointments IS
  'Allows legacy appointment modes and the current public-booking no-payment, full-payment, and deposit modes.';
