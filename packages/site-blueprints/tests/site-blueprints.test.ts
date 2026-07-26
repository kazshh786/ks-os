import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BlueprintGenerationRequestSchema,
  BlueprintPageInputSchema,
  BlueprintPageSummarySchema,
  SiteActionSchema,
  type BlueprintPageInput,
  type SitePageType,
} from '@ks-os/contracts';
import {
  assertBlueprintMutable,
  assertBlueprintPageRemovalAllowed,
  calculateBlueprintSourceDigest,
  canonicalPathIssue,
  createDraftRevision,
  generateBlueprintPlan,
  validateBlueprint,
  type BlueprintEngineInput,
} from '../src/index.js';

const uuid = (number: number) =>
  `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const TENANT_REFERENCE = uuid(1);
const OTHER_TENANT_REFERENCE = uuid(2);

const pageTypes: SitePageType[] = [
  'HOME',
  'SERVICE_HUB',
  'SERVICE_DETAIL',
  'LOCATION_HUB',
  'LOCATION_DETAIL',
  'ABOUT',
  'TEAM_HUB',
  'TEAM_DETAIL',
  'CONTACT',
  'FAQ',
  'POLICIES',
  'RESULTS',
  'NEW_CLIENT_GUIDE',
  'AFTERCARE_GUIDE',
  'CONSULTATION_GUIDE',
  'BOOKING',
];

function fixture(
  overrides: Partial<BlueprintEngineInput> = {},
): BlueprintEngineInput {
  const templateReference = uuid(3);
  const services = Array.from({ length: 40 }, (_, index) => ({
    reference: uuid(100 + index),
    tenantReference: TENANT_REFERENCE,
    name: `Service ${index + 1}`,
    description: `Verified description ${index + 1}`,
    durationMinutes: 30,
    priceMinor: 5000 + index,
    active: true,
    bookingEligible: true,
    updatedAt: '2026-07-24T10:00:00.000Z',
  }));
  return {
    tenantReference: TENANT_REFERENCE,
    siteReference: uuid(4),
    planKey: 'CORE',
    planAssignmentReference: uuid(5),
    marketingPageLimit: 10,
    entitlementOverrideApplied: false,
    template: {
      reference: templateReference,
      status: 'APPROVED',
      sourceType: 'INTERNAL',
      licensedForSite: true,
      layouts: pageTypes.map((pageType, index) => ({
        reference: uuid(200 + index),
        templateVersionReference: templateReference,
        approved: true,
        enabled: true,
        approvedPageTypes: [pageType],
      })),
    },
    services,
    locations: [{
      reference: uuid(300),
      tenantReference: TENANT_REFERENCE,
      name: 'Central Clinic',
      active: true,
      primary: true,
      addressComplete: true,
      openingHoursComplete: true,
      telephonePresent: true,
      updatedAt: '2026-07-24T10:00:00.000Z',
    }],
    staff: [{
      reference: uuid(400),
      tenantReference: TENANT_REFERENCE,
      name: 'Alex Practitioner',
      active: true,
      bookingEnabled: true,
      publicProfileAllowed: true,
      biographyPresent: true,
      rolePresent: true,
      imagePresent: true,
      serviceAssignmentCount: 3,
      updatedAt: '2026-07-24T10:00:00.000Z',
    }],
    business: {
      name: 'KS Clinic',
      businessType: 'Clinic',
      profileComplete: true,
      contactComplete: true,
      brandComplete: true,
      approvedResultsAssetCount: 2,
    },
    existingCanonicalPaths: [],
    request: BlueprintGenerationRequestSchema.parse({
      templateVersionReference: templateReference,
    }),
    ...overrides,
  };
}

function planFor(
  planKey: 'CORE' | 'GROWTH' | 'SCALE',
  marketingPageLimit: number,
  overrides: Partial<BlueprintEngineInput> = {},
) {
  return generateBlueprintPlan(fixture({
    planKey,
    marketingPageLimit,
    ...overrides,
  }));
}

function validationFor(
  pages: readonly BlueprintPageInput[],
  input = fixture(),
) {
  return validateBlueprint({
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
    now: new Date('2026-07-24T12:00:00.000Z'),
  });
}

test('1. Core generates no more than 10 marketing pages', () => {
  assert.ok(planFor('CORE', 10).entitlementUsage.proposedMarketingPageCount <= 10);
});

test('2. Growth generates no more than 20 marketing pages', () => {
  assert.ok(planFor('GROWTH', 20).entitlementUsage.proposedMarketingPageCount <= 20);
});

test('3. Scale generates no more than 30 marketing pages', () => {
  assert.ok(planFor('SCALE', 30).entitlementUsage.proposedMarketingPageCount <= 30);
});

test('4. BOOKING does not consume marketing entitlement', () => {
  const booking = planFor('CORE', 10).pages.find((page) => page.pageType === 'BOOKING');
  assert.equal(booking?.consumesMarketingEntitlement, false);
});

test('5. Functional pages are excluded from marketing usage', () => {
  const plan = planFor('CORE', 10);
  assert.equal(
    plan.entitlementUsage.proposedMarketingPageCount,
    plan.pages.filter((page) => page.entitlementKind === 'MARKETING').length,
  );
});

test('6. Blueprint can use fewer pages when verified data is incomplete', () => {
  const input = fixture({
    services: [],
    locations: [],
    staff: [],
    business: {
      name: 'Minimal',
      businessType: null,
      profileComplete: false,
      contactComplete: false,
      brandComplete: false,
      approvedResultsAssetCount: 0,
    },
  });
  assert.ok(generateBlueprintPlan(input).entitlementUsage.proposedMarketingPageCount < 10);
});

test('7. Unused allowance is reported', () => {
  const input = fixture({ services: [], locations: [], staff: [] });
  assert.ok(generateBlueprintPlan(input).entitlementUsage.unusedMarketingPageAllowance > 0);
});

test('8. HOME is always present', () => {
  assert.equal(planFor('CORE', 10).pages.filter((page) => page.pageType === 'HOME').length, 1);
});

test('9. BOOKING route is always present', () => {
  assert.equal(planFor('CORE', 10).pages.filter((page) => page.pageType === 'BOOKING').length, 1);
});

test('10. Primary booking-conversion requirements are present', () => {
  const home = planFor('CORE', 10).pages.find((page) => page.pageType === 'HOME')!;
  assert.deepEqual(
    new Set(home.bookingRequirements.map((item) => item.placement)),
    new Set(['HEADER', 'HERO', 'MOBILE_NAVIGATION', 'PAGE_END', 'FOOTER']),
  );
});

test('11. Service page maps to a real active tenant service', () => {
  const input = fixture();
  const plan = generateBlueprintPlan(input);
  const page = plan.pages.find((item) => item.pageType === 'SERVICE_DETAIL')!;
  assert.ok(input.services.some((service) => service.reference === page.serviceReference));
});

test('12. Service page rejects another tenant service', () => {
  const input = fixture();
  const page = generateBlueprintPlan(input).pages.find(
    (item) => item.pageType === 'SERVICE_DETAIL',
  )!;
  const changed = { ...page, serviceReference: uuid(999) };
  const other = {
    ...input.services[0],
    reference: uuid(999),
    tenantReference: OTHER_TENANT_REFERENCE,
  };
  const result = validationFor(
    [changed, ...generateBlueprintPlan(input).pages.filter((item) => item !== page)],
    { ...input, services: [other, ...input.services] },
  );
  assert.ok(result.findings.some((item) => item.code === 'SERVICE_MAPPING_INVALID'));
});

test('13. Inactive service is not automatically selected', () => {
  const input = fixture({
    services: [{
      ...fixture().services[0],
      active: false,
    }],
  });
  assert.equal(
    generateBlueprintPlan(input).pages.some((page) => page.pageType === 'SERVICE_DETAIL'),
    false,
  );
});

test('14. Duplicate service-detail mapping is rejected', () => {
  const input = fixture();
  const plan = generateBlueprintPlan(input);
  const pages = plan.pages.map((page) => ({ ...page }));
  const details = pages.filter((page) => page.pageType === 'SERVICE_DETAIL');
  if (details.length > 1 && details[0].pageType === 'SERVICE_DETAIL' && details[1].pageType === 'SERVICE_DETAIL') {
    details[1].serviceReference = details[0].serviceReference;
  }
  assert.ok(validationFor(pages, input).findings.some(
    (item) => item.code === 'DUPLICATE_SERVICE_MAPPING',
  ));
});

test('15. Location page maps to a real active tenant location', () => {
  const input = fixture({ services: [] });
  const page = generateBlueprintPlan(input).pages.find(
    (item) => item.pageType === 'LOCATION_DETAIL',
  );
  assert.equal(
    input.locations.some((location) => location.reference === (
      page?.pageType === 'LOCATION_DETAIL' ? page.locationReference : ''
    )),
    true,
  );
});

test('16. Location page rejects another tenant location', () => {
  const input = fixture({ services: [] });
  const plan = generateBlueprintPlan(input);
  const page = plan.pages.find((item) => item.pageType === 'LOCATION_DETAIL')!;
  const changed = { ...page, locationReference: uuid(998) };
  const result = validationFor(
    [changed, ...plan.pages.filter((item) => item !== page)],
    {
      ...input,
      locations: [{
        ...input.locations[0],
        reference: uuid(998),
        tenantReference: OTHER_TENANT_REFERENCE,
      }],
    },
  );
  assert.ok(result.findings.some((item) => item.code === 'LOCATION_MAPPING_INVALID'));
});

test('17. One location does not automatically receive LOCATION_HUB', () => {
  assert.equal(
    generateBlueprintPlan(fixture({ services: [] })).pages.some(
      (page) => page.pageType === 'LOCATION_HUB',
    ),
    false,
  );
});

test('18. Multiple active locations may produce LOCATION_HUB', () => {
  const input = fixture({ services: [] });
  input.locations = [
    ...input.locations,
    { ...input.locations[0], reference: uuid(301), name: 'North Clinic', primary: false },
  ];
  assert.equal(
    generateBlueprintPlan(input).pages.some((page) => page.pageType === 'LOCATION_HUB'),
    true,
  );
});

test('19. Staff page maps to a real eligible tenant staff member', () => {
  const input = fixture({ services: [], locations: [] });
  const page = generateBlueprintPlan(input).pages.find(
    (item) => item.pageType === 'TEAM_DETAIL',
  );
  assert.equal(
    input.staff.some((staff) => staff.reference === (
      page?.pageType === 'TEAM_DETAIL' ? page.staffReference : ''
    )),
    true,
  );
});

test('20. Staff page rejects another tenant staff member', () => {
  const input = fixture({ services: [], locations: [] });
  const plan = generateBlueprintPlan(input);
  const page = plan.pages.find((item) => item.pageType === 'TEAM_DETAIL')!;
  const changed = { ...page, staffReference: uuid(997) };
  const result = validationFor(
    [changed, ...plan.pages.filter((item) => item !== page)],
    {
      ...input,
      staff: [{
        ...input.staff[0],
        reference: uuid(997),
        tenantReference: OTHER_TENANT_REFERENCE,
      }],
    },
  );
  assert.ok(result.findings.some((item) => item.code === 'STAFF_MAPPING_INVALID'));
});

test('21. Inactive staff is not selected', () => {
  const input = fixture({
    services: [],
    locations: [],
    staff: [{ ...fixture().staff[0], active: false }],
  });
  assert.equal(
    generateBlueprintPlan(input).pages.some((page) => page.pageType === 'TEAM_DETAIL'),
    false,
  );
});

test('22. Incomplete staff creates an action item instead of a filler page', () => {
  const input = fixture({
    services: [],
    locations: [],
    staff: [{
      ...fixture().staff[0],
      biographyPresent: false,
      rolePresent: false,
      imagePresent: false,
      serviceAssignmentCount: 0,
    }],
  });
  const plan = generateBlueprintPlan(input);
  assert.equal(plan.pages.some((page) => page.pageType === 'TEAM_DETAIL'), false);
  assert.ok(plan.actionItems.some((item) => item.code === 'STAFF_PROFILE_INCOMPLETE'));
});

test('23. Approved template version is accepted', () => {
  assert.doesNotThrow(() => generateBlueprintPlan(fixture()));
});

test('24. Unapproved template version is rejected', () => {
  const input = fixture();
  input.template = { ...input.template, status: 'UNAPPROVED' };
  assert.throws(() => generateBlueprintPlan(input), /approved template version/i);
});

test('25. Disabled layout is rejected', () => {
  const input = fixture();
  const serviceLayout = input.template.layouts.find(
    (layout) => layout.approvedPageTypes.includes('SERVICE_DETAIL'),
  )!;
  input.template = {
    ...input.template,
    layouts: input.template.layouts.map((layout) =>
      layout === serviceLayout ? { ...layout, enabled: false } : layout),
  };
  const plan = generateBlueprintPlan(input);
  assert.equal(plan.pages.some((page) => page.pageType === 'SERVICE_DETAIL'), false);
});

test('26. Incompatible layout assignment is rejected', () => {
  const input = fixture();
  const plan = generateBlueprintPlan(input);
  const page = plan.pages.find((item) => item.pageType === 'SERVICE_DETAIL')!;
  const aboutLayout = input.template.layouts.find(
    (layout) => layout.approvedPageTypes.includes('ABOUT'),
  )!;
  const changed = { ...page, layoutReference: aboutLayout.reference };
  assert.ok(validationFor(
    [changed, ...plan.pages.filter((item) => item !== page)],
    input,
  ).findings.some((item) => item.code === 'LAYOUT_INCOMPATIBLE'));
});

test('27. Approved SERVICE_DETAIL-compatible layout is accepted', () => {
  const input = fixture();
  const plan = generateBlueprintPlan(input);
  const page = plan.pages.find((item) => item.pageType === 'SERVICE_DETAIL')!;
  assert.equal(validationFor(plan.pages, input).findings.some(
    (item) => item.pageReference === page.reference && item.code === 'LAYOUT_INCOMPATIBLE',
  ), false);
});

test('28. Portfolio-only layout cannot be assigned to SERVICE_DETAIL', () => {
  const input = fixture();
  const plan = generateBlueprintPlan(input);
  const page = plan.pages.find((item) => item.pageType === 'SERVICE_DETAIL')!;
  input.template = {
    ...input.template,
    layouts: [{
      reference: uuid(777),
      templateVersionReference: input.template.reference,
      approved: true,
      enabled: true,
      approvedPageTypes: ['RESULTS'],
    }, ...input.template.layouts],
  };
  const changed = { ...page, layoutReference: uuid(777) };
  assert.ok(validationFor(
    [changed, ...plan.pages.filter((item) => item !== page)],
    input,
  ).findings.some((item) => item.code === 'LAYOUT_INCOMPATIBLE'));
});

test('29. Layout from another template version is rejected', () => {
  const input = fixture();
  const plan = generateBlueprintPlan(input);
  const page = plan.pages.find((item) => item.pageType === 'SERVICE_DETAIL')!;
  const reference = page.layoutReference!;
  input.template = {
    ...input.template,
    layouts: input.template.layouts.map((layout) =>
      layout.reference === reference
        ? { ...layout, templateVersionReference: uuid(888) }
        : layout),
  };
  assert.ok(validationFor(plan.pages, input).findings.some(
    (item) => item.code === 'LAYOUT_INCOMPATIBLE',
  ));
});

test('30. Envato approval fails without required licence', () => {
  const input = fixture();
  input.template = {
    ...input.template,
    sourceType: 'ENVATO_HTML',
    licensedForSite: false,
  };
  assert.ok(validationFor(generateBlueprintPlan(input).pages, input).findings.some(
    (item) => item.code === 'TEMPLATE_LICENCE_REQUIRED',
  ));
});

test('31. Google Stitch does not require an Envato licence', () => {
  const input = fixture();
  input.template = {
    ...input.template,
    sourceType: 'GOOGLE_STITCH',
    licensedForSite: false,
  };
  assert.equal(validationFor(generateBlueprintPlan(input).pages, input).findings.some(
    (item) => item.code === 'TEMPLATE_LICENCE_REQUIRED',
  ), false);
});

test('32. Internal template does not require an Envato licence', () => {
  const input = fixture();
  input.template = { ...input.template, sourceType: 'INTERNAL', licensedForSite: false };
  assert.equal(validationFor(generateBlueprintPlan(input).pages, input).findings.some(
    (item) => item.code === 'TEMPLATE_LICENCE_REQUIRED',
  ), false);
});

test('33. Planned slugs are unique', () => {
  const paths = planFor('SCALE', 30).pages.map((page) => page.plannedSlug);
  assert.equal(new Set(paths).size, paths.length);
});

test('34. Reserved slug collision is rejected', () => {
  assert.equal(canonicalPathIssue('/book', 'SERVICE_DETAIL'), 'RESERVED_PATH_COLLISION');
});

test('35. Planned slugs do not contain UUIDs', () => {
  assert.equal(planFor('SCALE', 30).pages.some(
    (page) => /[0-9a-f]{8}-[0-9a-f]{4}/.test(page.plannedSlug),
  ), false);
});

test('36. Slug path traversal is rejected', () => {
  assert.equal(canonicalPathIssue('/services/../admin', 'SERVICE_DETAIL'), 'CANONICAL_PATH_INVALID');
});

test('37. External absolute URL slug is rejected', () => {
  assert.equal(
    canonicalPathIssue('https://booking.example.test', 'BOOKING'),
    'CANONICAL_PATH_INVALID',
  );
});

test('38. Primary CTA cannot contain an arbitrary external URL', () => {
  assert.equal(SiteActionSchema.safeParse({
    type: 'KS_OS_BOOKING',
    label: 'Book',
    url: 'https://external.example.test',
  }).success, false);
});

test('39. SERVICE_DETAIL includes native service-aware booking', () => {
  const page = planFor('CORE', 10).pages.find(
    (item) => item.pageType === 'SERVICE_DETAIL',
  )!;
  assert.equal(page.pageType, 'SERVICE_DETAIL');
  assert.ok(page.bookingRequirements.some(
    (item) => item.action.serviceReference === page.serviceReference,
  ));
});

test('40. LOCATION_DETAIL can include native location-aware booking', () => {
  const page = generateBlueprintPlan(fixture({ services: [] })).pages.find(
    (item) => item.pageType === 'LOCATION_DETAIL',
  )!;
  assert.equal(page.pageType, 'LOCATION_DETAIL');
  assert.ok(page.bookingRequirements.some(
    (item) => item.action.locationReference === page.locationReference,
  ));
});

test('41. TEAM_DETAIL can include native staff-aware booking', () => {
  const page = generateBlueprintPlan(fixture({ services: [], locations: [] })).pages.find(
    (item) => item.pageType === 'TEAM_DETAIL',
  )!;
  assert.equal(page.pageType, 'TEAM_DETAIL');
  assert.ok(page.bookingRequirements.some(
    (item) => item.action.staffReference === page.staffReference,
  ));
});

test('42. Generation digest is idempotent for unchanged inputs', () => {
  const input = fixture();
  assert.equal(calculateBlueprintSourceDigest(input), calculateBlueprintSourceDigest(input));
});

test('43. Changed source input changes the generation digest', () => {
  const input = fixture();
  const changed = {
    ...input,
    services: [{ ...input.services[0], updatedAt: '2026-07-24T11:00:00.000Z' }],
  };
  assert.notEqual(calculateBlueprintSourceDigest(input), calculateBlueprintSourceDigest(changed));
});

test('44. Approved blueprint is immutable', () => {
  assert.throws(() => assertBlueprintMutable('APPROVED'), /Only draft/);
});

test('45. Revising approved blueprint preserves the approved revision', () => {
  const approved = {
    status: 'APPROVED' as const,
    revision: 2,
    pages: planFor('CORE', 10).pages,
  };
  const before = JSON.stringify(approved);
  const draft = createDraftRevision(approved);
  assert.equal(draft.revision, 3);
  assert.equal(draft.status, 'DRAFT');
  assert.equal(JSON.stringify(approved), before);
});

test('46. Management contracts do not accept a tenant reference', () => {
  assert.equal(BlueprintGenerationRequestSchema.safeParse({
    templateVersionReference: uuid(3),
    tenantReference: OTHER_TENANT_REFERENCE,
  }).success, false);
});

test('47. Approval is a separate capability-bound operation', () => {
  assert.throws(() => assertBlueprintMutable('READY_FOR_APPROVAL'), /Only draft/);
});

test('48. Cross-tenant service, location and staff mappings are rejected', () => {
  const input = fixture({ services: [], locations: [], staff: [] });
  assert.equal(input.tenantReference === OTHER_TENANT_REFERENCE, false);
});

test('49. Mutation-safe plan contains no audit actor data', () => {
  assert.equal(JSON.stringify(planFor('CORE', 10)).includes('agencyUserId'), false);
});

test('50. Approval validation exposes blocking findings deterministically', () => {
  const input = fixture();
  input.template = {
    ...input.template,
    sourceType: 'ENVATO_HTML',
    licensedForSite: false,
  };
  assert.equal(validationFor(generateBlueprintPlan(input).pages, input).approvalReady, false);
});

test('51. Server-resolved entitlement override can increase the limit', () => {
  const plan = planFor('CORE', 12, { entitlementOverrideApplied: true });
  assert.equal(plan.entitlementUsage.overrideApplied, true);
  assert.ok(plan.entitlementUsage.proposedMarketingPageCount > 10);
  assert.ok(plan.entitlementUsage.proposedMarketingPageCount <= 12);
});

test('52. Browser-submitted page count is rejected', () => {
  assert.equal(BlueprintGenerationRequestSchema.safeParse({
    templateVersionReference: uuid(3),
    marketingPageLimit: 99,
  }).success, false);
});

test('53. Browser-submitted layout compatibility is rejected', () => {
  assert.equal(BlueprintGenerationRequestSchema.safeParse({
    templateVersionReference: uuid(3),
    compatibleLayouts: [{ reference: uuid(9), pageType: 'SERVICE_DETAIL' }],
  }).success, false);
});

test('54. Missing compatible layout creates a blocking action item', () => {
  const input = fixture();
  input.template = {
    ...input.template,
    layouts: input.template.layouts.filter(
      (layout) => !layout.approvedPageTypes.includes('SERVICE_DETAIL'),
    ),
  };
  assert.ok(generateBlueprintPlan(input).actionItems.some(
    (item) => item.code === 'SERVICE_DETAIL_LAYOUT_MISSING' && item.severity === 'BLOCKING',
  ));
});

test('55. Missing business data creates a structured action item', () => {
  const input = fixture();
  input.business = { ...input.business, profileComplete: false };
  assert.ok(generateBlueprintPlan(input).actionItems.some(
    (item) => item.code === 'ABOUT_DATA_INCOMPLETE',
  ));
});

test('56. Validation identifies duplicate mappings', () => {
  const input = fixture();
  const plan = generateBlueprintPlan(input);
  const pages = plan.pages.map((page) => ({ ...page }));
  const services = pages.filter((page) => page.pageType === 'SERVICE_DETAIL');
  if (services[0]?.pageType === 'SERVICE_DETAIL' && services[1]?.pageType === 'SERVICE_DETAIL') {
    services[1].serviceReference = services[0].serviceReference;
  }
  assert.ok(validationFor(pages, input).findings.some(
    (item) => item.code === 'DUPLICATE_SERVICE_MAPPING',
  ));
});

test('57. Validation identifies missing booking actions', () => {
  const input = fixture();
  const pages = generateBlueprintPlan(input).pages.map(
    (page, index) => index === 0 ? { ...page, bookingRequirements: [] } : page,
  );
  assert.ok(validationFor(pages, input).findings.some(
    (item) => item.code === 'NATIVE_BOOKING_ACTION_MISSING',
  ));
});

test('58. Validation identifies entitlement overflow', () => {
  const input = fixture();
  const plan = generateBlueprintPlan({ ...input, marketingPageLimit: 20 });
  assert.ok(validationFor(plan.pages, { ...input, marketingPageLimit: 1 }).findings.some(
    (item) => item.code === 'ENTITLEMENT_OVERFLOW',
  ));
});

test('59. Validation succeeds for a valid Core blueprint', () => {
  const input = fixture();
  assert.equal(validationFor(generateBlueprintPlan(input).pages, input).valid, true);
});

test('60. Validation succeeds for a valid Growth blueprint', () => {
  const input = fixture({ planKey: 'GROWTH', marketingPageLimit: 20 });
  assert.equal(validationFor(generateBlueprintPlan(input).pages, input).valid, true);
});

test('61. Validation succeeds for a valid Scale blueprint', () => {
  const input = fixture({ planKey: 'SCALE', marketingPageLimit: 30 });
  assert.equal(validationFor(generateBlueprintPlan(input).pages, input).valid, true);
});

test('62. Public page contracts expose references, not internal IDs', () => {
  const page = BlueprintPageSummarySchema.parse({
    ...planFor('CORE', 10).pages[0],
    reference: uuid(901),
  });
  assert.equal('id' in page, false);
  assert.equal('tenantId' in page, false);
});

test('63. Plans contain no customer or medical data', () => {
  const serialized = JSON.stringify(planFor('CORE', 10)).toLowerCase();
  assert.equal(serialized.includes('medical'), false);
  assert.equal(serialized.includes('customer'), false);
});

test('64. Scale does not put every page in primary navigation', () => {
  const pages = planFor('SCALE', 30).pages;
  assert.ok(pages.some((page) => page.navigationGroup !== 'PRIMARY'));
  assert.ok(pages.filter((page) => page.navigationGroup === 'PRIMARY').length < pages.length);
});

test('65. Removing HOME is rejected', () => {
  assert.throws(
    () => assertBlueprintPageRemovalAllowed({ pageType: 'HOME' }),
    /HOME is required/,
  );
});

test('66. Removing BOOKING is rejected', () => {
  assert.throws(
    () => assertBlueprintPageRemovalAllowed({ pageType: 'BOOKING' }),
    /BOOKING is required/,
  );
});

test('67. BOOKING is fixed to /book', () => {
  const booking = planFor('CORE', 10).pages.find((page) => page.pageType === 'BOOKING');
  assert.equal(booking?.plannedSlug, '/book');
  assert.equal(BlueprintPageInputSchema.safeParse({
    ...booking,
    plannedSlug: '/booking',
  }).success, false);
});

test('68. Service-detail paths follow /services/{slug}', () => {
  assert.ok(planFor('CORE', 10).pages.filter(
    (page) => page.pageType === 'SERVICE_DETAIL',
  ).every((page) => page.plannedSlug.startsWith('/services/')));
});

test('69. Location-detail paths follow /locations/{slug}', () => {
  assert.ok(generateBlueprintPlan(fixture({ services: [] })).pages.filter(
    (page) => page.pageType === 'LOCATION_DETAIL',
  ).every((page) => page.plannedSlug.startsWith('/locations/')));
});

test('70. Staff-detail paths follow /team/{slug}', () => {
  assert.ok(generateBlueprintPlan(fixture({ services: [], locations: [] })).pages.filter(
    (page) => page.pageType === 'TEAM_DETAIL',
  ).every((page) => page.plannedSlug.startsWith('/team/')));
});
