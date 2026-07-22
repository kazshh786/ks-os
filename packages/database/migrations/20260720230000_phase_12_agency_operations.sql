-- Phase 12: agency operations, tenant management and commercialisation.
-- Control-plane tables are API-only and deliberately unavailable to browser roles.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS agency_reference uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS lifecycle_status varchar(30) DEFAULT 'PROSPECT' NOT NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS legal_business_name varchar(255);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS business_type varchar(80);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS primary_contact_name varchar(255);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS primary_contact_email varchar(255);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS contract_start_at timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS minimum_term_ends_at timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS founding_client boolean DEFAULT false NOT NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS commercial_notes text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS launched_at timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS offboarded_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_agency_reference_unique ON tenants(agency_reference);
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_lifecycle_status_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_lifecycle_status_check CHECK (lifecycle_status IN ('PROSPECT','ONBOARDING','ACTIVE','SUSPENDED','OFFBOARDING','OFFBOARDED'));

CREATE TABLE IF NOT EXISTS agency_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_user_id uuid NOT NULL UNIQUE,
  email_normalized varchar(255) NOT NULL UNIQUE, display_name varchar(255) NOT NULL,
  role varchar(40) NOT NULL CHECK (role IN ('PLATFORM_OWNER','AGENCY_ADMINISTRATOR','SUPPORT_ADMINISTRATOR','FULFILMENT_ADMINISTRATOR')),
  status varchar(20) NOT NULL DEFAULT 'INVITED' CHECK (status IN ('INVITED','ACTIVE','SUSPENDED')),
  invited_by_agency_user_id uuid, last_authenticated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agency_users_invited_by_fk FOREIGN KEY (invited_by_agency_user_id) REFERENCES agency_users(id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS agency_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  auth_session_id uuid NOT NULL UNIQUE, assurance_level varchar(10) NOT NULL CHECK (assurance_level IN ('aal1','aal2')),
  expires_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
  revoke_reason varchar(255), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agency_sessions_user_expiry_idx ON agency_sessions(agency_user_id,expires_at);

CREATE TABLE IF NOT EXISTS agency_support_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT, token_hash varchar(64) NOT NULL UNIQUE,
  scope varchar(30) NOT NULL DEFAULT 'STANDARD_SUPPORT' CHECK (scope IN ('READ_ONLY','STANDARD_SUPPORT')),
  reason varchar(500) NOT NULL, expires_at timestamptz NOT NULL, last_used_at timestamptz, revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), CHECK (expires_at <= created_at + interval '2 hours')
);
CREATE INDEX IF NOT EXISTS agency_support_sessions_tenant_expiry_idx ON agency_support_sessions(tenant_id,expires_at);
CREATE INDEX IF NOT EXISTS agency_support_sessions_user_expiry_idx ON agency_support_sessions(agency_user_id,expires_at);

