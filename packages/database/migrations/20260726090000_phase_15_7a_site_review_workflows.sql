-- Phase 15.7A: Site Studio backend and controlled review workflows.
-- Additive only. This migration does not publish a site or invoke infrastructure.

ALTER TABLE site_render_snapshots
  ADD COLUMN IF NOT EXISTS source_content_digest_sha256 varchar(64);
ALTER TABLE site_render_snapshots
  ADD CONSTRAINT site_render_snapshots_source_digest_check
  CHECK (
    source_content_digest_sha256 IS NULL
    OR source_content_digest_sha256 ~ '^[a-f0-9]{64}$'
  ) NOT VALID;
ALTER TABLE site_render_snapshots
  VALIDATE CONSTRAINT site_render_snapshots_source_digest_check;
CREATE INDEX IF NOT EXISTS site_render_snapshots_version_kind_source_digest_idx
  ON site_render_snapshots(site_version_id, snapshot_kind, source_content_digest_sha256);

CREATE TABLE IF NOT EXISTS site_review_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  site_version_id uuid NOT NULL REFERENCES site_versions(id) ON DELETE RESTRICT,
  generation_run_id uuid REFERENCES site_generation_runs(id) ON DELETE RESTRICT,
  blueprint_id uuid REFERENCES site_blueprints(id) ON DELETE RESTRICT,
  blueprint_revision integer,
  template_version_id uuid REFERENCES template_versions(id) ON DELETE RESTRICT,
  knowledge_pack_id uuid REFERENCES knowledge_packs(id) ON DELETE RESTRICT,
  knowledge_pack_semantic_version text,
  pinned_content_digest_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN (
      'DRAFT','INTERNAL_REVIEW','INTERNAL_CHANGES_REQUIRED',
      'READY_FOR_CLIENT_REVIEW','CLIENT_REVIEW','CLIENT_CHANGES_REQUESTED',
      'CLIENT_APPROVED','AGENCY_FINAL_REVIEW','AGENCY_APPROVED',
      'REJECTED','CANCELLED','SUPERSEDED'
    )),
  review_scope text NOT NULL
    CHECK (review_scope IN (
      'FULL_SITE','PAGE','SECTION','FACTS_ONLY','COPY_ONLY',
      'DESIGN_AND_STRUCTURE','FINAL_APPROVAL'
    )),
  scoped_page_id uuid REFERENCES site_pages(id) ON DELETE RESTRICT,
  scoped_section_id uuid REFERENCES site_sections(id) ON DELETE RESTRICT,
  review_revision integer NOT NULL DEFAULT 1 CHECK (review_revision > 0),
  agency_owner_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  client_approval_required boolean NOT NULL DEFAULT true,
  agency_approval_required boolean NOT NULL DEFAULT true,
  opened_at timestamptz,
  client_review_started_at timestamptz,
  client_approved_at timestamptz,
  agency_approved_at timestamptz,
  rejected_at timestamptz,
  cancelled_at timestamptz,
  superseded_at timestamptz,
  created_by_agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_version_id, review_revision),
  CHECK (pinned_content_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (
    (review_scope = 'PAGE' AND scoped_page_id IS NOT NULL AND scoped_section_id IS NULL)
    OR (review_scope = 'SECTION' AND scoped_page_id IS NOT NULL AND scoped_section_id IS NOT NULL)
    OR (review_scope NOT IN ('PAGE','SECTION') AND scoped_page_id IS NULL AND scoped_section_id IS NULL)
  ),
  CHECK (
    generation_run_id IS NULL
    OR (
      blueprint_id IS NOT NULL
      AND blueprint_revision IS NOT NULL
      AND template_version_id IS NOT NULL
      AND knowledge_pack_id IS NOT NULL
      AND knowledge_pack_semantic_version IS NOT NULL
    )
  )
);
CREATE INDEX IF NOT EXISTS site_review_cycles_tenant_site_status_idx
  ON site_review_cycles(tenant_id, site_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS site_review_cycles_version_idx
  ON site_review_cycles(site_version_id, review_revision DESC);
CREATE INDEX IF NOT EXISTS site_review_cycles_generation_run_idx
  ON site_review_cycles(generation_run_id);
CREATE INDEX IF NOT EXISTS site_review_cycles_blueprint_idx
  ON site_review_cycles(blueprint_id);
CREATE INDEX IF NOT EXISTS site_review_cycles_template_version_idx
  ON site_review_cycles(template_version_id);
CREATE INDEX IF NOT EXISTS site_review_cycles_knowledge_pack_idx
  ON site_review_cycles(knowledge_pack_id);
CREATE INDEX IF NOT EXISTS site_review_cycles_owner_idx
  ON site_review_cycles(agency_owner_user_id);
CREATE INDEX IF NOT EXISTS site_review_cycles_created_by_idx
  ON site_review_cycles(created_by_agency_user_id);
CREATE INDEX IF NOT EXISTS site_review_cycles_scoped_page_idx
  ON site_review_cycles(scoped_page_id);
CREATE INDEX IF NOT EXISTS site_review_cycles_scoped_section_idx
  ON site_review_cycles(scoped_section_id);

CREATE TABLE IF NOT EXISTS site_review_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  review_cycle_id uuid NOT NULL REFERENCES site_review_cycles(id) ON DELETE RESTRICT,
  participant_type text NOT NULL
    CHECK (participant_type IN ('AGENCY_USER','TENANT_USER','EXTERNAL_REVIEWER')),
  agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  tenant_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  contact_reference uuid,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 160),
  email_normalized text NOT NULL CHECK (char_length(email_normalized) BETWEEN 3 AND 320),
  role text NOT NULL
    CHECK (role IN (
      'AGENCY_OWNER','AGENCY_REVIEWER','CLIENT_APPROVER',
      'CLIENT_REVIEWER','FACT_VERIFIER','VIEW_ONLY'
    )),
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('INVITED','ACTIVE','REVOKED')),
  invited_at timestamptz,
  accepted_at timestamptz,
  last_accessed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(review_cycle_id, email_normalized, role),
  CHECK (
    (participant_type = 'AGENCY_USER' AND agency_user_id IS NOT NULL AND tenant_user_id IS NULL)
    OR (participant_type = 'TENANT_USER' AND tenant_user_id IS NOT NULL AND agency_user_id IS NULL)
    OR (participant_type = 'EXTERNAL_REVIEWER' AND agency_user_id IS NULL AND tenant_user_id IS NULL)
  ),
  CHECK (
    (participant_type = 'AGENCY_USER' AND role IN ('AGENCY_OWNER','AGENCY_REVIEWER'))
    OR (
      participant_type IN ('TENANT_USER','EXTERNAL_REVIEWER')
      AND role IN ('CLIENT_APPROVER','CLIENT_REVIEWER','FACT_VERIFIER','VIEW_ONLY')
    )
  )
);
CREATE INDEX IF NOT EXISTS site_review_participants_cycle_status_idx
  ON site_review_participants(review_cycle_id, status, role);
