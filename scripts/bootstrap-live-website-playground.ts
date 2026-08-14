import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  agencyUsers,
  bookingChannelSchedules,
  closeDatabase,
  factFindingQuestionnaires,
  factFindingQuestionnaireQuestions,
  factFindingResponses,
  factFindingTemplates,
  getDatabase,
  locations,
  platformPlanEntitlements,
  platformPlans,
  platformPlanVersions,
  productionBriefFacts,
  productionBriefs,
  provisioningRuns,
  serviceLocations,
  services,
  siteGenerationRuns,
  siteJobs,
  sites,
  staffLocations,
  staffSchedules,
  staffServiceAssignments,
  templateSources,
  templateVersions,
  tenantPlanAssignments,
  tenants,
  users,
} from '@ks-os/database';
import { AgencyService, type AgencyActor } from '../apps/api/src/modules/agency/agency.service.js';
import { ManualTenantUserService } from '../apps/api/src/modules/agency/manual-tenant-user.service.js';
import { BookingPageService } from '../apps/api/src/modules/bookings/booking-page.service.js';
import { AgencyBookingSetupService } from '../apps/api/src/modules/provisioning/agency-booking-setup.service.js';
import { BookingFactSyncService } from '../apps/api/src/modules/provisioning/booking-fact-sync.service.js';
import { BookingAwareProvisioningService } from '../apps/api/src/modules/provisioning/booking-aware-provisioning.service.js';
import { FactFindingService } from '../apps/api/src/modules/provisioning/fact-finding.service.js';
import { ManualFactFindingService } from '../apps/api/src/modules/provisioning/manual-fact-finding.service.js';
import { AgencySiteGenerationService } from '../apps/api/src/modules/sites/site-generation.service.js';

dotenv.config({ path: resolve(process.cwd(), '../../.env'), quiet: true });

const EXPECTED_SUBDOMAIN = 'playground';
const EXPECTED_HOSTNAME = 'playground.kasimshah.com';
const EXPECTED_POSTCODE = 'LS1 4AB';
const REQUIRED_MARKETING_PAGE_LIMIT = 15;

function requireGuard() {
  if (process.env.LIVE_PLAYGROUND_BOOTSTRAP_ENABLED !== 'true') {
    throw new Error('LIVE_PLAYGROUND_BOOTSTRAP_ENABLED must be exactly true.');
  }
  if ((process.env.LIVE_PLAYGROUND_SUBDOMAIN || EXPECTED_SUBDOMAIN) !== EXPECTED_SUBDOMAIN) {
    throw new Error('LIVE_PLAYGROUND_SUBDOMAIN must be exactly playground.');
  }
  if ((process.env.LIVE_PLAYGROUND_HOSTNAME || EXPECTED_HOSTNAME) !== EXPECTED_HOSTNAME) {
    throw new Error('LIVE_PLAYGROUND_HOSTNAME must be exactly playground.kasimshah.com.');
  }
}

let db: ReturnType<typeof getDatabase>;

const serviceFixtures = [
  { name: 'Signature Glow Facial', description: 'A personalised facial with a calm consultation, tailored exfoliation and restorative hydration.', durationMinutes: 60, priceMinor: 6500 },
  { name: 'Deep Renewal Facial', description: 'A restorative facial tailored to support renewed, well-cared-for skin with clear aftercare guidance.', durationMinutes: 75, priceMinor: 8500 },
  { name: 'Brow Shape and Tint', description: 'A considered brow consultation, shape and tint for a softly defined everyday finish.', durationMinutes: 30, priceMinor: 3200 },
  { name: 'Luxury Gel Manicure', description: 'A detailed gel manicure with careful preparation, colour application and practical aftercare.', durationMinutes: 50, priceMinor: 4200 },
  { name: 'Skin Consultation', description: 'A one-to-one skin consultation with practical home-care guidance and a recommended treatment plan.', durationMinutes: 30, priceMinor: 2500 },
] as const;

const staffFixtures = [
  {
    email: 'maya@playground.kasimshah.com',
    name: 'Maya Bennett',
    title: 'Lead Skin Therapist',
    bio: 'Maya is Luma Beauty Studio’s lead skin therapist, known for calm consultations, tailored facial treatments and clear skin-care guidance.',
    role: 'owner' as const,
  },
  {
    email: 'sara@playground.kasimshah.com',
    name: 'Sara Khan',
    title: 'Brow and Beauty Specialist',
    bio: 'Sara specialises in thoughtful brow and beauty treatments, combining a warm welcome with careful detail and straightforward aftercare.',
    role: 'staff' as const,
  },
] as const;

