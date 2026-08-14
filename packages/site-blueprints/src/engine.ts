import { createHash } from 'node:crypto';
import type {
  BlueprintNavigationGroup,
  BlueprintPageInput,
  SiteConversionRole,
  SiteEntitlementKind,
  SitePageType,
} from '@ks-os/contracts';
import { bookingRequirementsForPage } from './booking.js';
import { scorePageOpportunity } from './scoring.js';
import {
  allocateUniqueBlueprintPath,
  defaultBlueprintPath,
  slugifySegment,
} from './slug.js';
import type {
  BlueprintEngineInput,
  BlueprintLayoutInput,
  BlueprintPlan,
  PlannedBlueprintActionItem,
} from './types.js';
import { BLUEPRINT_ENGINE_VERSION } from './types.js';
import { validateBlueprint } from './validation.js';

const PAGE_DEFAULTS: Record<SitePageType, {
  conversionRole: SiteConversionRole;
  navigationGroup: BlueprintNavigationGroup;
  entitlementKind: SiteEntitlementKind;
  title: string;
  priority: number;
}> = {
  HOME: { conversionRole: 'PRIMARY_LANDING', navigationGroup: 'PRIMARY', entitlementKind: 'MARKETING', title: 'Home', priority: 1 },
  SERVICE_HUB: { conversionRole: 'SERVICE_CONVERSION', navigationGroup: 'PRIMARY', entitlementKind: 'MARKETING', title: 'Services', priority: 2 },
  SERVICE_DETAIL: { conversionRole: 'SERVICE_CONVERSION', navigationGroup: 'CONTEXTUAL', entitlementKind: 'MARKETING', title: 'Service', priority: 3 },
  LOCATION_HUB: { conversionRole: 'LOCAL_DISCOVERY', navigationGroup: 'PRIMARY', entitlementKind: 'MARKETING', title: 'Locations', priority: 8 },
  LOCATION_DETAIL: { conversionRole: 'LOCAL_DISCOVERY', navigationGroup: 'SECONDARY', entitlementKind: 'MARKETING', title: 'Location', priority: 7 },
  ABOUT: { conversionRole: 'TRUST_BUILDING', navigationGroup: 'PRIMARY', entitlementKind: 'MARKETING', title: 'About', priority: 4 },
  TEAM_HUB: { conversionRole: 'TRUST_BUILDING', navigationGroup: 'PRIMARY', entitlementKind: 'MARKETING', title: 'Team', priority: 9 },
  TEAM_DETAIL: { conversionRole: 'TRUST_BUILDING', navigationGroup: 'CONTEXTUAL', entitlementKind: 'MARKETING', title: 'Team member', priority: 10 },
  CONTACT: { conversionRole: 'TRUST_BUILDING', navigationGroup: 'PRIMARY', entitlementKind: 'MARKETING', title: 'Contact', priority: 5 },
  FAQ: { conversionRole: 'OBJECTION_HANDLING', navigationGroup: 'SECONDARY', entitlementKind: 'MARKETING', title: 'Frequently asked questions', priority: 6 },
  POLICIES: { conversionRole: 'OBJECTION_HANDLING', navigationGroup: 'SECONDARY', entitlementKind: 'REQUIRED_LEGAL', title: 'Policies', priority: 12 },
  RESULTS: { conversionRole: 'TRUST_BUILDING', navigationGroup: 'PRIMARY', entitlementKind: 'MARKETING', title: 'Results', priority: 11 },
  NEW_CLIENT_GUIDE: { conversionRole: 'OBJECTION_HANDLING', navigationGroup: 'SECONDARY', entitlementKind: 'MARKETING', title: 'New client guide', priority: 13 },
  AFTERCARE_GUIDE: { conversionRole: 'OBJECTION_HANDLING', navigationGroup: 'CONTEXTUAL', entitlementKind: 'MARKETING', title: 'Aftercare guide', priority: 14 },
  CONSULTATION_GUIDE: { conversionRole: 'OBJECTION_HANDLING', navigationGroup: 'CONTEXTUAL', entitlementKind: 'MARKETING', title: 'Consultation guide', priority: 15 },
  GUIDE: { conversionRole: 'OBJECTION_HANDLING', navigationGroup: 'SECONDARY', entitlementKind: 'MARKETING', title: 'Guide', priority: 16 },
  HOW_TO: { conversionRole: 'OBJECTION_HANDLING', navigationGroup: 'CONTEXTUAL', entitlementKind: 'MARKETING', title: 'How to', priority: 17 },
  ARTICLE: { conversionRole: 'TRUST_BUILDING', navigationGroup: 'CONTEXTUAL', entitlementKind: 'MARKETING', title: 'Article', priority: 18 },
  BLOG_POST: { conversionRole: 'TRUST_BUILDING', navigationGroup: 'CONTEXTUAL', entitlementKind: 'MARKETING', title: 'Blog post', priority: 19 },
  FAQ_RESOURCE: { conversionRole: 'OBJECTION_HANDLING', navigationGroup: 'CONTEXTUAL', entitlementKind: 'MARKETING', title: 'FAQ resource', priority: 20 },
  TUTORIAL: { conversionRole: 'OBJECTION_HANDLING', navigationGroup: 'CONTEXTUAL', entitlementKind: 'MARKETING', title: 'Tutorial', priority: 21 },
  DEFINITION: { conversionRole: 'OBJECTION_HANDLING', navigationGroup: 'CONTEXTUAL', entitlementKind: 'MARKETING', title: 'Definition', priority: 22 },
  TROUBLESHOOTING: { conversionRole: 'OBJECTION_HANDLING', navigationGroup: 'CONTEXTUAL', entitlementKind: 'MARKETING', title: 'Troubleshooting', priority: 23 },
  COMPARISON: { conversionRole: 'TRUST_BUILDING', navigationGroup: 'CONTEXTUAL', entitlementKind: 'MARKETING', title: 'Comparison', priority: 24 },
  CASE_STUDY: { conversionRole: 'TRUST_BUILDING', navigationGroup: 'CONTEXTUAL', entitlementKind: 'MARKETING', title: 'Case study', priority: 25 },
  BOOKING: { conversionRole: 'BOOKING', navigationGroup: 'FUNCTIONAL', entitlementKind: 'FUNCTIONAL', title: 'Book now', priority: 0 },
};