CREATE INDEX IF NOT EXISTS site_review_participants_agency_user_idx
  ON site_review_participants(agency_user_id);
CREATE INDEX IF NOT EXISTS site_review_participants_tenant_user_idx
  ON site_review_participants(tenant_user_id);

CREATE TABLE IF NOT EXISTS site_review_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  review_cycle_id uuid NOT NULL REFERENCES site_review_cycles(id) ON DELETE RESTRICT,
  target_type text NOT NULL
    CHECK (target_type IN (
      'SITE','PAGE','SECTION','FIELD','METADATA','NAVIGATION',
      'BOOKING_ACTION','STRUCTURED_DATA_INPUT','FACT','GENERATION_FINDING'
    )),
  page_id uuid REFERENCES site_pages(id) ON DELETE RESTRICT,
  section_id uuid REFERENCES site_sections(id) ON DELETE RESTRICT,
  generation_finding_id uuid REFERENCES site_generation_findings(id) ON DELETE RESTRICT,
  field_path text CHECK (field_path IS NULL OR (char_length(field_path) BETWEEN 1 AND 500 AND field_path ~ '^[A-Za-z0-9_.\[\]-]+$')),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN (
      'PENDING','IN_REVIEW','COMMENTED','CHANGE_REQUESTED',
      'APPROVED','REJECTED','NOT_APPLICABLE','SUPERSEDED'
    )),
  required_reviewer_type text
    CHECK (required_reviewer_type IS NULL OR required_reviewer_type IN ('AGENCY','CLIENT','FACT_VERIFIER')),
  blocking boolean NOT NULL DEFAULT false,
  client_visible boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(review_cycle_id, target_type, page_id, section_id, field_path, generation_finding_id)
);
CREATE INDEX IF NOT EXISTS site_review_items_cycle_status_idx
  ON site_review_items(review_cycle_id, status, blocking, display_order);
CREATE INDEX IF NOT EXISTS site_review_items_page_idx ON site_review_items(page_id);
CREATE INDEX IF NOT EXISTS site_review_items_section_idx ON site_review_items(section_id);
CREATE INDEX IF NOT EXISTS site_review_items_finding_idx ON site_review_items(generation_finding_id);