async function actor(): Promise<AgencyActor> {
  const [row] = await db.select({ id: agencyUsers.id, role: agencyUsers.role })
    .from(agencyUsers)
    .where(and(eq(agencyUsers.status, 'ACTIVE'), eq(agencyUsers.role, 'PLATFORM_OWNER')))
    .orderBy(asc(agencyUsers.createdAt))
    .limit(1);
  if (!row) throw new Error('An active platform owner is required for the production bootstrap.');
  return { agencyUserId: row.id, role: row.role as AgencyActor['role'], requestId: 'live-playground-bootstrap' };
}

async function eligiblePlanVersion(minimumPageLimit = REQUIRED_MARKETING_PAGE_LIMIT) {
  const rows = await db.select({
    id: platformPlanVersions.id,
    key: platformPlans.key,
    value: platformPlanEntitlements.valueJson,
  }).from(platformPlanVersions)
    .innerJoin(platformPlans, eq(platformPlanVersions.planId, platformPlans.id))
    .innerJoin(platformPlanEntitlements, and(
      eq(platformPlanEntitlements.planVersionId, platformPlanVersions.id),
      eq(platformPlanEntitlements.entitlementKey, 'sites.initial_marketing_pages'),
    ))
    .where(and(
      eq(platformPlanVersions.status, 'ACTIVE'),
      inArray(platformPlans.key, ['CORE', 'GROWTH', 'SCALE']),
    ))
    .orderBy(asc(platformPlanVersions.monthlyPriceMinor));
  const plan = rows.find(row => Number((row.value as { limit?: unknown })?.limit) >= minimumPageLimit);
  if (!plan) throw new Error(`No active plan version includes at least ${minimumPageLimit} initial marketing pages.`);
  return plan;
}

async function ensureTenant(agency: AgencyService, agencyActor: AgencyActor) {
  const [existing] = await db.select().from(tenants)
    .where(eq(tenants.subdomain, EXPECTED_SUBDOMAIN)).limit(1);
  if (existing) {
    if (existing.name !== 'Luma Beauty Studio') {
      throw new Error('The playground subdomain is already owned by a different workspace.');
    }
    const plan = await eligiblePlanVersion();
    const [assignment] = await db.select({ planVersionId: tenantPlanAssignments.planVersionId })
      .from(tenantPlanAssignments).where(and(
        eq(tenantPlanAssignments.tenantId, existing.id),
        eq(tenantPlanAssignments.status, 'ACTIVE'),
      )).limit(1);
    if (assignment?.planVersionId !== plan.id) {
      await agency.changePlan(
        agencyActor,
        existing.id,
        plan.id,
        'IMMEDIATE',
        'The fictional live playground requires the governed 15-page marketing plan used by its acceptance fixture.',
      );
    }
    return (await db.select().from(tenants).where(eq(tenants.id, existing.id)).limit(1))[0];
  }
  const plan = await eligiblePlanVersion();
  return agency.createTenant(agencyActor, {
    name: 'Luma Beauty Studio',
    legalBusinessName: 'Luma Beauty Studio Ltd',
    subdomain: EXPECTED_SUBDOMAIN,
    businessType: 'Beauty studio',
    timezone: 'Europe/London',
    currency: 'GBP',
    planVersionId: plan.id,
    primaryContactName: 'Maya Bennett',
    primaryContactEmail: 'maya@playground.kasimshah.com',
    foundingClient: false,
    commercialNotes: 'Fictional internal live-playground workspace. No real customer data.',
  });
}

