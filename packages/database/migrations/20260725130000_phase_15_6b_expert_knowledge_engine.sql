-- Phase 15.6B: Expert Knowledge Engine.
-- Additive, server-only, agency-governed knowledge-pack storage.

CREATE TABLE knowledge_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  semantic_version text NOT NULL,
  intended_scope text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  schema_version integer NOT NULL DEFAULT 1,
  source_digest_sha256 text,
  content_digest_sha256 text,
  rule_count integer NOT NULL DEFAULT 0,
  page_playbook_count integer NOT NULL DEFAULT 0,
  section_playbook_count integer NOT NULL DEFAULT 0,
  source_count integer NOT NULL DEFAULT 0,
  finding_count integer NOT NULL DEFAULT 0,
  conflict_count integer NOT NULL DEFAULT 0,
  revision_of_pack_id uuid REFERENCES knowledge_packs(id) ON DELETE RESTRICT,
  superseded_by_pack_id uuid REFERENCES knowledge_packs(id) ON DELETE RESTRICT,
  created_by_agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  approved_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  activated_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  retired_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  activated_at timestamptz,
  retired_at timestamptz,
  CONSTRAINT knowledge_packs_name_check
    CHECK (char_length(btrim(name)) BETWEEN 2 AND 200),
  CONSTRAINT knowledge_packs_description_check
    CHECK (description IS NULL OR char_length(description) <= 2000),
  CONSTRAINT knowledge_packs_semantic_version_check
    CHECK (semantic_version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'),
  CONSTRAINT knowledge_packs_scope_check
    CHECK (intended_scope IN ('PUBLIC_SITE')),
  CONSTRAINT knowledge_packs_status_check
    CHECK (status IN (
      'DRAFT', 'IMPORTING', 'REVIEW_REQUIRED', 'READY_FOR_APPROVAL',
      'APPROVED', 'ACTIVE', 'RETIRED', 'REJECTED', 'SUPERSEDED'
    )),
  CONSTRAINT knowledge_packs_schema_version_check CHECK (schema_version = 1),
  CONSTRAINT knowledge_packs_source_digest_check
    CHECK (source_digest_sha256 IS NULL OR source_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT knowledge_packs_content_digest_check
    CHECK (content_digest_sha256 IS NULL OR content_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT knowledge_packs_counts_check
    CHECK (
      rule_count >= 0 AND page_playbook_count >= 0
      AND section_playbook_count >= 0 AND source_count >= 0
      AND finding_count >= 0 AND conflict_count >= 0
    ),
  CONSTRAINT knowledge_packs_version_unique
    UNIQUE (intended_scope, semantic_version)
);

CREATE UNIQUE INDEX knowledge_packs_one_active_scope_idx
  ON knowledge_packs (intended_scope)
  WHERE status = 'ACTIVE';
CREATE INDEX knowledge_packs_status_created_idx
  ON knowledge_packs (status, created_at DESC, id);
CREATE INDEX knowledge_packs_revision_idx
  ON knowledge_packs (revision_of_pack_id);
CREATE INDEX knowledge_packs_superseded_idx
  ON knowledge_packs (superseded_by_pack_id);
CREATE INDEX knowledge_packs_created_by_idx
  ON knowledge_packs (created_by_agency_user_id);
CREATE INDEX knowledge_packs_approved_by_idx
  ON knowledge_packs (approved_by_agency_user_id);
CREATE INDEX knowledge_packs_activated_by_idx
  ON knowledge_packs (activated_by_agency_user_id);
CREATE INDEX knowledge_packs_retired_by_idx
  ON knowledge_packs (retired_by_agency_user_id);

CREATE TABLE knowledge_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  knowledge_pack_id uuid NOT NULL REFERENCES knowledge_packs(id) ON DELETE RESTRICT,
  source_id text NOT NULL,
  source_title text NOT NULL,
  author text,
  edition_or_version text,
  source_type text NOT NULL,
  topic_domains_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_authority text NOT NULL,
  support_capability text NOT NULL,
  strength_of_support text,
  temporal_class text NOT NULL,
  citation_locations_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  copyright_notes text,
  verified_at date,
  review_due_at date,
  review_notes text,
  content_digest_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_sources_identifier_check
    CHECK (source_id ~ '^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$' AND char_length(source_id) <= 120),
  CONSTRAINT knowledge_sources_title_check
    CHECK (char_length(btrim(source_title)) BETWEEN 1 AND 300),
  CONSTRAINT knowledge_sources_source_type_check
    CHECK (source_type IN (
      'ARTICLE', 'BOOK', 'DOCUMENTATION', 'INTERNAL_POLICY',
      'OFFICIAL_DOCUMENTATION', 'REPORT', 'STANDARD', 'WEBSITE'
    )),
  CONSTRAINT knowledge_sources_evidence_authority_check
    CHECK (evidence_authority IN (
      'PLATFORM_POLICY', 'OFFICIAL_STANDARD', 'OFFICIAL_PRODUCT_DOCUMENTATION',
      'EXPERT_BOOK', 'PROFESSIONAL_GUIDANCE', 'AI_SYNTHESIS'
    )),
  CONSTRAINT knowledge_sources_support_check
    CHECK (support_capability IN ('DIRECT', 'SYNTHESISED', 'INFERRED')),
  CONSTRAINT knowledge_sources_strength_check
    CHECK (strength_of_support IS NULL OR strength_of_support IN ('STRONG', 'MODERATE', 'LIMITED')),
  CONSTRAINT knowledge_sources_temporal_check
    CHECK (temporal_class IN ('STABLE', 'SLOW_CHANGING', 'TIME_SENSITIVE', 'EXPERIMENTAL')),
  CONSTRAINT knowledge_sources_topic_domains_json_check
    CHECK (jsonb_typeof(topic_domains_json) = 'array'),
  CONSTRAINT knowledge_sources_citations_json_check
    CHECK (jsonb_typeof(citation_locations_json) = 'array'),
  CONSTRAINT knowledge_sources_content_digest_check
    CHECK (content_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT knowledge_sources_pack_identifier_unique
    UNIQUE (knowledge_pack_id, source_id)
);

CREATE INDEX knowledge_sources_pack_created_idx
  ON knowledge_sources (knowledge_pack_id, created_at, id);
CREATE INDEX knowledge_sources_type_idx
  ON knowledge_sources (source_type, knowledge_pack_id);

CREATE TABLE knowledge_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  knowledge_pack_id uuid NOT NULL REFERENCES knowledge_packs(id) ON DELETE RESTRICT,
  rule_id text NOT NULL,
  rule_name text NOT NULL,
  rule_scope text NOT NULL,
  domain text NOT NULL,
  subcategory text NOT NULL,
  principle text NOT NULL,
  why_it_matters text,
  implementation_instruction text NOT NULL,
  priority text NOT NULL,
  validation_type text NOT NULL,
  publication_effect text NOT NULL,
  enforcement_authority text NOT NULL,
  required_business_data_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  prohibited_behaviour text,
  anti_pattern text,
  deterministic_test_description text,
  ai_review_instruction text,
  human_review_instruction text,
  support_type text,
  temporal_class text NOT NULL,
  verification_source_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  verified_at date,
  review_due_at date,
  confidence numeric(5,4) NOT NULL,
  notes text,
  status text NOT NULL DEFAULT 'ACCEPTED',
  content_digest_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_rules_identifier_check
    CHECK (rule_id ~ '^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$' AND char_length(rule_id) <= 120),
  CONSTRAINT knowledge_rules_name_check
    CHECK (char_length(btrim(rule_name)) BETWEEN 1 AND 240),
  CONSTRAINT knowledge_rules_scope_check
    CHECK (rule_scope IN (
      'PUBLIC_SITE', 'CONTENT_GENERATION', 'SEO_AUDIT',
      'BOOKING_FLOW', 'PLATFORM_SECURITY'
    )),
  CONSTRAINT knowledge_rules_domain_check
    CHECK (domain IN (
      'UX', 'MOBILE', 'ACCESSIBILITY', 'TECHNICAL_SEO', 'LOCAL_SEO',
      'CONTENT_SEO', 'COPYWRITING', 'CONVERSION', 'TRUST', 'BOOKING',
      'PERFORMANCE'
    )),
  CONSTRAINT knowledge_rules_priority_check
    CHECK (priority IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
  CONSTRAINT knowledge_rules_validation_type_check
    CHECK (validation_type IN (
      'DETERMINISTIC', 'AI_REVIEW', 'HUMAN_REVIEW', 'DATA_REQUIRED', 'MIXED'
    )),
  CONSTRAINT knowledge_rules_publication_effect_check
    CHECK (publication_effect IN ('BLOCK', 'WARNING', 'RECOMMENDATION')),
  CONSTRAINT knowledge_rules_authority_check
    CHECK (enforcement_authority IN (
      'PLATFORM', 'OFFICIAL_STANDARD', 'OFFICIAL_DOCUMENTATION',
      'EXPERT_APPROVED', 'ADVISORY'
    )),
  CONSTRAINT knowledge_rules_block_authority_check
    CHECK (
      publication_effect <> 'BLOCK'
      OR enforcement_authority IN (
        'PLATFORM', 'OFFICIAL_STANDARD', 'OFFICIAL_DOCUMENTATION', 'EXPERT_APPROVED'
      )
    ),
  CONSTRAINT knowledge_rules_support_check
    CHECK (support_type IS NULL OR support_type IN ('DIRECT', 'SYNTHESISED', 'INFERRED')),
  CONSTRAINT knowledge_rules_temporal_check
    CHECK (temporal_class IN ('STABLE', 'SLOW_CHANGING', 'TIME_SENSITIVE', 'EXPERIMENTAL')),
  CONSTRAINT knowledge_rules_status_check
    CHECK (status IN ('ACCEPTED', 'REJECTED', 'DEPRECATED')),
  CONSTRAINT knowledge_rules_required_data_json_check
    CHECK (jsonb_typeof(required_business_data_json) = 'array'),
  CONSTRAINT knowledge_rules_verification_sources_json_check
    CHECK (jsonb_typeof(verification_source_ids_json) = 'array'),
  CONSTRAINT knowledge_rules_confidence_check CHECK (confidence BETWEEN 0 AND 1),
  CONSTRAINT knowledge_rules_distilled_lengths_check
    CHECK (
      char_length(principle) BETWEEN 1 AND 1200
      AND char_length(implementation_instruction) BETWEEN 1 AND 2000
      AND (why_it_matters IS NULL OR char_length(why_it_matters) <= 1500)
      AND (notes IS NULL OR char_length(notes) <= 1000)
    ),
  CONSTRAINT knowledge_rules_content_digest_check
    CHECK (content_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT knowledge_rules_pack_identifier_unique
    UNIQUE (knowledge_pack_id, rule_id)
);

CREATE INDEX knowledge_rules_pack_order_idx
  ON knowledge_rules (
    knowledge_pack_id, enforcement_authority, publication_effect,
    priority, domain, rule_id
  );
CREATE INDEX knowledge_rules_pack_domain_idx
  ON knowledge_rules (knowledge_pack_id, domain, status);
CREATE INDEX knowledge_rules_content_digest_idx
  ON knowledge_rules (knowledge_pack_id, content_digest_sha256);

CREATE TABLE knowledge_rule_page_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_pack_id uuid NOT NULL REFERENCES knowledge_packs(id) ON DELETE RESTRICT,
  knowledge_rule_id uuid NOT NULL REFERENCES knowledge_rules(id) ON DELETE RESTRICT,
  page_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_rule_page_types_value_check
    CHECK (page_type IN (
      'HOME', 'SERVICE_HUB', 'SERVICE_DETAIL', 'LOCATION_HUB',
      'LOCATION_DETAIL', 'ABOUT', 'TEAM_HUB', 'TEAM_DETAIL', 'CONTACT',
      'FAQ', 'POLICIES', 'RESULTS', 'NEW_CLIENT_GUIDE', 'AFTERCARE_GUIDE',
      'CONSULTATION_GUIDE', 'BOOKING'
    )),
  CONSTRAINT knowledge_rule_page_types_unique
    UNIQUE (knowledge_rule_id, page_type)
);
CREATE INDEX knowledge_rule_page_types_pack_page_idx
  ON knowledge_rule_page_types (knowledge_pack_id, page_type, knowledge_rule_id);

CREATE TABLE knowledge_rule_section_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_pack_id uuid NOT NULL REFERENCES knowledge_packs(id) ON DELETE RESTRICT,
  knowledge_rule_id uuid NOT NULL REFERENCES knowledge_rules(id) ON DELETE RESTRICT,
  section_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_rule_section_types_value_check
    CHECK (section_type IN (
      'HEADER', 'ANNOUNCEMENT_BAR', 'HERO', 'INTRODUCTION',
      'FEATURED_SERVICES', 'SERVICE_GRID', 'SERVICE_DETAILS', 'BENEFITS',
      'PROCESS', 'PRICING', 'TEAM', 'STAFF_PROFILE', 'GALLERY', 'RESULTS',
      'TESTIMONIALS', 'TRUST_INDICATORS', 'FAQ', 'LOCATION',
      'OPENING_HOURS', 'CONTACT', 'BOOKING_CTA', 'FINAL_CTA', 'FOOTER',
      'RICH_TEXT'
    )),
  CONSTRAINT knowledge_rule_section_types_unique
    UNIQUE (knowledge_rule_id, section_type)
);
CREATE INDEX knowledge_rule_section_types_pack_section_idx
  ON knowledge_rule_section_types (knowledge_pack_id, section_type, knowledge_rule_id);

CREATE TABLE knowledge_rule_conversion_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_pack_id uuid NOT NULL REFERENCES knowledge_packs(id) ON DELETE RESTRICT,
  knowledge_rule_id uuid NOT NULL REFERENCES knowledge_rules(id) ON DELETE RESTRICT,
  conversion_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_rule_conversion_roles_value_check
    CHECK (conversion_role IN (
      'PRIMARY_LANDING', 'SERVICE_CONVERSION', 'LOCAL_DISCOVERY',
      'TRUST_BUILDING', 'OBJECTION_HANDLING', 'BOOKING'
    )),
  CONSTRAINT knowledge_rule_conversion_roles_unique
    UNIQUE (knowledge_rule_id, conversion_role)
);
CREATE INDEX knowledge_rule_conversion_roles_pack_role_idx
  ON knowledge_rule_conversion_roles (
    knowledge_pack_id, conversion_role, knowledge_rule_id
  );