CREATE TABLE IF NOT EXISTS site_review_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  review_cycle_id uuid NOT NULL REFERENCES site_review_cycles(id) ON DELETE RESTRICT,
  review_item_id uuid REFERENCES site_review_items(id) ON DELETE RESTRICT,
  page_id uuid REFERENCES site_pages(id) ON DELETE RESTRICT,
  section_id uuid REFERENCES site_sections(id) ON DELETE RESTRICT,
  field_path text CHECK (field_path IS NULL OR (char_length(field_path) BETWEEN 1 AND 500 AND field_path ~ '^[A-Za-z0-9_.\[\]-]+$')),
  author_type text NOT NULL
    CHECK (author_type IN ('AGENCY_USER','TENANT_USER','EXTERNAL_REVIEWER')),
  agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  tenant_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  participant_id uuid REFERENCES site_review_participants(id) ON DELETE RESTRICT,
  body text NOT NULL CHECK (
    char_length(body) BETWEEN 1 AND 2000
    AND position('<' IN body) = 0
    AND lower(body) !~ '(javascript[[:space:]]*:|data[[:space:]]*:[[:space:]]*text/html|vbscript[[:space:]]*:|[[:<:]](script|iframe|object|embed)[[:>:]])'
  ),
  visibility text NOT NULL DEFAULT 'CLIENT_VISIBLE'
    CHECK (visibility IN ('INTERNAL','CLIENT_VISIBLE')),
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','RESOLVED','DISMISSED','DELETED')),
  parent_comment_id uuid REFERENCES site_review_comments(id) ON DELETE RESTRICT,
  anchor_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  anchor_status text NOT NULL DEFAULT 'CURRENT'
    CHECK (anchor_status IN ('CURRENT','OUTDATED','REQUIRES_REANCHOR')),
  resolved_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  resolved_by_participant_id uuid REFERENCES site_review_participants(id) ON DELETE RESTRICT,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (
    (author_type = 'AGENCY_USER' AND agency_user_id IS NOT NULL)
    OR (author_type = 'TENANT_USER' AND tenant_user_id IS NOT NULL AND participant_id IS NOT NULL)
    OR (author_type = 'EXTERNAL_REVIEWER' AND participant_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS site_review_comments_cycle_status_idx
  ON site_review_comments(review_cycle_id, status, created_at);
CREATE INDEX IF NOT EXISTS site_review_comments_item_idx ON site_review_comments(review_item_id);
CREATE INDEX IF NOT EXISTS site_review_comments_page_idx ON site_review_comments(page_id);
CREATE INDEX IF NOT EXISTS site_review_comments_section_idx ON site_review_comments(section_id);
CREATE INDEX IF NOT EXISTS site_review_comments_parent_idx ON site_review_comments(parent_comment_id);
CREATE INDEX IF NOT EXISTS site_review_comments_participant_idx ON site_review_comments(participant_id);
CREATE INDEX IF NOT EXISTS site_review_comments_agency_user_idx ON site_review_comments(agency_user_id);
CREATE INDEX IF NOT EXISTS site_review_comments_tenant_user_idx ON site_review_comments(tenant_user_id);
CREATE INDEX IF NOT EXISTS site_review_comments_resolved_agency_user_idx
  ON site_review_comments(resolved_by_agency_user_id);
CREATE INDEX IF NOT EXISTS site_review_comments_resolved_participant_idx
  ON site_review_comments(resolved_by_participant_id);

-- Extend the existing change-request aggregate. Historical rows remain valid.
ALTER TABLE site_change_requests
  ADD COLUMN IF NOT EXISTS review_cycle_id uuid REFERENCES site_review_cycles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS review_item_id uuid REFERENCES site_review_items(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS section_id uuid REFERENCES site_sections(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS field_path text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN IF NOT EXISTS requested_outcome text,
  ADD COLUMN IF NOT EXISTS submitted_by_type text,
  ADD COLUMN IF NOT EXISTS submitted_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS submitted_by_participant_id uuid REFERENCES site_review_participants(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS assigned_to_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS resolution_type text,
  ADD COLUMN IF NOT EXISTS resulting_site_version_id uuid REFERENCES site_versions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS resulting_page_id uuid REFERENCES site_pages(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS resulting_section_id uuid REFERENCES site_sections(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS regeneration_job_id uuid REFERENCES site_jobs(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

ALTER TABLE site_change_requests ALTER COLUMN requested_by_tenant_user_id DROP NOT NULL;
ALTER TABLE site_change_requests DROP CONSTRAINT IF EXISTS site_change_requests_status_check;
ALTER TABLE site_change_requests ADD CONSTRAINT site_change_requests_status_check
  CHECK (status IN (
    'SUBMITTED','OPEN','TRIAGED','ACCEPTED','IN_PROGRESS','READY_FOR_REVIEW',
    'COMPLETED','RESOLVED','REJECTED','CANCELLED','SUPERSEDED'
  )) NOT VALID;
ALTER TABLE site_change_requests VALIDATE CONSTRAINT site_change_requests_status_check;
ALTER TABLE site_change_requests ADD CONSTRAINT site_change_requests_review_category_check
  CHECK (category IS NULL OR category IN (
    'FACT_CORRECTION','COPY_CHANGE','SERVICE_CHANGE','PRICE_CHANGE','STAFF_CHANGE',
    'LOCATION_CHANGE','POLICY_CHANGE','DESIGN_FEEDBACK','LAYOUT_CHANGE','IMAGE_CHANGE',
    'SEO_CHANGE','BOOKING_CHANGE','ACCESSIBILITY_CHANGE','OTHER'
  )) NOT VALID;
ALTER TABLE site_change_requests ADD CONSTRAINT site_change_requests_priority_check
  CHECK (priority IN ('URGENT','HIGH','NORMAL','LOW')) NOT VALID;
ALTER TABLE site_change_requests ADD CONSTRAINT site_change_requests_resolution_type_check
  CHECK (resolution_type IS NULL OR resolution_type IN (
    'MANUAL_CONTENT_REVISION','SECTION_REGENERATION','PAGE_REGENERATION',
    'FACT_DATA_UPDATE_REQUIRED','NO_CHANGE_REQUIRED','REQUEST_REJECTED',
    'DUPLICATE_REQUEST','DEFERRED'
  )) NOT VALID;
ALTER TABLE site_change_requests ADD CONSTRAINT site_change_requests_submitter_check
  CHECK (
    requested_by_tenant_user_id IS NOT NULL
    OR submitted_by_agency_user_id IS NOT NULL
    OR submitted_by_participant_id IS NOT NULL
  ) NOT VALID;
ALTER TABLE site_change_requests ADD CONSTRAINT site_change_requests_submitter_type_check
  CHECK (submitted_by_type IS NULL OR submitted_by_type IN (
    'AGENCY_USER','TENANT_USER','EXTERNAL_REVIEWER'
  )) NOT VALID;
ALTER TABLE site_change_requests ADD CONSTRAINT site_change_requests_field_path_check
  CHECK (
    field_path IS NULL
    OR (
      char_length(field_path) BETWEEN 1 AND 500
      AND field_path ~ '^[A-Za-z0-9_.\[\]-]+$'
    )
  ) NOT VALID;
ALTER TABLE site_change_requests ADD CONSTRAINT site_change_requests_safe_text_check
  CHECK (
    review_cycle_id IS NULL
    OR (
      char_length(description) BETWEEN 1 AND 4000
      AND position('<' IN description) = 0
      AND (requested_outcome IS NULL OR (
        char_length(requested_outcome) BETWEEN 1 AND 2000
        AND position('<' IN requested_outcome) = 0
      ))
    )
  ) NOT VALID;
ALTER TABLE site_change_requests VALIDATE CONSTRAINT site_change_requests_review_category_check;
ALTER TABLE site_change_requests VALIDATE CONSTRAINT site_change_requests_priority_check;
ALTER TABLE site_change_requests VALIDATE CONSTRAINT site_change_requests_resolution_type_check;
ALTER TABLE site_change_requests VALIDATE CONSTRAINT site_change_requests_submitter_check;
ALTER TABLE site_change_requests VALIDATE CONSTRAINT site_change_requests_submitter_type_check;
ALTER TABLE site_change_requests VALIDATE CONSTRAINT site_change_requests_field_path_check;
ALTER TABLE site_change_requests VALIDATE CONSTRAINT site_change_requests_safe_text_check;
CREATE INDEX IF NOT EXISTS site_change_requests_review_cycle_status_idx
  ON site_change_requests(review_cycle_id, status, created_at);
CREATE INDEX IF NOT EXISTS site_change_requests_review_item_idx ON site_change_requests(review_item_id);
CREATE INDEX IF NOT EXISTS site_change_requests_section_idx ON site_change_requests(section_id);
CREATE INDEX IF NOT EXISTS site_change_requests_submitted_agency_idx ON site_change_requests(submitted_by_agency_user_id);
CREATE INDEX IF NOT EXISTS site_change_requests_submitted_participant_idx ON site_change_requests(submitted_by_participant_id);
CREATE INDEX IF NOT EXISTS site_change_requests_assigned_idx ON site_change_requests(assigned_to_agency_user_id);
CREATE INDEX IF NOT EXISTS site_change_requests_result_version_idx ON site_change_requests(resulting_site_version_id);
CREATE INDEX IF NOT EXISTS site_change_requests_result_page_idx ON site_change_requests(resulting_page_id);
CREATE INDEX IF NOT EXISTS site_change_requests_result_section_idx ON site_change_requests(resulting_section_id);
CREATE INDEX IF NOT EXISTS site_change_requests_regeneration_job_idx ON site_change_requests(regeneration_job_id);

CREATE TABLE IF NOT EXISTS site_change_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  change_request_id uuid NOT NULL REFERENCES site_change_requests(id) ON DELETE RESTRICT,
  review_cycle_id uuid NOT NULL REFERENCES site_review_cycles(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'CREATED','TRIAGED','ASSIGNED','ACCEPTED','REGENERATION_QUEUED',
    'READY_FOR_REVIEW','RESOLVED','REJECTED','CANCELLED','SUPERSEDED'
  )),
  from_status text,
  to_status text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('AGENCY_USER','TENANT_USER','EXTERNAL_REVIEWER','SYSTEM')),
  agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  participant_id uuid REFERENCES site_review_participants(id) ON DELETE RESTRICT,
  safe_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS site_change_request_events_request_idx
  ON site_change_request_events(change_request_id, occurred_at);
CREATE INDEX IF NOT EXISTS site_change_request_events_cycle_idx
  ON site_change_request_events(review_cycle_id, occurred_at);
CREATE INDEX IF NOT EXISTS site_change_request_events_agency_user_idx
  ON site_change_request_events(agency_user_id);
CREATE INDEX IF NOT EXISTS site_change_request_events_participant_idx
  ON site_change_request_events(participant_id);

CREATE TABLE IF NOT EXISTS site_fact_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  review_cycle_id uuid NOT NULL REFERENCES site_review_cycles(id) ON DELETE RESTRICT,
  review_item_id uuid REFERENCES site_review_items(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  fact_type text NOT NULL CHECK (fact_type IN (
    'LEGAL_BUSINESS_NAME','TRADING_NAME','PHONE','EMAIL','ADDRESS','OPENING_HOURS',
    'SERVICE_NAME','SERVICE_DESCRIPTION','SERVICE_PRICE','SERVICE_DURATION',
    'STAFF_NAME','STAFF_ROLE','STAFF_CREDENTIAL','STAFF_BIO','LOCATION',
    'SERVICE_AREA','POLICY','QUALIFICATION','AWARD','GUARANTEE','REVIEW',
    'TESTIMONIAL','RESULT','OTHER'
  )),
  source_entity_type text NOT NULL CHECK (source_entity_type IN (
    'TENANT','SERVICE','STAFF','LOCATION','POLICY','GENERATION_CLAIM','OTHER'
  )),
  source_entity_reference uuid,
  display_label text NOT NULL CHECK (char_length(display_label) BETWEEN 1 AND 160),
  proposed_public_value text NOT NULL CHECK (char_length(proposed_public_value) BETWEEN 1 AND 2000),
  value_digest_sha256 text NOT NULL CHECK (value_digest_sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'UNVERIFIED' CHECK (status IN (
    'UNVERIFIED','PENDING_REVIEW','CONFIRMED','DISPUTED','REQUIRES_EVIDENCE',
    'REJECTED','SUPERSEDED','NOT_APPLICABLE'
  )),
  client_response text CHECK (client_response IS NULL OR char_length(client_response) <= 1000),
  evidence_required boolean NOT NULL DEFAULT false,
  evidence_reference uuid,
  evidence_private boolean NOT NULL DEFAULT true,
  agency_decision text CHECK (agency_decision IS NULL OR char_length(agency_decision) <= 1000),
  responded_by_participant_id uuid REFERENCES site_review_participants(id) ON DELETE RESTRICT,
  confirmed_at timestamptz,
  disputed_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(review_cycle_id, fact_type, source_entity_type, source_entity_reference, value_digest_sha256)
);
CREATE INDEX IF NOT EXISTS site_fact_verifications_cycle_status_idx
  ON site_fact_verifications(review_cycle_id, status, created_at);
CREATE INDEX IF NOT EXISTS site_fact_verifications_tenant_source_idx
  ON site_fact_verifications(tenant_id, source_entity_type, source_entity_reference);
CREATE INDEX IF NOT EXISTS site_fact_verifications_item_idx ON site_fact_verifications(review_item_id);
CREATE INDEX IF NOT EXISTS site_fact_verifications_participant_idx ON site_fact_verifications(responded_by_participant_id);

-- Extend the existing approval aggregate and retain immutable decisions separately.
ALTER TABLE site_approvals
  ADD COLUMN IF NOT EXISTS review_cycle_id uuid REFERENCES site_review_cycles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS review_revision integer,
  ADD COLUMN IF NOT EXISTS approval_level text,
  ADD COLUMN IF NOT EXISTS review_item_id uuid REFERENCES site_review_items(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS page_id uuid REFERENCES site_pages(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS content_digest_sha256 text,
  ADD COLUMN IF NOT EXISTS invalidated_at timestamptz,
  ADD COLUMN IF NOT EXISTS invalidation_reason text;
ALTER TABLE site_approvals ADD CONSTRAINT site_approvals_review_level_check
  CHECK (approval_level IS NULL OR approval_level IN (
    'ITEM','PAGE','FULL_SITE','CLIENT_FINAL','AGENCY_FINAL'
  )) NOT VALID;
ALTER TABLE site_approvals VALIDATE CONSTRAINT site_approvals_review_level_check;
CREATE INDEX IF NOT EXISTS site_approvals_review_cycle_status_idx
  ON site_approvals(review_cycle_id, status, approval_level);
CREATE INDEX IF NOT EXISTS site_approvals_review_item_idx ON site_approvals(review_item_id);
CREATE INDEX IF NOT EXISTS site_approvals_page_idx ON site_approvals(page_id);
CREATE INDEX IF NOT EXISTS site_approvals_valid_digest_idx
  ON site_approvals(review_cycle_id, approval_level, content_digest_sha256)
  WHERE invalidated_at IS NULL;

CREATE TABLE IF NOT EXISTS site_approval_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  approval_id uuid NOT NULL REFERENCES site_approvals(id) ON DELETE RESTRICT,
  review_cycle_id uuid NOT NULL REFERENCES site_review_cycles(id) ON DELETE RESTRICT,
  site_version_id uuid NOT NULL REFERENCES site_versions(id) ON DELETE RESTRICT,
  review_revision integer NOT NULL CHECK (review_revision > 0),
  approver_type text NOT NULL CHECK (approver_type IN ('AGENCY_USER','TENANT_USER','EXTERNAL_REVIEWER')),
  agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  tenant_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  participant_id uuid REFERENCES site_review_participants(id) ON DELETE RESTRICT,
  approver_role text NOT NULL CHECK (approver_role IN (
    'AGENCY_OWNER','AGENCY_REVIEWER','CLIENT_APPROVER','CLIENT_REVIEWER','FACT_VERIFIER'
  )),
  decision text NOT NULL CHECK (decision IN (
    'APPROVE','APPROVE_WITH_NOTES','REQUEST_CHANGES','REJECT','WITHDRAW_APPROVAL'
  )),
  approval_level text NOT NULL CHECK (approval_level IN (
    'ITEM','PAGE','FULL_SITE','CLIENT_FINAL','AGENCY_FINAL'
  )),
  review_item_id uuid REFERENCES site_review_items(id) ON DELETE RESTRICT,
  page_id uuid REFERENCES site_pages(id) ON DELETE RESTRICT,
  content_digest_sha256 text NOT NULL CHECK (content_digest_sha256 ~ '^[a-f0-9]{64}$'),
  open_blocking_item_count integer NOT NULL CHECK (open_blocking_item_count >= 0),
  open_change_request_count integer NOT NULL CHECK (open_change_request_count >= 0),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  invalidated_at timestamptz,
  invalidation_reason text CHECK (invalidation_reason IS NULL OR char_length(invalidation_reason) <= 500),
  decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS site_approval_decisions_cycle_level_idx
  ON site_approval_decisions(review_cycle_id, approval_level, decided_at);
CREATE INDEX IF NOT EXISTS site_approval_decisions_approval_idx
  ON site_approval_decisions(approval_id, decided_at);
CREATE INDEX IF NOT EXISTS site_approval_decisions_version_idx
  ON site_approval_decisions(site_version_id, decided_at);
CREATE INDEX IF NOT EXISTS site_approval_decisions_item_idx ON site_approval_decisions(review_item_id);
CREATE INDEX IF NOT EXISTS site_approval_decisions_page_idx ON site_approval_decisions(page_id);
CREATE INDEX IF NOT EXISTS site_approval_decisions_agency_user_idx ON site_approval_decisions(agency_user_id);
CREATE INDEX IF NOT EXISTS site_approval_decisions_tenant_user_idx ON site_approval_decisions(tenant_user_id);
CREATE INDEX IF NOT EXISTS site_approval_decisions_participant_idx ON site_approval_decisions(participant_id);

CREATE TABLE IF NOT EXISTS site_review_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  review_cycle_id uuid NOT NULL REFERENCES site_review_cycles(id) ON DELETE RESTRICT,
  participant_id uuid NOT NULL REFERENCES site_review_participants(id) ON DELETE RESTRICT,
  review_revision integer NOT NULL CHECK (review_revision > 0),
  token_digest_sha256 text NOT NULL UNIQUE CHECK (token_digest_sha256 ~ '^[a-f0-9]{64}$'),
  recipient_email_normalized text NOT NULL CHECK (char_length(recipient_email_normalized) BETWEEN 3 AND 320),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING','QUEUED','SENT','OPENED','ACCEPTED','EXPIRED','REVOKED','FAILED'
  )),
  email_outbox_id uuid REFERENCES email_outbox(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  sent_at timestamptz,
  opened_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(review_cycle_id, participant_id, review_revision)
);
CREATE INDEX IF NOT EXISTS site_review_invitations_cycle_status_idx
  ON site_review_invitations(review_cycle_id, status, expires_at);
CREATE INDEX IF NOT EXISTS site_review_invitations_participant_idx
  ON site_review_invitations(participant_id, status);
CREATE INDEX IF NOT EXISTS site_review_invitations_outbox_idx ON site_review_invitations(email_outbox_id);

CREATE TABLE IF NOT EXISTS site_review_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  review_cycle_id uuid NOT NULL REFERENCES site_review_cycles(id) ON DELETE RESTRICT,
  participant_id uuid NOT NULL REFERENCES site_review_participants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  site_version_id uuid NOT NULL REFERENCES site_versions(id) ON DELETE RESTRICT,
  invitation_id uuid REFERENCES site_review_invitations(id) ON DELETE RESTRICT,
  token_digest_sha256 text NOT NULL UNIQUE CHECK (token_digest_sha256 ~ '^[a-f0-9]{64}$'),
  preview_token_jti uuid NOT NULL UNIQUE,
  purpose text NOT NULL CHECK (purpose IN (
    'AGENCY_REVIEW','CLIENT_REVIEW','FACT_VERIFICATION','FINAL_APPROVAL'
  )),
  allowed_scope text NOT NULL CHECK (allowed_scope IN (
    'FULL_SITE','PAGE','SECTION','FACTS_ONLY','COPY_ONLY',
    'DESIGN_AND_STRUCTURE','FINAL_APPROVAL'
  )),
  expires_at timestamptz NOT NULL,
  last_accessed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS site_review_sessions_cycle_expiry_idx
  ON site_review_sessions(review_cycle_id, expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS site_review_sessions_participant_idx
  ON site_review_sessions(participant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS site_review_sessions_site_version_idx
  ON site_review_sessions(site_id, site_version_id);
CREATE INDEX IF NOT EXISTS site_review_sessions_invitation_idx ON site_review_sessions(invitation_id);

CREATE TABLE IF NOT EXISTS site_review_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  review_cycle_id uuid NOT NULL REFERENCES site_review_cycles(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 3 AND 100),
  actor_type text NOT NULL CHECK (actor_type IN ('AGENCY_USER','TENANT_USER','EXTERNAL_REVIEWER','SYSTEM')),
  agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  participant_id uuid REFERENCES site_review_participants(id) ON DELETE RESTRICT,
  target_type text NOT NULL CHECK (char_length(target_type) BETWEEN 2 AND 80),
  target_public_reference uuid,
  safe_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS site_review_activity_cycle_occurred_idx
  ON site_review_activity(review_cycle_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS site_review_activity_agency_user_idx ON site_review_activity(agency_user_id);
CREATE INDEX IF NOT EXISTS site_review_activity_participant_idx ON site_review_activity(participant_id);

CREATE OR REPLACE FUNCTION ks_validate_site_review_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  version_row site_versions%ROWTYPE;
  run_row site_generation_runs%ROWTYPE;
BEGIN
  SELECT * INTO version_row FROM site_versions WHERE id = NEW.site_version_id;
  IF NOT FOUND
     OR version_row.tenant_id <> NEW.tenant_id
     OR version_row.site_id <> NEW.site_id THEN
    RAISE EXCEPTION 'SITE_REVIEW_OWNERSHIP_INVALID';
  END IF;
  IF version_row.status = 'PUBLISHED' OR version_row.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'SITE_REVIEW_PUBLISHED_VERSION_FORBIDDEN';
  END IF;
  IF NEW.pinned_content_digest_sha256 IS DISTINCT FROM version_row.generation_content_digest_sha256 THEN
    RAISE EXCEPTION 'SITE_REVIEW_CONTENT_DIGEST_INVALID';
  END IF;
  IF NEW.scoped_page_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM site_pages p
    WHERE p.id = NEW.scoped_page_id
      AND p.tenant_id = NEW.tenant_id
      AND p.site_id = NEW.site_id
      AND p.version_id = NEW.site_version_id
  ) THEN
    RAISE EXCEPTION 'SITE_REVIEW_PAGE_OWNERSHIP_INVALID';
  END IF;
  IF NEW.scoped_section_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM site_sections s
    WHERE s.id = NEW.scoped_section_id
      AND s.tenant_id = NEW.tenant_id
      AND s.site_id = NEW.site_id
      AND s.version_id = NEW.site_version_id
      AND s.page_id = NEW.scoped_page_id
  ) THEN
    RAISE EXCEPTION 'SITE_REVIEW_SECTION_OWNERSHIP_INVALID';
  END IF;
  IF NEW.generation_run_id IS NOT NULL THEN
    SELECT * INTO run_row FROM site_generation_runs WHERE id = NEW.generation_run_id;
    IF NOT FOUND
       OR run_row.tenant_id <> NEW.tenant_id
       OR run_row.site_id <> NEW.site_id
       OR run_row.site_version_id <> NEW.site_version_id
       OR run_row.blueprint_id <> NEW.blueprint_id
       OR run_row.blueprint_revision <> NEW.blueprint_revision
       OR run_row.template_version_id <> NEW.template_version_id
       OR run_row.knowledge_pack_id <> NEW.knowledge_pack_id
       OR run_row.knowledge_pack_semantic_version <> NEW.knowledge_pack_semantic_version THEN
      RAISE EXCEPTION 'SITE_REVIEW_PROVENANCE_INVALID';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.site_id IS DISTINCT FROM OLD.site_id
    OR NEW.site_version_id IS DISTINCT FROM OLD.site_version_id
    OR NEW.generation_run_id IS DISTINCT FROM OLD.generation_run_id
    OR NEW.blueprint_id IS DISTINCT FROM OLD.blueprint_id
    OR NEW.blueprint_revision IS DISTINCT FROM OLD.blueprint_revision
    OR NEW.template_version_id IS DISTINCT FROM OLD.template_version_id
    OR NEW.knowledge_pack_id IS DISTINCT FROM OLD.knowledge_pack_id
    OR NEW.knowledge_pack_semantic_version IS DISTINCT FROM OLD.knowledge_pack_semantic_version
    OR NEW.pinned_content_digest_sha256 IS DISTINCT FROM OLD.pinned_content_digest_sha256
  ) THEN
    RAISE EXCEPTION 'SITE_REVIEW_PINNED_CONTEXT_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER site_review_cycles_validate
BEFORE INSERT OR UPDATE ON site_review_cycles
FOR EACH ROW EXECUTE FUNCTION ks_validate_site_review_cycle();

CREATE OR REPLACE FUNCTION ks_validate_site_review_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF (
    OLD.status = 'READY_FOR_CLIENT_REVIEW'
    AND NEW.status = 'AGENCY_FINAL_REVIEW'
    AND OLD.client_approval_required
  ) THEN
    RAISE EXCEPTION 'SITE_REVIEW_CLIENT_APPROVAL_REQUIRED';
  END IF;
  IF NOT (
    (OLD.status = 'DRAFT' AND NEW.status IN ('INTERNAL_REVIEW','CANCELLED','SUPERSEDED'))
    OR (OLD.status = 'INTERNAL_REVIEW' AND NEW.status IN ('INTERNAL_CHANGES_REQUIRED','READY_FOR_CLIENT_REVIEW','REJECTED','CANCELLED','SUPERSEDED'))
    OR (OLD.status = 'INTERNAL_CHANGES_REQUIRED' AND NEW.status IN ('INTERNAL_REVIEW','REJECTED','CANCELLED','SUPERSEDED'))
    OR (OLD.status = 'READY_FOR_CLIENT_REVIEW' AND NEW.status IN ('CLIENT_REVIEW','AGENCY_FINAL_REVIEW','INTERNAL_CHANGES_REQUIRED','CANCELLED','SUPERSEDED'))
    OR (OLD.status = 'CLIENT_REVIEW' AND NEW.status IN ('CLIENT_CHANGES_REQUESTED','CLIENT_APPROVED','REJECTED','CANCELLED','SUPERSEDED'))
    OR (OLD.status = 'CLIENT_CHANGES_REQUESTED' AND NEW.status IN ('INTERNAL_REVIEW','CLIENT_REVIEW','REJECTED','CANCELLED','SUPERSEDED'))
    OR (OLD.status = 'CLIENT_APPROVED' AND NEW.status IN ('AGENCY_FINAL_REVIEW','CLIENT_CHANGES_REQUESTED','CANCELLED','SUPERSEDED'))
    OR (OLD.status = 'AGENCY_FINAL_REVIEW' AND NEW.status IN ('AGENCY_APPROVED','INTERNAL_CHANGES_REQUIRED','REJECTED','CANCELLED','SUPERSEDED'))
    OR (OLD.status IN ('AGENCY_APPROVED','REJECTED','CANCELLED') AND NEW.status = 'SUPERSEDED')
  ) THEN
    RAISE EXCEPTION 'SITE_REVIEW_TRANSITION_INVALID: % -> %', OLD.status, NEW.status;
  END IF;
  NEW.updated_at := now();
  NEW.opened_at := CASE WHEN NEW.status = 'INTERNAL_REVIEW' THEN COALESCE(OLD.opened_at, now()) ELSE NEW.opened_at END;
  NEW.client_review_started_at := CASE WHEN NEW.status = 'CLIENT_REVIEW' THEN COALESCE(OLD.client_review_started_at, now()) ELSE NEW.client_review_started_at END;
  NEW.client_approved_at := CASE WHEN NEW.status = 'CLIENT_APPROVED' THEN now() ELSE NEW.client_approved_at END;
  NEW.agency_approved_at := CASE WHEN NEW.status = 'AGENCY_APPROVED' THEN now() ELSE NEW.agency_approved_at END;
  NEW.rejected_at := CASE WHEN NEW.status = 'REJECTED' THEN now() ELSE NEW.rejected_at END;
  NEW.cancelled_at := CASE WHEN NEW.status = 'CANCELLED' THEN now() ELSE NEW.cancelled_at END;
  NEW.superseded_at := CASE WHEN NEW.status = 'SUPERSEDED' THEN now() ELSE NEW.superseded_at END;
  RETURN NEW;
END;
$$;
CREATE TRIGGER site_review_cycles_transition
BEFORE UPDATE OF status ON site_review_cycles
FOR EACH ROW EXECUTE FUNCTION ks_validate_site_review_transition();

CREATE OR REPLACE FUNCTION ks_validate_site_review_target()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cycle_row site_review_cycles%ROWTYPE;
  target_page_id uuid;
BEGIN
  SELECT * INTO cycle_row FROM site_review_cycles WHERE id = NEW.review_cycle_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SITE_REVIEW_CYCLE_NOT_FOUND'; END IF;
  IF NEW.page_id IS NOT NULL THEN
    SELECT p.id INTO target_page_id FROM site_pages p
    WHERE p.id = NEW.page_id
      AND p.tenant_id = cycle_row.tenant_id
      AND p.site_id = cycle_row.site_id
      AND p.version_id = cycle_row.site_version_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'SITE_REVIEW_PAGE_OWNERSHIP_INVALID'; END IF;
  END IF;
  IF NEW.section_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM site_sections s
    WHERE s.id = NEW.section_id
      AND s.tenant_id = cycle_row.tenant_id
      AND s.site_id = cycle_row.site_id
      AND s.version_id = cycle_row.site_version_id
      AND (NEW.page_id IS NULL OR s.page_id = NEW.page_id)
  ) THEN
    RAISE EXCEPTION 'SITE_REVIEW_SECTION_OWNERSHIP_INVALID';
  END IF;
  IF TG_TABLE_NAME = 'site_review_comments' THEN
    IF NEW.review_item_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM site_review_items i
      WHERE i.id = NEW.review_item_id AND i.review_cycle_id = NEW.review_cycle_id
    ) THEN
      RAISE EXCEPTION 'SITE_REVIEW_ITEM_OWNERSHIP_INVALID';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER site_review_items_target
BEFORE INSERT OR UPDATE ON site_review_items
FOR EACH ROW EXECUTE FUNCTION ks_validate_site_review_target();
CREATE TRIGGER site_review_comments_target
BEFORE INSERT OR UPDATE ON site_review_comments
FOR EACH ROW EXECUTE FUNCTION ks_validate_site_review_target();

CREATE OR REPLACE FUNCTION ks_validate_site_review_comment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.parent_comment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM site_review_comments parent
    WHERE parent.id = NEW.parent_comment_id
      AND parent.review_cycle_id = NEW.review_cycle_id
      AND parent.status <> 'DELETED'
  ) THEN
    RAISE EXCEPTION 'SITE_REVIEW_COMMENT_PARENT_INVALID';
  END IF;
  IF NEW.participant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM site_review_participants participant
    WHERE participant.id = NEW.participant_id
      AND participant.review_cycle_id = NEW.review_cycle_id
      AND participant.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'SITE_REVIEW_COMMENT_PARTICIPANT_INVALID';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER site_review_comments_validate
BEFORE INSERT OR UPDATE ON site_review_comments
FOR EACH ROW EXECUTE FUNCTION ks_validate_site_review_comment();

CREATE OR REPLACE FUNCTION ks_validate_site_review_participant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE cycle_tenant uuid;
BEGIN
  SELECT tenant_id INTO cycle_tenant
  FROM site_review_cycles WHERE id = NEW.review_cycle_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SITE_REVIEW_CYCLE_NOT_FOUND'; END IF;
  IF NEW.participant_type = 'TENANT_USER' AND NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = NEW.tenant_user_id
      AND u.tenant_id = cycle_tenant
      AND u.account_status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'SITE_REVIEW_PARTICIPANT_TENANT_INVALID';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER site_review_participants_ownership
BEFORE INSERT OR UPDATE ON site_review_participants
FOR EACH ROW EXECUTE FUNCTION ks_validate_site_review_participant();

CREATE OR REPLACE FUNCTION ks_validate_site_review_child_relation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE relation_participant_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'site_fact_verifications' THEN
    relation_participant_id := NEW.responded_by_participant_id;
  ELSE
    relation_participant_id := NEW.participant_id;
  END IF;
  IF relation_participant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM site_review_participants participant
    WHERE participant.id = relation_participant_id
      AND participant.review_cycle_id = NEW.review_cycle_id
  ) THEN
    RAISE EXCEPTION 'SITE_REVIEW_PARTICIPANT_SCOPE_INVALID';
  END IF;
  IF TG_TABLE_NAME = 'site_fact_verifications'
     AND NEW.review_item_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM site_review_items item
       WHERE item.id = NEW.review_item_id
         AND item.review_cycle_id = NEW.review_cycle_id
         AND item.target_type = 'FACT'
     ) THEN
    RAISE EXCEPTION 'SITE_REVIEW_FACT_ITEM_INVALID';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER site_review_invitations_relation
BEFORE INSERT OR UPDATE ON site_review_invitations
FOR EACH ROW EXECUTE FUNCTION ks_validate_site_review_child_relation();
CREATE TRIGGER site_review_sessions_relation
BEFORE INSERT OR UPDATE ON site_review_sessions
FOR EACH ROW EXECUTE FUNCTION ks_validate_site_review_child_relation();
CREATE TRIGGER site_fact_verifications_relation
BEFORE INSERT OR UPDATE ON site_fact_verifications
FOR EACH ROW EXECUTE FUNCTION ks_validate_site_review_child_relation();
CREATE TRIGGER site_approval_decisions_relation
BEFORE INSERT OR UPDATE ON site_approval_decisions
FOR EACH ROW EXECUTE FUNCTION ks_validate_site_review_child_relation();
CREATE TRIGGER site_review_activity_relation
BEFORE INSERT OR UPDATE ON site_review_activity
FOR EACH ROW EXECUTE FUNCTION ks_validate_site_review_child_relation();
CREATE TRIGGER site_change_request_events_relation
BEFORE INSERT OR UPDATE ON site_change_request_events
FOR EACH ROW EXECUTE FUNCTION ks_validate_site_review_child_relation();

CREATE OR REPLACE FUNCTION ks_validate_site_approval_decision_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM site_review_cycles cycle
    JOIN site_approvals approval ON approval.id = NEW.approval_id
    WHERE cycle.id = NEW.review_cycle_id
      AND cycle.site_version_id = NEW.site_version_id
      AND cycle.review_revision = NEW.review_revision
      AND cycle.pinned_content_digest_sha256 = NEW.content_digest_sha256
      AND approval.review_cycle_id = cycle.id
      AND approval.version_id = cycle.site_version_id
      AND approval.review_revision = cycle.review_revision
      AND approval.content_digest_sha256 = cycle.pinned_content_digest_sha256
  ) THEN
    RAISE EXCEPTION 'SITE_REVIEW_APPROVAL_SCOPE_INVALID';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER site_approval_decisions_scope
BEFORE INSERT OR UPDATE ON site_approval_decisions
FOR EACH ROW EXECUTE FUNCTION ks_validate_site_approval_decision_scope();

CREATE OR REPLACE FUNCTION ks_validate_site_approval_decision_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.public_reference IS DISTINCT FROM OLD.public_reference
    OR NEW.approval_id IS DISTINCT FROM OLD.approval_id
    OR NEW.review_cycle_id IS DISTINCT FROM OLD.review_cycle_id
    OR NEW.site_version_id IS DISTINCT FROM OLD.site_version_id
    OR NEW.review_revision IS DISTINCT FROM OLD.review_revision
    OR NEW.approver_type IS DISTINCT FROM OLD.approver_type
    OR NEW.agency_user_id IS DISTINCT FROM OLD.agency_user_id
    OR NEW.tenant_user_id IS DISTINCT FROM OLD.tenant_user_id
    OR NEW.participant_id IS DISTINCT FROM OLD.participant_id
    OR NEW.approver_role IS DISTINCT FROM OLD.approver_role
    OR NEW.decision IS DISTINCT FROM OLD.decision
    OR NEW.approval_level IS DISTINCT FROM OLD.approval_level
    OR NEW.review_item_id IS DISTINCT FROM OLD.review_item_id
    OR NEW.page_id IS DISTINCT FROM OLD.page_id
    OR NEW.content_digest_sha256 IS DISTINCT FROM OLD.content_digest_sha256
    OR NEW.open_blocking_item_count IS DISTINCT FROM OLD.open_blocking_item_count
    OR NEW.open_change_request_count IS DISTINCT FROM OLD.open_change_request_count
    OR NEW.notes IS DISTINCT FROM OLD.notes
    OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
    OR (OLD.invalidated_at IS NOT NULL AND NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at)
  ) THEN
    RAISE EXCEPTION 'SITE_REVIEW_APPROVAL_DECISION_IMMUTABLE';
  END IF;
  IF NEW.invalidated_at IS NOT NULL AND NEW.invalidation_reason IS NULL THEN
    RAISE EXCEPTION 'SITE_REVIEW_APPROVAL_INVALIDATION_REASON_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER site_approval_decisions_immutable
