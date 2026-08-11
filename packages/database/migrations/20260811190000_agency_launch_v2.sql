-- Agency Launch V2: explicit discovery classifications, consent ledger and
-- governed asset provenance. Existing secure fact-finding invitations,
-- sessions, responses, clarifications and uploads remain the source of truth.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.fact_finding_template_questions
  ADD COLUMN data_classification varchar(30) NOT NULL DEFAULT 'PUBLIC_FACT',
  ADD COLUMN consent_type varchar(60);

ALTER TABLE public.fact_finding_questionnaire_questions
  ADD COLUMN data_classification varchar(30) NOT NULL DEFAULT 'PUBLIC_FACT',
  ADD COLUMN consent_type varchar(60);

ALTER TABLE public.fact_finding_responses
  ADD COLUMN data_classification varchar(30) NOT NULL DEFAULT 'PUBLIC_FACT',
  ADD COLUMN verification_basis varchar(30) NOT NULL DEFAULT 'UNVERIFIED';

ALTER TABLE public.fact_finding_uploads
  ADD COLUMN provenance varchar(40) NOT NULL DEFAULT 'CLIENT_SUPPLIED';

ALTER TABLE public.fact_finding_template_questions
  ADD CONSTRAINT fact_finding_template_questions_classification_check CHECK (
    data_classification IN ('PUBLIC_FACT','PRIVATE_OPERATIONAL','CONSENT','EVIDENCE','CONTENT_PREFERENCE','ASSET')
  ),
  ADD CONSTRAINT fact_finding_template_questions_consent_check CHECK (
    (data_classification = 'CONSENT' AND consent_type IS NOT NULL)
    OR (data_classification <> 'CONSENT' AND consent_type IS NULL)
  );

ALTER TABLE public.fact_finding_questionnaire_questions
  ADD CONSTRAINT fact_finding_questionnaire_questions_classification_check CHECK (
    data_classification IN ('PUBLIC_FACT','PRIVATE_OPERATIONAL','CONSENT','EVIDENCE','CONTENT_PREFERENCE','ASSET')
  ),
  ADD CONSTRAINT fact_finding_questionnaire_questions_consent_check CHECK (
    (data_classification = 'CONSENT' AND consent_type IS NOT NULL)
    OR (data_classification <> 'CONSENT' AND consent_type IS NULL)
  );

ALTER TABLE public.fact_finding_responses
  ADD CONSTRAINT fact_finding_responses_classification_check CHECK (
    data_classification IN ('PUBLIC_FACT','PRIVATE_OPERATIONAL','CONSENT','EVIDENCE','CONTENT_PREFERENCE','ASSET')
  ),
  ADD CONSTRAINT fact_finding_responses_verification_check CHECK (
    verification_basis IN ('UNVERIFIED','TENANT_CONFIRMED','AGENCY_CONFIRMED','VERIFIED')
  );

ALTER TABLE public.fact_finding_uploads
  ADD CONSTRAINT fact_finding_uploads_provenance_check CHECK (
    provenance IN ('CLIENT_SUPPLIED','AGENCY_SUPPLIED','APPROVED_STOCK','AI_GENERATED')
  );

CREATE TABLE public.fact_finding_consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  questionnaire_id uuid NOT NULL REFERENCES public.fact_finding_questionnaires(id) ON DELETE RESTRICT,
  participant_id uuid REFERENCES public.fact_finding_participants(id) ON DELETE RESTRICT,
  response_id uuid NOT NULL REFERENCES public.fact_finding_responses(id) ON DELETE RESTRICT,
  response_version integer NOT NULL,
  consent_type varchar(60) NOT NULL CHECK (consent_type IN (
    'PUBLIC_BUSINESS_INFORMATION','SUPPLIED_IMAGERY_PUBLICATION',
    'TESTIMONIAL_CASE_STUDY_PUBLICATION','AI_STOCK_SUPPORTING_IMAGES',
    'AGENCY_REVIEW_ACKNOWLEDGEMENT'
  )),
  decision varchar(20) NOT NULL CHECK (decision IN ('GRANTED','DENIED')),
  wording_version varchar(40) NOT NULL DEFAULT '1.0.0',
  answer_digest_sha256 varchar(64) NOT NULL CHECK (answer_digest_sha256 ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT fact_finding_consent_records_response_version_unique UNIQUE (response_id, response_version)
);

CREATE INDEX fact_finding_consent_records_tenant_type_idx
  ON public.fact_finding_consent_records(tenant_id, consent_type, recorded_at);