async function ensureBookingData(agencyActor: AgencyActor, tenant: typeof tenants.$inferSelect) {
  const agency = new AgencyService();
  await agency.updateTenant(agencyActor, tenant.id, {
    operationalPhone: '+442079460958',
    replyToEmail: 'hello@playground.kasimshah.com',
    primaryColor: '#563B47',
    secondaryColor: '#D8B9A8',
    accentColor: '#A36D73',
    primaryContactName: 'Maya Bennett',
    primaryContactEmail: 'maya@playground.kasimshah.com',
    minimumCancellationNoticeMinutes: 1440,
    minimumRescheduleNoticeMinutes: 1440,
    lateCancellationMessage: 'Please give at least 24 hours notice when cancelling or rescheduling.',
    depositPolicyMessage: 'Online payment is not required for this fictional playground studio; guests may pay later.',
  });

  const bookingSetup = new AgencyBookingSetupService();
  const legacyServiceNames: Record<string, string[]> = {
    'Deep Renewal Facial': ['Radiance Reset Peel'],
    'Brow Shape and Tint': ['Brow Shape & Tint'],
    'Luxury Gel Manicure': ['Lash Lift & Tint'],
    'Skin Consultation': ['Calm Skin Consultation'],
  };
  let bookingSummary = await bookingSetup.summary(tenant.agencyReference);
  for (const fixture of serviceFixtures) {
    const existing = bookingSummary.services.find(item =>
      item.name === fixture.name || (legacyServiceNames[fixture.name] || []).includes(item.name));
    if (existing) {
      await bookingSetup.updateService(
        agencyActor,
        tenant.agencyReference,
        existing.reference,
        { ...fixture, active: true },
      );
    } else {
      await bookingSetup.createService(agencyActor, tenant.agencyReference, fixture);
    }
  }
  bookingSummary = await bookingSetup.summary(tenant.agencyReference);
  const expectedServiceNames = new Set<string>(serviceFixtures.map(item => item.name));
  for (const service of bookingSummary.services) {
    if (service.active && !expectedServiceNames.has(service.name)) {
      await bookingSetup.setServiceActive(agencyActor, tenant.agencyReference, service.reference, false);
    }
  }

  bookingSummary = await bookingSetup.summary(tenant.agencyReference);
  const locationToReuse = bookingSummary.locations.find(item => item.active)
    || bookingSummary.locations[0];
  const resolvedLocation = await bookingSetup.saveLocation(agencyActor, tenant.agencyReference, {
    reference: locationToReuse?.reference,
    name: 'Luma Beauty Studio',
    address: '18 Market Lane, Leeds, UK',
    postcode: EXPECTED_POSTCODE,
    phone: '+442079460958',
    timezone: 'Europe/London',
    primary: true,
    active: true,
  });
  for (const extra of bookingSummary.locations.filter(item => item.reference !== resolvedLocation.publicReference)) {
    await bookingSetup.saveLocation(agencyActor, tenant.agencyReference, {
      reference: extra.reference,
      name: extra.name,
      address: extra.address,
      postcode: extra.postcode,
      timezone: 'Europe/London',
      primary: false,
      active: false,
    });
  }
  if (!resolvedLocation) throw new Error('The playground location could not be resolved.');

  const manualUsers = new ManualTenantUserService();
  for (const fixture of staffFixtures) {
    let [member] = await db.select().from(users)
      .where(and(eq(users.tenantId, tenant.id), eq(users.emailNormalized, fixture.email))).limit(1);
    if (!member) {
      const created = await manualUsers.create(agencyActor, tenant.agencyReference, {
        email: fixture.email,
        displayName: fixture.name,
        role: fixture.role,
        bookingEnabled: true,
      });
      [member] = await db.select().from(users).where(eq(users.publicReference, created.id)).limit(1);
    }
    if (!member) throw new Error(`The fictional staff profile ${fixture.name} could not be resolved.`);
    await manualUsers.updateProfile(agencyActor, tenant.agencyReference, member.publicReference, {
      displayName: fixture.name,
      jobTitle: fixture.title,
      biography: fixture.bio,
      bookingEnabled: true,
    });
    await db.insert(staffLocations).values({ tenantId: tenant.id, staffUserId: member.id, locationId: resolvedLocation.id })
      .onConflictDoNothing();
    for (const dayOfWeek of [1, 2, 3, 4, 5, 6]) {
      const hours = dayOfWeek === 6 ? { start: '09:00', end: '16:00' } : { start: '09:30', end: '18:00' };
      const [schedule] = await db.select({ id: staffSchedules.id }).from(staffSchedules).where(and(
        eq(staffSchedules.tenantId, tenant.id), eq(staffSchedules.userId, member.id),
        eq(staffSchedules.dayOfWeek, dayOfWeek), eq(staffSchedules.startTime, hours.start), eq(staffSchedules.endTime, hours.end),
      )).limit(1);
      if (!schedule) await db.insert(staffSchedules).values({ tenantId: tenant.id, userId: member.id, dayOfWeek, startTime: hours.start, endTime: hours.end });
      const [channelSchedule] = await db.select({ id: bookingChannelSchedules.id }).from(bookingChannelSchedules).where(and(
        eq(bookingChannelSchedules.tenantId, tenant.id), eq(bookingChannelSchedules.userId, member.id),
        eq(bookingChannelSchedules.bookingChannel, 'in_shop'), eq(bookingChannelSchedules.dayOfWeek, dayOfWeek),
      )).limit(1);
      if (!channelSchedule) await db.insert(bookingChannelSchedules).values({ tenantId: tenant.id, userId: member.id, bookingChannel: 'in_shop', dayOfWeek, startTime: hours.start, endTime: hours.end });
    }
  }

  const expectedStaffEmails = new Set<string>(staffFixtures.map(item => item.email));
  const staleMembers = await db.select({
    reference: users.publicReference,
    email: users.emailNormalized,
  }).from(users).where(and(eq(users.tenantId, tenant.id), eq(users.accountStatus, 'ACTIVE')));
  for (const member of staleMembers) {
    if (!expectedStaffEmails.has(member.email)) {
      await agency.setTenantUserStatus(agencyActor, tenant.id, member.reference, 'SUSPENDED');
    }
  }

  const [serviceRows, memberRows] = await Promise.all([
    db.select().from(services).where(and(eq(services.tenantId, tenant.id), eq(services.isActive, true))),
    db.select().from(users).where(and(eq(users.tenantId, tenant.id), eq(users.accountStatus, 'ACTIVE'), eq(users.bookingEnabled, true))),
  ]);
  for (const service of serviceRows) {
    await db.insert(serviceLocations).values({ tenantId: tenant.id, serviceId: service.id, locationId: resolvedLocation.id }).onConflictDoNothing();
    for (const member of memberRows) {
      await db.insert(staffServiceAssignments).values({ tenantId: tenant.id, staffUserId: member.id, serviceId: service.id, isActive: true }).onConflictDoNothing();
    }
  }

  const [owner] = memberRows.sort((left, right) => Number(right.role === 'owner') - Number(left.role === 'owner'));
  if (!owner) throw new Error('The booking page needs an active owner membership.');
  const bookingPage = new BookingPageService();
  await bookingPage.ensureForTenant(tenant.id);
  await bookingPage.updateSettings(tenant.id, owner.id, {
    publicSlug: 'playground',
    title: 'Book with Luma Beauty Studio',
    description: 'Choose a fictional Luma service and a convenient time. This playground demonstrates the real KS OS native booking journey.',
    enabled: true,
    defaultLocationId: resolvedLocation.id,
    allowedLocationIds: [resolvedLocation.id],
    allowedServiceIds: serviceRows.map(item => item.id),
    allowedStaffIds: memberRows.map(item => item.id),
    bookingRules: { minimumNoticeMinutes: 120, maximumFutureDays: 90, slotIntervalMinutes: 30, allowAnyStaff: true, allowGuestBooking: true, customerNotesEnabled: true, enabledBookingChannels: ['in_shop'] },
    paymentSettings: { mode: 'PAY_LATER', depositPercentage: 0, promotionCodesEnabled: false, giftCardsEnabled: false },
    cancellationSettings: { customerCancellationEnabled: true, customerReschedulingEnabled: true, minimumNoticeMinutes: 1440, policyText: 'Please give at least 24 hours notice when cancelling or rescheduling.' },
    seoSettings: { title: 'Book Luma Beauty Studio', description: 'Book a fictional beauty appointment in the KS OS playground.', socialTitle: 'Luma Beauty Studio', socialDescription: 'A fictional KS OS live booking playground.', socialImageUrl: null, allowIndexing: false, canonicalUrl: null },
  });
  await bookingPage.setPublished(tenant.id, true);
}