BEFORE UPDATE ON site_approval_decisions
FOR EACH ROW EXECUTE FUNCTION ks_validate_site_approval_decision_update();

CREATE OR REPLACE FUNCTION ks_validate_site_review_tenant_record()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE cycle_tenant uuid;
DECLARE cycle_site uuid;
DECLARE cycle_version uuid;
BEGIN
  SELECT tenant_id, site_id, site_version_id
    INTO cycle_tenant, cycle_site, cycle_version
  FROM site_review_cycles WHERE id = NEW.review_cycle_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SITE_REVIEW_CYCLE_NOT_FOUND'; END IF;
  IF TG_TABLE_NAME = 'site_change_requests' THEN
    IF NEW.tenant_id <> cycle_tenant OR NEW.site_id <> cycle_site OR NEW.version_id <> cycle_version THEN
      RAISE EXCEPTION 'SITE_REVIEW_OWNERSHIP_INVALID';
    END IF;
  ELSIF TG_TABLE_NAME = 'site_fact_verifications' THEN
    IF NEW.tenant_id <> cycle_tenant THEN RAISE EXCEPTION 'SITE_REVIEW_OWNERSHIP_INVALID'; END IF;
    IF NEW.source_entity_reference IS NOT NULL THEN
      IF NEW.source_entity_type = 'SERVICE' AND NOT EXISTS (
        SELECT 1 FROM services entity
        WHERE entity.public_reference = NEW.source_entity_reference
          AND entity.tenant_id = cycle_tenant
      ) THEN RAISE EXCEPTION 'SITE_REVIEW_FACT_SOURCE_INVALID'; END IF;
      IF NEW.source_entity_type = 'STAFF' AND NOT EXISTS (
        SELECT 1 FROM users entity
        WHERE entity.public_reference = NEW.source_entity_reference
          AND entity.tenant_id = cycle_tenant
      ) THEN RAISE EXCEPTION 'SITE_REVIEW_FACT_SOURCE_INVALID'; END IF;
      IF NEW.source_entity_type = 'LOCATION' AND NOT EXISTS (
        SELECT 1 FROM locations entity
        WHERE entity.public_reference = NEW.source_entity_reference
          AND entity.tenant_id = cycle_tenant
      ) THEN RAISE EXCEPTION 'SITE_REVIEW_FACT_SOURCE_INVALID'; END IF;
      IF NEW.source_entity_type = 'GENERATION_CLAIM' AND NOT EXISTS (
        SELECT 1 FROM site_generation_claims entity
        WHERE entity.public_reference = NEW.source_entity_reference
          AND entity.tenant_id = cycle_tenant
          AND entity.claim_status NOT IN ('UNSUPPORTED','PROHIBITED')
      ) THEN RAISE EXCEPTION 'SITE_REVIEW_FACT_SOURCE_INVALID'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'site_review_sessions' THEN
    IF NEW.site_id <> cycle_site OR NEW.site_version_id <> cycle_version THEN
      RAISE EXCEPTION 'SITE_REVIEW_SESSION_SCOPE_INVALID';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER site_change_requests_review_ownership