CREATE TABLE knowledge_rule_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_pack_id uuid NOT NULL REFERENCES knowledge_packs(id) ON DELETE RESTRICT,
  knowledge_rule_id uuid NOT NULL REFERENCES knowledge_rules(id) ON DELETE RESTRICT,
  knowledge_source_id uuid NOT NULL REFERENCES knowledge_sources(id) ON DELETE RESTRICT,
  relationship_type text NOT NULL DEFAULT 'SUPPORT',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_rule_sources_relationship_check
    CHECK (relationship_type IN ('SUPPORT', 'VERIFICATION')),
  CONSTRAINT knowledge_rule_sources_unique
    UNIQUE (knowledge_rule_id, knowledge_source_id, relationship_type)
);
CREATE INDEX knowledge_rule_sources_pack_rule_idx
  ON knowledge_rule_sources (knowledge_pack_id, knowledge_rule_id);
CREATE INDEX knowledge_rule_sources_source_idx
  ON knowledge_rule_sources (knowledge_source_id, knowledge_rule_id);

CREATE TABLE knowledge_page_playbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  knowledge_pack_id uuid NOT NULL REFERENCES knowledge_packs(id) ON DELETE RESTRICT,
  page_type text NOT NULL,
  conversion_role text NOT NULL,
  content_digest_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_page_playbooks_page_type_check
    CHECK (page_type IN (
      'HOME', 'SERVICE_HUB', 'SERVICE_DETAIL', 'LOCATION_HUB',
      'LOCATION_DETAIL', 'ABOUT', 'TEAM_HUB', 'TEAM_DETAIL', 'CONTACT',
      'FAQ', 'POLICIES', 'RESULTS', 'NEW_CLIENT_GUIDE', 'AFTERCARE_GUIDE',
      'CONSULTATION_GUIDE', 'BOOKING'
    )),
  CONSTRAINT knowledge_page_playbooks_conversion_role_check
    CHECK (conversion_role IN (
      'PRIMARY_LANDING', 'SERVICE_CONVERSION', 'LOCAL_DISCOVERY',
      'TRUST_BUILDING', 'OBJECTION_HANDLING', 'BOOKING'
    )),
  CONSTRAINT knowledge_page_playbooks_digest_check
    CHECK (content_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT knowledge_page_playbooks_unique
    UNIQUE (knowledge_pack_id, page_type, conversion_role)
);
CREATE INDEX knowledge_page_playbooks_pack_page_idx
  ON knowledge_page_playbooks (knowledge_pack_id, page_type, conversion_role);