CREATE TABLE IF NOT EXISTS platform_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  support_session_id uuid REFERENCES agency_support_sessions(id) ON DELETE RESTRICT,
  tenant_id uuid REFERENCES tenants(id) ON DELETE RESTRICT, action varchar(120) NOT NULL,
  target_type varchar(80) NOT NULL, target_id varchar(255), outcome varchar(30) NOT NULL DEFAULT 'SUCCESS',
  reason varchar(500), request_id varchar(100), ip_hash varchar(64), metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_audit_events_tenant_occurred_idx ON platform_audit_events(tenant_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS platform_audit_events_actor_occurred_idx ON platform_audit_events(agency_user_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS platform_audit_events_action_occurred_idx ON platform_audit_events(action,occurred_at DESC);
CREATE OR REPLACE FUNCTION prevent_platform_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'platform_audit_events is append-only'; END $$;
DROP TRIGGER IF EXISTS platform_audit_events_append_only ON platform_audit_events;
CREATE TRIGGER platform_audit_events_append_only BEFORE UPDATE OR DELETE ON platform_audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_platform_audit_mutation();
REVOKE EXECUTE ON FUNCTION prevent_platform_audit_mutation() FROM PUBLIC;

CREATE TABLE IF NOT EXISTS platform_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key varchar(20) NOT NULL UNIQUE CHECK (key IN ('CORE','GROWTH','SCALE')),
  name varchar(120) NOT NULL, status varchar(20) NOT NULL DEFAULT 'ACTIVE', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS platform_plan_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_id uuid NOT NULL REFERENCES platform_plans(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0), name varchar(120) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
  monthly_price_minor integer NOT NULL CHECK (monthly_price_minor >= 0), setup_fee_amount_minor integer NOT NULL CHECK (setup_fee_amount_minor >= 0), currency varchar(3) NOT NULL DEFAULT 'GBP',
  effective_from timestamptz NOT NULL, published_at timestamptz, retired_at timestamptz,
  created_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(plan_id,version)
);
CREATE INDEX IF NOT EXISTS platform_plan_versions_status_idx ON platform_plan_versions(status,effective_from);
CREATE TABLE IF NOT EXISTS platform_plan_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_version_id uuid NOT NULL REFERENCES platform_plan_versions(id) ON DELETE CASCADE,
  entitlement_key varchar(80) NOT NULL, name varchar(120) NOT NULL,
  entitlement_type varchar(20) NOT NULL CHECK (entitlement_type IN ('BOOLEAN','QUANTITY','USAGE','SERVICE_LEVEL')),
  availability varchar(30) NOT NULL DEFAULT 'GENERALLY_AVAILABLE' CHECK (availability IN ('UNAVAILABLE','INTERNAL_PILOT','BETA','GENERALLY_AVAILABLE','RETIRED')),
  value_json jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(plan_version_id,entitlement_key)
);
CREATE INDEX IF NOT EXISTS platform_plan_entitlements_key_idx ON platform_plan_entitlements(entitlement_key);
CREATE TABLE IF NOT EXISTS tenant_plan_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  plan_version_id uuid NOT NULL REFERENCES platform_plan_versions(id) ON DELETE RESTRICT,
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ENDED')),
  starts_at timestamptz NOT NULL, ends_at timestamptz,
  scheduled_replacement_plan_version_id uuid REFERENCES platform_plan_versions(id) ON DELETE RESTRICT,
  scheduled_replacement_at timestamptz, reason varchar(500), assigned_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_plan_assignments_one_active_idx ON tenant_plan_assignments(tenant_id) WHERE status='ACTIVE';
CREATE INDEX IF NOT EXISTS tenant_plan_assignments_plan_version_idx ON tenant_plan_assignments(plan_version_id);
CREATE TABLE IF NOT EXISTS tenant_entitlement_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  entitlement_key varchar(80) NOT NULL, previous_value_json jsonb, value_json jsonb NOT NULL, reason varchar(500) NOT NULL,
  starts_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz,
  created_by_agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT, approved_by_agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), CHECK (expires_at > starts_at)
);
CREATE INDEX IF NOT EXISTS tenant_entitlement_overrides_tenant_key_expiry_idx ON tenant_entitlement_overrides(tenant_id,entitlement_key,expires_at) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS tenant_entitlement_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  entitlement_key varchar(80) NOT NULL, period_start timestamptz NOT NULL, period_end timestamptz NOT NULL,
  used integer NOT NULL DEFAULT 0 CHECK (used >= 0), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,entitlement_key,period_start), CHECK (period_end > period_start)
);

CREATE TABLE IF NOT EXISTS tenant_onboarding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE RESTRICT,
  status varchar(30) NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS','BLOCKED','READY_TO_LAUNCH','COMPLETE','CANCELLED')),
  owner_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT, target_launch_at timestamptz, launched_at timestamptz,
  responsible_tenant_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  completion_percentage integer NOT NULL DEFAULT 0 CHECK (completion_percentage BETWEEN 0 AND 100), current_stage varchar(40) NOT NULL DEFAULT 'SALE_HANDOVER',
  missing_information jsonb NOT NULL DEFAULT '[]'::jsonb, blockers jsonb NOT NULL DEFAULT '[]'::jsonb, next_action text,
  internal_notes text, client_visible_notes text, last_client_activity_at timestamptz,
  business_profile jsonb NOT NULL DEFAULT '{}'::jsonb, branding_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  domain_email_profile jsonb NOT NULL DEFAULT '{}'::jsonb, website_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tenant_onboarding_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), onboarding_id uuid NOT NULL REFERENCES tenant_onboarding(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT, stage_key varchar(40) NOT NULL,
  sequence integer NOT NULL CHECK (sequence BETWEEN 1 AND 12), status varchar(20) NOT NULL DEFAULT 'NOT_STARTED'
    CHECK (status IN ('NOT_STARTED','IN_PROGRESS','BLOCKED','READY','COMPLETE','SKIPPED')),
  blocker_code varchar(80), blocker_note text, notes text, due_at timestamptz, completed_at timestamptz,
  updated_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT, updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(onboarding_id,stage_key), CHECK (status <> 'BLOCKED' OR blocker_note IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS tenant_onboarding_stages_tenant_sequence_idx ON tenant_onboarding_stages(tenant_id,sequence);
CREATE TABLE IF NOT EXISTS tenant_launch_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  check_key varchar(80) NOT NULL, status varchar(20) NOT NULL CHECK (status IN ('PASS','FAIL','WARNING')),
  blocking boolean NOT NULL DEFAULT true, detail text, checked_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,check_key)
);
CREATE INDEX IF NOT EXISTS tenant_launch_checks_tenant_status_idx ON tenant_launch_checks(tenant_id,status);