function controlledAnswer(question: { fieldMapping?: string | null; questionType: string; options?: unknown }) {
  const mapped: Record<string, unknown> = {
    'LOCATION.ADDRESS': { line1: '18 Market Lane', city: 'Leeds', postcode: EXPECTED_POSTCODE, countryCode: 'GB' },
    'BUSINESS.DESCRIPTION': 'Luma Beauty Studio is a calm, contemporary fictional beauty studio in Leeds, created to demonstrate a complete KS OS website and native booking journey.',
    'BUSINESS.CATEGORY': 'BEAUTY_CLINIC',
    'BUSINESS.AUDIENCE': 'Leeds clients seeking thoughtful, high-quality skin, brow and beauty treatments in a welcoming studio.',
    'BUSINESS.DIFFERENTIATORS': ['Personalised consultations', 'Clear treatment guidance', 'Calm studio experience'],
    'BUSINESS.BRAND_VOICE': 'Warm, refined, reassuring and clear. Never overclaim results.',
    'BRAND.TONE': 'Warm, modern, calm and expert-led.',
    'BRAND.VISUAL_DIRECTION': 'Editorial warmth, soft rose and cocoa tones, generous whitespace and authentic treatment imagery.',
    'BOOKING.CANCELLATION_POLICY': 'Please give at least 24 hours notice when cancelling or rescheduling.',
  };
  if (question.fieldMapping && mapped[question.fieldMapping] !== undefined) return mapped[question.fieldMapping];
  const options = Array.isArray(question.options) ? question.options : [];
  const firstOption = options.map(item => typeof item === 'string' ? item : (item as { value?: unknown })?.value).find(item => typeof item === 'string');
  switch (question.questionType) {
    case 'BOOLEAN': return true;
    case 'NUMBER': case 'DURATION': return 30;
    case 'MONEY': return { amountMinor: 3500, currency: 'GBP' };
    case 'ADDRESS': return { line1: '18 Market Lane', city: 'Leeds', postcode: EXPECTED_POSTCODE, countryCode: 'GB' };
    case 'OPENING_HOURS': return [1, 2, 3, 4, 5, 6].map(dayOfWeek => ({ dayOfWeek, opensAt: dayOfWeek === 6 ? '09:00' : '09:30', closesAt: dayOfWeek === 6 ? '16:00' : '18:00', closed: false }));
    case 'MULTI_SELECT': return firstOption ? [firstOption] : ['Not applicable'];
    case 'SINGLE_SELECT': return firstOption || 'Not applicable';
    case 'EMAIL': return 'hello@playground.kasimshah.com';
    case 'PHONE': return '+442079460958';
    case 'URL': return 'https://playground.kasimshah.com';
    case 'DATE': return '2026-08-03';
    default: return 'Confirmed for the fictional Luma Beauty Studio playground.';
  }
}