CREATE TABLE knowledge_section_playbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  knowledge_pack_id uuid NOT NULL REFERENCES knowledge_packs(id) ON DELETE RESTRICT,
  page_playbook_id uuid NOT NULL REFERENCES knowledge_page_playbooks(id) ON DELETE RESTRICT,
  section_type text NOT NULL,
  section_order_min integer NOT NULL,
  section_order_max integer NOT NULL,
  requirement text NOT NULL,
  user_intent text NOT NULL,
  business_objective text,
  section_purpose text NOT NULL,
  required_business_data_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  copy_instruction text,
  seo_instruction text,
  trust_instruction text,
  booking_instruction text,
  mobile_instruction text,
  accessibility_instruction text,
  allowed_primary_cta_types_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  allowed_secondary_cta_types_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  blocking_conditions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  common_anti_patterns_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  rule_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence numeric(5,4) NOT NULL,
  notes text,
  content_digest_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_section_playbooks_section_type_check
    CHECK (section_type IN (
      'HEADER', 'ANNOUNCEMENT_BAR', 'HERO', 'INTRODUCTION',
      'FEATURED_SERVICES', 'SERVICE_GRID', 'SERVICE_DETAILS', 'BENEFITS',
      'PROCESS', 'PRICING', 'TEAM', 'STAFF_PROFILE', 'GALLERY', 'RESULTS',
      'TESTIMONIALS', 'TRUST_INDICATORS', 'FAQ', 'LOCATION',
      'OPENING_HOURS', 'CONTACT', 'BOOKING_CTA', 'FINAL_CTA', 'FOOTER',
      'RICH_TEXT'
    )),
  CONSTRAINT knowledge_section_playbooks_order_check
    CHECK (
      section_order_min BETWEEN 0 AND 100
      AND section_order_max BETWEEN section_order_min AND 100
    ),
  CONSTRAINT knowledge_section_playbooks_requirement_check
    CHECK (requirement IN (
      'REQUIRED', 'RECOMMENDED', 'OPTIONAL', 'CONDITIONAL', 'PROHIBITED'
    )),
  CONSTRAINT knowledge_section_playbooks_json_arrays_check
    CHECK (
      jsonb_typeof(required_business_data_json) = 'array'
      AND jsonb_typeof(allowed_primary_cta_types_json) = 'array'
      AND jsonb_typeof(allowed_secondary_cta_types_json) = 'array'
      AND jsonb_typeof(blocking_conditions_json) = 'array'
      AND jsonb_typeof(common_anti_patterns_json) = 'array'
      AND jsonb_typeof(rule_ids_json) = 'array'
      AND jsonb_typeof(source_ids_json) = 'array'
    ),
  CONSTRAINT knowledge_section_playbooks_confidence_check
    CHECK (confidence BETWEEN 0 AND 1),
  CONSTRAINT knowledge_section_playbooks_digest_check
    CHECK (content_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT knowledge_section_playbooks_unique
    UNIQUE (
      page_playbook_id, section_type, section_order_min, section_order_max
    )
);
CREATE INDEX knowledge_section_playbooks_pack_page_idx
  ON knowledge_section_playbooks (
    knowledge_pack_id, page_playbook_id, section_order_min, id
  );