CREATE TABLE IF NOT EXISTS tenant_billing_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE RESTRICT,
  provider varchar(30) NOT NULL DEFAULT 'GOCARDLESS' CHECK (provider='GOCARDLESS'), provider_customer_id varchar(255) UNIQUE,
  provider_mandate_id varchar(255) UNIQUE, mandate_status varchar(30) NOT NULL DEFAULT 'NOT_CREATED',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tenant_setup_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  billing_account_id uuid NOT NULL REFERENCES tenant_billing_accounts(id) ON DELETE RESTRICT,
  provider_payment_id varchar(255) UNIQUE, provider_billing_request_id varchar(255) UNIQUE,
  amount_minor integer NOT NULL CHECK (amount_minor >= 0), currency varchar(3) NOT NULL DEFAULT 'GBP',
  status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','FAILED','REFUNDED','WAIVED')),
  waived_reason varchar(500), confirmed_at timestamptz, refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'WAIVED' OR waived_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS tenant_setup_payments_tenant_status_idx ON tenant_setup_payments(tenant_id,status);
CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  billing_account_id uuid NOT NULL REFERENCES tenant_billing_accounts(id) ON DELETE RESTRICT,
  plan_version_id uuid NOT NULL REFERENCES platform_plan_versions(id) ON DELETE RESTRICT,
  provider_subscription_id varchar(255) UNIQUE, status varchar(40) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','AWAITING_MANDATE','PENDING','TRIALLING','ACTIVE','PAYMENT_OVERDUE','GRACE_PERIOD','RESTRICTED','PAUSED','CANCELLATION_SCHEDULED','CANCELLED','WRITTEN_OFF')),
  amount_minor integer NOT NULL CHECK (amount_minor >= 0), currency varchar(3) NOT NULL DEFAULT 'GBP', interval_unit varchar(20) NOT NULL DEFAULT 'MONTHLY',
  trial_ends_at timestamptz, next_charge_at timestamptz, grace_ends_at timestamptz, cancellation_scheduled_at timestamptz,
  cancelled_at timestamptz, minimum_term_ends_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tenant_subscriptions_tenant_status_idx ON tenant_subscriptions(tenant_id,status);
CREATE INDEX IF NOT EXISTS tenant_subscriptions_next_charge_idx ON tenant_subscriptions(status,next_charge_at);
CREATE TABLE IF NOT EXISTS tenant_subscription_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  subscription_id uuid REFERENCES tenant_subscriptions(id) ON DELETE RESTRICT,
  setup_payment_id uuid REFERENCES tenant_setup_payments(id) ON DELETE RESTRICT,
  provider_event_id varchar(255) NOT NULL UNIQUE, resource_type varchar(40) NOT NULL, action varchar(80) NOT NULL,
  payload_json jsonb NOT NULL, processed_at timestamptz, failure_code varchar(80), received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tenant_subscription_events_tenant_received_idx ON tenant_subscription_events(tenant_id,received_at DESC);
CREATE INDEX IF NOT EXISTS tenant_subscription_events_processing_idx ON tenant_subscription_events(processed_at,received_at);
CREATE TABLE IF NOT EXISTS tenant_price_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  subscription_id uuid REFERENCES tenant_subscriptions(id) ON DELETE RESTRICT,
  kind varchar(30) NOT NULL CHECK (kind IN ('DISCOUNT','FOUNDING_RATE','FREE_PERIOD','MANUAL_PRICE')),
  amount_minor integer CHECK (amount_minor >= 0), percentage_basis_points integer CHECK (percentage_basis_points BETWEEN 0 AND 10000),
  reason varchar(500) NOT NULL, starts_at timestamptz NOT NULL, expires_at timestamptz,
  created_by_agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at IS NULL OR expires_at > starts_at)
);
CREATE INDEX IF NOT EXISTS tenant_price_exceptions_tenant_expiry_idx ON tenant_price_exceptions(tenant_id,expires_at);

