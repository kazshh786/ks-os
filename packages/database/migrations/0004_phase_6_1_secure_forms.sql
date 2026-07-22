-- Reviewed additive Phase 6.1 migration. Do not apply automatically to production.
ALTER TABLE forms ADD COLUMN IF NOT EXISTS description text DEFAULT '' NOT NULL;
ALTER TABLE forms ADD COLUMN IF NOT EXISTS acknowledgement_text text DEFAULT '' NOT NULL;
ALTER TABLE forms ADD COLUMN IF NOT EXISTS status varchar(20) DEFAULT 'DRAFT' NOT NULL CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED'));
ALTER TABLE forms ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(id) ON DELETE set null;
ALTER TABLE forms ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE TABLE IF NOT EXISTS form_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE cascade,
 form_id uuid NOT NULL REFERENCES forms(id) ON DELETE restrict, version_number integer NOT NULL CHECK (version_number > 0),
 title_snapshot varchar(255) NOT NULL, description_snapshot text DEFAULT '' NOT NULL, schema_json jsonb NOT NULL,
 acknowledgement_text text NOT NULL, created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE restrict,
 created_at timestamptz DEFAULT now() NOT NULL, published_at timestamptz DEFAULT now() NOT NULL,
 CONSTRAINT form_versions_form_version_unique UNIQUE(form_id, version_number)
);

CREATE TABLE IF NOT EXISTS form_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE cascade,
 form_id uuid NOT NULL REFERENCES forms(id) ON DELETE restrict, form_version_id uuid NOT NULL REFERENCES form_versions(id) ON DELETE restrict,
 client_id uuid NOT NULL REFERENCES clients(id) ON DELETE restrict, appointment_id uuid REFERENCES appointments(id) ON DELETE set null,
 status varchar(20) DEFAULT 'PENDING' NOT NULL CHECK (status IN ('PENDING','OPENED','SUBMITTED','EXPIRED','CANCELLED')),
 public_token_hash varchar(64) NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
 assigned_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE restrict, created_at timestamptz DEFAULT now() NOT NULL,
 opened_at timestamptz, submitted_at timestamptz, cancelled_at timestamptz, updated_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE client_form_submissions ADD COLUMN IF NOT EXISTS assignment_id uuid REFERENCES form_assignments(id) ON DELETE restrict;
ALTER TABLE client_form_submissions ADD COLUMN IF NOT EXISTS form_version_id uuid REFERENCES form_versions(id) ON DELETE restrict;
ALTER TABLE client_form_submissions ADD COLUMN IF NOT EXISTS appointment_id uuid REFERENCES appointments(id) ON DELETE set null;
ALTER TABLE client_form_submissions ADD COLUMN IF NOT EXISTS acknowledgement_name varchar(255);
ALTER TABLE client_form_submissions ADD COLUMN IF NOT EXISTS acknowledgement_accepted boolean DEFAULT false NOT NULL;
ALTER TABLE client_form_submissions ADD COLUMN IF NOT EXISTS acknowledgement_text text;
ALTER TABLE client_form_submissions ADD COLUMN IF NOT EXISTS submitted_from varchar(30) DEFAULT 'PUBLIC_LINK' NOT NULL;
ALTER TABLE client_form_submissions ADD COLUMN IF NOT EXISTS idempotency_key uuid;
ALTER TABLE client_form_submissions ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now() NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS client_form_submissions_assignment_unique ON client_form_submissions(assignment_id) WHERE assignment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS client_form_submissions_idempotency_unique ON client_form_submissions(assignment_id,idempotency_key) WHERE assignment_id IS NOT NULL AND idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS form_assignments_active_appointment_unique ON form_assignments(form_version_id,appointment_id) WHERE appointment_id IS NOT NULL AND status IN ('PENDING','OPENED','SUBMITTED');
CREATE INDEX IF NOT EXISTS forms_tenant_status_idx ON forms(tenant_id,status);
CREATE INDEX IF NOT EXISTS form_versions_tenant_form_idx ON form_versions(tenant_id,form_id,version_number DESC);
CREATE INDEX IF NOT EXISTS form_assignments_tenant_status_idx ON form_assignments(tenant_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS client_form_submissions_tenant_created_idx ON client_form_submissions(tenant_id,created_at DESC);

CREATE OR REPLACE FUNCTION prevent_form_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'published form versions are immutable'; END $$;
DROP TRIGGER IF EXISTS form_versions_immutable ON form_versions;
CREATE TRIGGER form_versions_immutable BEFORE UPDATE OR DELETE ON form_versions FOR EACH ROW EXECUTE FUNCTION prevent_form_version_mutation();

ALTER TABLE forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_form_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON form_versions, form_assignments, client_form_submissions FROM anon, authenticated;
