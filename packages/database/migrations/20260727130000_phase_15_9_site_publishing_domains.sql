-- Phase 15.9: immutable site publication pointers, fallback/custom hostname
-- governance, reviewed DNS operations, health evidence and rollback history.
-- Publishing changes data pointers only; it never deploys application code.

ALTER TABLE site_render_snapshots
  ADD COLUMN IF NOT EXISTS site_version_digest_sha256 varchar(64),
  ADD COLUMN IF NOT EXISTS quality_run_id uuid
    REFERENCES site_quality_runs(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS quality_policy_version varchar(100),
  ADD COLUMN IF NOT EXISTS knowledge_pack_id uuid
    REFERENCES knowledge_packs(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS knowledge_pack_semantic_version varchar(50),
  ADD COLUMN IF NOT EXISTS knowledge_pack_digest_sha256 varchar(64),
  ADD COLUMN IF NOT EXISTS renderer_release_version varchar(100);

CREATE INDEX IF NOT EXISTS site_render_snapshots_quality_run_idx
  ON site_render_snapshots(quality_run_id)
  WHERE quality_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_render_snapshots_knowledge_pack_idx
  ON site_render_snapshots(knowledge_pack_id)
  WHERE knowledge_pack_id IS NOT NULL;

ALTER TABLE site_domains
  ADD COLUMN IF NOT EXISTS domain_type varchar(20) NOT NULL DEFAULT 'CUSTOM',
  ADD COLUMN IF NOT EXISTS domain_role varchar(20) NOT NULL DEFAULT 'ALIAS',
  ADD COLUMN IF NOT EXISTS provider_key varchar(30),
  ADD COLUMN IF NOT EXISTS provider_safe_reference varchar(255),
  ADD COLUMN IF NOT EXISTS ownership_status varchar(30) NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN IF NOT EXISTS ssl_status varchar(30) NOT NULL DEFAULT 'NOT_REQUESTED',
  ADD COLUMN IF NOT EXISTS canonical_preference varchar(20) NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS redirect_target_domain_id uuid
    REFERENCES site_domains(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS last_healthy_at timestamptz,
  ADD COLUMN IF NOT EXISTS degraded_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS removed_at timestamptz,
  ADD COLUMN IF NOT EXISTS removal_cooldown_until timestamptz,
  ADD COLUMN IF NOT EXISTS reassignment_approved_by_agency_user_id uuid
    REFERENCES agency_users(id) ON DELETE RESTRICT;

ALTER TABLE site_domains
  DROP CONSTRAINT IF EXISTS site_domains_status_check;

-- Preserve existing live hostnames while introducing the stricter Phase 15.9
-- ownership and certificate invariants.
UPDATE site_domains
SET ownership_status = 'VERIFIED',
    ssl_status = 'ACTIVE'
WHERE status = 'ACTIVE';

ALTER TABLE site_domains
  ADD CONSTRAINT site_domains_status_check CHECK (status IN (
    'RESERVED','DNS_DISCOVERY_PENDING','DNS_REVIEW_REQUIRED',
    'NAMESERVER_ACTION_REQUIRED','NAMESERVER_CHECK_PENDING','VERIFYING',
    'VERIFIED','SSL_PENDING','ACTIVATING','ACTIVE','DEGRADED','FAILED',
    'SUSPENDED','REMOVED'
  )) NOT VALID;
ALTER TABLE site_domains VALIDATE CONSTRAINT site_domains_status_check;

ALTER TABLE site_domains
  ADD CONSTRAINT site_domains_type_valid
    CHECK (domain_type IN ('FALLBACK','CUSTOM')),
  ADD CONSTRAINT site_domains_role_valid
    CHECK (domain_role IN ('CANONICAL','ALIAS','FALLBACK')),
  ADD CONSTRAINT site_domains_provider_valid
    CHECK (provider_key IS NULL OR provider_key IN ('KS_OS','CLOUDFLARE','VERCEL')),
  ADD CONSTRAINT site_domains_ownership_valid
    CHECK (ownership_status IN ('UNVERIFIED','CHALLENGE_PENDING','VERIFIED','CONFLICT','REVOKED')),
  ADD CONSTRAINT site_domains_ssl_valid
    CHECK (ssl_status IN ('NOT_REQUESTED','PENDING','ACTIVE','FAILED')),
  ADD CONSTRAINT site_domains_canonical_preference_valid
    CHECK (canonical_preference IN ('NONE','APEX','WWW')),
  ADD CONSTRAINT site_domains_fallback_shape
    CHECK (
      (domain_type = 'FALLBACK' AND domain_role = 'FALLBACK' AND provider_key = 'KS_OS')
      OR domain_type = 'CUSTOM'
    ),
  ADD CONSTRAINT site_domains_active_requirements
    CHECK (
      status <> 'ACTIVE'
      OR (
        ownership_status = 'VERIFIED'
        AND ssl_status = 'ACTIVE'
      )
    ),
  ADD CONSTRAINT site_domains_redirect_not_self
    CHECK (redirect_target_domain_id IS NULL OR redirect_target_domain_id <> id);

CREATE UNIQUE INDEX IF NOT EXISTS site_domains_one_fallback_per_site_idx
  ON site_domains(site_id) WHERE domain_type = 'FALLBACK' AND status <> 'REMOVED';
CREATE UNIQUE INDEX IF NOT EXISTS site_domains_one_canonical_per_site_idx
  ON site_domains(site_id) WHERE domain_role = 'CANONICAL' AND status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS site_domains_provider_reference_idx
  ON site_domains(provider_key, provider_safe_reference)
  WHERE provider_safe_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_domains_removal_cooldown_idx
  ON site_domains(removal_cooldown_until)
  WHERE removal_cooldown_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_domains_redirect_target_idx
  ON site_domains(redirect_target_domain_id)
  WHERE redirect_target_domain_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS site_publication_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  site_version_id uuid NOT NULL REFERENCES site_versions(id) ON DELETE RESTRICT,
  snapshot_id uuid REFERENCES site_render_snapshots(id) ON DELETE RESTRICT,
  previous_snapshot_id uuid REFERENCES site_render_snapshots(id) ON DELETE RESTRICT,
  quality_run_id uuid NOT NULL REFERENCES site_quality_runs(id) ON DELETE RESTRICT,
  site_job_id uuid REFERENCES site_jobs(id) ON DELETE RESTRICT,
  status varchar(40) NOT NULL DEFAULT 'REQUESTED' CHECK (status IN (
    'REQUESTED','VALIDATING','SNAPSHOTTING','ACTIVATING_HOSTNAMES',
    'SWITCHING_POINTER','INVALIDATING_CACHE','HEALTH_CHECKING','LIVE',
    'FAILED','CANCEL_REQUESTED','CANCELLED','ROLLING_BACK','ROLLED_BACK',
    'SUPERSEDED'
  )),
  reason varchar(40) NOT NULL CHECK (reason IN (
    'INITIAL_PUBLICATION','CONTENT_UPDATE','SEO_PAGE_PUBLICATION',
    'MANUAL_REPUBLICATION','ROLLBACK','DOMAIN_ACTIVATION_RECHECK'
  )),
  requested_by_agency_user_id uuid NOT NULL
    REFERENCES agency_users(id) ON DELETE RESTRICT,
  warning_acknowledgement_json jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(warning_acknowledgement_json) = 'object'),
  idempotency_key varchar(64) NOT NULL UNIQUE
    CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  failure_code varchar(100),
  failure_message varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (snapshot_id IS NULL OR snapshot_id <> previous_snapshot_id),
  CHECK (
    status NOT IN ('LIVE','ROLLED_BACK')
    OR (snapshot_id IS NOT NULL AND completed_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS site_publication_runs_site_created_idx
  ON site_publication_runs(tenant_id, site_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS site_publication_runs_status_created_idx
  ON site_publication_runs(status, created_at, id);
CREATE INDEX IF NOT EXISTS site_publication_runs_version_idx
  ON site_publication_runs(site_version_id, created_at DESC);
CREATE INDEX IF NOT EXISTS site_publication_runs_quality_idx
  ON site_publication_runs(quality_run_id);
CREATE INDEX IF NOT EXISTS site_publication_runs_snapshot_idx
  ON site_publication_runs(snapshot_id)
  WHERE snapshot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_publication_runs_previous_snapshot_idx
  ON site_publication_runs(previous_snapshot_id)
  WHERE previous_snapshot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_publication_runs_job_idx
  ON site_publication_runs(site_job_id)
  WHERE site_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_publication_runs_requested_by_idx
  ON site_publication_runs(requested_by_agency_user_id);

CREATE TABLE IF NOT EXISTS site_publication_pointers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL UNIQUE REFERENCES sites(id) ON DELETE RESTRICT,
  active_snapshot_id uuid NOT NULL REFERENCES site_render_snapshots(id) ON DELETE RESTRICT,
  previous_snapshot_id uuid REFERENCES site_render_snapshots(id) ON DELETE RESTRICT,
  publication_run_id uuid NOT NULL
    REFERENCES site_publication_runs(id) ON DELETE RESTRICT,
  pointer_version integer NOT NULL DEFAULT 1 CHECK (pointer_version > 0),
  activated_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (active_snapshot_id <> previous_snapshot_id)
);
CREATE INDEX IF NOT EXISTS site_publication_pointers_active_snapshot_idx
  ON site_publication_pointers(active_snapshot_id);
CREATE INDEX IF NOT EXISTS site_publication_pointers_previous_snapshot_idx
  ON site_publication_pointers(previous_snapshot_id)
  WHERE previous_snapshot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_publication_pointers_run_idx
  ON site_publication_pointers(publication_run_id);

CREATE TABLE IF NOT EXISTS site_domain_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  domain_id uuid NOT NULL REFERENCES site_domains(id) ON DELETE RESTRICT,
  verification_type varchar(40) NOT NULL CHECK (verification_type IN (
    'VERCEL_OWNERSHIP','DNS_TXT','NAMESERVER_DELEGATION','HTTP_CHALLENGE','SSL'
  )),
  status varchar(30) NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING','VERIFIED','FAILED','EXPIRED','REVOKED'
  )),
  challenge_digest_sha256 varchar(64)
    CHECK (challenge_digest_sha256 IS NULL OR challenge_digest_sha256 ~ '^[0-9a-f]{64}$'),
  provider_safe_reference varchar(255),
  safe_evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(safe_evidence_json) = 'object'),
  verified_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS site_domain_verifications_domain_created_idx
  ON site_domain_verifications(domain_id, created_at DESC);
CREATE INDEX IF NOT EXISTS site_domain_verifications_site_status_idx
  ON site_domain_verifications(tenant_id, site_id, status);

CREATE TABLE IF NOT EXISTS site_domain_dns_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  domain_id uuid NOT NULL REFERENCES site_domains(id) ON DELETE RESTRICT,
  status varchar(30) NOT NULL DEFAULT 'DISCOVERED' CHECK (status IN (
    'DISCOVERED','REVIEW_REQUIRED','APPROVED','APPLYING','APPLIED','FAILED','SUPERSEDED'
  )),
  discovery_digest_sha256 varchar(64) NOT NULL
    CHECK (discovery_digest_sha256 ~ '^[0-9a-f]{64}$'),
  reviewed_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS site_domain_dns_plans_domain_created_idx
  ON site_domain_dns_plans(domain_id, created_at DESC);
CREATE INDEX IF NOT EXISTS site_domain_dns_plans_reviewer_idx
  ON site_domain_dns_plans(reviewed_by_agency_user_id)
  WHERE reviewed_by_agency_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS site_domain_dns_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  domain_id uuid NOT NULL REFERENCES site_domains(id) ON DELETE RESTRICT,
  dns_plan_id uuid NOT NULL REFERENCES site_domain_dns_plans(id) ON DELETE RESTRICT,
  provider_safe_reference varchar(255),
  record_type varchar(10) NOT NULL CHECK (record_type IN (
    'A','AAAA','CAA','CNAME','MX','NS','SRV','TXT'
  )),
  record_name varchar(253) NOT NULL,
  record_content varchar(2000) NOT NULL,
  ttl integer CHECK (ttl IS NULL OR ttl BETWEEN 60 AND 86400),
  classification varchar(40) NOT NULL CHECK (classification IN (
    'WEBSITE','EMAIL','SECURITY','SERVICE','UNRELATED','CONFLICT_REVIEW_REQUIRED'
  )),
  protected boolean NOT NULL DEFAULT true,
  managed_by_ks_os boolean NOT NULL DEFAULT false,
  proxied boolean NOT NULL DEFAULT false,
  review_decision varchar(30) NOT NULL DEFAULT 'PENDING' CHECK (review_decision IN (
    'PENDING','PRESERVE','APPLY','REPLACE','REJECT'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (record_name = lower(record_name)),
  CHECK (proxied = false),
  CHECK (NOT managed_by_ks_os OR classification = 'WEBSITE')
);
CREATE INDEX IF NOT EXISTS site_domain_dns_records_plan_idx
  ON site_domain_dns_records(dns_plan_id, classification, review_decision, id);
CREATE INDEX IF NOT EXISTS site_domain_dns_records_domain_idx
  ON site_domain_dns_records(domain_id, record_name, record_type);
CREATE INDEX IF NOT EXISTS site_domain_dns_records_site_fk_idx
  ON site_domain_dns_records(site_id);

CREATE TABLE IF NOT EXISTS site_domain_provider_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  domain_id uuid REFERENCES site_domains(id) ON DELETE RESTRICT,
  publication_run_id uuid REFERENCES site_publication_runs(id) ON DELETE RESTRICT,
  provider_key varchar(30) NOT NULL CHECK (provider_key IN ('CLOUDFLARE','VERCEL')),
  operation_type varchar(60) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING','RUNNING','SUCCEEDED','RETRY_DELAY','FAILED',
    'COMPENSATING','COMPENSATED','CANCELLED'
  )),
  idempotency_key varchar(64) NOT NULL UNIQUE
    CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  maximum_attempts integer NOT NULL DEFAULT 5 CHECK (maximum_attempts BETWEEN 1 AND 20),
  provider_safe_reference varchar(255),
  safe_request_json jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(safe_request_json) = 'object'),
  safe_result_json jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(safe_result_json) = 'object'),
  failure_code varchar(100),
  safe_failure_message varchar(500),
  next_attempt_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (domain_id IS NOT NULL OR publication_run_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS site_domain_provider_operations_queue_idx
  ON site_domain_provider_operations(status, next_attempt_at, created_at)
  WHERE status IN ('PENDING','RETRY_DELAY');
CREATE INDEX IF NOT EXISTS site_domain_provider_operations_domain_idx
  ON site_domain_provider_operations(domain_id, created_at DESC)
  WHERE domain_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_domain_provider_operations_run_idx
  ON site_domain_provider_operations(publication_run_id, created_at DESC)
  WHERE publication_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_domain_provider_operations_site_fk_idx
  ON site_domain_provider_operations(site_id);

CREATE TABLE IF NOT EXISTS site_domain_redirects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  source_domain_id uuid NOT NULL REFERENCES site_domains(id) ON DELETE RESTRICT,
  target_domain_id uuid NOT NULL REFERENCES site_domains(id) ON DELETE RESTRICT,
  status varchar(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','SUSPENDED','REMOVED')),
  preserve_path boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_domain_id <> target_domain_id),
  UNIQUE(source_domain_id)
);
CREATE INDEX IF NOT EXISTS site_domain_redirects_target_idx
  ON site_domain_redirects(target_domain_id);