CREATE TABLE IF NOT EXISTS managed_deliverables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  type varchar(30) NOT NULL CHECK (type IN ('WEBSITE','SEO','ANALYTICS','CONTENT','PAID_MEDIA','DOMAIN','EMAIL','OTHER')),
  title varchar(180) NOT NULL, description text, status varchar(30) NOT NULL DEFAULT 'NOT_STARTED'
    CHECK (status IN ('NOT_STARTED','IN_PROGRESS','AWAITING_CLIENT','BLOCKED','READY_FOR_APPROVAL','APPROVED','DELIVERED','CANCELLED')),
  assigned_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT, due_at timestamptz,
  estimated_minutes integer NOT NULL DEFAULT 0 CHECK (estimated_minutes >= 0), actual_minutes integer NOT NULL DEFAULT 0 CHECK (actual_minutes >= 0),
  cost_minor integer NOT NULL DEFAULT 0 CHECK (cost_minor >= 0), completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS managed_deliverables_tenant_status_due_idx ON managed_deliverables(tenant_id,status,due_at);
CREATE INDEX IF NOT EXISTS managed_deliverables_assignee_status_idx ON managed_deliverables(assigned_agency_user_id,status);
CREATE TABLE IF NOT EXISTS managed_deliverable_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), deliverable_id uuid NOT NULL REFERENCES managed_deliverables(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT, agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  action varchar(80) NOT NULL, from_status varchar(30), to_status varchar(30), note text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS managed_deliverable_activity_deliverable_created_idx ON managed_deliverable_activity(deliverable_id,created_at);
CREATE TABLE IF NOT EXISTS managed_deliverable_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), deliverable_id uuid NOT NULL REFERENCES managed_deliverables(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT, status varchar(20) NOT NULL DEFAULT 'PENDING',
  requested_by_agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT, response_note text,
  requested_at timestamptz NOT NULL DEFAULT now(), responded_at timestamptz
);
CREATE INDEX IF NOT EXISTS managed_deliverable_approvals_deliverable_status_idx ON managed_deliverable_approvals(deliverable_id,status);
CREATE TABLE IF NOT EXISTS managed_service_time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), deliverable_id uuid NOT NULL REFERENCES managed_deliverables(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT, agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  minutes integer NOT NULL CHECK (minutes > 0), cost_minor integer NOT NULL DEFAULT 0 CHECK (cost_minor >= 0), note varchar(1000),
  worked_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS managed_service_time_entries_tenant_worked_idx ON managed_service_time_entries(tenant_id,worked_at);
CREATE INDEX IF NOT EXISTS managed_service_time_entries_deliverable_idx ON managed_service_time_entries(deliverable_id);

CREATE TABLE IF NOT EXISTS platform_failed_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid REFERENCES tenants(id) ON DELETE RESTRICT,
  job_type varchar(80) NOT NULL, source_id varchar(255) NOT NULL, status varchar(20) NOT NULL DEFAULT 'FAILED',
  failure_code varchar(80) NOT NULL, safe_retry_kind varchar(80), attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz, last_failed_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(job_type,source_id)
);
CREATE INDEX IF NOT EXISTS platform_failed_jobs_status_attempt_idx ON platform_failed_jobs(status,next_attempt_at);
CREATE TABLE IF NOT EXISTS platform_support_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid REFERENCES tenants(id) ON DELETE RESTRICT,
  agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT, category varchar(30) NOT NULL,
  visibility varchar(30) NOT NULL DEFAULT 'AGENCY_ONLY' CHECK (visibility='AGENCY_ONLY'), note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_support_notes_tenant_created_idx ON platform_support_notes(tenant_id,created_at DESC);
CREATE TABLE IF NOT EXISTS platform_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid REFERENCES tenants(id) ON DELETE RESTRICT,
  severity varchar(20) NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')), status varchar(20) NOT NULL DEFAULT 'OPEN',
  title varchar(180) NOT NULL, summary text, started_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_incidents_status_severity_idx ON platform_incidents(status,severity);