CREATE INDEX knowledge_section_playbooks_section_idx
  ON knowledge_section_playbooks (section_type, knowledge_pack_id);

CREATE TABLE knowledge_import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  knowledge_pack_id uuid NOT NULL REFERENCES knowledge_packs(id) ON DELETE RESTRICT,
  import_format text NOT NULL,
  source_digest_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'STARTED',
  source_count integer NOT NULL DEFAULT 0,
  rule_count integer NOT NULL DEFAULT 0,
  page_playbook_count integer NOT NULL DEFAULT 0,
  section_playbook_count integer NOT NULL DEFAULT 0,
  rejected_rule_count integer NOT NULL DEFAULT 0,
  finding_count integer NOT NULL DEFAULT 0,
  conflict_count integer NOT NULL DEFAULT 0,
  failure_code text,
  requested_by_agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT knowledge_import_runs_format_check
    CHECK (import_format IN ('CSV', 'JSON')),
  CONSTRAINT knowledge_import_runs_status_check
    CHECK (status IN ('STARTED', 'COMPLETED', 'FAILED')),
  CONSTRAINT knowledge_import_runs_digest_check
    CHECK (source_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT knowledge_import_runs_counts_check
    CHECK (
      source_count >= 0 AND rule_count >= 0 AND page_playbook_count >= 0
      AND section_playbook_count >= 0 AND rejected_rule_count >= 0
      AND finding_count >= 0 AND conflict_count >= 0
    ),
  CONSTRAINT knowledge_import_runs_pack_digest_unique
    UNIQUE (knowledge_pack_id, source_digest_sha256)
);
CREATE INDEX knowledge_import_runs_pack_started_idx
  ON knowledge_import_runs (knowledge_pack_id, started_at DESC, id);