CREATE INDEX IF NOT EXISTS site_domain_redirects_site_idx
  ON site_domain_redirects(tenant_id, site_id, status);

CREATE TABLE IF NOT EXISTS site_publication_health_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  publication_run_id uuid NOT NULL
    REFERENCES site_publication_runs(id) ON DELETE RESTRICT,
  domain_id uuid NOT NULL REFERENCES site_domains(id) ON DELETE RESTRICT,
  snapshot_id uuid NOT NULL REFERENCES site_render_snapshots(id) ON DELETE RESTRICT,
  check_type varchar(30) NOT NULL CHECK (check_type IN (
    'HOMEPAGE','BOOKING_ENTRY','CANONICAL','SITEMAP','ROBOTS','SSL'
  )),
  status varchar(20) NOT NULL CHECK (status IN (
    'PENDING','PASSED','FAILED','TIMED_OUT'
  )),
  expected_snapshot_reference uuid NOT NULL,
  actual_snapshot_reference uuid,
  http_status integer CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  response_bytes integer CHECK (response_bytes IS NULL OR response_bytes >= 0),
  redirect_count integer NOT NULL DEFAULT 0 CHECK (redirect_count BETWEEN 0 AND 10),
  safe_evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(safe_evidence_json) = 'object'),
  failure_code varchar(100),
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS site_publication_health_checks_run_idx
  ON site_publication_health_checks(publication_run_id, status, checked_at DESC);