CREATE INDEX IF NOT EXISTS platform_incidents_tenant_started_idx ON platform_incidents(tenant_id,started_at DESC);
CREATE TABLE IF NOT EXISTS agency_export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), requested_by_agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  export_type varchar(40) NOT NULL, filters_json jsonb NOT NULL DEFAULT '{}'::jsonb, status varchar(20) NOT NULL DEFAULT 'PENDING',
  storage_path varchar(500), row_count integer, expires_at timestamptz, requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz, failure_code varchar(80)
);
CREATE INDEX IF NOT EXISTS agency_export_jobs_status_requested_idx ON agency_export_jobs(status,requested_at);
CREATE INDEX IF NOT EXISTS agency_export_jobs_requested_by_idx ON agency_export_jobs(requested_by_agency_user_id);
CREATE TABLE IF NOT EXISTS tenant_activation_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  milestone_key varchar(60) NOT NULL, source_type varchar(40) NOT NULL, source_id varchar(255), achieved_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, UNIQUE(tenant_id,milestone_key)
);
CREATE INDEX IF NOT EXISTS tenant_activation_milestones_achieved_idx ON tenant_activation_milestones(milestone_key,achieved_at);
CREATE TABLE IF NOT EXISTS tenant_churn_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  plan_version_id uuid REFERENCES platform_plan_versions(id) ON DELETE RESTRICT, cancellation_at timestamptz NOT NULL,
  lifetime_days integer NOT NULL CHECK (lifetime_days >= 0), monthly_value_minor integer NOT NULL CHECK (monthly_value_minor >= 0),
  reason varchar(500) NOT NULL, competitor varchar(255), product_issue boolean NOT NULL DEFAULT false, service_issue boolean NOT NULL DEFAULT false,
  price_issue boolean NOT NULL DEFAULT false, business_closure boolean NOT NULL DEFAULT false, failed_payment boolean NOT NULL DEFAULT false,
  data_exported_at timestamptz, website_transfer_status varchar(80) NOT NULL DEFAULT 'NOT_STARTED',
  created_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tenant_churn_records_tenant_cancellation_idx ON tenant_churn_records(tenant_id,cancellation_at);
CREATE INDEX IF NOT EXISTS tenant_churn_records_cancellation_idx ON tenant_churn_records(cancellation_at);

INSERT INTO platform_plans(id,key,name) VALUES
 ('10000000-0000-4000-8000-000000000001','CORE','Core'),
 ('10000000-0000-4000-8000-000000000002','GROWTH','Growth'),
 ('10000000-0000-4000-8000-000000000003','SCALE','Scale') ON CONFLICT (key) DO NOTHING;
INSERT INTO platform_plan_versions(id,plan_id,version,name,status,monthly_price_minor,setup_fee_amount_minor,currency,effective_from,published_at) VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',1,'Core v1','ACTIVE',9700,29700,'GBP',now(),now()),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',1,'Growth v1','ACTIVE',29700,39700,'GBP',now(),now()),
 ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003',1,'Scale v1','ACTIVE',49700,69700,'GBP',now(),now()) ON CONFLICT (plan_id,version) DO NOTHING;