async function ensureLockedBrief(agencyActor: AgencyActor, tenant: typeof tenants.$inferSelect) {
  const [locked] = await db.select({ brief: productionBriefs }).from(productionBriefs)
    .innerJoin(productionBriefFacts, eq(productionBriefFacts.productionBriefId, productionBriefs.id))
    .where(and(
      eq(productionBriefs.tenantId, tenant.id),
      eq(productionBriefs.status, 'LOCKED_FOR_PROVISIONING'),
      eq(productionBriefFacts.fieldMapping, 'LOCATION.ADDRESS'),
      sql`${productionBriefFacts.approvedValueJson}->>'postcode' = ${EXPECTED_POSTCODE}`,
    ))
    .orderBy(sql`${productionBriefs.briefVersion} desc`).limit(1);
  if (locked) return locked.brief;

  const facts = new FactFindingService();
  const manual = new ManualFactFindingService();
  const sync = new BookingFactSyncService();
  const [canonicalQuestionnaire] = await db.select({ questionnaire: factFindingQuestionnaires })
    .from(factFindingQuestionnaires)
    .innerJoin(factFindingResponses, eq(factFindingResponses.questionnaireId, factFindingQuestionnaires.id))
    .where(and(
      eq(factFindingQuestionnaires.tenantId, tenant.id),
      sql`${factFindingQuestionnaires.status} <> 'SUPERSEDED'`,
      eq(factFindingResponses.fieldMapping, 'LOCATION.ADDRESS'),
      sql`coalesce(${factFindingResponses.approvedValueJson}, ${factFindingResponses.answerJson})->>'postcode' = ${EXPECTED_POSTCODE}`,
    ))
    .orderBy(sql`${factFindingQuestionnaires.questionnaireVersion} desc`).limit(1);
  let questionnaire = canonicalQuestionnaire?.questionnaire;
  if (!questionnaire) {
    const [template] = await db.select().from(factFindingTemplates)
      .where(eq(factFindingTemplates.status, 'ACTIVE'))
      .orderBy(sql`${factFindingTemplates.version} desc`).limit(1);
    if (!template) throw new Error('An active fact-finding template is required.');
    const created = await facts.createQuestionnaire(agencyActor, tenant.agencyReference, {
      templateReference: template.publicReference,
      assignedReviewerReference: agencyActor.agencyUserId,
    });
    [questionnaire] = await db.select().from(factFindingQuestionnaires)
      .where(eq(factFindingQuestionnaires.publicReference, created.reference)).limit(1);
  }
  if (!questionnaire) throw new Error('The fact-finding questionnaire could not be resolved.');
  if (questionnaire.status === 'DRAFT') {
    const detail = await facts.questionnaireDetail(questionnaire.publicReference);
    await facts.prequalify(agencyActor, questionnaire.publicReference, {
      questionOverrides: detail.questions
        .filter(question => !question.required && !question.systemRequired)
        .map(question => ({ questionReference: question.reference, included: false })),
    });
  }
  if (['PREQUALIFIED', 'IN_PROGRESS', 'CLARIFICATION_REQUIRED'].includes(questionnaire.status) || questionnaire.status === 'DRAFT') {
    await sync.sync(agencyActor, questionnaire.publicReference);
    const form = await manual.form(questionnaire.publicReference);
    const existing = new Set(form.responses.map(response => response.questionReference));
    for (const question of form.questions) {
      if (existing.has(question.reference)) continue;
      if (['FILE_UPLOAD', 'IMAGE_UPLOAD'].includes(question.questionType)) {
        throw new Error(`Required asset question ${question.key} needs a real reviewed upload before provisioning.`);
      }
      await manual.save(agencyActor, questionnaire.publicReference, question.reference, controlledAnswer(question));
    }
    await manual.submit(agencyActor, questionnaire.publicReference);
  }

  const form = await manual.form(questionnaire.publicReference);
  const questions = new Map(form.questions.map(question => [question.reference, question]));
  const responseRows = await db.select({
    reference: factFindingResponses.publicReference,
    questionReference: factFindingQuestionnaireQuestions.publicReference,
    status: factFindingResponses.status,
  }).from(factFindingResponses)
    .innerJoin(factFindingQuestionnaireQuestions, eq(factFindingQuestionnaireQuestions.id, factFindingResponses.questionId))
    .where(eq(factFindingResponses.questionnaireId, questionnaire.id));
  for (const response of responseRows) {
    if (response.status === 'AGENCY_APPROVED') continue;
    const question = questions.get(response.questionReference);
    if (!question) continue;
    await facts.approveResponse(agencyActor, response.reference, {
      publicUseEligible: question.publicUseAllowed,
      bookingUseEligible: question.bookingUseAllowed,
      generationUseEligible: question.generationUseAllowed,
      verificationBasis: question.evidenceRequired ? 'VERIFIED' : 'AGENCY_CONFIRMED',
      note: 'Verified fictional playground content against the canonical Luma setup.',
    });
  }
  const brief = await facts.buildBrief(agencyActor, questionnaire.publicReference, {});
  await facts.approveBrief(agencyActor, brief.reference);
  return facts.lockBrief(agencyActor, brief.reference);
}