CREATE INDEX fact_finding_consent_records_questionnaire_idx
  ON public.fact_finding_consent_records(questionnaire_id, recorded_at);

CREATE OR REPLACE FUNCTION public.ks_validate_fact_finding_consent_ownership()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  response_row public.fact_finding_responses%ROWTYPE;
BEGIN
  SELECT * INTO response_row
  FROM public.fact_finding_responses
  WHERE id = NEW.response_id;

  IF response_row.id IS NULL
     OR response_row.tenant_id <> NEW.tenant_id
     OR response_row.questionnaire_id <> NEW.questionnaire_id
     OR response_row.participant_id IS DISTINCT FROM NEW.participant_id
     OR response_row.response_version <> NEW.response_version THEN
    RAISE EXCEPTION 'fact-finding consent scope must match its exact response version';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER fact_finding_consent_records_validate_ownership
BEFORE INSERT ON public.fact_finding_consent_records
FOR EACH ROW EXECUTE FUNCTION public.ks_validate_fact_finding_consent_ownership();

CREATE OR REPLACE FUNCTION public.ks_limit_fact_finding_consent_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.id <> OLD.id
     OR NEW.public_reference <> OLD.public_reference
     OR NEW.tenant_id <> OLD.tenant_id
     OR NEW.questionnaire_id <> OLD.questionnaire_id
     OR NEW.participant_id IS DISTINCT FROM OLD.participant_id
     OR NEW.response_id <> OLD.response_id
     OR NEW.response_version <> OLD.response_version
     OR NEW.consent_type <> OLD.consent_type
     OR NEW.decision <> OLD.decision
     OR NEW.wording_version <> OLD.wording_version
     OR NEW.answer_digest_sha256 <> OLD.answer_digest_sha256
     OR NEW.recorded_at <> OLD.recorded_at
     OR OLD.revoked_at IS NOT NULL
     OR NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'consent records are immutable except for one-way revocation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER fact_finding_consent_records_limited_mutation
BEFORE UPDATE ON public.fact_finding_consent_records
FOR EACH ROW EXECUTE FUNCTION public.ks_limit_fact_finding_consent_mutation();

CREATE OR REPLACE FUNCTION public.ks_prevent_fact_finding_consent_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'consent records are append-only; revoke the current record instead';
END;
$$;

CREATE TRIGGER fact_finding_consent_records_prevent_delete
BEFORE DELETE ON public.fact_finding_consent_records
FOR EACH ROW EXECUTE FUNCTION public.ks_prevent_fact_finding_consent_delete();

REVOKE EXECUTE ON FUNCTION public.ks_validate_fact_finding_consent_ownership() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ks_limit_fact_finding_consent_mutation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ks_prevent_fact_finding_consent_delete() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.fact_finding_consent_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.fact_finding_consent_records FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.fact_finding_consent_records TO service_role;

COMMENT ON TABLE public.fact_finding_consent_records IS
  'Tenant-scoped, version-pinned discovery consent decisions. Consent is never a public generation fact.';
COMMENT ON COLUMN public.fact_finding_consent_records.answer_digest_sha256 IS
  'Digest of the bounded boolean consent response; the raw discovery/session token is never stored.';

-- Backfill classification metadata on existing V1 templates, immutable question
-- snapshots and responses without changing their question wording or answers.
UPDATE public.fact_finding_template_questions
SET data_classification = CASE
  WHEN field_mapping LIKE 'ASSET.%' THEN 'ASSET'
  WHEN field_mapping LIKE 'BRAND.%' THEN 'CONTENT_PREFERENCE'
  WHEN field_mapping IS NULL THEN 'PRIVATE_OPERATIONAL'
  ELSE 'PUBLIC_FACT'
END;

UPDATE public.fact_finding_questionnaire_questions
SET data_classification = CASE
  WHEN field_mapping LIKE 'ASSET.%' THEN 'ASSET'
  WHEN field_mapping LIKE 'BRAND.%' THEN 'CONTENT_PREFERENCE'
  WHEN field_mapping IS NULL THEN 'PRIVATE_OPERATIONAL'
  ELSE 'PUBLIC_FACT'
END;

UPDATE public.fact_finding_responses AS response
SET data_classification = question.data_classification,
    verification_basis = CASE
      WHEN response.status = 'AGENCY_APPROVED' THEN 'AGENCY_CONFIRMED'
      WHEN response.status = 'CLIENT_CONFIRMED' THEN 'TENANT_CONFIRMED'
      ELSE 'UNVERIFIED'
    END
