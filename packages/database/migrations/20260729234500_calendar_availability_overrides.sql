-- Additive booking-hours override migration. Apply through the normal reviewed deployment process.
CREATE TABLE IF NOT EXISTS booking_schedule_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE cascade,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE cascade,
  booking_channel text NOT NULL CHECK (booking_channel IN ('in_shop', 'mobile')),
  override_date date NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  start_time time,
  end_time time,
  note varchar(160),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_schedule_overrides_valid_window CHECK (
    (enabled = false AND start_time IS NULL AND end_time IS NULL)
    OR
    (enabled = true AND start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS booking_schedule_overrides_member_channel_date_unique
  ON booking_schedule_overrides(tenant_id, user_id, booking_channel, override_date);
CREATE INDEX IF NOT EXISTS booking_schedule_overrides_tenant_date_idx
  ON booking_schedule_overrides(tenant_id, override_date);

ALTER TABLE booking_schedule_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON booking_schedule_overrides FROM anon, authenticated;
