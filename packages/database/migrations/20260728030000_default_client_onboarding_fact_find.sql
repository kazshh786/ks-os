-- Recommended KS OS client onboarding intake.
-- This creates one active, versioned fact-finding template that is rendered by
-- the shared advanced intake-form UI. It is idempotent and contains no client data.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
  owner_id uuid;
  template_id uuid;
BEGIN
  SELECT id INTO owner_id
  FROM public.agency_users
  WHERE role = 'PLATFORM_OWNER' AND status = 'ACTIVE'
  ORDER BY created_at ASC
  LIMIT 1;

  IF owner_id IS NULL THEN
    RAISE NOTICE 'Default client onboarding form was not seeded because no active platform owner exists.';
    RETURN;
  END IF;

  INSERT INTO public.fact_finding_templates (
    id, public_reference, template_key, version, name, description,
    business_categories_json, plan_keys_json, status,
    created_by_agency_user_id, activated_by_agency_user_id, activated_at
  ) VALUES (
    'a1000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    'KS_OS_CLIENT_ONBOARDING', 1,
    'KS OS complete client onboarding',
    'A guided business intake covering the verified facts required for booking setup, website generation and workspace provisioning.',
    '["HAIR_SALON","BEAUTY_CLINIC","BARBER","NAIL_SALON","MASSAGE_THERAPIST","PERSONAL_TRAINER","GENERAL_APPOINTMENT_BUSINESS"]'::jsonb,
    '["CORE","GROWTH","SCALE"]'::jsonb,
    'ACTIVE', owner_id, owner_id, now()
  )
  ON CONFLICT (template_key, version) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    business_categories_json = EXCLUDED.business_categories_json,
    plan_keys_json = EXCLUDED.plan_keys_json,
    status = 'ACTIVE',
    activated_by_agency_user_id = owner_id,
    activated_at = coalesce(fact_finding_templates.activated_at, now()),
    updated_at = now()
  RETURNING id INTO template_id;

  INSERT INTO public.fact_finding_template_sections
    (id, public_reference, template_id, section_key, title, description, display_order, optional)
  VALUES
    ('a2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001',template_id,'BUSINESS_IDENTITY','Business basics','Identity, public contact details and what makes the business different.',0,false),
    ('a2000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000002',template_id,'LOCATIONS_AND_HOURS','Locations and opening hours','Where services are delivered and when customers can book.',1,false),
    ('a2000000-0000-4000-8000-000000000003','a2000000-0000-4000-8000-000000000003',template_id,'SERVICES_AND_PRICING','Services and pricing','The primary service catalogue used to establish the booking workspace.',2,false),
    ('a2000000-0000-4000-8000-000000000004','a2000000-0000-4000-8000-000000000004',template_id,'TEAM_AND_AVAILABILITY','Team and availability','The initial team member and their bookable availability.',3,false),
    ('a2000000-0000-4000-8000-000000000005','a2000000-0000-4000-8000-000000000005',template_id,'BOOKING_POLICIES','Booking rules and policies','Notice periods, cancellations, deposits and confirmation behaviour.',4,false),
    ('a2000000-0000-4000-8000-000000000006','a2000000-0000-4000-8000-000000000006',template_id,'BRAND_CONTENT_ASSETS','Brand, content and files','Direction for the website plus optional private supporting assets.',5,false)
  ON CONFLICT (template_id, section_key) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    display_order = EXCLUDED.display_order,
    optional = EXCLUDED.optional;

  INSERT INTO public.fact_finding_template_questions (
    id, public_reference, template_id, section_id, question_key, label, guidance,
    question_type, field_mapping, required, system_required, evidence_required,
    public_use_allowed, booking_use_allowed, generation_use_allowed,
    agency_verification_required, options_json, display_order
  ) VALUES
    ('a3000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',template_id,'a2000000-0000-4000-8000-000000000001','LEGAL_BUSINESS_NAME','What is the legal business name?','Use the registered name shown on official records.','SHORT_TEXT','BUSINESS.LEGAL_NAME',true,true,false,false,true,false,true,'[]',0),
    ('a3000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000002',template_id,'a2000000-0000-4000-8000-000000000001','TRADING_NAME','What name should customers see?','This becomes the main trading name in booking and website experiences.','SHORT_TEXT','BUSINESS.TRADING_NAME',true,true,false,true,true,true,true,'[]',1),
    ('a3000000-0000-4000-8000-000000000003','a3000000-0000-4000-8000-000000000003',template_id,'a2000000-0000-4000-8000-000000000001','BUSINESS_DESCRIPTION','Describe the business in a few sentences.','Explain what you do, who you help and the experience customers can expect.','LONG_TEXT','BUSINESS.DESCRIPTION',true,false,false,true,false,true,true,'[]',2),
    ('a3000000-0000-4000-8000-000000000004','a3000000-0000-4000-8000-000000000004',template_id,'a2000000-0000-4000-8000-000000000001','PUBLIC_PHONE','What telephone number should customers use?','This may appear on the website and booking confirmations.','PHONE','BUSINESS.PUBLIC_PHONE',true,true,false,true,true,true,true,'[]',3),
    ('a3000000-0000-4000-8000-000000000005','a3000000-0000-4000-8000-000000000005',template_id,'a2000000-0000-4000-8000-000000000001','PUBLIC_EMAIL','What public email address should customers use?','Use an inbox that is actively monitored.','EMAIL','BUSINESS.PUBLIC_EMAIL',true,true,false,true,true,true,true,'[]',4),
    ('a3000000-0000-4000-8000-000000000006','a3000000-0000-4000-8000-000000000006',template_id,'a2000000-0000-4000-8000-000000000001','BUSINESS_CATEGORY','Which category best describes the business?','Choose the closest match; this helps configure sensible defaults.','SINGLE_SELECT','BUSINESS.CATEGORY',true,false,false,true,false,true,true,'[{"value":"HAIR_SALON","label":"Hair salon"},{"value":"BEAUTY_CLINIC","label":"Beauty clinic"},{"value":"BARBER","label":"Barber"},{"value":"NAIL_SALON","label":"Nail salon"},{"value":"MASSAGE_THERAPIST","label":"Massage therapist"},{"value":"PERSONAL_TRAINER","label":"Personal trainer"},{"value":"GENERAL_APPOINTMENT_BUSINESS","label":"Other appointment business"}]',5),
    ('a3000000-0000-4000-8000-000000000007','a3000000-0000-4000-8000-000000000007',template_id,'a2000000-0000-4000-8000-000000000001','TARGET_AUDIENCE','Who are your ideal customers?','Describe the people, needs and local audience you serve.','LONG_TEXT','BUSINESS.AUDIENCE',true,false,false,true,false,true,true,'[]',6),
    ('a3000000-0000-4000-8000-000000000008','a3000000-0000-4000-8000-000000000008',template_id,'a2000000-0000-4000-8000-000000000001','DIFFERENTIATORS','Why do customers choose you?','Include specialist experience, service standards or anything genuinely distinctive.','LONG_TEXT','BUSINESS.DIFFERENTIATORS',true,false,false,true,false,true,true,'[]',7),

    ('a3000000-0000-4000-8000-000000000009','a3000000-0000-4000-8000-000000000009',template_id,'a2000000-0000-4000-8000-000000000002','PRIMARY_LOCATION_NAME','What should the main location be called?','For a single-site business, this can simply be the trading name.','SHORT_TEXT','LOCATION.NAME',true,true,false,true,true,true,true,'[]',0),
    ('a3000000-0000-4000-8000-000000000010','a3000000-0000-4000-8000-000000000010',template_id,'a2000000-0000-4000-8000-000000000002','PRIMARY_LOCATION_ADDRESS','What is the main service address?','Enter the address customers should use. Mobile or remote businesses can use their operating base and explain the service area below.','ADDRESS','LOCATION.ADDRESS',true,true,false,true,true,true,true,'[]',1),
    ('a3000000-0000-4000-8000-000000000011','a3000000-0000-4000-8000-000000000011',template_id,'a2000000-0000-4000-8000-000000000002','SERVICE_AREA','Do you serve customers away from the main premises?','List towns, postcodes or travel limits where relevant.','LONG_TEXT','LOCATION.SERVICE_AREA',false,false,false,true,true,true,true,'[]',2),
    ('a3000000-0000-4000-8000-000000000012','a3000000-0000-4000-8000-000000000012',template_id,'a2000000-0000-4000-8000-000000000002','OPENING_HOURS','What are the normal opening hours?','These establish the initial booking availability and can be refined later.','OPENING_HOURS','LOCATION.OPENING_HOURS',true,true,false,true,true,true,true,'[]',3),
    ('a3000000-0000-4000-8000-000000000013','a3000000-0000-4000-8000-000000000013',template_id,'a2000000-0000-4000-8000-000000000002','ACCESSIBILITY','What accessibility information should customers know?','Mention step-free access, accessible facilities or assistance available.','LONG_TEXT','LOCATION.ACCESSIBILITY',false,false,false,true,false,true,true,'[]',4),
    ('a3000000-0000-4000-8000-000000000014','a3000000-0000-4000-8000-000000000014',template_id,'a2000000-0000-4000-8000-000000000002','PARKING','What parking or transport information is useful?','Keep this practical and accurate.','LONG_TEXT','LOCATION.PARKING',false,false,false,true,false,true,true,'[]',5),

    ('a3000000-0000-4000-8000-000000000015','a3000000-0000-4000-8000-000000000015',template_id,'a2000000-0000-4000-8000-000000000003','PRIMARY_SERVICE_NAME','What is the first service customers should be able to book?','Start with the most important or most popular service. More services can be added after provisioning.','SHORT_TEXT','SERVICE.NAME',true,true,false,true,true,true,true,'[]',0),
    ('a3000000-0000-4000-8000-000000000016','a3000000-0000-4000-8000-000000000016',template_id,'a2000000-0000-4000-8000-000000000003','PRIMARY_SERVICE_DESCRIPTION','Describe this service.','Explain what is included and who it is suitable for.','LONG_TEXT','SERVICE.DESCRIPTION',true,false,false,true,true,true,true,'[]',1),
    ('a3000000-0000-4000-8000-000000000017','a3000000-0000-4000-8000-000000000017',template_id,'a2000000-0000-4000-8000-000000000003','PRIMARY_SERVICE_DURATION','How many minutes does this service take?','Use the normal bookable duration.','DURATION','SERVICE.DURATION',true,true,false,false,true,true,true,'[]',2),
    ('a3000000-0000-4000-8000-000000000018','a3000000-0000-4000-8000-000000000018',template_id,'a2000000-0000-4000-8000-000000000003','PRIMARY_SERVICE_PRICE','What is the standard price?','Enter the customer-facing price in pounds.','MONEY','SERVICE.PRICE',true,true,false,true,true,true,true,'[]',3),
    ('a3000000-0000-4000-8000-000000000019','a3000000-0000-4000-8000-000000000019',template_id,'a2000000-0000-4000-8000-000000000003','PRIMARY_SERVICE_DEPOSIT','Is a deposit required for this service?','Leave as £0 when no deposit is required.','MONEY','SERVICE.DEPOSIT',false,false,false,false,true,false,true,'[]',4),
    ('a3000000-0000-4000-8000-000000000020','a3000000-0000-4000-8000-000000000020',template_id,'a2000000-0000-4000-8000-000000000003','SERVICE_BUFFER','How many buffer minutes are needed after this service?','Use zero when no clean-up or transition time is needed.','DURATION','SERVICE.BUFFER',false,false,false,false,true,false,true,'[]',5),
    ('a3000000-0000-4000-8000-000000000021','a3000000-0000-4000-8000-000000000021',template_id,'a2000000-0000-4000-8000-000000000003','SERVICE_INTAKE_REQUIREMENTS','What information must be collected before this service?','List consultation, consent or preparation requirements.','LONG_TEXT','SERVICE.INTAKE_REQUIREMENTS',false,false,false,false,true,false,true,'[]',6),

    ('a3000000-0000-4000-8000-000000000022','a3000000-0000-4000-8000-000000000022',template_id,'a2000000-0000-4000-8000-000000000004','PRIMARY_STAFF_NAME','Who is the first bookable team member?','Use the name customers should see.','SHORT_TEXT','STAFF.NAME',true,true,false,true,true,true,true,'[]',0),
    ('a3000000-0000-4000-8000-000000000023','a3000000-0000-4000-8000-000000000023',template_id,'a2000000-0000-4000-8000-000000000004','PRIMARY_STAFF_ROLE','What is their role or job title?','For example: Senior stylist, therapist or coach.','SHORT_TEXT','STAFF.ROLE',true,false,false,true,true,true,true,'[]',1),
    ('a3000000-0000-4000-8000-000000000024','a3000000-0000-4000-8000-000000000024',template_id,'a2000000-0000-4000-8000-000000000004','PRIMARY_STAFF_BIO','Write a short customer-facing biography.','Focus on experience, approach and what customers can expect.','LONG_TEXT','STAFF.BIO',false,false,false,true,false,true,true,'[]',2),
    ('a3000000-0000-4000-8000-000000000025','a3000000-0000-4000-8000-000000000025',template_id,'a2000000-0000-4000-8000-000000000004','PRIMARY_STAFF_CREDENTIALS','List relevant qualifications or credentials.','Only include claims the agency can verify.','LONG_TEXT','STAFF.CREDENTIALS',false,false,true,true,false,true,true,'[]',3),
    ('a3000000-0000-4000-8000-000000000026','a3000000-0000-4000-8000-000000000026',template_id,'a2000000-0000-4000-8000-000000000004','PRIMARY_STAFF_AVAILABILITY','When is this person normally available?','These hours can be narrower than the business opening hours.','OPENING_HOURS','STAFF.AVAILABILITY',true,true,false,false,true,false,true,'[]',4),

    ('a3000000-0000-4000-8000-000000000027','a3000000-0000-4000-8000-000000000027',template_id,'a2000000-0000-4000-8000-000000000005','MINIMUM_NOTICE','What is the minimum booking notice in minutes?','For example, 120 means customers must book at least two hours ahead.','DURATION','BOOKING.MINIMUM_NOTICE',true,true,false,false,true,false,true,'[]',0),
    ('a3000000-0000-4000-8000-000000000028','a3000000-0000-4000-8000-000000000028',template_id,'a2000000-0000-4000-8000-000000000005','MAXIMUM_ADVANCE','How many days ahead can customers book?','Enter a practical booking window such as 60 or 90 days.','DURATION','BOOKING.MAXIMUM_ADVANCE',true,false,false,false,true,false,true,'[]',1),
    ('a3000000-0000-4000-8000-000000000029','a3000000-0000-4000-8000-000000000029',template_id,'a2000000-0000-4000-8000-000000000005','CANCELLATION_POLICY','What is the cancellation policy?','Use clear customer-facing wording, including any deadline or charge.','POLICY','BOOKING.CANCELLATION_POLICY',true,true,false,true,true,true,true,'[]',2),
    ('a3000000-0000-4000-8000-000000000030','a3000000-0000-4000-8000-000000000030',template_id,'a2000000-0000-4000-8000-000000000005','RESCHEDULING_POLICY','What is the rescheduling policy?','Explain when and how customers may change an appointment.','POLICY','BOOKING.RESCHEDULING_POLICY',true,false,false,true,true,true,true,'[]',3),
    ('a3000000-0000-4000-8000-000000000031','a3000000-0000-4000-8000-000000000031',template_id,'a2000000-0000-4000-8000-000000000005','DEPOSIT_POLICY','Explain any deposit rules.','Describe when a deposit is taken, whether it is refundable and how it is applied.','POLICY','BOOKING.DEPOSIT_POLICY',false,false,false,true,true,true,true,'[]',4),
    ('a3000000-0000-4000-8000-000000000032','a3000000-0000-4000-8000-000000000032',template_id,'a2000000-0000-4000-8000-000000000005','CONFIRMATION_BEHAVIOUR','How should new bookings be confirmed?','Choose the normal behaviour for online bookings.','SINGLE_SELECT','BOOKING.CONFIRMATION_BEHAVIOUR',true,false,false,false,true,false,true,'[{"value":"AUTO_CONFIRM","label":"Confirm automatically"},{"value":"REQUEST_APPROVAL","label":"Request staff approval"}]',5),

    ('a3000000-0000-4000-8000-000000000033','a3000000-0000-4000-8000-000000000033',template_id,'a2000000-0000-4000-8000-000000000006','BRAND_TONE','Which tone best matches the business?','Choose the closest starting point; details can be refined in the next question.','SINGLE_SELECT','BRAND.TONE',true,false,false,true,false,true,true,'[{"value":"WARM","label":"Warm and welcoming"},{"value":"PREMIUM","label":"Premium and refined"},{"value":"BOLD","label":"Bold and energetic"},{"value":"CALM","label":"Calm and reassuring"},{"value":"DIRECT","label":"Clear and practical"}]',0),
    ('a3000000-0000-4000-8000-000000000034','a3000000-0000-4000-8000-000000000034',template_id,'a2000000-0000-4000-8000-000000000006','VISUAL_DIRECTION','Describe the desired visual style.','Mention colours, atmosphere, examples to emulate and anything to avoid.','LONG_TEXT','BRAND.VISUAL_DIRECTION',true,true,false,true,false,true,true,'[]',1),
    ('a3000000-0000-4000-8000-000000000035','a3000000-0000-4000-8000-000000000035',template_id,'a2000000-0000-4000-8000-000000000006','BRAND_COLOURS','Are there existing brand colours?','List colour names or hexadecimal values where known.','LONG_TEXT','BRAND.COLOURS',false,false,false,true,false,true,true,'[]',2),
    ('a3000000-0000-4000-8000-000000000036','a3000000-0000-4000-8000-000000000036',template_id,'a2000000-0000-4000-8000-000000000006','BUSINESS_STORY','Tell the story behind the business.','Include why it started, important milestones and the values that guide it.','LONG_TEXT','CONTENT.BUSINESS_STORY',false,false,false,true,false,true,true,'[]',3),
    ('a3000000-0000-4000-8000-000000000037','a3000000-0000-4000-8000-000000000037',template_id,'a2000000-0000-4000-8000-000000000006','COMMON_FAQ','What questions do customers ask most often?','Write the question and a clear answer for each item.','LONG_TEXT','CONTENT.FAQ',false,false,false,true,false,true,true,'[]',4),
    ('a3000000-0000-4000-8000-000000000038','a3000000-0000-4000-8000-000000000038',template_id,'a2000000-0000-4000-8000-000000000006','LOGO_UPLOAD','Upload the current logo.','The file remains private until the agency reviews and approves its permitted use.','IMAGE_UPLOAD','ASSET.LOGO',false,false,false,false,false,false,true,'[]',5),
    ('a3000000-0000-4000-8000-000000000039','a3000000-0000-4000-8000-000000000039',template_id,'a2000000-0000-4000-8000-000000000006','LOCATION_PHOTO_UPLOAD','Upload a strong location photograph.','Use an original image the business has permission to publish.','IMAGE_UPLOAD','ASSET.LOCATION_PHOTO',false,false,false,false,false,false,true,'[]',6),
    ('a3000000-0000-4000-8000-000000000040','a3000000-0000-4000-8000-000000000040',template_id,'a2000000-0000-4000-8000-000000000006','TEAM_PHOTO_UPLOAD','Upload a team photograph if available.','Use an image with appropriate consent from everyone shown.','IMAGE_UPLOAD','ASSET.TEAM_PHOTO',false,false,false,false,false,false,true,'[]',7)
  ON CONFLICT (template_id, question_key) DO UPDATE SET
    label = EXCLUDED.label,
    guidance = EXCLUDED.guidance,
    question_type = EXCLUDED.question_type,
    field_mapping = EXCLUDED.field_mapping,
    required = EXCLUDED.required,
    system_required = EXCLUDED.system_required,
    evidence_required = EXCLUDED.evidence_required,
    public_use_allowed = EXCLUDED.public_use_allowed,
    booking_use_allowed = EXCLUDED.booking_use_allowed,
    generation_use_allowed = EXCLUDED.generation_use_allowed,
    agency_verification_required = EXCLUDED.agency_verification_required,
    options_json = EXCLUDED.options_json,
    display_order = EXCLUDED.display_order;
END
$$;