CREATE INDEX IF NOT EXISTS site_publication_health_checks_domain_idx
  ON site_publication_health_checks(domain_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS site_publication_health_checks_snapshot_idx
  ON site_publication_health_checks(snapshot_id);

CREATE TABLE IF NOT EXISTS site_cache_invalidation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  publication_run_id uuid NOT NULL
    REFERENCES site_publication_runs(id) ON DELETE RESTRICT,
  snapshot_id uuid NOT NULL REFERENCES site_render_snapshots(id) ON DELETE RESTRICT,
  pointer_version integer NOT NULL CHECK (pointer_version > 0),
  idempotency_key varchar(64) NOT NULL UNIQUE
    CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
  status varchar(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','SUCCEEDED','FAILED')),
  safe_tags_json jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(safe_tags_json) = 'array'),
  failure_code varchar(100),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS site_cache_invalidation_events_site_idx
  ON site_cache_invalidation_events(tenant_id, site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS site_cache_invalidation_events_run_idx
  ON site_cache_invalidation_events(publication_run_id);
CREATE INDEX IF NOT EXISTS site_cache_invalidation_events_snapshot_idx
  ON site_cache_invalidation_events(snapshot_id);

CREATE TABLE IF NOT EXISTS site_rollback_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  publication_run_id uuid NOT NULL
    REFERENCES site_publication_runs(id) ON DELETE RESTRICT,
  from_snapshot_id uuid NOT NULL REFERENCES site_render_snapshots(id) ON DELETE RESTRICT,
  to_snapshot_id uuid NOT NULL REFERENCES site_render_snapshots(id) ON DELETE RESTRICT,
  requested_by_agency_user_id uuid NOT NULL
    REFERENCES agency_users(id) ON DELETE RESTRICT,
  reason varchar(500) NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('REQUESTED','COMPLETED','FAILED')),
  pointer_version integer CHECK (pointer_version IS NULL OR pointer_version > 0),
  failure_code varchar(100),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (from_snapshot_id <> to_snapshot_id)
);
CREATE INDEX IF NOT EXISTS site_rollback_events_site_idx
  ON site_rollback_events(tenant_id, site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS site_rollback_events_run_idx
  ON site_rollback_events(publication_run_id);
CREATE INDEX IF NOT EXISTS site_rollback_events_from_snapshot_idx
  ON site_rollback_events(from_snapshot_id);
CREATE INDEX IF NOT EXISTS site_rollback_events_to_snapshot_idx
  ON site_rollback_events(to_snapshot_id);
CREATE INDEX IF NOT EXISTS site_rollback_events_requested_by_idx
  ON site_rollback_events(requested_by_agency_user_id);

CREATE TABLE IF NOT EXISTS site_domain_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  domain_id uuid NOT NULL REFERENCES site_domains(id) ON DELETE RESTRICT,
  event_type varchar(80) NOT NULL,
  status_from varchar(30),
  status_to varchar(30),
  safe_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(safe_metadata_json) = 'object'),
  agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS site_domain_events_domain_idx
  ON site_domain_events(domain_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS site_domain_events_site_idx
  ON site_domain_events(tenant_id, site_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS site_domain_events_agency_user_idx
  ON site_domain_events(agency_user_id)
  WHERE agency_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION ks_validate_phase_15_9_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  row_data jsonb := to_jsonb(NEW);
  expected_tenant_id uuid;
  expected_site_id uuid;
  related_id uuid;
BEGIN
  SELECT tenant_id INTO expected_tenant_id
  FROM sites
  WHERE id = NEW.site_id;
  IF expected_tenant_id IS NULL OR expected_tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'SITE_PUBLICATION_TENANT_SCOPE_INVALID'
      USING ERRCODE = '23514';
  END IF;

  FOREACH related_id IN ARRAY ARRAY[
    NULLIF(row_data ->> 'site_version_id', '')::uuid,
    NULLIF(row_data ->> 'snapshot_id', '')::uuid,
    NULLIF(row_data ->> 'active_snapshot_id', '')::uuid,
    NULLIF(row_data ->> 'previous_snapshot_id', '')::uuid,
    NULLIF(row_data ->> 'from_snapshot_id', '')::uuid,
    NULLIF(row_data ->> 'to_snapshot_id', '')::uuid,
    NULLIF(row_data ->> 'domain_id', '')::uuid,
    NULLIF(row_data ->> 'source_domain_id', '')::uuid,
    NULLIF(row_data ->> 'target_domain_id', '')::uuid,
    NULLIF(row_data ->> 'publication_run_id', '')::uuid,
    NULLIF(row_data ->> 'quality_run_id', '')::uuid,
    NULLIF(row_data ->> 'dns_plan_id', '')::uuid
  ]
  LOOP
    IF related_id IS NULL THEN CONTINUE; END IF;
    SELECT tenant_id, site_id INTO expected_tenant_id, expected_site_id
    FROM (
      SELECT tenant_id, site_id, id FROM site_versions
      UNION ALL SELECT tenant_id, site_id, id FROM site_render_snapshots
      UNION ALL SELECT tenant_id, site_id, id FROM site_domains
      UNION ALL SELECT tenant_id, site_id, id FROM site_publication_runs
      UNION ALL SELECT tenant_id, site_id, id FROM site_quality_runs
      UNION ALL SELECT tenant_id, site_id, id FROM site_domain_dns_plans
    ) related
    WHERE related.id = related_id
    LIMIT 1;
    IF expected_tenant_id IS NULL
      OR expected_tenant_id <> NEW.tenant_id
      OR expected_site_id <> NEW.site_id THEN
      RAISE EXCEPTION 'SITE_PUBLICATION_RELATED_SCOPE_INVALID'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ks_validate_publication_pointer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  snapshot_kind_value varchar(20);
  snapshot_tenant_id uuid;
  snapshot_site_id uuid;
  run_tenant_id uuid;
  run_site_id uuid;
BEGIN
  SELECT snapshot_kind, tenant_id, site_id
  INTO snapshot_kind_value, snapshot_tenant_id, snapshot_site_id
  FROM site_render_snapshots
  WHERE id = NEW.active_snapshot_id;
  SELECT tenant_id, site_id INTO run_tenant_id, run_site_id
  FROM site_publication_runs WHERE id = NEW.publication_run_id;
  IF snapshot_kind_value <> 'PUBLISHED'
    OR snapshot_tenant_id <> NEW.tenant_id
    OR snapshot_site_id <> NEW.site_id
    OR run_tenant_id <> NEW.tenant_id
    OR run_site_id <> NEW.site_id THEN
    RAISE EXCEPTION 'SITE_PUBLICATION_POINTER_SCOPE_INVALID'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.pointer_version <> OLD.pointer_version + 1 THEN
    RAISE EXCEPTION 'SITE_PUBLICATION_POINTER_VERSION_INVALID'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ks_validate_published_snapshot_governance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  quality_tenant_id uuid;
  quality_site_id uuid;
  quality_version_id uuid;
  quality_digest varchar(64);
  quality_status varchar(40);
  pack_digest varchar(64);
BEGIN
  IF NEW.snapshot_kind <> 'PUBLISHED' THEN RETURN NEW; END IF;
  IF NEW.site_version_digest_sha256 IS NULL
    OR NEW.quality_run_id IS NULL
    OR NEW.quality_policy_version IS NULL
    OR NEW.knowledge_pack_id IS NULL
    OR NEW.knowledge_pack_semantic_version IS NULL
    OR NEW.knowledge_pack_digest_sha256 IS NULL
    OR NEW.renderer_release_version IS NULL THEN
    RAISE EXCEPTION 'SITE_PUBLICATION_GOVERNANCE_PINS_REQUIRED'
      USING ERRCODE = '23514';
  END IF;
  SELECT tenant_id, site_id, site_version_id, site_version_digest_sha256, status
  INTO quality_tenant_id, quality_site_id, quality_version_id, quality_digest, quality_status
  FROM site_quality_runs WHERE id = NEW.quality_run_id;
  SELECT content_digest_sha256 INTO pack_digest
  FROM knowledge_packs WHERE id = NEW.knowledge_pack_id;
  IF quality_tenant_id <> NEW.tenant_id
    OR quality_site_id <> NEW.site_id
    OR quality_version_id <> NEW.site_version_id
    OR quality_digest <> NEW.site_version_digest_sha256
    OR quality_status <> 'READY'
    OR pack_digest <> NEW.knowledge_pack_digest_sha256 THEN
    RAISE EXCEPTION 'SITE_PUBLICATION_GOVERNANCE_PIN_INVALID'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ks_phase_15_9_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'PHASE_15_9_EVIDENCE_APPEND_ONLY'
    USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS site_render_snapshots_publication_governance
  ON site_render_snapshots;
CREATE TRIGGER site_render_snapshots_publication_governance
  BEFORE INSERT ON site_render_snapshots
  FOR EACH ROW EXECUTE FUNCTION ks_validate_published_snapshot_governance();

DROP TRIGGER IF EXISTS site_publication_pointers_validate
  ON site_publication_pointers;
CREATE TRIGGER site_publication_pointers_validate
  BEFORE INSERT OR UPDATE ON site_publication_pointers
  FOR EACH ROW EXECUTE FUNCTION ks_validate_publication_pointer();

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'site_publication_runs',
    'site_publication_pointers',
    'site_domain_verifications',
    'site_domain_dns_plans',
    'site_domain_dns_records',
    'site_domain_provider_operations',
    'site_domain_redirects',
    'site_publication_health_checks',
    'site_cache_invalidation_events',
    'site_rollback_events',
    'site_domain_events'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_scope ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER %I_scope BEFORE INSERT OR UPDATE ON %I '
      || 'FOR EACH ROW EXECUTE FUNCTION ks_validate_phase_15_9_scope()',
      table_name,
      table_name
    );
  END LOOP;
END
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'site_domain_verifications',
    'site_publication_health_checks',
    'site_cache_invalidation_events',
    'site_rollback_events',
    'site_domain_events'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_append_only ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER %I_append_only BEFORE UPDATE OR DELETE ON %I '
      || 'FOR EACH ROW EXECUTE FUNCTION ks_phase_15_9_append_only()',
      table_name,
      table_name
    );
  END LOOP;
