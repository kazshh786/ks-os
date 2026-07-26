import type {
  BlueprintEntitlementUsage,
  BlueprintPageInput,
  BlueprintValidationFinding,
  BlueprintValidationResult,
  SitePageType,
} from '@ks-os/contracts';
import { canonicalPathIssue } from './slug.js';
import type {
  BlueprintValidationContext,
  BlueprintLayoutInput,
} from './types.js';
import { pageHasNativeBookingAction } from './booking.js';

function finding(
  code: string,
  message: string,
  severity: 'INFO' | 'WARNING' | 'BLOCKING' = 'BLOCKING',
  pageReference: string | null = null,
  subjectReference: string | null = null,
): BlueprintValidationFinding {
  return { code, severity, message, pageReference, subjectReference };
}

export function calculateBlueprintEntitlementUsage(input: {
  pages: readonly BlueprintPageInput[];
  planKey: BlueprintValidationContext['planKey'];
  marketingPageLimit: number;
  entitlementOverrideApplied: boolean;
}): BlueprintEntitlementUsage {
  const proposedMarketingPageCount = input.pages.filter(
    (page) => page.consumesMarketingEntitlement,
  ).length;
  return {
    planKey: input.planKey,
    marketingPageLimit: input.marketingPageLimit,
    proposedMarketingPageCount,
    functionalPageCount: input.pages.filter(
      (page) => page.entitlementKind === 'FUNCTIONAL',
    ).length,
    requiredLegalPageCount: input.pages.filter(
      (page) => page.entitlementKind === 'REQUIRED_LEGAL',
    ).length,
    unusedMarketingPageAllowance: Math.max(
      0,
      input.marketingPageLimit - proposedMarketingPageCount,
    ),
    overrideApplied: input.entitlementOverrideApplied,
  };
}

function compatible(
  page: BlueprintPageInput,
  layouts: readonly BlueprintLayoutInput[],
  templateReference: string,
) {
  if (!page.layoutReference) return false;
  const layout = layouts.find((item) => item.reference === page.layoutReference);
  return Boolean(
    layout
    && layout.templateVersionReference === templateReference
    && layout.approved
    && layout.enabled
    && layout.approvedPageTypes.includes(page.pageType),
  );
}

function mappingFindings(
  pages: readonly BlueprintPageInput[],
  context: BlueprintValidationContext,
) {
  const findings: BlueprintValidationFinding[] = [];
  const seen = {
    SERVICE_DETAIL: new Set<string>(),
    LOCATION_DETAIL: new Set<string>(),
    TEAM_DETAIL: new Set<string>(),
  };
  for (const page of pages) {
    if (page.pageType === 'SERVICE_DETAIL') {
      const service = context.services.find(
        (item) => item.reference === page.serviceReference,
      );
      if (
        !service
        || service.tenantReference !== context.tenantReference
        || !service.active
        || !service.bookingEligible
      ) {
        findings.push(finding(
          'SERVICE_MAPPING_INVALID',
          'Service detail pages require a real active bookable tenant service.',
          'BLOCKING',
          page.reference || null,
          page.serviceReference,
        ));
      }
      if (seen.SERVICE_DETAIL.has(page.serviceReference)) {
        findings.push(finding(
          'DUPLICATE_SERVICE_MAPPING',
          'A service can be mapped to only one service detail page.',
          'BLOCKING',
          page.reference || null,
          page.serviceReference,
        ));
      }
      seen.SERVICE_DETAIL.add(page.serviceReference);
      if (!page.bookingRequirements.some(
        (item) => item.action.serviceReference === page.serviceReference,
      )) {
        findings.push(finding(
          'SERVICE_BOOKING_ACTION_MISSING',
          'Service detail pages require a native service-aware booking action.',
          'BLOCKING',
          page.reference || null,
          page.serviceReference,
        ));
      }
    }
    if (page.pageType === 'LOCATION_DETAIL') {
      const location = context.locations.find(
        (item) => item.reference === page.locationReference,
      );
      if (
        !location
        || location.tenantReference !== context.tenantReference
        || !location.active
      ) {
        findings.push(finding(
          'LOCATION_MAPPING_INVALID',
          'Location detail pages require a real active tenant location.',
          'BLOCKING',
          page.reference || null,
          page.locationReference,
        ));
      }
      if (seen.LOCATION_DETAIL.has(page.locationReference)) {
        findings.push(finding(
          'DUPLICATE_LOCATION_MAPPING',
          'A location can be mapped to only one location detail page.',
          'BLOCKING',
          page.reference || null,
          page.locationReference,
        ));
      }
      seen.LOCATION_DETAIL.add(page.locationReference);
    }
    if (page.pageType === 'TEAM_DETAIL') {
      const staff = context.staff.find(
        (item) => item.reference === page.staffReference,
      );
      if (
        !staff
        || staff.tenantReference !== context.tenantReference
        || !staff.active
        || !staff.publicProfileAllowed
      ) {
        findings.push(finding(
          'STAFF_MAPPING_INVALID',
          'Team detail pages require a real eligible tenant staff profile.',
          'BLOCKING',
          page.reference || null,
          page.staffReference,
        ));
      }
      if (seen.TEAM_DETAIL.has(page.staffReference)) {
        findings.push(finding(
          'DUPLICATE_STAFF_MAPPING',
          'A staff member can be mapped to only one team detail page.',
          'BLOCKING',
          page.reference || null,
          page.staffReference,
        ));
      }
      seen.TEAM_DETAIL.add(page.staffReference);
    }
  }
  return findings;
}

