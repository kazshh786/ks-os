-- System-created tasks retain AUTOMATION provenance without attributing creation to a human.
ALTER TABLE tasks ALTER COLUMN created_by_user_id DROP NOT NULL;
-- Additive orchestration metadata. Existing rules, events and history remain canonical.
ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS managed_template_key varchar(80);
ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS managed_template_version varchar(20);
CREATE UNIQUE INDEX IF NOT EXISTS automation_managed_template_unique ON automation_rules(tenant_id,managed_template_key) WHERE managed_template_key IS NOT NULL;
ALTER TABLE business_events ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE internal_notifications ADD COLUMN IF NOT EXISTS automation_action_run_id uuid REFERENCES automation_action_runs(id);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_automation_action_unique ON internal_notifications(automation_action_run_id) WHERE automation_action_run_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS automation_run_tenant_unique ON automation_runs(id,tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS automation_action_run_scope_unique ON automation_action_runs(id,automation_run_id,tenant_id);
CREATE TABLE IF NOT EXISTS automation_tenant_controls (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
 outbound_paused boolean NOT NULL DEFAULT false,
 emergency_stopped boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_autopilot_tenant_unique ON users(id,tenant_id);
CREATE TABLE IF NOT EXISTS automation_approval_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id), automation_run_id uuid NOT NULL,
 automation_action_run_id uuid NOT NULL UNIQUE,
 action_type varchar(60) NOT NULL CHECK(action_type='REVIEW_FOLLOW_UP'),
 status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED','EXPIRED','CANCELLED')),
 risk_level varchar(30) NOT NULL DEFAULT 'APPROVAL_REQUIRED' CHECK(risk_level='APPROVAL_REQUIRED'),
 title varchar(160) NOT NULL, reason varchar(300) NOT NULL,
 safe_preview_json jsonb NOT NULL,
 config_hash varchar(64) NOT NULL,
 requested_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 resolved_at timestamptz, resolved_by_user_id uuid REFERENCES users(id),
 FOREIGN KEY(resolved_by_user_id,tenant_id) REFERENCES users(id,tenant_id),
 FOREIGN KEY(automation_action_run_id,automation_run_id,tenant_id) REFERENCES automation_action_runs(id,automation_run_id,tenant_id),
 CHECK(expires_at>requested_at),
 CHECK(jsonb_typeof(safe_preview_json)='object' AND safe_preview_json - ARRAY['sourceType','sourceReference','effect'] = '{}'::jsonb AND coalesce(safe_preview_json->>'effect'='CREATE_FOLLOW_UP_TASK' AND safe_preview_json->>'sourceType' IN ('appointment','sales_opportunity','quote','work_item','task','client','form_assignment','payment','invoice') AND safe_preview_json->>'sourceReference' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',false))
);
CREATE INDEX IF NOT EXISTS automation_approvals_pending_idx ON automation_approval_requests(tenant_id,requested_at) WHERE status='PENDING';
CREATE INDEX IF NOT EXISTS automation_approvals_expiry_idx ON automation_approval_requests(expires_at) WHERE status IN ('PENDING','APPROVED');
CREATE INDEX IF NOT EXISTS automation_action_history_idx ON automation_action_runs(tenant_id,completed_at DESC);
CREATE INDEX IF NOT EXISTS automation_events_source_idx ON business_events(tenant_id,source_type,source_id,event_type);
CREATE INDEX IF NOT EXISTS autopilot_quote_waiting_idx ON sales_quotes(sent_at,id) WHERE status='SENT';
CREATE INDEX IF NOT EXISTS autopilot_task_due_idx ON tasks(due_at,id) WHERE status IN ('OPEN','IN_PROGRESS');
CREATE INDEX IF NOT EXISTS autopilot_work_due_idx ON work_items(due_at,id) WHERE status NOT IN ('COMPLETED','CANCELLED');
CREATE INDEX IF NOT EXISTS autopilot_form_due_idx ON form_assignments(created_at,id) WHERE status IN ('PENDING','OPENED');
CREATE INDEX IF NOT EXISTS autopilot_payment_failed_idx ON checkout_transactions(created_at,id) WHERE payment_status='FAILED';
CREATE INDEX IF NOT EXISTS autopilot_invoice_due_idx ON invoices(due_at,id) WHERE status='ISSUED';
ALTER TABLE automation_tenant_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_approval_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON automation_tenant_controls,automation_approval_requests FROM anon,authenticated;

-- Mutation capture is transactional, including writes from specialist services. No backfill.
-- The trigger constructs only identifiers; never serialize NEW into the event payload.
CREATE OR REPLACE FUNCTION autopilot_capture_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_name text; source_kind text; source_uuid uuid; source_tenant uuid; event_version text; category text;
BEGIN
 source_uuid:=NEW.id; source_tenant:=NEW.tenant_id;
 event_version:=txid_current()::text;
 CASE TG_TABLE_NAME
 WHEN 'clients' THEN
  source_kind:='client'; IF TG_OP='INSERT' THEN event_name:='CUSTOMER_CREATED'; END IF;
 WHEN 'client_sales_profiles' THEN
  source_kind:='client'; source_uuid:=NEW.client_id;
  IF TG_OP='INSERT' OR NEW.lifecycle IS DISTINCT FROM OLD.lifecycle THEN event_name:='CUSTOMER_LIFECYCLE_CHANGED'; END IF;
 WHEN 'sales_opportunities' THEN
  source_kind:='sales_opportunity';
  IF TG_OP='INSERT' THEN event_name:='OPPORTUNITY_CREATED';
  ELSIF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN event_name:='OPPORTUNITY_STAGE_CHANGED'; END IF;
  IF TG_OP='INSERT' OR NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
   SELECT s.category INTO category FROM sales_pipeline_stages s WHERE s.id=NEW.stage_id AND s.tenant_id=NEW.tenant_id;
   IF category IN ('WON','LOST') THEN
    INSERT INTO business_events(id,tenant_id,event_type,source_type,source_id,payload_json,occurred_at)
    VALUES('OPPORTUNITY_'||category||':'||source_uuid||':'||event_version,source_tenant,'OPPORTUNITY_'||category,source_kind,source_uuid,'{"version":1}',now()) ON CONFLICT DO NOTHING;
   END IF;
  END IF;
 WHEN 'sales_quotes' THEN
  source_kind:='quote';
  IF TG_OP='INSERT' THEN event_name:='QUOTE_CREATED';
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('SENT','ACCEPTED','DECLINED','EXPIRED') THEN event_name:='QUOTE_'||NEW.status; END IF;
 WHEN 'work_items' THEN
  source_kind:='work_item';
  IF TG_OP='INSERT' THEN event_name:='WORK_CREATED';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
   event_name:=CASE WHEN OLD.status IN ('COMPLETED','CANCELLED') THEN 'WORK_REOPENED' WHEN NEW.status='IN_PROGRESS' THEN 'WORK_STARTED' ELSE 'WORK_'||NEW.status END;
  END IF;
 WHEN 'tasks' THEN
  source_kind:='task';
  IF TG_OP='INSERT' THEN event_name:='TASK_CREATED';
  ELSIF NEW.status='COMPLETED' AND NEW.status IS DISTINCT FROM OLD.status THEN event_name:='TASK_COMPLETED'; END IF;
 WHEN 'form_assignments' THEN
  source_kind:='form_assignment';
  IF TG_OP='UPDATE' AND NEW.status='OPENED' AND NEW.status IS DISTINCT FROM OLD.status THEN event_name:='FORM_OPENED'; END IF;
 WHEN 'checkout_transactions' THEN
  source_kind:='payment';
  IF TG_OP='INSERT' OR NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
   IF NEW.payment_status='FAILED' THEN event_name:='PAYMENT_FAILED'; END IF;
  END IF;
 WHEN 'appointments' THEN
  source_kind:='appointment';
  IF TG_OP='UPDATE' AND NEW.status='NO_SHOW' AND NEW.status IS DISTINCT FROM OLD.status THEN event_name:='APPOINTMENT_NO_SHOW'; END IF;
 WHEN 'review_invitations' THEN
  source_kind:='appointment'; source_uuid:=NEW.appointment_id; event_version:=NEW.id::text;
  IF TG_OP='INSERT' AND NEW.status='SCHEDULED' THEN event_name:='REVIEW_REQUEST_SCHEDULED';
  ELSIF TG_OP='UPDATE' AND NEW.sent_at IS NOT NULL AND OLD.sent_at IS NULL THEN event_name:='REVIEW_REQUEST_SENT';
  ELSIF TG_OP='UPDATE' AND NEW.confirmed_review_at IS NOT NULL AND OLD.confirmed_review_at IS NULL THEN event_name:='REVIEW_RECEIVED'; END IF;
 WHEN 'invoice_activity' THEN
  source_kind:='invoice'; source_uuid:=NEW.invoice_id; event_version:=NEW.id::text;
  IF NEW.activity_type IN ('ISSUED','PARTIALLY_PAID','PAID') THEN event_name:='INVOICE_'||NEW.activity_type; END IF;
 ELSE RAISE EXCEPTION 'Unsupported autopilot source';
 END CASE;
 IF event_name IS NOT NULL THEN
  INSERT INTO business_events(id,tenant_id,event_type,source_type,source_id,payload_json,occurred_at)
  VALUES(event_name||':'||source_uuid||':'||event_version,source_tenant,event_name,source_kind,source_uuid,'{"version":1}',now()) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['clients','client_sales_profiles','sales_opportunities','sales_quotes','work_items','tasks','form_assignments','checkout_transactions','appointments','invoice_activity','review_invitations'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS autopilot_capture ON %I',name);
  EXECUTE format('CREATE TRIGGER autopilot_capture AFTER INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION autopilot_capture_mutation()',name);
 END LOOP;
END $$;