END
$$;

ALTER TABLE site_publication_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_publication_pointers ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_domain_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_domain_dns_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_domain_dns_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_domain_provider_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_domain_redirects ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_publication_health_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_cache_invalidation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_rollback_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_domain_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  site_publication_runs,
  site_publication_pointers,
  site_domain_verifications,
  site_domain_dns_plans,
  site_domain_dns_records,
  site_domain_provider_operations,
  site_domain_redirects,
  site_publication_health_checks,
  site_cache_invalidation_events,
  site_rollback_events,
  site_domain_events
FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  site_publication_runs,
  site_publication_pointers,
  site_domain_dns_plans,
  site_domain_dns_records,
  site_domain_provider_operations,
  site_domain_redirects
TO service_role;

GRANT SELECT, INSERT ON TABLE
  site_domain_verifications,
  site_publication_health_checks,
  site_cache_invalidation_events,
  site_rollback_events,
  site_domain_events
TO service_role;

REVOKE ALL ON FUNCTION
  ks_validate_phase_15_9_scope(),
  ks_validate_publication_pointer(),
  ks_validate_published_snapshot_governance(),
  ks_phase_15_9_append_only()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  ks_validate_phase_15_9_scope(),
  ks_validate_publication_pointer(),
  ks_validate_published_snapshot_governance(),
  ks_phase_15_9_append_only()