async function ensureProvisioningRun(agencyActor: AgencyActor, tenant: typeof tenants.$inferSelect, briefReference: string) {
  const [existing] = await db.select({ run: provisioningRuns }).from(provisioningRuns)
    .innerJoin(productionBriefs, eq(provisioningRuns.productionBriefId, productionBriefs.id))
    .where(and(
      eq(provisioningRuns.tenantId, tenant.id),
      eq(productionBriefs.publicReference, briefReference),
    ))
    .orderBy(sql`${provisioningRuns.createdAt} desc`).limit(1);
  if (existing) return existing.run;
  const plan = await eligiblePlanVersion();
  const [template] = await db.select({ reference: templateVersions.publicReference })
    .from(templateVersions)
    .innerJoin(templateSources, eq(templateVersions.templateSourceId, templateSources.id))
    .where(and(
      eq(templateSources.sourceReference, 'ks-native-component-system'),
      eq(templateVersions.status, 'APPROVED'),
      eq(templateVersions.analysisStatus, 'APPROVED'),
    )).limit(1);
  if (!template) throw new Error('The approved KS Native renderer is unavailable.');
  const provisioning = new BookingAwareProvisioningService(db, process.env);
  const draft = await provisioning.createDraft(agencyActor, {
    productionBriefReference: briefReference,
    planVersionReference: plan.id,
    workspace: { name: 'Luma Beauty Studio', subdomain: EXPECTED_SUBDOMAIN, timezone: 'Europe/London', currency: 'GBP' },
    templateVersionReference: template.reference,
    pagePlan: {
      requestedPageTypes: ['HOME', 'SERVICE_HUB', 'SERVICE_DETAIL', 'ABOUT', 'TEAM_HUB', 'LOCATION_DETAIL', 'CONTACT', 'FAQ', 'POLICIES', 'NEW_CLIENT_GUIDE', 'BOOKING'],
      targetMarketingPageCount: REQUIRED_MARKETING_PAGE_LIMIT,
      preferredLayoutReferences: {},
      design: { source: 'KS_NATIVE', presetKey: 'NORTHLIGHT', defaultSectionVariant: 'editorial' },
    },
    paymentPreference: { allowPayLater: true, onlinePaymentsRequested: false, depositCollectionRequested: false },
  });
  const validation = await provisioning.validateDraft(agencyActor, draft.reference);
  if (!validation.ready) throw new Error(`Provisioning is blocked: ${validation.blockingIssues.map(issue => issue.code).join(', ')}`);
  return provisioning.start(agencyActor, {
    provisioningDraftReference: draft.reference,
    idempotencyKey: `live-playground:${tenant.businessReference}:${draft.reference}`,
  });
}

