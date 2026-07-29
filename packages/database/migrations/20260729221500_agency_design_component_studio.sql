-- Agency Design Studio: governed reusable components, page sections and site themes.
-- Generated output is stored as structured KS OS data only. No executable HTML,
-- CSS or JavaScript is accepted into the production renderer.

CREATE TABLE IF NOT EXISTS design_library_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  slug varchar(120) NOT NULL UNIQUE,
  name varchar(160) NOT NULL,
  description text NOT NULL,
  item_kind varchar(30) NOT NULL,
  category varchar(80) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'DRAFT',
  source_type varchar(30) NOT NULL,
  tags_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  theme_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  definition_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  page_manifest_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  preview_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  preview_image_url text,
  preview_html_url text,
  source_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  accessibility_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  latest_revision integer NOT NULL DEFAULT 1,
  available_for_client_delivery boolean NOT NULL DEFAULT false,
  is_system boolean NOT NULL DEFAULT false,
  created_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  approved_by_agency_user_id uuid REFERENCES agency_users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT design_library_items_kind_check CHECK (item_kind IN ('COMPONENT', 'PAGE_SECTION', 'SITE_THEME')),
  CONSTRAINT design_library_items_status_check CHECK (status IN ('GENERATING', 'DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'FAILED', 'ARCHIVED')),
  CONSTRAINT design_library_items_source_check CHECK (source_type IN ('KS_AI', 'GOOGLE_STITCH', 'PREBUILT', 'MANUAL')),
  CONSTRAINT design_library_items_revision_check CHECK (latest_revision > 0),
  CONSTRAINT design_library_items_delivery_check CHECK (available_for_client_delivery = false OR (item_kind = 'SITE_THEME' AND status = 'APPROVED'))
);

CREATE INDEX IF NOT EXISTS design_library_items_kind_status_idx
  ON design_library_items(item_kind, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS design_library_items_category_status_idx
  ON design_library_items(category, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS design_library_items_source_status_idx
  ON design_library_items(source_type, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS design_library_items_delivery_idx
  ON design_library_items(item_kind, available_for_client_delivery, status);

CREATE TABLE IF NOT EXISTS design_library_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES design_library_items(id) ON DELETE RESTRICT,
  status varchar(30) NOT NULL DEFAULT 'PENDING',
  target_kind varchar(30) NOT NULL,
  source_type varchar(30) NOT NULL,
  prompt text NOT NULL,
  provider_key varchar(80),
  model_key varchar(160),
  stitch_project_reference varchar(255),
  stitch_screen_reference varchar(255),
  output_digest_sha256 varchar(64),
  safe_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_code varchar(100),
  failure_message varchar(500),
  requested_by_agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  completed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT design_library_generations_status_check CHECK (status IN ('PENDING', 'GENERATING', 'COMPLETED', 'FAILED')),
  CONSTRAINT design_library_generations_kind_check CHECK (target_kind IN ('COMPONENT', 'PAGE_SECTION', 'SITE_THEME')),
  CONSTRAINT design_library_generations_source_check CHECK (source_type IN ('KS_AI', 'GOOGLE_STITCH')),
  CONSTRAINT design_library_generations_digest_check CHECK (output_digest_sha256 IS NULL OR output_digest_sha256 ~ '^[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS design_library_generations_item_created_idx
  ON design_library_generations(item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS design_library_generations_status_created_idx
  ON design_library_generations(status, created_at DESC);
CREATE INDEX IF NOT EXISTS design_library_generations_requester_created_idx
  ON design_library_generations(requested_by_agency_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS design_library_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES design_library_items(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  status varchar(20) NOT NULL DEFAULT 'ACTIVE',
  assigned_by_agency_user_id uuid NOT NULL REFERENCES agency_users(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT design_library_assignments_status_check CHECK (status IN ('ACTIVE', 'REPLACED', 'REVOKED'))
);

CREATE INDEX IF NOT EXISTS design_library_assignments_tenant_status_idx
  ON design_library_assignments(tenant_id, status, assigned_at DESC);
CREATE INDEX IF NOT EXISTS design_library_assignments_item_status_idx
  ON design_library_assignments(item_id, status, assigned_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS design_library_assignments_one_active_per_tenant
  ON design_library_assignments(tenant_id) WHERE status = 'ACTIVE';

-- Five original KS-owned site themes provide realistic starting points. Their
-- preview manifests are rendered inside the Agency Design Studio as miniature
-- websites; the production site still uses the controlled native renderer.
INSERT INTO design_library_items (
  slug, name, description, item_kind, category, status, source_type, tags_json,
  theme_json, definition_json, page_manifest_json, preview_json,
  accessibility_json, available_for_client_delivery, is_system, approved_at
)
VALUES
(
  'local-service-pro',
  'Local Service Pro',
  'A practical, trust-led website system that prioritises services, location, availability and booking.',
  'SITE_THEME', 'Local services', 'APPROVED', 'PREBUILT',
  '["local business","trades","appointments","multi-location"]'::jsonb,
  '{"primaryColour":"#183B2B","secondaryColour":"#496B54","accentColour":"#A34E2D","backgroundColour":"#F8FBF7","surfaceColour":"#FFFFFF","textColour":"#173126","mutedTextColour":"#52645A","borderColour":"#D5E1D8","headingFontKey":"SYSTEM_SERIF","bodyFontKey":"SYSTEM_SANS","radiusScale":"MEDIUM","spacingDensity":"COMFORTABLE","containerWidth":"STANDARD","buttonStyle":"SOLID","imageStyle":"ROUNDED","motionPreference":"REDUCED"}'::jsonb,
  '{"defaultSectionVariant":"standard","variantRules":{"HERO":"split","FEATURED_SERVICES":"grid","SERVICE_GRID":"grid","TRUST_INDICATORS":"quiet","TESTIMONIALS":"quiet","LOCATION":"split","CONTACT":"split","BOOKING_CTA":"featured","FINAL_CTA":"featured"},"conversionGoal":"Make local trust, service choice and booking immediately clear."}'::jsonb,
  '[{"pageType":"HOME","required":true,"sections":["HEADER","HERO","TRUST_INDICATORS","FEATURED_SERVICES","TESTIMONIALS","BOOKING_CTA","FOOTER"]},{"pageType":"SERVICE_HUB","required":true,"sections":["HEADER","HERO","SERVICE_GRID","FAQ","BOOKING_CTA","FOOTER"]},{"pageType":"ABOUT","required":true,"sections":["HEADER","HERO","RICH_TEXT","TEAM","TRUST_INDICATORS","FINAL_CTA","FOOTER"]},{"pageType":"CONTACT","required":true,"sections":["HEADER","HERO","CONTACT","LOCATION","OPENING_HOURS","FOOTER"]},{"pageType":"POLICIES","required":true,"sections":["HEADER","RICH_TEXT","FOOTER"]},{"pageType":"BOOKING","required":true,"sections":["HEADER","HERO","BOOKING_CTA","FOOTER"]}]'::jsonb,
  '{"layout":"split","eyebrow":"Trusted local specialists","headline":"Reliable help, right when you need it","body":"Clear services, transparent availability and straightforward online booking.","primaryAction":"Book a service","secondaryAction":"View services","cards":["Fast response","Local experts","Clear pricing"],"imageTreatment":"local-team"}'::jsonb,
  '{"issues":[],"standard":"WCAG_2_2_AA","reviewed":true}'::jsonb,
  true, true, now()
),
(
  'wellness-atelier',
  'Wellness Atelier',
  'A calm, human and spacious theme for wellbeing, therapy, coaching and holistic appointment businesses.',
  'SITE_THEME', 'Wellness', 'APPROVED', 'PREBUILT',
  '["wellness","therapy","coaching","beauty"]'::jsonb,
  '{"primaryColour":"#193B36","secondaryColour":"#416A62","accentColour":"#A84E31","backgroundColour":"#F4FAF8","surfaceColour":"#FFFFFF","textColour":"#15312D","mutedTextColour":"#49615D","borderColour":"#CFE0DC","headingFontKey":"SYSTEM_SERIF","bodyFontKey":"SYSTEM_SANS","radiusScale":"LARGE","spacingDensity":"AIRY","containerWidth":"STANDARD","buttonStyle":"SOFT","imageStyle":"ROUNDED","motionPreference":"REDUCED"}'::jsonb,
  '{"defaultSectionVariant":"quiet","variantRules":{"HERO":"split","INTRODUCTION":"editorial","FEATURED_SERVICES":"editorial","BENEFITS":"grid","TEAM":"editorial","TESTIMONIALS":"editorial","FAQ":"quiet","BOOKING_CTA":"featured"},"conversionGoal":"Create reassurance before gently guiding visitors towards a consultation or booking."}'::jsonb,
  '[{"pageType":"HOME","required":true,"sections":["HEADER","HERO","INTRODUCTION","FEATURED_SERVICES","BENEFITS","TESTIMONIALS","BOOKING_CTA","FOOTER"]},{"pageType":"SERVICE_HUB","required":true,"sections":["HEADER","HERO","SERVICE_GRID","RICH_TEXT","FAQ","BOOKING_CTA","FOOTER"]},{"pageType":"ABOUT","required":true,"sections":["HEADER","HERO","RICH_TEXT","TEAM","TRUST_INDICATORS","FINAL_CTA","FOOTER"]},{"pageType":"CONTACT","required":true,"sections":["HEADER","CONTACT","LOCATION","OPENING_HOURS","FOOTER"]},{"pageType":"POLICIES","required":true,"sections":["HEADER","RICH_TEXT","FOOTER"]},{"pageType":"BOOKING","required":true,"sections":["HEADER","HERO","BOOKING_CTA","FOOTER"]}]'::jsonb,
  '{"layout":"editorial","eyebrow":"Space to feel better","headline":"Thoughtful care for your whole wellbeing","body":"A calm experience, clear guidance and appointments designed around you.","primaryAction":"Start your journey","secondaryAction":"Explore treatments","cards":["Personal care","Qualified team","Flexible booking"],"imageTreatment":"soft-wellness"}'::jsonb,
  '{"issues":[],"standard":"WCAG_2_2_AA","reviewed":true}'::jsonb,
  true, true, now()
),
(
  'clinical-clarity',
  'Clinical Clarity',
  'A precise, credible and highly legible theme for clinics, healthcare and regulated professional services.',
  'SITE_THEME', 'Healthcare', 'APPROVED', 'PREBUILT',
  '["healthcare","clinic","regulated","professional"]'::jsonb,
  '{"primaryColour":"#12344A","secondaryColour":"#316A82","accentColour":"#007A6F","backgroundColour":"#F7FBFD","surfaceColour":"#FFFFFF","textColour":"#102A3A","mutedTextColour":"#45626F","borderColour":"#C9DCE5","headingFontKey":"SYSTEM_SANS","bodyFontKey":"SYSTEM_SANS","radiusScale":"SMALL","spacingDensity":"COMFORTABLE","containerWidth":"STANDARD","buttonStyle":"SOLID","imageStyle":"SQUARE","motionPreference":"NONE"}'::jsonb,
  '{"defaultSectionVariant":"compact","variantRules":{"HERO":"split","TRUST_INDICATORS":"grid","FEATURED_SERVICES":"grid","SERVICE_DETAILS":"split","PROCESS":"grid","TEAM":"grid","FAQ":"compact","CONTACT":"split","BOOKING_CTA":"featured"},"conversionGoal":"Establish competence, safety and clear next steps without visual ambiguity."}'::jsonb,
  '[{"pageType":"HOME","required":true,"sections":["HEADER","HERO","TRUST_INDICATORS","FEATURED_SERVICES","PROCESS","BOOKING_CTA","FOOTER"]},{"pageType":"SERVICE_HUB","required":true,"sections":["HEADER","HERO","SERVICE_GRID","SERVICE_DETAILS","FAQ","BOOKING_CTA","FOOTER"]},{"pageType":"ABOUT","required":true,"sections":["HEADER","HERO","RICH_TEXT","TEAM","TRUST_INDICATORS","FOOTER"]},{"pageType":"CONTACT","required":true,"sections":["HEADER","CONTACT","LOCATION","OPENING_HOURS","FOOTER"]},{"pageType":"POLICIES","required":true,"sections":["HEADER","RICH_TEXT","FOOTER"]},{"pageType":"BOOKING","required":true,"sections":["HEADER","HERO","BOOKING_CTA","FOOTER"]}]'::jsonb,
  '{"layout":"structured","eyebrow":"Professional care","headline":"Clear information. Confident decisions.","body":"Understand your options, meet the team and book the right appointment.","primaryAction":"Book an appointment","secondaryAction":"View services","cards":["Qualified clinicians","Evidence-led care","Secure booking"],"imageTreatment":"clinical-team"}'::jsonb,
  '{"issues":[],"standard":"WCAG_2_2_AA","reviewed":true}'::jsonb,
  true, true, now()
),
(
  'modern-consultancy',
  'Modern Consultancy',
  'A crisp, conversion-focused system for consultants, agencies, technology and business services.',
  'SITE_THEME', 'Professional services', 'APPROVED', 'PREBUILT',
  '["consultancy","agency","technology","b2b"]'::jsonb,
  '{"primaryColour":"#111827","secondaryColour":"#334155","accentColour":"#2563EB","backgroundColour":"#F8FAFC","surfaceColour":"#FFFFFF","textColour":"#111827","mutedTextColour":"#475569","borderColour":"#CBD5E1","headingFontKey":"SYSTEM_SANS","bodyFontKey":"SYSTEM_SANS","radiusScale":"MEDIUM","spacingDensity":"COMFORTABLE","containerWidth":"WIDE","buttonStyle":"SOLID","imageStyle":"ROUNDED","motionPreference":"REDUCED"}'::jsonb,
  '{"defaultSectionVariant":"grid","variantRules":{"HERO":"featured","TRUST_INDICATORS":"compact","FEATURED_SERVICES":"grid","BENEFITS":"grid","PROCESS":"grid","RESULTS":"grid","TESTIMONIALS":"quiet","FINAL_CTA":"featured"},"conversionGoal":"Communicate a strong proposition quickly and turn interest into a qualified enquiry."}'::jsonb,
  '[{"pageType":"HOME","required":true,"sections":["HEADER","HERO","TRUST_INDICATORS","FEATURED_SERVICES","BENEFITS","RESULTS","FINAL_CTA","FOOTER"]},{"pageType":"SERVICE_HUB","required":true,"sections":["HEADER","HERO","SERVICE_GRID","PROCESS","FAQ","FINAL_CTA","FOOTER"]},{"pageType":"ABOUT","required":true,"sections":["HEADER","HERO","RICH_TEXT","TEAM","RESULTS","FINAL_CTA","FOOTER"]},{"pageType":"CONTACT","required":true,"sections":["HEADER","CONTACT","LOCATION","FOOTER"]},{"pageType":"POLICIES","required":true,"sections":["HEADER","RICH_TEXT","FOOTER"]},{"pageType":"BOOKING","required":true,"sections":["HEADER","HERO","BOOKING_CTA","FOOTER"]}]'::jsonb,
  '{"layout":"bento","eyebrow":"Practical growth partner","headline":"Turn complex work into measurable progress","body":"Focused expertise, transparent delivery and a clear route from challenge to outcome.","primaryAction":"Plan a consultation","secondaryAction":"See our work","cards":["Strategy","Delivery","Results"],"imageTreatment":"modern-abstract"}'::jsonb,
  '{"issues":[],"standard":"WCAG_2_2_AA","reviewed":true}'::jsonb,
  true, true, now()
),
(
  'creative-portfolio',
  'Creative Portfolio',
  'An expressive, editorial system for studios, creators, events and visually led personal brands.',
  'SITE_THEME', 'Creative', 'APPROVED', 'PREBUILT',
  '["creative","portfolio","events","personal brand"]'::jsonb,
  '{"primaryColour":"#2A1F4F","secondaryColour":"#51407A","accentColour":"#B54B78","backgroundColour":"#FAF8FF","surfaceColour":"#FFFFFF","textColour":"#211A3B","mutedTextColour":"#5A536E","borderColour":"#DDD7EA","headingFontKey":"EDITORIAL_SERIF","bodyFontKey":"SYSTEM_SANS","radiusScale":"MEDIUM","spacingDensity":"AIRY","containerWidth":"WIDE","buttonStyle":"SOFT","imageStyle":"EDITORIAL","motionPreference":"STANDARD"}'::jsonb,
  '{"defaultSectionVariant":"editorial","variantRules":{"HERO":"featured","INTRODUCTION":"editorial","GALLERY":"editorial","RESULTS":"editorial","FEATURED_SERVICES":"editorial","TESTIMONIALS":"editorial","TEAM":"editorial","FINAL_CTA":"featured"},"conversionGoal":"Use visual storytelling to establish a distinctive point of view and invite collaboration."}'::jsonb,
  '[{"pageType":"HOME","required":true,"sections":["HEADER","HERO","INTRODUCTION","GALLERY","FEATURED_SERVICES","TESTIMONIALS","FINAL_CTA","FOOTER"]},{"pageType":"SERVICE_HUB","required":true,"sections":["HEADER","HERO","SERVICE_GRID","RESULTS","FAQ","FINAL_CTA","FOOTER"]},{"pageType":"ABOUT","required":true,"sections":["HEADER","HERO","RICH_TEXT","TEAM","GALLERY","FINAL_CTA","FOOTER"]},{"pageType":"CONTACT","required":true,"sections":["HEADER","CONTACT","LOCATION","FOOTER"]},{"pageType":"POLICIES","required":true,"sections":["HEADER","RICH_TEXT","FOOTER"]},{"pageType":"BOOKING","required":true,"sections":["HEADER","HERO","BOOKING_CTA","FOOTER"]}]'::jsonb,
  '{"layout":"editorial-collage","eyebrow":"Ideas made visible","headline":"Distinctive work for ambitious people","body":"Strategy, craft and visual storytelling brought together in one clear experience.","primaryAction":"Start a project","secondaryAction":"View selected work","cards":["Identity","Digital","Campaigns"],"imageTreatment":"creative-collage"}'::jsonb,
  '{"issues":[],"standard":"WCAG_2_2_AA","reviewed":true}'::jsonb,
  true, true, now()
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  tags_json = EXCLUDED.tags_json,
  theme_json = EXCLUDED.theme_json,
  definition_json = EXCLUDED.definition_json,
  page_manifest_json = EXCLUDED.page_manifest_json,
  preview_json = EXCLUDED.preview_json,
  accessibility_json = EXCLUDED.accessibility_json,
  status = 'APPROVED',
  available_for_client_delivery = true,
  is_system = true,
  approved_at = COALESCE(design_library_items.approved_at, now()),
  updated_at = now();