TO service_role;

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'site_jobs'::regclass
    AND conname = 'site_jobs_type_valid';
  IF constraint_name IS NOT NULL THEN
    ALTER TABLE site_jobs DROP CONSTRAINT site_jobs_type_valid;
  END IF;
  ALTER TABLE site_jobs
    ADD CONSTRAINT site_jobs_type_valid CHECK(job_type IN (
      'PROVISION_WORKSPACE','IMPORT_TEMPLATE','CLASSIFY_TEMPLATE','CREATE_BLUEPRINT',
      'GENERATE_SITE','GENERATE_PAGE','REGENERATE_SECTION','GENERATE_METADATA',
      'GENERATE_STRUCTURED_DATA','OPTIMISE_IMAGE','RUN_SEO_AUDIT','RUN_UX_AUDIT',
      'RUN_ACCESSIBILITY_AUDIT','RUN_CONVERSION_AUDIT','RUN_FULL_SITE_QUALITY_AUDIT',
      'RUN_TECHNICAL_SEO_AUDIT','RUN_RESPONSIVE_UX_AUDIT',
      'RUN_BOOKING_INTEGRITY_AUDIT','RUN_PERFORMANCE_AUDIT',
      'RUN_CONTENT_INTEGRITY_AUDIT','RUN_ASSET_READINESS_AUDIT',
      'EVALUATE_PUBLICATION_READINESS','CREATE_SITE_SNAPSHOT','PREPARE_PUBLICATION',
      'VERIFY_DOMAIN','SYNC_ANALYTICS','CHECK_BOOKING_LINKS',
      'GENERATE_MONTHLY_PAGE_OPPORTUNITIES','GENERATE_MONTHLY_PAGE',
      'CREATE_SITE_PUBLICATION','ACTIVATE_FALLBACK_DOMAIN',
      'CREATE_CUSTOM_DOMAIN_PLAN','DISCOVER_CUSTOM_DOMAIN_DNS',
      'VERIFY_NAMESERVER_DELEGATION','CONFIGURE_CUSTOM_DOMAIN_DNS',
      'VERIFY_CUSTOM_DOMAIN','ACTIVATE_CUSTOM_DOMAIN',
      'RUN_PUBLICATION_HEALTH_CHECKS','ROLLBACK_SITE_PUBLICATION',
      'SUSPEND_SITE_DOMAIN','REMOVE_SITE_DOMAIN','INVALIDATE_SITE_CACHE',
      'TEST_SUCCEED','TEST_RETRYABLE_FAILURE','TEST_TERMINAL_FAILURE',
      'TEST_LONG_RUNNING','TEST_CANCELLABLE'
    ));
END
$$;

COMMENT ON TABLE site_publication_pointers IS
  'One atomic live snapshot pointer per site. Pointer changes are transactional and versioned.';
COMMENT ON TABLE site_domain_dns_records IS
  'Reviewed DNS discovery records; protected or unrelated records are never implicitly changed.';
COMMENT ON TABLE site_domain_provider_operations IS
  'Credential-free provider operation ledger with bounded attempts and safe metadata only.';
COMMENT ON TABLE site_publication_health_checks IS
  'Bounded SSRF-safe publication health evidence for database-owned hostnames only.';