CREATE INDEX knowledge_import_runs_requested_by_idx
  ON knowledge_import_runs (requested_by_agency_user_id);

CREATE TABLE knowledge_import_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  knowledge_pack_id uuid NOT NULL REFERENCES knowledge_packs(id) ON DELETE RESTRICT,
  import_run_id uuid REFERENCES knowledge_import_runs(id) ON DELETE RESTRICT,
  severity text NOT NULL,
  category text NOT NULL,
  code text NOT NULL,
  message text NOT NULL,
  blocks_approval boolean NOT NULL DEFAULT false,
  rule_id text,
  source_id text,
  page_type text,
  section_type text,
  current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_import_findings_severity_check
    CHECK (severity IN ('ERROR', 'WARNING', 'REVIEW')),
  CONSTRAINT knowledge_import_findings_category_check
    CHECK (category IN (
      'SCHEMA', 'DUPLICATE', 'PROVENANCE', 'COPYRIGHT', 'CONFLICT',
      'BOOKING', 'BUSINESS_DATA', 'PLAYBOOK', 'GOVERNANCE'
    )),
  CONSTRAINT knowledge_import_findings_code_check
    CHECK (code ~ '^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$' AND char_length(code) <= 120),
  CONSTRAINT knowledge_import_findings_message_check
    CHECK (char_length(message) BETWEEN 1 AND 500)
);
CREATE INDEX knowledge_import_findings_pack_current_idx
  ON knowledge_import_findings (
    knowledge_pack_id, current, blocks_approval, severity, created_at, id
  );
