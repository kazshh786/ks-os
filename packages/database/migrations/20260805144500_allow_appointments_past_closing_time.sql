ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS allow_appointments_past_closing_time boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN tenants.allow_appointments_past_closing_time IS
  'When enabled, availability may offer appointment start times before closing even if service duration or buffer extends beyond the schedule end.';