FROM public.fact_finding_questionnaire_questions AS question
WHERE question.id = response.question_id;

-- Create a new immutable V2 discovery template by cloning V1, then append the
-- explicit trust, website-requirements, image-policy and consent questions.
DO $$
DECLARE
  owner_id uuid;
  source_template_id uuid;
  target_template_id uuid;
  trust_section_id uuid := 'a2000000-0000-4000-8000-000000000007'::uuid;
  requirements_section_id uuid := 'a2000000-0000-4000-8000-000000000008'::uuid;
  consent_section_id uuid := 'a2000000-0000-4000-8000-000000000009'::uuid;
BEGIN
  SELECT id INTO owner_id
  FROM public.agency_users
  WHERE role = 'PLATFORM_OWNER' AND status = 'ACTIVE'
  ORDER BY created_at ASC
  LIMIT 1;

  SELECT id INTO source_template_id
  FROM public.fact_finding_templates
  WHERE template_key = 'KS_OS_CLIENT_ONBOARDING' AND version = 1
  LIMIT 1;

  IF owner_id IS NULL OR source_template_id IS NULL THEN
    RAISE NOTICE 'Agency Launch V2 discovery template was not seeded because its owner or V1 source is unavailable.';
    RETURN;
  END IF;

  UPDATE public.fact_finding_templates
  SET status = 'SUPERSEDED', updated_at = now()
  WHERE template_key = 'KS_OS_CLIENT_ONBOARDING' AND status = 'ACTIVE';

  INSERT INTO public.fact_finding_templates (
    public_reference, template_key, version, name, description,
    business_categories_json, plan_keys_json, status,
    created_by_agency_user_id, activated_by_agency_user_id, activated_at
  )
  SELECT
    'a1000000-0000-4000-8000-000000000002'::uuid,
    template_key, 2, 'KS OS governed client discovery',
    'Discovery, consent, verified facts, governed assets and website requirements for Agency Launch V2.',
    business_categories_json, plan_keys_json, 'ACTIVE', owner_id, owner_id, now()
  FROM public.fact_finding_templates
  WHERE id = source_template_id
  ON CONFLICT (template_key, version) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    status = 'ACTIVE',
    activated_by_agency_user_id = owner_id,
    activated_at = coalesce(fact_finding_templates.activated_at, now()),
    updated_at = now()
  RETURNING id INTO target_template_id;

  INSERT INTO public.fact_finding_template_sections (
    public_reference, template_id, section_key, title, description, display_order, optional
  )
  SELECT gen_random_uuid(), target_template_id, section_key, title, description, display_order, optional
  FROM public.fact_finding_template_sections
  WHERE template_id = source_template_id
  ON CONFLICT (template_id, section_key) DO NOTHING;

  INSERT INTO public.fact_finding_template_questions (
    public_reference, template_id, section_id, question_key, label, guidance,
    question_type, field_mapping, required, system_required, evidence_required,
    public_use_allowed, booking_use_allowed, generation_use_allowed,
    agency_verification_required, data_classification, consent_type,
    conditions_json, validation_json, options_json, display_order
  )
  SELECT
    gen_random_uuid(), target_template_id, target_section.id, source_question.question_key,
    source_question.label, source_question.guidance, source_question.question_type,
    source_question.field_mapping, source_question.required, source_question.system_required,
    source_question.evidence_required, source_question.public_use_allowed,
    source_question.booking_use_allowed, source_question.generation_use_allowed,
    source_question.agency_verification_required, source_question.data_classification,
    source_question.consent_type, source_question.conditions_json,
    source_question.validation_json, source_question.options_json, source_question.display_order
  FROM public.fact_finding_template_questions AS source_question
  JOIN public.fact_finding_template_sections AS source_section
    ON source_section.id = source_question.section_id
  JOIN public.fact_finding_template_sections AS target_section
    ON target_section.template_id = target_template_id
   AND target_section.section_key = source_section.section_key
  WHERE source_question.template_id = source_template_id
  ON CONFLICT (template_id, question_key) DO NOTHING;

  INSERT INTO public.fact_finding_template_sections
    (id, public_reference, template_id, section_key, title, description, display_order, optional)
  VALUES
    (trust_section_id, trust_section_id, target_template_id, 'TRUST_AND_EVIDENCE', 'Trust and evidence', 'Claims must be supported before they can become public facts.', 70, true),
    (requirements_section_id, requirements_section_id, target_template_id, 'WEBSITE_REQUIREMENTS', 'Website requirements', 'Requested architecture, priorities and exclusions.', 80, false),
    (consent_section_id, consent_section_id, target_template_id, 'CONSENT', 'Consent and permissions', 'Separate, explicit permissions for public use and agency review.', 90, false)
  ON CONFLICT (template_id, section_key) DO NOTHING;

  INSERT INTO public.fact_finding_template_questions (
    id, public_reference, template_id, section_id, question_key, label, guidance,
    question_type, field_mapping, required, system_required, evidence_required,
    public_use_allowed, booking_use_allowed, generation_use_allowed,
    agency_verification_required, data_classification, consent_type,
    options_json, display_order
  ) VALUES
    ('a3000000-0000-4000-8000-000000000041','a3000000-0000-4000-8000-000000000041',target_template_id,trust_section_id,'TRUST_QUALIFICATIONS','Which qualifications, accreditations or memberships may be stated publicly?','Include evidence references; unsupported superlatives and comparative claims will be rejected.','LONG_TEXT','CONTENT.TRUST_EVIDENCE',false,false,true,true,false,true,true,'PUBLIC_FACT',NULL,'[]',0),
    ('a3000000-0000-4000-8000-000000000042','a3000000-0000-4000-8000-000000000042',target_template_id,trust_section_id,'TRUST_AWARDS','Which awards or guarantees may be stated publicly?','Add only claims that can be substantiated during agency review.','LONG_TEXT','CONTENT.AWARD',false,false,true,true,false,true,true,'PUBLIC_FACT',NULL,'[]',1),
    ('a3000000-0000-4000-8000-000000000043','a3000000-0000-4000-8000-000000000043',target_template_id,requirements_section_id,'WEBSITE_LIKES_DISLIKES','What do you like or dislike about other websites?','Describe useful direction without copying another business.','LONG_TEXT','BRAND.VISUAL_DIRECTION',false,false,false,false,false,true,true,'CONTENT_PREFERENCE',NULL,'[]',0),
    ('a3000000-0000-4000-8000-000000000044','a3000000-0000-4000-8000-000000000044',target_template_id,requirements_section_id,'IMAGE_SOURCE_POLICY','Which image sourcing policy should the agency follow?','This governs generation; it does not grant publication permission for an individual upload.','SINGLE_SELECT','CONTENT.IMAGE_SOURCE_POLICY',true,true,false,false,false,true,true,'CONTENT_PREFERENCE',NULL,'[{"value":"CLIENT_UPLOADS_ONLY","label":"Client uploads only"},{"value":"CLIENT_FIRST_THEN_APPROVED_STOCK","label":"Client first, then approved stock"},{"value":"AI_SUPPORTING_IMAGES_ALLOWED","label":"AI supporting images allowed"},{"value":"AGENCY_SUPPLIES_IMAGES","label":"Agency supplies images"}]',1),
    ('a3000000-0000-4000-8000-000000000045','a3000000-0000-4000-8000-000000000045',target_template_id,requirements_section_id,'REQUESTED_PAGE_TYPES','Which page types are required?','Explicitly requested pages remain in the draft blueprint; missing content becomes a blocking gap.','MULTI_SELECT','WEBSITE.REQUESTED_PAGE_TYPES',true,false,false,false,false,true,true,'CONTENT_PREFERENCE',NULL,'[{"value":"HOME","label":"Home"},{"value":"SERVICE_HUB","label":"Services"},{"value":"SERVICE_DETAIL","label":"Service pages"},{"value":"ABOUT","label":"About"},{"value":"TEAM_HUB","label":"Team"},{"value":"LOCATION_DETAIL","label":"Location pages"},{"value":"CONTACT","label":"Contact"},{"value":"FAQ","label":"FAQ"},{"value":"RESULTS","label":"Results or gallery"},{"value":"BOOKING","label":"Booking"}]',2),
    ('a3000000-0000-4000-8000-000000000046','a3000000-0000-4000-8000-000000000046',target_template_id,requirements_section_id,'EXPLICIT_PAGES','List any specifically named pages that must exist.','Include campaign, guide or specialist pages that are not captured above.','LONG_TEXT','WEBSITE.EXPLICIT_PAGES',false,false,false,false,false,true,true,'CONTENT_PREFERENCE',NULL,'[]',3),
    ('a3000000-0000-4000-8000-000000000047','a3000000-0000-4000-8000-000000000047',target_template_id,requirements_section_id,'COMMERCIAL_PRIORITIES','What commercial outcomes should the website prioritise?','Order the outcomes that matter most, such as consultations, bookings or qualified enquiries.','LONG_TEXT','WEBSITE.COMMERCIAL_PRIORITIES',true,false,false,false,false,true,true,'CONTENT_PREFERENCE',NULL,'[]',4),
    ('a3000000-0000-4000-8000-000000000048','a3000000-0000-4000-8000-000000000048',target_template_id,requirements_section_id,'REQUIRED_CONTENT','What content must appear?','State contractual, regulatory, accessibility or customer-information requirements.','LONG_TEXT','WEBSITE.REQUIRED_CONTENT',false,false,false,false,false,true,true,'CONTENT_PREFERENCE',NULL,'[]',5),
    ('a3000000-0000-4000-8000-000000000049','a3000000-0000-4000-8000-000000000049',target_template_id,requirements_section_id,'PROHIBITED_CONTENT','What must never appear?','Include prohibited terms, claims, services, imagery or positioning.','LONG_TEXT','WEBSITE.PROHIBITED_CONTENT',false,false,false,false,false,true,true,'CONTENT_PREFERENCE',NULL,'[]',6),
    ('a3000000-0000-4000-8000-000000000055','a3000000-0000-4000-8000-000000000055',target_template_id,requirements_section_id,'PRIORITIZED_SERVICES','Which services should the website prioritise?','Use the exact service names or references already supplied. Missing service detail remains a visible content gap.','LONG_TEXT','WEBSITE.PRIORITIZED_SERVICES',false,false,false,false,false,true,true,'CONTENT_PREFERENCE',NULL,'[]',7),
    ('a3000000-0000-4000-8000-000000000056','a3000000-0000-4000-8000-000000000056',target_template_id,requirements_section_id,'PRIORITIZED_LOCATIONS','Which locations should the website prioritise?','Use the exact location names or references already supplied. Unverified location claims cannot be generated.','LONG_TEXT','WEBSITE.PRIORITIZED_LOCATIONS',false,false,false,false,false,true,true,'CONTENT_PREFERENCE',NULL,'[]',8),
    ('a3000000-0000-4000-8000-000000000050','a3000000-0000-4000-8000-000000000050',target_template_id,consent_section_id,'CONSENT_PUBLIC_INFORMATION','May the agency use the supplied, agency-verified business information on the public website?','Agency review remains mandatory before any information is published.','BOOLEAN',NULL,true,true,false,false,false,false,false,'CONSENT','PUBLIC_BUSINESS_INFORMATION','[]',0),
    ('a3000000-0000-4000-8000-000000000051','a3000000-0000-4000-8000-000000000051',target_template_id,consent_section_id,'CONSENT_SUPPLIED_IMAGERY','May imagery supplied through this discovery be published after agency review?','Individual asset permissions and people depicted must still be valid.','BOOLEAN',NULL,true,true,false,false,false,false,false,'CONSENT','SUPPLIED_IMAGERY_PUBLICATION','[]',1),
    ('a3000000-0000-4000-8000-000000000052','a3000000-0000-4000-8000-000000000052',target_template_id,consent_section_id,'CONSENT_TESTIMONIALS','May supplied testimonials and case studies be published where their own permissions are valid?','This does not override missing testimonial or subject consent.','BOOLEAN',NULL,true,true,false,false,false,false,false,'CONSENT','TESTIMONIAL_CASE_STUDY_PUBLICATION','[]',2),
    ('a3000000-0000-4000-8000-000000000053','a3000000-0000-4000-8000-000000000053',target_template_id,consent_section_id,'CONSENT_AI_STOCK_IMAGES','May the agency use supporting AI or stock imagery according to the selected image policy?','This preference never permits invented depictions of staff, premises, results or evidence.','BOOLEAN',NULL,true,true,false,false,false,false,false,'CONSENT','AI_STOCK_SUPPORTING_IMAGES','[]',3),
    ('a3000000-0000-4000-8000-000000000054','a3000000-0000-4000-8000-000000000054',target_template_id,consent_section_id,'CONSENT_AGENCY_REVIEW','I understand the agency will review the website before publication.','Submitting discovery is not approval to publish a website.','BOOLEAN',NULL,true,true,false,false,false,false,false,'CONSENT','AGENCY_REVIEW_ACKNOWLEDGEMENT','[]',4)
  ON CONFLICT (template_id, question_key) DO NOTHING;
END
$$;