CREATE INDEX knowledge_import_findings_import_idx
  ON knowledge_import_findings (import_run_id, created_at, id);

CREATE TABLE knowledge_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  knowledge_pack_id uuid NOT NULL REFERENCES knowledge_packs(id) ON DELETE RESTRICT,
  import_run_id uuid REFERENCES knowledge_import_runs(id) ON DELETE RESTRICT,
  conflict_type text NOT NULL,
  severity text NOT NULL,
  summary text NOT NULL,
  rule_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  page_type text,
  section_type text,
  status text NOT NULL DEFAULT 'OPEN',
  resolution_reason text,
  resolved_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  resolved_at timestamptz,
  current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_conflicts_type_check
    CHECK (conflict_type IN (
      'PRIORITY_MISMATCH', 'PUBLICATION_EFFECT_MISMATCH',
      'REQUIRED_PROHIBITED_SECTION', 'EXTERNAL_BOOKING',
      'ACCESSIBILITY_ANIMATION', 'URGENCY_TRUST', 'SEO_THIN_CONTENT',
      'UNSUPPORTED_CLAIM', 'MUTUALLY_EXCLUSIVE_INSTRUCTIONS'
    )),
  CONSTRAINT knowledge_conflicts_severity_check
    CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM')),
  CONSTRAINT knowledge_conflicts_status_check
    CHECK (status IN ('OPEN', 'RESOLVED', 'DISMISSED')),
  CONSTRAINT knowledge_conflicts_rules_json_check
    CHECK (jsonb_typeof(rule_ids_json) = 'array'),
  CONSTRAINT knowledge_conflicts_summary_check
    CHECK (char_length(summary) BETWEEN 1 AND 500)
);
CREATE INDEX knowledge_conflicts_pack_current_idx
  ON knowledge_conflicts (
    knowledge_pack_id, current, status, severity, created_at, id
  );