INSERT INTO platform_plan_entitlements(plan_version_id,entitlement_key,name,entitlement_type,availability,value_json) VALUES
 ('20000000-0000-4000-8000-000000000001','staff.limit','Active staff','QUANTITY','GENERALLY_AVAILABLE','{"limit":5}'),
 ('20000000-0000-4000-8000-000000000001','locations.limit','Active locations','QUANTITY','GENERALLY_AVAILABLE','{"limit":1}'),
 ('20000000-0000-4000-8000-000000000001','bookings.monthly','Monthly bookings','USAGE','GENERALLY_AVAILABLE','{"limit":500,"period":"MONTH"}'),
 ('20000000-0000-4000-8000-000000000001','automations.enabled','Automations','BOOLEAN','GENERALLY_AVAILABLE','{"enabled":false}'),
 ('20000000-0000-4000-8000-000000000001','analytics.advanced','Advanced analytics','BOOLEAN','GENERALLY_AVAILABLE','{"enabled":false}'),
 ('20000000-0000-4000-8000-000000000002','staff.limit','Active staff','QUANTITY','GENERALLY_AVAILABLE','{"limit":15}'),
 ('20000000-0000-4000-8000-000000000002','locations.limit','Active locations','QUANTITY','GENERALLY_AVAILABLE','{"limit":3}'),
 ('20000000-0000-4000-8000-000000000002','bookings.monthly','Monthly bookings','USAGE','GENERALLY_AVAILABLE','{"limit":2500,"period":"MONTH"}'),
 ('20000000-0000-4000-8000-000000000002','automations.enabled','Automations','BOOLEAN','GENERALLY_AVAILABLE','{"enabled":true}'),
 ('20000000-0000-4000-8000-000000000002','analytics.advanced','Advanced analytics','BOOLEAN','GENERALLY_AVAILABLE','{"enabled":true}'),
 ('20000000-0000-4000-8000-000000000003','staff.limit','Active staff','QUANTITY','GENERALLY_AVAILABLE','{"limit":100}'),
 ('20000000-0000-4000-8000-000000000003','locations.limit','Active locations','QUANTITY','GENERALLY_AVAILABLE','{"limit":20}'),
 ('20000000-0000-4000-8000-000000000003','bookings.monthly','Monthly bookings','USAGE','GENERALLY_AVAILABLE','{"limit":20000,"period":"MONTH"}'),
 ('20000000-0000-4000-8000-000000000003','automations.enabled','Automations','BOOLEAN','GENERALLY_AVAILABLE','{"enabled":true}'),
 ('20000000-0000-4000-8000-000000000003','analytics.advanced','Advanced analytics','BOOLEAN','GENERALLY_AVAILABLE','{"enabled":true}'),
 ('20000000-0000-4000-8000-000000000001','pos.enabled','Point of sale','BOOLEAN','GENERALLY_AVAILABLE','{"enabled":true}'),
 ('20000000-0000-4000-8000-000000000002','pos.enabled','Point of sale','BOOLEAN','GENERALLY_AVAILABLE','{"enabled":true}'),
 ('20000000-0000-4000-8000-000000000003','pos.enabled','Point of sale','BOOLEAN','GENERALLY_AVAILABLE','{"enabled":true}'),
 ('20000000-0000-4000-8000-000000000001','support.level','Support level','SERVICE_LEVEL','GENERALLY_AVAILABLE','{"level":"STANDARD"}'),
 ('20000000-0000-4000-8000-000000000002','support.level','Support level','SERVICE_LEVEL','GENERALLY_AVAILABLE','{"level":"PRIORITY"}'),
 ('20000000-0000-4000-8000-000000000003','support.level','Support level','SERVICE_LEVEL','GENERALLY_AVAILABLE','{"level":"STRATEGIC"}'),
 ('20000000-0000-4000-8000-000000000001','inventory.enabled','Inventory','BOOLEAN','UNAVAILABLE','{"enabled":false}'),
 ('20000000-0000-4000-8000-000000000002','inventory.enabled','Inventory','BOOLEAN','BETA','{"enabled":true}'),
 ('20000000-0000-4000-8000-000000000003','inventory.enabled','Inventory','BOOLEAN','BETA','{"enabled":true}')
ON CONFLICT (plan_version_id,entitlement_key) DO NOTHING;

-- Preserve existing customers while moving package enforcement to immutable assignments.
UPDATE tenants SET lifecycle_status=CASE WHEN is_active THEN 'ACTIVE' ELSE 'SUSPENDED' END,
  legal_business_name=COALESCE(legal_business_name,name)
WHERE lifecycle_status='PROSPECT';
INSERT INTO tenant_plan_assignments(tenant_id,plan_version_id,status,starts_at,reason)
SELECT t.id,CASE t.package_tier WHEN 'growth' THEN '20000000-0000-4000-8000-000000000002'::uuid WHEN 'scale' THEN '20000000-0000-4000-8000-000000000003'::uuid ELSE '20000000-0000-4000-8000-000000000001'::uuid END,
  'ACTIVE',t.created_at,'PHASE_12_LEGACY_BACKFILL'
FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM tenant_plan_assignments a WHERE a.tenant_id=t.id AND a.status='ACTIVE');
INSERT INTO tenant_billing_accounts(tenant_id)
SELECT t.id FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM tenant_billing_accounts b WHERE b.tenant_id=t.id);

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'agency_users','agency_sessions','agency_support_sessions','platform_audit_events','platform_plans','platform_plan_versions',
    'platform_plan_entitlements','tenant_plan_assignments','tenant_entitlement_overrides','tenant_entitlement_usage',
    'tenant_onboarding','tenant_onboarding_stages','tenant_launch_checks','tenant_billing_accounts','tenant_setup_payments',
    'tenant_subscriptions','tenant_subscription_events','tenant_price_exceptions','managed_deliverables','managed_deliverable_activity',
    'managed_deliverable_approvals','managed_service_time_entries','platform_failed_jobs','platform_support_notes','platform_incidents','agency_export_jobs',
    'tenant_activation_milestones','tenant_churn_records'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM anon, authenticated',table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO service_role',table_name);
  END LOOP;
END $$;
REVOKE UPDATE, DELETE ON platform_audit_events FROM service_role;