BEFORE INSERT OR UPDATE ON site_change_requests
FOR EACH ROW WHEN (NEW.review_cycle_id IS NOT NULL)
EXECUTE FUNCTION ks_validate_site_review_tenant_record();
CREATE TRIGGER site_fact_verifications_ownership
BEFORE INSERT OR UPDATE ON site_fact_verifications
FOR EACH ROW EXECUTE FUNCTION ks_validate_site_review_tenant_record();
CREATE TRIGGER site_review_sessions_ownership
BEFORE INSERT OR UPDATE ON site_review_sessions
FOR EACH ROW EXECUTE FUNCTION ks_validate_site_review_tenant_record();

CREATE OR REPLACE FUNCTION ks_validate_site_review_change_request_target()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.review_cycle_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.page_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM site_pages page
    WHERE page.id = NEW.page_id
      AND page.tenant_id = NEW.tenant_id
      AND page.site_id = NEW.site_id
      AND page.version_id = NEW.version_id
  ) THEN RAISE EXCEPTION 'SITE_REVIEW_PAGE_OWNERSHIP_INVALID'; END IF;
  IF NEW.section_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM site_sections section
    WHERE section.id = NEW.section_id
      AND section.tenant_id = NEW.tenant_id
      AND section.site_id = NEW.site_id
      AND section.version_id = NEW.version_id
      AND (NEW.page_id IS NULL OR section.page_id = NEW.page_id)
  ) THEN RAISE EXCEPTION 'SITE_REVIEW_SECTION_OWNERSHIP_INVALID'; END IF;
  IF NEW.review_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM site_review_items item
    WHERE item.id = NEW.review_item_id
      AND item.review_cycle_id = NEW.review_cycle_id
  ) THEN RAISE EXCEPTION 'SITE_REVIEW_ITEM_OWNERSHIP_INVALID'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER site_change_requests_review_target