CREATE INDEX knowledge_conflicts_import_idx
  ON knowledge_conflicts (import_run_id, created_at, id);
CREATE INDEX knowledge_conflicts_resolved_by_idx
  ON knowledge_conflicts (resolved_by_agency_user_id);

CREATE TABLE knowledge_rejected_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  knowledge_pack_id uuid NOT NULL REFERENCES knowledge_packs(id) ON DELETE RESTRICT,
  rule_id text NOT NULL,
  rule_name text NOT NULL,
  rejection_reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_rejected_rules_identifier_check
    CHECK (rule_id ~ '^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$' AND char_length(rule_id) <= 120),
  CONSTRAINT knowledge_rejected_rules_reason_check
    CHECK (char_length(rejection_reason) BETWEEN 1 AND 1000),
  CONSTRAINT knowledge_rejected_rules_unique
    UNIQUE (knowledge_pack_id, rule_id)
);
CREATE INDEX knowledge_rejected_rules_pack_idx
  ON knowledge_rejected_rules (knowledge_pack_id, rule_id);

CREATE OR REPLACE FUNCTION ks_validate_knowledge_pack_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'DRAFT' AND NEW.status IN ('IMPORTING', 'REJECTED'))
    OR (OLD.status = 'IMPORTING' AND NEW.status = 'REVIEW_REQUIRED')
    OR (
      OLD.status = 'REVIEW_REQUIRED'
      AND NEW.status IN ('IMPORTING', 'READY_FOR_APPROVAL', 'REJECTED')
    )
    OR (
      OLD.status = 'READY_FOR_APPROVAL'
      AND NEW.status IN ('IMPORTING', 'REVIEW_REQUIRED', 'APPROVED', 'REJECTED')
    )
    OR (OLD.status = 'APPROVED' AND NEW.status IN ('ACTIVE', 'RETIRED'))
    OR (OLD.status = 'ACTIVE' AND NEW.status IN ('RETIRED', 'SUPERSEDED'))
  ) THEN
    RAISE EXCEPTION 'Invalid knowledge-pack transition: % -> %',
      OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;

  IF OLD.status IN ('APPROVED', 'ACTIVE', 'RETIRED', 'REJECTED', 'SUPERSEDED')
    AND (
      NEW.name IS DISTINCT FROM OLD.name
      OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.semantic_version IS DISTINCT FROM OLD.semantic_version
      OR NEW.intended_scope IS DISTINCT FROM OLD.intended_scope
      OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
      OR NEW.source_digest_sha256 IS DISTINCT FROM OLD.source_digest_sha256
      OR NEW.content_digest_sha256 IS DISTINCT FROM OLD.content_digest_sha256
      OR NEW.rule_count IS DISTINCT FROM OLD.rule_count
      OR NEW.page_playbook_count IS DISTINCT FROM OLD.page_playbook_count
      OR NEW.section_playbook_count IS DISTINCT FROM OLD.section_playbook_count
      OR NEW.source_count IS DISTINCT FROM OLD.source_count
    )
  THEN
    RAISE EXCEPTION 'Approved knowledge-pack content is immutable'
      USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER knowledge_packs_transition_guard
BEFORE UPDATE ON knowledge_packs
FOR EACH ROW EXECUTE FUNCTION ks_validate_knowledge_pack_transition();

