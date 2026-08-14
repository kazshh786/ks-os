-- A connected account belongs to either the Stripe test environment or the
-- Stripe live environment. Persist that boundary per tenant so changing the
-- platform keys cannot leave onboarding, booking or POS pointed at an account
-- from the other environment. Existing rows remain NULL until Stripe verifies
-- them with the active platform key; this avoids guessing for live accounts.

ALTER TABLE public.stripe_connections
  ADD COLUMN IF NOT EXISTS livemode boolean;

CREATE UNIQUE INDEX IF NOT EXISTS stripe_connections_stripe_account_id_unique
  ON public.stripe_connections (stripe_account_id);

COMMENT ON COLUMN public.stripe_connections.livemode IS
  'True for live Stripe connected accounts, false for test accounts, NULL until a legacy connection is verified.';