BEFORE INSERT OR UPDATE ON site_change_requests
FOR EACH ROW WHEN (NEW.review_cycle_id IS NOT NULL)
EXECUTE FUNCTION ks_validate_site_review_change_request_target();

CREATE OR REPLACE FUNCTION ks_revoke_site_review_access()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('AGENCY_APPROVED','CANCELLED','SUPERSEDED','REJECTED')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE site_review_invitations
      SET status = 'REVOKED', revoked_at = now()
    WHERE review_cycle_id = NEW.id
      AND status NOT IN ('REVOKED','EXPIRED','FAILED');
    INSERT INTO site_preview_token_revocations(
      token_jti, tenant_id, site_id, site_version_id, reason_code, expires_at
    )
    SELECT preview_token_jti, NEW.tenant_id, NEW.site_id, NEW.site_version_id,
      'REVIEW_CYCLE_' || NEW.status, expires_at
    FROM site_review_sessions
    WHERE review_cycle_id = NEW.id AND revoked_at IS NULL
    ON CONFLICT (token_jti) DO NOTHING;
    UPDATE site_review_sessions
      SET revoked_at = now()
    WHERE review_cycle_id = NEW.id AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER site_review_cycles_revoke_access
AFTER UPDATE OF status ON site_review_cycles
FOR EACH ROW EXECUTE FUNCTION ks_revoke_site_review_access();

