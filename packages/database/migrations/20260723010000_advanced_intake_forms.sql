-- Advanced intake forms: additive and backwards-compatible with existing published versions.
ALTER TABLE forms ADD COLUMN IF NOT EXISTS internal_description text NOT NULL DEFAULT '';
ALTER TABLE forms ADD COLUMN IF NOT EXISTS form_type varchar(40) NOT NULL DEFAULT 'CUSTOM';
ALTER TABLE forms ADD COLUMN IF NOT EXISTS default_language varchar(12) NOT NULL DEFAULT 'en-GB';
ALTER TABLE forms ADD COLUMN IF NOT EXISTS supported_languages text[] NOT NULL DEFAULT ARRAY['en-GB'];
ALTER TABLE forms ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}';
ALTER TABLE forms ADD COLUMN IF NOT EXISTS theme_json jsonb NOT NULL DEFAULT '{}';
ALTER TABLE forms ADD COLUMN IF NOT EXISTS public_slug varchar(120);
ALTER TABLE forms ADD COLUMN IF NOT EXISTS category varchar(80);
ALTER TABLE forms ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE forms ADD COLUMN IF NOT EXISTS updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE forms ADD COLUMN IF NOT EXISTS draft_revision integer NOT NULL DEFAULT 1;
ALTER TABLE forms ADD COLUMN IF NOT EXISTS published_version_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS forms_tenant_public_slug_unique ON forms(tenant_id,public_slug) WHERE public_slug IS NOT NULL;

ALTER TABLE form_versions ADD COLUMN IF NOT EXISTS theme_snapshot jsonb NOT NULL DEFAULT '{}';
ALTER TABLE form_versions ADD COLUMN IF NOT EXISTS logic_snapshot jsonb NOT NULL DEFAULT '[]';
ALTER TABLE form_versions ADD COLUMN IF NOT EXISTS validation_snapshot jsonb NOT NULL DEFAULT '{}';
ALTER TABLE form_versions ADD COLUMN IF NOT EXISTS settings_snapshot jsonb NOT NULL DEFAULT '{}';
ALTER TABLE form_versions ADD COLUMN IF NOT EXISTS change_summary varchar(1000);
ALTER TABLE form_versions ADD COLUMN IF NOT EXISTS previous_version_id uuid REFERENCES form_versions(id) ON DELETE RESTRICT;
DO $$ BEGIN ALTER TABLE forms ADD CONSTRAINT forms_published_version_fk FOREIGN KEY(published_version_id) REFERENCES form_versions(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE client_form_submissions ADD COLUMN IF NOT EXISTS status varchar(30) NOT NULL DEFAULT 'SUBMITTED';
ALTER TABLE client_form_submissions ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE client_form_submissions ADD COLUMN IF NOT EXISTS reviewed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE client_form_submissions ADD COLUMN IF NOT EXISTS review_notes text;
ALTER TABLE client_form_submissions ADD COLUMN IF NOT EXISTS review_flags jsonb NOT NULL DEFAULT '[]';
ALTER TABLE client_form_submissions ADD COLUMN IF NOT EXISTS completion_percentage integer NOT NULL DEFAULT 100;
ALTER TABLE client_form_submissions ADD COLUMN IF NOT EXISTS language varchar(12) NOT NULL DEFAULT 'en-GB';
ALTER TABLE client_form_submissions ADD COLUMN IF NOT EXISTS timezone varchar(100);
ALTER TABLE client_form_submissions ADD COLUMN IF NOT EXISTS tracking_parameters jsonb NOT NULL DEFAULT '{}';

CREATE TABLE form_submission_drafts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 assignment_id uuid NOT NULL UNIQUE REFERENCES form_assignments(id) ON DELETE CASCADE, form_version_id uuid NOT NULL REFERENCES form_versions(id) ON DELETE RESTRICT,
 resume_token_hash varchar(64) NOT NULL UNIQUE, answers_json jsonb NOT NULL DEFAULT '{}', current_page integer NOT NULL DEFAULT 0,
 completion_percentage integer NOT NULL DEFAULT 0, revision integer NOT NULL DEFAULT 1, language varchar(12) NOT NULL DEFAULT 'en-GB', timezone varchar(100),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), last_saved_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
 CONSTRAINT form_draft_completion_check CHECK(completion_percentage BETWEEN 0 AND 100)
);
CREATE INDEX form_submission_drafts_expiry_idx ON form_submission_drafts(expires_at) WHERE revoked_at IS NULL;

CREATE TABLE form_submission_answers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), submission_id uuid NOT NULL REFERENCES client_form_submissions(id) ON DELETE CASCADE,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, field_id uuid NOT NULL, field_key varchar(120) NOT NULL,
 field_version integer NOT NULL DEFAULT 1, answer_type varchar(40) NOT NULL, value_json jsonb, display_value text,
 validation_state varchar(20) NOT NULL DEFAULT 'VALID', sensitive_classification varchar(30) NOT NULL DEFAULT 'STANDARD',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(submission_id,field_key)
);

CREATE TABLE form_submission_files(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 assignment_id uuid NOT NULL REFERENCES form_assignments(id) ON DELETE CASCADE, submission_id uuid REFERENCES client_form_submissions(id) ON DELETE CASCADE,
 field_key varchar(120) NOT NULL, storage_path varchar(1000) NOT NULL UNIQUE, original_name varchar(255) NOT NULL,
 safe_content_type varchar(100) NOT NULL, byte_size integer NOT NULL, checksum_sha256 varchar(64) NOT NULL,
 scan_status varchar(20) NOT NULL DEFAULT 'PENDING', created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
 CONSTRAINT form_file_size_check CHECK(byte_size BETWEEN 1 AND 10485760)
);

CREATE TABLE form_templates(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE, name varchar(160) NOT NULL,
 category varchar(80) NOT NULL, description text NOT NULL DEFAULT '', schema_json jsonb NOT NULL, theme_json jsonb NOT NULL DEFAULT '{}',
 version integer NOT NULL DEFAULT 1, is_system boolean NOT NULL DEFAULT false, created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX form_templates_catalog_idx ON form_templates(tenant_id,is_system,category,name);

CREATE TABLE form_analytics_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE, form_version_id uuid REFERENCES form_versions(id) ON DELETE SET NULL,
 assignment_id uuid REFERENCES form_assignments(id) ON DELETE SET NULL, event_type varchar(40) NOT NULL, page_id varchar(120), field_key varchar(120),
 device_type varchar(20), source varchar(100), campaign varchar(100), language varchar(12), duration_ms integer,
 occurred_at timestamptz NOT NULL DEFAULT now(), metadata jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX form_analytics_rollup_idx ON form_analytics_events(tenant_id,form_id,form_version_id,event_type,occurred_at);

ALTER TABLE form_submission_drafts ENABLE ROW LEVEL SECURITY; ALTER TABLE form_submission_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_submission_files ENABLE ROW LEVEL SECURITY; ALTER TABLE form_templates ENABLE ROW LEVEL SECURITY; ALTER TABLE form_analytics_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON form_submission_drafts,form_submission_answers,form_submission_files,form_templates,form_analytics_events FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON form_submission_drafts,form_submission_answers,form_submission_files,form_templates,form_analytics_events TO service_role;

CREATE OR REPLACE FUNCTION prevent_published_form_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Published form versions are immutable' USING ERRCODE='55000'; END $$;
DROP TRIGGER IF EXISTS form_versions_immutable ON form_versions;
CREATE TRIGGER form_versions_immutable BEFORE UPDATE OR DELETE ON form_versions FOR EACH ROW EXECUTE FUNCTION prevent_published_form_version_mutation();