async function reconcileStrandedGeneration(agencyActor: AgencyActor, tenant: typeof tenants.$inferSelect) {
  const stranded = await db.select({
    siteReference: sites.publicReference,
    runReference: siteGenerationRuns.publicReference,
  }).from(siteGenerationRuns)
    .innerJoin(sites, eq(siteGenerationRuns.siteId, sites.id))
    .innerJoin(siteJobs, eq(siteGenerationRuns.siteJobId, siteJobs.id))
    .where(and(
      eq(siteGenerationRuns.tenantId, tenant.id),
      inArray(siteGenerationRuns.status, ['PENDING', 'PREPARING_CONTEXT', 'GENERATING', 'VALIDATING', 'REPAIRING']),
      inArray(siteJobs.status, ['FAILED', 'DEAD_LETTER']),
    ));
  const generation = new AgencySiteGenerationService(db, undefined, process.env);
  for (const run of stranded) {
    await generation.reconcileTerminalJobState(
      agencyActor,
      run.siteReference,
      run.runReference,
      'Reconcile the preflight failure that preceded durable run-state persistence, then start the exact-fixture provisioning revision.',
    );
  }
}

async function main() {
  requireGuard();
  db = getDatabase();
  const agencyActor = await actor();
  const agency = new AgencyService();
  const tenant = await ensureTenant(agency, agencyActor);
  await ensureBookingData(agencyActor, tenant);
  for (const stageKey of ['SALE_HANDOVER', 'CONTRACT', 'SETUP_FEE', 'DIRECT_DEBIT', 'BUSINESS_PROFILE', 'BRAND_ASSETS', 'CATALOGUE', 'TEAM_AND_LOCATIONS']) {
    await agency.updateStage(agencyActor, tenant.id, stageKey, { status: 'COMPLETE', notes: 'Completed by the guarded fictional playground bootstrap.' });
  }
  const brief = await ensureLockedBrief(agencyActor, tenant);
  const briefReference = 'reference' in brief ? brief.reference : brief.publicReference;
  await reconcileStrandedGeneration(agencyActor, tenant);
  const run = await ensureProvisioningRun(agencyActor, tenant, briefReference);
  process.stdout.write(`${JSON.stringify({
    tenantReference: tenant.businessReference,
    subdomain: tenant.subdomain,
    hostname: EXPECTED_HOSTNAME,
    productionBriefReference: briefReference,
    provisioningRunReference: 'reference' in run ? run.reference : run.publicReference,
    status: run.status,
    nextRequiredAction: 'Wait for provisioning, then complete the mandatory human review in Site Studio.',
  })}\n`);
}

main()
  .catch(error => {
    const safe = error instanceof Error ? error.message : 'Playground bootstrap failed.';
    process.stderr.write(`${safe}\n`);
    process.exitCode = 1;
  })
  .finally(() => db ? closeDatabase() : undefined);