CREATE OR REPLACE FUNCTION ks_reject_append_only_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER site_change_request_events_append_only
BEFORE UPDATE OR DELETE ON site_change_request_events
FOR EACH ROW EXECUTE FUNCTION ks_reject_append_only_change();
CREATE TRIGGER site_approval_decisions_no_delete
BEFORE DELETE ON site_approval_decisions
FOR EACH ROW EXECUTE FUNCTION ks_reject_append_only_change();
CREATE TRIGGER site_review_activity_append_only
BEFORE UPDATE OR DELETE ON site_review_activity
FOR EACH ROW EXECUTE FUNCTION ks_reject_append_only_change();

ALTER TABLE site_review_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_review_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_review_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_review_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_change_request_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_fact_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_approval_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_review_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_review_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_review_activity ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  site_review_cycles,
  site_review_participants,
  site_review_items,
  site_review_comments,
  site_change_request_events,
  site_fact_verifications,
  site_approval_decisions,
  site_review_invitations,
  site_review_sessions,
  site_review_activity
FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE
  site_review_cycles,
  site_review_participants,
  site_review_items,
  site_review_comments,
  site_fact_verifications,
  site_approval_decisions,
  site_review_invitations,
  site_review_sessions
TO service_role;

GRANT SELECT, INSERT ON TABLE
  site_change_request_events,
  site_review_activity
TO service_role;

COMMENT ON TABLE site_review_cycles IS
  'Phase 15.7A version-pinned review cycles; lifecycle approval does not publish.';
COMMENT ON COLUMN site_review_invitations.token_digest_sha256 IS
  'SHA-256 digest of a high-entropy single-use invitation token; raw token is never stored.';
COMMENT ON COLUMN site_review_sessions.token_digest_sha256 IS
  'SHA-256 digest of a high-entropy review session token; raw token is never stored.';
COMMENT ON TABLE site_approval_decisions IS
  'Immutable version- and digest-bound review decisions. Invalidation updates are permitted, deletion is not.';
