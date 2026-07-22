CREATE TABLE IF NOT EXISTS tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,title varchar(180) NOT NULL,description text,notes text,
 status varchar(20) NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','IN_PROGRESS','COMPLETED','CANCELLED')),priority varchar(20) NOT NULL DEFAULT 'NORMAL' CHECK(priority IN('LOW','NORMAL','HIGH','URGENT')),
 assigned_user_id uuid REFERENCES users(id) ON DELETE SET NULL,created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,due_at timestamptz,completed_at timestamptz,completed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 cancelled_at timestamptz,cancelled_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,source_type varchar(30) NOT NULL DEFAULT 'MANUAL' CHECK(source_type IN('MANUAL','OPERATIONS_ISSUE','APPOINTMENT','CLIENT','FORM_ASSIGNMENT','PAYMENT','REFUND','AUTOMATION','PRODUCT')),
 source_id uuid,deduplication_key varchar(255),appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,client_id uuid REFERENCES clients(id) ON DELETE SET NULL,operations_issue_id uuid REFERENCES operations_issues(id) ON DELETE SET NULL,
 form_assignment_id uuid REFERENCES form_assignments(id) ON DELETE SET NULL,automation_run_id uuid REFERENCES automation_runs(id) ON DELETE SET NULL,overdue_notified_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT tasks_tenant_dedup_unique UNIQUE(tenant_id,deduplication_key)
);
CREATE TABLE IF NOT EXISTS task_activity (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,activity_type varchar(30) NOT NULL CHECK(activity_type IN('CREATED','ASSIGNED','REASSIGNED','STARTED','COMPLETED','REOPENED','CANCELLED','DUE_DATE_CHANGED','PRIORITY_CHANGED')),actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,from_value varchar(255),to_value varchar(255),created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS tasks_tenant_status_updated_idx ON tasks(tenant_id,status,updated_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS tasks_tenant_assignee_status_due_idx ON tasks(tenant_id,assigned_user_id,status,due_at);
CREATE INDEX IF NOT EXISTS tasks_actionable_due_idx ON tasks(tenant_id,due_at) WHERE status IN('OPEN','IN_PROGRESS') AND due_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_appointment_idx ON tasks(appointment_id);CREATE INDEX IF NOT EXISTS tasks_client_idx ON tasks(client_id);CREATE INDEX IF NOT EXISTS tasks_operations_issue_idx ON tasks(operations_issue_id);CREATE INDEX IF NOT EXISTS tasks_form_assignment_idx ON tasks(form_assignment_id);CREATE INDEX IF NOT EXISTS tasks_automation_run_idx ON tasks(automation_run_id);
CREATE INDEX IF NOT EXISTS task_activity_task_created_idx ON task_activity(task_id,created_at);CREATE INDEX IF NOT EXISTS task_activity_tenant_idx ON task_activity(tenant_id);
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;ALTER TABLE task_activity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tasks,task_activity FROM anon,authenticated;
COMMENT ON TABLE tasks IS 'Private server-only tenant operational tasks.';COMMENT ON TABLE task_activity IS 'Immutable server-only task lifecycle history.';