export function validateBlueprint(input: {
  pages: readonly BlueprintPageInput[];
  context: BlueprintValidationContext;
  now?: Date;
}): BlueprintValidationResult {
  const findings: BlueprintValidationFinding[] = [];
  const usage = calculateBlueprintEntitlementUsage({
    pages: input.pages,
    planKey: input.context.planKey,
    marketingPageLimit: input.context.marketingPageLimit,
    entitlementOverrideApplied: input.context.entitlementOverrideApplied,
  });
  if (usage.proposedMarketingPageCount > usage.marketingPageLimit) {
    findings.push(finding(
      'ENTITLEMENT_OVERFLOW',
      'The blueprint exceeds the server-resolved marketing page allowance.',
    ));
  }
  const count = (pageType: SitePageType) =>
    input.pages.filter((page) => page.pageType === pageType).length;
  if (count('HOME') !== 1) {
    findings.push(finding('HOME_REQUIRED', 'Exactly one HOME page is required.'));
  }
  if (count('BOOKING') !== 1) {
    findings.push(finding(
      'BOOKING_ROUTE_REQUIRED',
      'Exactly one native BOOKING route is required.',
    ));
  }
  if (input.context.template.status !== 'APPROVED') {
    findings.push(finding(
      'TEMPLATE_VERSION_NOT_APPROVED',
      'The blueprint template version must be approved.',
    ));
  }
  if (
    input.context.template.sourceType === 'ENVATO_HTML'
    && !input.context.template.licensedForSite
  ) {
    findings.push(finding(
      'TEMPLATE_LICENCE_REQUIRED',
      'A valid site-specific Envato licence is required for approval.',
    ));
  }
  const slugs = new Set<string>();
  for (const page of input.pages) {
    if (slugs.has(page.plannedSlug)) {
      findings.push(finding(
        'DUPLICATE_SLUG',
        `The canonical path ${page.plannedSlug} is duplicated.`,
        'BLOCKING',
        page.reference || null,
      ));
    }
    slugs.add(page.plannedSlug);
    const pathIssue = canonicalPathIssue(page.plannedSlug, page.pageType);
    if (pathIssue) {
      findings.push(finding(
        pathIssue,
        `The canonical path ${page.plannedSlug} is invalid for ${page.pageType}.`,
        'BLOCKING',
        page.reference || null,
      ));
    }
    if (!compatible(
      page,
      input.context.template.layouts,
      input.context.template.reference,
    )) {
      findings.push(finding(
        'LAYOUT_INCOMPATIBLE',
        `The assigned layout is not active and approved for ${page.pageType}.`,
        'BLOCKING',
        page.reference || null,
      ));
    }
    if (!pageHasNativeBookingAction(page)) {
      findings.push(finding(
        'NATIVE_BOOKING_ACTION_MISSING',
        `${page.pageType} has no native KS OS booking action.`,
        'BLOCKING',
        page.reference || null,
      ));
    }
    if (
      page.pageType === 'BOOKING'
      && (page.consumesMarketingEntitlement || page.entitlementKind !== 'FUNCTIONAL')
    ) {
      findings.push(finding(
        'BOOKING_ENTITLEMENT_INVALID',
        'BOOKING cannot consume the marketing entitlement.',
        'BLOCKING',
        page.reference || null,
      ));
    }
  }
  const home = input.pages.find((page) => page.pageType === 'HOME');
  for (const placement of [
    'HEADER',
    'HERO',
    'MOBILE_NAVIGATION',
    'PAGE_END',
    'FOOTER',
  ] as const) {
    if (!home?.bookingRequirements.some((item) => item.placement === placement)) {
      findings.push(finding(
        `BOOKING_${placement}_REQUIRED`,
        `The blueprint requires a native ${placement} booking action.`,
        'BLOCKING',
        home?.reference || null,
      ));
    }
  }
  findings.push(...mappingFindings(input.pages, input.context));
  const blocking = findings.some((item) => item.severity === 'BLOCKING');
  return {
    valid: !blocking,
    approvalReady: !blocking,
    entitlementUsage: usage,
    findings,
    validatedAt: (input.now || new Date()).toISOString(),
  };
}

export function listBlueprintBlockingFindings(result: BlueprintValidationResult) {
  return result.findings.filter((findingItem) => findingItem.severity === 'BLOCKING');
}

export class BlueprintApprovalValidationError extends Error {
  readonly code = 'BLUEPRINT_APPROVAL_BLOCKED';
  constructor(readonly result: BlueprintValidationResult) {
    super('The blueprint has blocking validation findings.');
    this.name = 'BlueprintApprovalValidationError';
  }
}

export function assertBlueprintValidForApproval(result: BlueprintValidationResult) {
  if (!result.approvalReady) throw new BlueprintApprovalValidationError(result);
}
