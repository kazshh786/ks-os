-- Universal Work / Jobs foundation.
-- Additive only: existing bookings, tasks, CRM, sales and payment data are untouched.

CREATE TABLE IF NOT EXISTS work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reference_number varchar(40) NOT NULL,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  work_type varchar(20) NOT NULL DEFAULT 'JOB',
  status varchar(20) NOT NULL DEFAULT 'DRAFT',
  priority varchar(20) NOT NULL DEFAULT 'NORMAL',
  title varchar(255) NOT NULL,
  description text,
  assigned_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  source_opportunity_id uuid REFERENCES sales_opportunities(id) ON DELETE SET NULL,
  source_quote_id uuid REFERENCES sales_quotes(id) ON DELETE SET NULL,
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  due_at timestamptz,
  location_label varchar(500),
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  blocked_reason text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_items_work_type_check CHECK (work_type IN ('JOB','PROJECT','DELIVERY','CASE','ORDER')),
  CONSTRAINT work_items_status_check CHECK (status IN ('DRAFT','READY','IN_PROGRESS','BLOCKED','COMPLETED','CANCELLED')),
  CONSTRAINT work_items_priority_check CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  CONSTRAINT work_items_schedule_check CHECK (scheduled_end_at IS NULL OR scheduled_start_at IS NULL OR scheduled_end_at >= scheduled_start_at),
  CONSTRAINT work_items_tenant_reference_number_unique UNIQUE (tenant_id, reference_number),
  CONSTRAINT work_items_tenant_source_opportunity_unique UNIQUE (tenant_id, source_opportunity_id)
);

CREATE INDEX IF NOT EXISTS work_items_tenant_status_updated_idx ON work_items(tenant_id, status, updated_at, id);
CREATE INDEX IF NOT EXISTS work_items_tenant_assignee_status_idx ON work_items(tenant_id, assigned_user_id, status);
CREATE INDEX IF NOT EXISTS work_items_tenant_client_idx ON work_items(tenant_id, client_id);
CREATE INDEX IF NOT EXISTS work_items_tenant_due_idx ON work_items(tenant_id, due_at);

CREATE TABLE IF NOT EXISTS work_item_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  work_item_id uuid NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  activity_type varchar(40) NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  from_value text,
  to_value text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_item_activity_type_check CHECK (activity_type IN (
    'CREATED','CONVERTED_FROM_SALE','STATUS_CHANGED','ASSIGNED','REASSIGNED',
    'SCHEDULE_CHANGED','DUE_DATE_CHANGED','PRIORITY_CHANGED','TASK_CREATED',
    'COMPLETED','REOPENED','CANCELLED'
  ))
);

CREATE INDEX IF NOT EXISTS work_item_activity_work_created_idx ON work_item_activity(tenant_id, work_item_id, created_at);

CREATE TABLE IF NOT EXISTS work_task_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  work_item_id uuid NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_task_links_task_unique UNIQUE (task_id)
);

CREATE INDEX IF NOT EXISTS work_task_links_tenant_work_idx ON work_task_links(tenant_id, work_item_id);

COMMENT ON TABLE work_items IS 'Universal tenant-scoped execution records used for jobs, projects, deliveries, cases and orders.';
COMMENT ON COLUMN work_items.source_opportunity_id IS 'Optional Sales provenance; at most one work record is created from an opportunity per tenant.';
COMMENT ON TABLE work_task_links IS 'FK-backed projection linking canonical tasks to universal work items; task source_type/source_id remain authoritative.';
