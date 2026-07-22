-- Reviewed additive Phase 9.1 migration. Do not apply automatically to production.
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status varchar(20) DEFAULT 'ACTIVE' NOT NULL CHECK(account_status IN('INVITED','ACTIVE','SUSPENDED','DEACTIVATED'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title varchar(120);
ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_phone varchar(30);
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_url varchar(1000);
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS booking_enabled boolean DEFAULT true NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at timestamptz;
CREATE TABLE IF NOT EXISTS staff_invitations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE cascade,email_normalized varchar(255) NOT NULL,name varchar(255) NOT NULL,role varchar(20) DEFAULT 'staff' NOT NULL CHECK(role='staff'),status varchar(20) DEFAULT 'PENDING' NOT NULL CHECK(status IN('PENDING','ACCEPTED','EXPIRED','CANCELLED')),auth_user_id uuid,invited_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE restrict,expires_at timestamptz NOT NULL,created_at timestamptz DEFAULT now() NOT NULL,sent_at timestamptz,accepted_at timestamptz,cancelled_at timestamptz,last_sent_at timestamptz,send_count integer DEFAULT 0 NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS staff_invitations_pending_unique ON staff_invitations(tenant_id,email_normalized) WHERE status='PENDING';
CREATE TABLE IF NOT EXISTS staff_service_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE cascade,staff_user_id uuid NOT NULL REFERENCES users(id) ON DELETE restrict,service_id uuid NOT NULL REFERENCES services(id) ON DELETE restrict,is_active boolean DEFAULT true NOT NULL,created_at timestamptz DEFAULT now() NOT NULL,updated_at timestamptz DEFAULT now() NOT NULL,CONSTRAINT staff_service_assignments_member_service_unique UNIQUE(staff_user_id,service_id));
CREATE UNIQUE INDEX IF NOT EXISTS staff_schedules_user_day_unique ON staff_schedules(tenant_id,user_id,day_of_week);
CREATE UNIQUE INDEX IF NOT EXISTS booking_channel_schedules_user_channel_day_unique ON booking_channel_schedules(tenant_id,user_id,booking_channel,day_of_week);
CREATE INDEX IF NOT EXISTS users_tenant_account_status_idx ON users(tenant_id,account_status);
ALTER TABLE staff_invitations ENABLE ROW LEVEL SECURITY;ALTER TABLE staff_service_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON staff_invitations,staff_service_assignments FROM anon,authenticated;