interface Candidate {
  pageType: SitePageType;
  title: string;
  subjectName?: string;
  serviceReference?: string;
  locationReference?: string;
  staffReference?: string;
  explicitPath?: boolean;
  required: boolean;
  score: number;
  reasons: string[];
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function calculateBlueprintSourceDigest(input: BlueprintEngineInput) {
  const digestInput = {
    engineVersion: BLUEPRINT_ENGINE_VERSION,
    siteReference: input.siteReference,
    tenantReference: input.tenantReference,
    planKey: input.planKey,
    planAssignmentReference: input.planAssignmentReference,
    marketingPageLimit: input.marketingPageLimit,
    templateReference: input.template.reference,
    templateStatus: input.template.status,
    templateSourceType: input.template.sourceType,
    templateLicensed: input.template.licensedForSite,
    layouts: [...input.template.layouts].sort((a, b) => a.reference.localeCompare(b.reference)),
    services: [...input.services].sort((a, b) => a.reference.localeCompare(b.reference)),
    locations: [...input.locations].sort((a, b) => a.reference.localeCompare(b.reference)),
    staff: [...input.staff].sort((a, b) => a.reference.localeCompare(b.reference)),
    business: input.business,
    existingCanonicalPaths: [...input.existingCanonicalPaths].sort(),
    request: input.request,
  };
  return createHash('sha256')
    .update(JSON.stringify(stableValue(digestInput)))
    .digest('hex');
}

function layoutFor(
  input: BlueprintEngineInput,
  pageType: SitePageType,
): BlueprintLayoutInput | null {
  const compatible = input.template.layouts
    .filter((layout) =>
      layout.templateVersionReference === input.template.reference
      && layout.approved
      && layout.enabled
      && layout.approvedPageTypes.includes(pageType))
    .sort((left, right) => left.reference.localeCompare(right.reference));
  const preferred = input.request.preferences.preferredLayoutReferences[pageType];
  return compatible.find((layout) => layout.reference === preferred)
    || compatible[0]
    || null;
}

function actionItem(
  category: PlannedBlueprintActionItem['category'],
  severity: PlannedBlueprintActionItem['severity'],
  code: string,
  message: string,
  subjectReference: string | null = null,
  safeMetadata: PlannedBlueprintActionItem['safeMetadata'] = {},
): PlannedBlueprintActionItem {
  return {
    category,
    severity,
    code,
    message,
    pageReference: null,
    subjectReference,
    safeMetadata,
  };
}

function candidate(
  input: Omit<Candidate, 'score' | 'reasons'> & {
    scoreInput: Parameters<typeof scorePageOpportunity>[0];
  },
): Candidate {
  const scored = scorePageOpportunity(input.scoreInput);
  return {
    pageType: input.pageType,
    title: input.title,
    subjectName: input.subjectName,
    serviceReference: input.serviceReference,
    locationReference: input.locationReference,
    staffReference: input.staffReference,
    explicitPath: input.explicitPath,
    required: input.required,
    score: scored.score,
    reasons: scored.reasons,
  };
}

function buildCandidates(
  input: BlueprintEngineInput,
  actionItems: PlannedBlueprintActionItem[],
) {
  const candidates: Candidate[] = [];
  const baseline = (
    pageType: SitePageType,
    ready: boolean,
    missingMessage?: string,
  ) => {
    const layout = layoutFor(input, pageType);
    const explicitlyRequested = input.request.preferences.includePageTypes.includes(pageType);
    if (!ready && missingMessage) {
      actionItems.push(actionItem(
        'BUSINESS_PROFILE',
        pageType === 'HOME' || explicitlyRequested ? 'BLOCKING' : 'WARNING',
        `${pageType}_DATA_INCOMPLETE`,
        missingMessage,
      ));
    }
    candidates.push(candidate({
      pageType,
      title: PAGE_DEFAULTS[pageType].title,
      required: ['HOME', 'BOOKING'].includes(pageType) || explicitlyRequested,
      scoreInput: {
        pageType,
        requiredBaseline: ['HOME', 'BOOKING'].includes(pageType) || explicitlyRequested,
        fillsNavigationRole: true,
        handlesObjection: pageType === 'FAQ',
        compatibleLayout: Boolean(layout),
        missingRequiredData: !ready,
      },
    }));
  };
  baseline('HOME', true);
  if (input.services.some((service) => service.active && service.bookingEligible)) {
    baseline('SERVICE_HUB', true);
  } else {
    actionItems.push(actionItem(
      'SERVICE_DATA',
      'WARNING',
      'ACTIVE_SERVICES_REQUIRED',
      'No active bookable services are available for service planning.',
    ));
  }
  baseline(
    'ABOUT',
    input.business.profileComplete,
    'Complete the verified founder or business story before generating the About page.',
  );
  baseline(
    'CONTACT',
    input.business.contactComplete,
    'Complete verified business contact details.',
  );
  baseline('FAQ', true);
  baseline('POLICIES', true);
  baseline('BOOKING', true);

  for (const service of [...input.services].sort((a, b) => a.reference.localeCompare(b.reference))) {
    if (
      !service.active
      || !service.bookingEligible
      || service.tenantReference !== input.tenantReference
    ) continue;
    const layout = layoutFor(input, 'SERVICE_DETAIL');
    if (!layout) {
      actionItems.push(actionItem(
        'LAYOUT',
        'BLOCKING',
        'SERVICE_DETAIL_LAYOUT_MISSING',
        'An active approved SERVICE_DETAIL-compatible layout is required.',
        service.reference,
      ));
      continue;
    }
    const complete = Boolean(
      service.description
      && service.durationMinutes
      && service.priceMinor !== null,
    );
    candidates.push(candidate({
      pageType: 'SERVICE_DETAIL',
      title: service.name,
      subjectName: service.name,
      serviceReference: service.reference,
      required: false,
      scoreInput: {
        pageType: 'SERVICE_DETAIL',
        realActiveSubject: true,
        bookingEligible: true,
        agencyPriority:
          input.request.preferences.prioritisedServiceReferences.includes(service.reference),
        completeCommercialData: complete,
        compatibleLayout: true,
        thinContentRisk: !complete,
      },
    }));
    if (!complete) {
      actionItems.push(actionItem(
        'SERVICE_DATA',
        'WARNING',
        'SERVICE_DETAIL_RECOMMENDED_DATA_MISSING',
        'Service description, duration or pricing guidance is incomplete.',
        service.reference,
      ));
    }
  }

  const validLocations = input.locations.filter((location) =>
    location.active
    && location.addressComplete
    && location.tenantReference === input.tenantReference);
  if (validLocations.length >= 2) baseline('LOCATION_HUB', true);
  for (const location of [...input.locations].sort((a, b) => a.reference.localeCompare(b.reference))) {
    if (
      !location.active
      || location.tenantReference !== input.tenantReference
    ) continue;
    if (!location.addressComplete) {
      actionItems.push(actionItem(
        'LOCATION_DATA',
        location.primary ? 'BLOCKING' : 'WARNING',
        'LOCATION_ADDRESS_INCOMPLETE',
        'The location needs a verified complete address before a detail page is planned.',
        location.reference,
      ));
      continue;
    }
    const layout = layoutFor(input, 'LOCATION_DETAIL');
    if (!layout) {
      actionItems.push(actionItem(
        'LAYOUT',
        'BLOCKING',
        'LOCATION_DETAIL_LAYOUT_MISSING',
        'An active approved LOCATION_DETAIL-compatible layout is required.',
        location.reference,
      ));
      continue;
    }
    candidates.push(candidate({
      pageType: 'LOCATION_DETAIL',
      title: location.name,
      subjectName: location.name,
      locationReference: location.reference,
      required: false,
      scoreInput: {
        pageType: 'LOCATION_DETAIL',
        realActiveSubject: true,
        agencyPriority:
          input.request.preferences.prioritisedLocationReferences.includes(location.reference),
        completeCommercialData:
          location.openingHoursComplete && location.telephonePresent,
        compatibleLayout: true,
        thinContentRisk: !location.openingHoursComplete,
      },
    }));
  }

  const eligibleStaff = input.staff.filter((staff) =>
    staff.active
    && staff.publicProfileAllowed
    && staff.tenantReference === input.tenantReference);
  if (eligibleStaff.length >= 2) baseline('TEAM_HUB', true);
  for (const staff of [...input.staff].sort((a, b) => a.reference.localeCompare(b.reference))) {
    if (
      !staff.active
      || !staff.publicProfileAllowed
      || staff.tenantReference !== input.tenantReference
    ) continue;
    const meaningful = staff.biographyPresent || (
      staff.rolePresent
      && (staff.imagePresent || staff.serviceAssignmentCount > 0)
    );
    if (!meaningful) {
      actionItems.push(actionItem(
        'STAFF_DATA',
        'WARNING',
        'STAFF_PROFILE_INCOMPLETE',
        'The public staff profile needs meaningful role, biography, image or service data.',
        staff.reference,
      ));
      continue;
    }
    const layout = layoutFor(input, 'TEAM_DETAIL');
    if (!layout) {
      actionItems.push(actionItem(
        'LAYOUT',
        'BLOCKING',
        'TEAM_DETAIL_LAYOUT_MISSING',
        'An active approved TEAM_DETAIL-compatible layout is required.',
        staff.reference,
      ));
      continue;
    }
    candidates.push(candidate({
      pageType: 'TEAM_DETAIL',
      title: staff.name,
      subjectName: staff.name,
      staffReference: staff.reference,
      required: false,
      scoreInput: {
        pageType: 'TEAM_DETAIL',
        realActiveSubject: true,
        bookingEligible: staff.bookingEnabled,
        agencyPriority:
          input.request.preferences.prioritisedStaffReferences.includes(staff.reference),
        completeCommercialData: staff.biographyPresent && staff.rolePresent,
        compatibleLayout: true,
      },
    }));
  }

  if (
    input.request.preferences.includePageTypes.includes('RESULTS')
    && input.business.approvedResultsAssetCount > 0
  ) baseline('RESULTS', true);
  for (const guide of [
    'NEW_CLIENT_GUIDE',
    'AFTERCARE_GUIDE',
    'CONSULTATION_GUIDE',
  ] as const) {
    if (input.request.preferences.includePageTypes.includes(guide)) baseline(guide, true);
  }
  for (const requestedPageType of [...input.request.preferences.includePageTypes].sort()) {
    const existing = candidates.filter(item => item.pageType === requestedPageType);
    if (existing.length) {
      existing.forEach(item => { item.required = true; });
      continue;
    }
    if (['SERVICE_DETAIL', 'LOCATION_DETAIL', 'TEAM_DETAIL'].includes(requestedPageType)) {
      actionItems.push(actionItem(
        requestedPageType === 'SERVICE_DETAIL' ? 'SERVICE_DATA' : requestedPageType === 'LOCATION_DETAIL' ? 'LOCATION_DATA' : 'STAFF_DATA',
        'BLOCKING',
        `${requestedPageType}_REQUESTED_SUBJECT_MISSING`,
        `The explicitly requested ${PAGE_DEFAULTS[requestedPageType].title} page needs an eligible verified subject before it can be planned.`,
      ));
      continue;
    }
    const ready = requestedPageType === 'ABOUT' ? input.business.profileComplete
      : requestedPageType === 'CONTACT' ? input.business.contactComplete
        : requestedPageType === 'SERVICE_HUB' ? input.services.some(service => service.active && service.bookingEligible && service.tenantReference === input.tenantReference)
          : requestedPageType === 'LOCATION_HUB' ? validLocations.length > 0
            : requestedPageType === 'TEAM_HUB' ? eligibleStaff.length > 0
              : requestedPageType === 'RESULTS' ? input.business.approvedResultsAssetCount > 0
                : true;
    baseline(
      requestedPageType,
      ready,
      `The explicitly requested ${PAGE_DEFAULTS[requestedPageType].title} page is missing the verified content required to generate it.`,
    );
  }
  for (const explicitPage of [...input.request.preferences.explicitPages]
    .sort((left, right) => left.title.localeCompare(right.title))) {
    const layout = layoutFor(input, explicitPage.pageType);
    candidates.push(candidate({
      pageType: explicitPage.pageType,
      title: explicitPage.title,
      subjectName: explicitPage.title,
      explicitPath: true,
      required: true,
      scoreInput: {
        pageType: explicitPage.pageType,
        requiredBaseline: true,
        fillsNavigationRole: true,
        compatibleLayout: Boolean(layout),
      },
    }));
    if (!layout) {
      actionItems.push(actionItem(
        'LAYOUT',
        'BLOCKING',
        'EXPLICIT_PAGE_LAYOUT_MISSING',
        `The explicitly requested page “${explicitPage.title}” has no approved compatible ${explicitPage.pageType} layout.`,
        null,
        { title: explicitPage.title, pageType: explicitPage.pageType },
      ));
    }
  }
  return candidates;
}

function navigationOrder(pageType: SitePageType, pageIndex: number) {
  const order = [
    'HOME',
    'SERVICE_HUB',
    'ABOUT',
    'TEAM_HUB',
    'LOCATION_HUB',
    'RESULTS',
    'CONTACT',
    'BOOKING',
  ].indexOf(pageType);
  return order >= 0 ? order : 100 + pageIndex;
}

function pageFromCandidate(
  input: BlueprintEngineInput,
  item: Candidate,
  usedPaths: Set<string>,
  index: number,
): BlueprintPageInput {
  const defaults = PAGE_DEFAULTS[item.pageType];
  const layout = layoutFor(input, item.pageType);
  const plannedSlug = allocateUniqueBlueprintPath(
    item.explicitPath
      ? `/${slugifySegment(item.title)}`
      : defaultBlueprintPath(item.pageType, item.subjectName),
    usedPaths,
  );
  const bookingRequirements = bookingRequirementsForPage({
    pageType: item.pageType,
    serviceReference: item.serviceReference,
    locationReference: item.locationReference,
    staffReference: item.staffReference,
  });
  const common = {
    pageType: item.pageType,
    conversionRole: defaults.conversionRole,
    titleLabel: item.title,
    plannedSlug,
    navigationGroup: defaults.navigationGroup,
    navigationOrder: navigationOrder(item.pageType, index),
    layoutReference: layout?.reference || null,
    entitlementKind: defaults.entitlementKind,
    consumesMarketingEntitlement: defaults.entitlementKind === 'MARKETING',
    generationPriority: defaults.priority,
    selectionScore: item.score,
    selectionReasons: item.reasons,
    layoutSelectionReason: layout
      ? input.request.preferences.preferredLayoutReferences[item.pageType] === layout.reference
        ? 'AGENCY_PREFERRED_APPROVED_COMPATIBLE_LAYOUT'
        : 'DETERMINISTIC_FIRST_APPROVED_COMPATIBLE_LAYOUT'
      : null,
    bookingRequirements,
  };
  if (item.pageType === 'SERVICE_DETAIL') {
    return { ...common, pageType: item.pageType, serviceReference: item.serviceReference! };
  }
  if (item.pageType === 'LOCATION_DETAIL') {
    return { ...common, pageType: item.pageType, locationReference: item.locationReference! };
  }
  if (item.pageType === 'TEAM_DETAIL') {
    return { ...common, pageType: item.pageType, staffReference: item.staffReference! };
  }
  return common as BlueprintPageInput;
}

function readinessForCandidates(
  input: BlueprintEngineInput,
  candidates: readonly Candidate[],
) {
  return candidates.map((item) => {
    const subjectReference =
      item.serviceReference || item.locationReference || item.staffReference || null;
    const layout = layoutFor(input, item.pageType);
    return {
      pageType: item.pageType,
      subjectReference,
      ready: item.score >= 0 && Boolean(layout),
      requiredChecks: [
        { code: 'SOURCE_DATA_READY', passed: item.score >= 0 },
        { code: 'APPROVED_COMPATIBLE_LAYOUT', passed: Boolean(layout) },
      ],
      recommendedMissing: item.reasons.includes('THIN_CONTENT_RISK')
        ? ['MEANINGFUL_CONTENT_DATA']
        : [],
    };
  });
}

export class BlueprintTemplateVersionError extends Error {
  readonly code = 'TEMPLATE_VERSION_NOT_APPROVED';
  constructor() {
    super('Blueprint generation requires an approved template version.');
    this.name = 'BlueprintTemplateVersionError';
  }
}

export function generateBlueprintPlan(input: BlueprintEngineInput): BlueprintPlan {
  if (input.template.status !== 'APPROVED') {
    throw new BlueprintTemplateVersionError();
  }
  const actionItems: PlannedBlueprintActionItem[] = [];
  const candidates = buildCandidates(input, actionItems);
  // Canonical paths are unique within a blueprint revision. Existing rendered
  // versions may legitimately use the same paths because a future revision
  // replaces, rather than coexists with, that route architecture.
  const usedPaths = new Set<string>();
  const nonMarketing = candidates.filter(
    (item) => PAGE_DEFAULTS[item.pageType].entitlementKind !== 'MARKETING',
  );
  const marketing = candidates
    .filter((item) => PAGE_DEFAULTS[item.pageType].entitlementKind === 'MARKETING')
    .sort((left, right) =>
      Number(right.required) - Number(left.required)
      || right.score - left.score
      || PAGE_DEFAULTS[left.pageType].priority - PAGE_DEFAULTS[right.pageType].priority
      || (left.serviceReference || left.locationReference || left.staffReference || '')
        .localeCompare(
          right.serviceReference || right.locationReference || right.staffReference || '',
        ));
  const requiredMarketing = marketing.filter(item => item.required);
  const optionalMarketing = marketing.filter(item => !item.required && item.score >= 0);
  const selected = [
    ...requiredMarketing,
    ...optionalMarketing.slice(0, Math.max(0, input.marketingPageLimit - requiredMarketing.length)),
    ...nonMarketing,
  ].sort((left, right) =>
    PAGE_DEFAULTS[left.pageType].priority - PAGE_DEFAULTS[right.pageType].priority
    || right.score - left.score);
  const pages = selected.map((item, index) =>
    pageFromCandidate(input, item, usedPaths, index));
  const validation = validateBlueprint({
    pages,
    context: {
      tenantReference: input.tenantReference,
      planKey: input.planKey,
      marketingPageLimit: input.marketingPageLimit,
      entitlementOverrideApplied: input.entitlementOverrideApplied,
      template: input.template,
      services: input.services,
      locations: input.locations,
      staff: input.staff,
    },
  });
  for (const validationFinding of validation.findings) {
    if (actionItems.some((item) => item.code === validationFinding.code)) continue;
    actionItems.push(actionItem(
      validationFinding.code === 'TEMPLATE_LICENCE_REQUIRED' ? 'LICENCE' : 'LAYOUT',
      validationFinding.severity,
      validationFinding.code,
      validationFinding.message,
      validationFinding.subjectReference,
    ));
  }
  if (validation.entitlementUsage.unusedMarketingPageAllowance > 0) {
    actionItems.push(actionItem(
      'ENTITLEMENT',
      'INFO',
      'UNUSED_MARKETING_PAGE_ALLOWANCE',
      'Verified business data does not currently justify using the full allowance.',
      null,
      { unused: validation.entitlementUsage.unusedMarketingPageAllowance },
    ));
  }
  return {
    sourceDataDigest: calculateBlueprintSourceDigest(input),
    engineVersion: BLUEPRINT_ENGINE_VERSION,
    pages,
    entitlementUsage: validation.entitlementUsage,
    readiness: readinessForCandidates(input, candidates),
    actionItems,
    validation,
  };
}