CREATE OR REPLACE FUNCTION ks_validate_knowledge_pack_child()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  child_pack_id uuid;
  parent_pack_id uuid;
  pack_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    child_pack_id := OLD.knowledge_pack_id;
  ELSE
    child_pack_id := NEW.knowledge_pack_id;
  END IF;
  SELECT status INTO pack_status
  FROM knowledge_packs
  WHERE id = child_pack_id;

  IF pack_status IS NULL THEN
    RAISE EXCEPTION 'Knowledge pack does not exist' USING ERRCODE = '23503';
  END IF;
  IF pack_status NOT IN (
    'DRAFT', 'IMPORTING', 'REVIEW_REQUIRED', 'READY_FOR_APPROVAL'
  ) THEN
    RAISE EXCEPTION 'Approved knowledge-pack content is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME IN (
    'knowledge_rule_page_types',
    'knowledge_rule_section_types',
    'knowledge_rule_conversion_roles',
    'knowledge_rule_sources'
  ) THEN
    SELECT knowledge_pack_id INTO parent_pack_id
    FROM knowledge_rules
    WHERE id = CASE
      WHEN TG_OP = 'DELETE' THEN OLD.knowledge_rule_id
      ELSE NEW.knowledge_rule_id
    END;
    IF parent_pack_id IS DISTINCT FROM child_pack_id THEN
      RAISE EXCEPTION 'Knowledge-rule ownership mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'knowledge_rule_sources' THEN
    SELECT knowledge_pack_id INTO parent_pack_id
    FROM knowledge_sources
    WHERE id = CASE
      WHEN TG_OP = 'DELETE' THEN OLD.knowledge_source_id
      ELSE NEW.knowledge_source_id
    END;
    IF parent_pack_id IS DISTINCT FROM child_pack_id THEN
      RAISE EXCEPTION 'Knowledge-source ownership mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'knowledge_section_playbooks' THEN
    SELECT knowledge_pack_id INTO parent_pack_id
    FROM knowledge_page_playbooks
    WHERE id = CASE
      WHEN TG_OP = 'DELETE' THEN OLD.page_playbook_id
      ELSE NEW.page_playbook_id
    END;
    IF parent_pack_id IS DISTINCT FROM child_pack_id THEN
      RAISE EXCEPTION 'Knowledge-playbook ownership mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'knowledge_sources',
    'knowledge_rules',
    'knowledge_rule_page_types',
    'knowledge_rule_section_types',
    'knowledge_rule_conversion_roles',
    'knowledge_rule_sources',
    'knowledge_page_playbooks',
    'knowledge_section_playbooks',
    'knowledge_import_runs',
    'knowledge_import_findings',
    'knowledge_conflicts',
    'knowledge_rejected_rules'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_mutability_guard '
      'BEFORE INSERT OR UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION ks_validate_knowledge_pack_child()',
      table_name,
      table_name
    );
  END LOOP;
END;
$$;

ALTER TABLE knowledge_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_rule_page_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_rule_section_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_rule_conversion_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_rule_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_page_playbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_section_playbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_import_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_import_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_rejected_rules ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  knowledge_packs,
  knowledge_sources,
  knowledge_rules,
  knowledge_rule_page_types,
  knowledge_rule_section_types,
  knowledge_rule_conversion_roles,
  knowledge_rule_sources,
  knowledge_page_playbooks,
  knowledge_section_playbooks,
  knowledge_import_runs,
  knowledge_import_findings,
  knowledge_conflicts,
  knowledge_rejected_rules
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE
  knowledge_packs,
  knowledge_sources,
  knowledge_rules,
  knowledge_page_playbooks,
  knowledge_section_playbooks,
  knowledge_import_runs,
  knowledge_import_findings,
  knowledge_conflicts,
  knowledge_rejected_rules
TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  knowledge_rule_page_types,
  knowledge_rule_section_types,
  knowledge_rule_conversion_roles,
  knowledge_rule_sources
TO service_role;

REVOKE EXECUTE ON FUNCTION ks_validate_knowledge_pack_transition()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ks_validate_knowledge_pack_child()
  FROM PUBLIC, anon, authenticated;
