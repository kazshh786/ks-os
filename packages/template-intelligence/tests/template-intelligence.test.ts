import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EMPTY_TEMPLATE_DESIGN_SIGNALS,
  EMPTY_TEMPLATE_RESPONSIVE_SIGNALS,
  TemplateManifestSchema,
} from '@ks-os/contracts';
import {
  TemplateCompatibilityService,
  TemplateLicenceGuard,
  analyseTrustedTemplateFiles,
  assertTemplateApprovalReady,
  assertTemplateVersionMutable,
  classifyHtmlLayout,
  extractCssResponsiveSignals,
  extractDesignSignals,
  inspectHtmlPage,
  inventoryTemplateFiles,
  normalizeTemplateRelativePath,
  resolveTemplatePathWithinRoot,
  templateArtifactDigest,
  type ApprovedLayoutCompatibility,
  type TemplateCompatibilityRepository,
  type TemplateLicenceContext,
  type TemplateLicenceRepository,
} from '../src/index.js';

const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');

const VERSION_REFERENCE = '11111111-1111-4111-8111-111111111111';
const LAYOUT_REFERENCE = '22222222-2222-4222-8222-222222222222';

function manifestLayout(
  allowedPageTypes: Array<
    'HOME' | 'SERVICE_DETAIL' | 'RESULTS'
  > = ['HOME', 'SERVICE_DETAIL'],
  recommendedPageType: 'HOME' | 'SERVICE_DETAIL' | 'RESULTS' = 'HOME',
) {
  return {
    layoutReference: LAYOUT_REFERENCE,
    layoutKey: 'home-editorial',
    sourceFile: 'index.html',
    detectedPageType: 'HOME' as const,
    recommendedPageType,
    suggestedAdditionalPageTypes: [],
    allowedPageTypes,
    incompatiblePageTypes: [],
    conversionRole: 'PRIMARY_LANDING' as const,
    classificationConfidence: 0.92,
    classificationEvidence: ['HOME_FILENAME', 'HERO_PRESENT'],
    sections: [],
    bookingCtaPositions: ['HEADER', 'HERO', 'FINAL_SECTION', 'FOOTER'] as const,
    responsiveSignals: EMPTY_TEMPLATE_RESPONSIVE_SIGNALS,
    accessibilityConcerns: [],
    securityConcerns: [],
    requiresAgencyReview: false,
    enabled: true,
  };
}

function validManifest(layouts = [manifestLayout()]) {
  return {
    schemaVersion: 1 as const,
    templateVersionReference: VERSION_REFERENCE,
    sourceType: 'INTERNAL' as const,
    name: 'Original test template',
    industryTags: ['salon'],
    designSignals: EMPTY_TEMPLATE_DESIGN_SIGNALS,
    layouts,
    findings: [],
  };
}

test('7. absolute archive paths are rejected', () => {
  assert.throws(() => normalizeTemplateRelativePath('/tmp/index.html'), /relative/);
  assert.throws(
    () => normalizeTemplateRelativePath('C:\\template\\index.html'),
    /relative/,
  );
});

test('8. parent traversal paths are rejected', () => {
  assert.throws(
    () => normalizeTemplateRelativePath('pages/../../outside.html'),
    /traverse/,
  );
});

test('9. null-byte paths are rejected', () => {
  assert.throws(
    () => normalizeTemplateRelativePath('pages/index.html\0.js'),
    /null bytes/,
  );
});

test('10. symbolic and hard links are rejected', () => {
  assert.throws(
    () => inventoryTemplateFiles([
      { relativePath: 'linked.html', kind: 'SYMLINK', byteSize: 10 },
    ]),
    /Symbolic and hard links/,
  );
  assert.throws(
    () => inventoryTemplateFiles([
      { relativePath: 'linked.html', kind: 'HARDLINK', byteSize: 10 },
    ]),
    /Symbolic and hard links/,
  );
});

test('11. path resolution cannot escape its assigned root', () => {
  assert.throws(
    () => resolveTemplatePathWithinRoot('C:\\safe-template', '..\\outside.txt'),
    /traverse/,
  );
  assert.match(
    resolveTemplatePathWithinRoot('C:\\safe-template', 'pages/index.html'),
    /safe-template[\\/]pages[\\/]index\.html$/,
  );
});

test('12. maximum file count is enforced', () => {
  assert.throws(
    () => inventoryTemplateFiles([
      { relativePath: 'one.html', byteSize: 1 },
      { relativePath: 'two.html', byteSize: 1 },
    ], {
      maxFileCount: 1,
      maxExtractedBytes: 100,
      maxIndividualFileBytes: 100,
    }),
    /exceeds 1 files/,
  );
});

test('13. maximum extracted size is enforced', () => {
  assert.throws(
    () => inventoryTemplateFiles([
      { relativePath: 'one.css', byteSize: 60 },
      { relativePath: 'two.css', byteSize: 60 },
    ], {
      maxFileCount: 10,
      maxExtractedBytes: 100,
      maxIndividualFileBytes: 100,
    }),
    /total extracted-size/,
  );
});

test('14. JavaScript is never executed during analysis', () => {
  const marker = '__template_analysis_must_not_execute__';
  delete (globalThis as Record<string, unknown>)[marker];
  analyseTrustedTemplateFiles([
    {
      relativePath: 'index.html',
      content: '<main><h1>Safe</h1><script src="assets/app.js"></script></main>',
    },
    {
      relativePath: 'assets/app.js',
      content: `globalThis.${marker} = true`,
    },
  ]);
  assert.equal((globalThis as Record<string, unknown>)[marker], undefined);
});

test('15. HTML inspection detects title, H1, navigation and footer', () => {
  const analysis = inspectHtmlPage(fixture('home.html'));
  assert.equal(analysis.title, 'Original Studio Home');
  assert.equal(analysis.headings.some((heading) => heading.level === 1), true);
  assert.equal(analysis.hasNavigation, true);
  assert.equal(analysis.hasFooter, true);
});

test('16. HTML inspection detects a hero section', () => {
  const analysis = inspectHtmlPage(fixture('home.html'));
  assert.equal(
    analysis.sections.some((section) => section.sectionType === 'HERO'),
    true,
  );
});

test('17. HTML inspection detects a booking CTA in the header', () => {
  const analysis = inspectHtmlPage(fixture('home.html'));
  assert.equal(
    analysis.bookingCtas.some((cta) => cta.position === 'HEADER'),
    true,
  );
});

test('18. HTML inspection detects a final booking CTA', () => {
  const analysis = inspectHtmlPage(fixture('home.html'));
  assert.equal(
    analysis.bookingCtas.some((cta) => cta.position === 'FINAL_SECTION'),
    true,
  );
});

test('19. service-detail fixture is classified as SERVICE_DETAIL with evidence', () => {
  const analysis = inspectHtmlPage(fixture('service-detail.html'));
  const classification = classifyHtmlLayout('service-detail.html', analysis);
  assert.equal(classification.detectedPageType, 'SERVICE_DETAIL');
  assert.equal(classification.recommendedPageType, 'SERVICE_DETAIL');
  assert.equal(classification.evidence.includes('SERVICE_DETAIL_TERMINOLOGY'), true);
});

test('20. portfolio fixture is not automatically SERVICE_DETAIL', () => {
  const classification = classifyHtmlLayout(
    'portfolio.html',
    inspectHtmlPage(fixture('portfolio.html')),
  );
  assert.equal(classification.detectedPageType, 'PORTFOLIO');
  assert.notEqual(classification.recommendedPageType, 'SERVICE_DETAIL');
  assert.equal(classification.requiresAgencyReview, true);
});

test('21. product-detail fixture is not automatically SERVICE_DETAIL', () => {
  const classification = classifyHtmlLayout(
    'product-detail.html',
    inspectHtmlPage(fixture('product-detail.html')),
  );
  assert.equal(classification.detectedPageType, 'PRODUCT_DETAIL');
  assert.notEqual(classification.recommendedPageType, 'SERVICE_DETAIL');
});

test('22. contact fixture is classified as CONTACT', () => {
  const classification = classifyHtmlLayout(
    'contact.html',
    inspectHtmlPage(fixture('contact.html')),
  );
  assert.equal(classification.recommendedPageType, 'CONTACT');
});

test('23. team collection fixture is classified as TEAM_HUB', () => {
  const classification = classifyHtmlLayout(
    'team-hub.html',
    inspectHtmlPage(fixture('team-hub.html')),
  );
  assert.equal(classification.recommendedPageType, 'TEAM_HUB');
});

test('24. low-confidence classification requires agency review', () => {
  const classification = classifyHtmlLayout(
    'layout.html',
    inspectHtmlPage(fixture('low-confidence.html')),
  );
  assert.equal(classification.confidenceBand, 'LOW');
  assert.equal(classification.requiresAgencyReview, true);
});

test('classification calculates additional suggestions without approving them', () => {
  const analysis = inspectHtmlPage(`
    <!doctype html>
    <html lang="en"><head><title>Frequently asked questions</title></head>
    <body><main><section class="faq"><h1>FAQ</h1></section></main></body></html>
  `);
  const classification = classifyHtmlLayout('faq.html', analysis);
  assert.equal(classification.recommendedPageType, 'FAQ');
  assert.deepEqual(classification.suggestedAdditionalPageTypes, [
    'NEW_CLIENT_GUIDE',
    'AFTERCARE_GUIDE',
    'CONSULTATION_GUIDE',
  ]);
  assert.equal(
    classification.incompatiblePageTypes.includes('AFTERCARE_GUIDE'),
    false,
  );
});

test('detected sections record whether the recommended page type requires them', () => {
  const analysis = analyseTrustedTemplateFiles([
    {
      relativePath: 'service-detail.html',
      content: fixture('service-detail.html'),
    },
  ]);
  assert.equal(
    analysis.layouts[0]?.analysis.sections.some(
      (section) =>
        section.sectionType === 'SERVICE_DETAILS'
        && section.requiredForRecommendedPageType,
    ),
    true,
  );
  assert.equal(
    analysis.layouts[0]?.analysis.sections.some(
      (section) =>
        section.containsBookingAction
        && section.requiredForRecommendedPageType,
    ),
    true,
  );
});

test('26. disabled layouts are not returned as compatible', async () => {
  const repository: TemplateCompatibilityRepository = {
    async findLayout() {
      return {
        layoutReference: LAYOUT_REFERENCE,
        templateVersionReference: VERSION_REFERENCE,
        templateVersionApproved: true,
        enabled: false,
        approvedPageTypes: ['HOME'],
      };
    },
    async listLayouts() {
      return [await this.findLayout('') as ApprovedLayoutCompatibility];
    },
  };
  const service = new TemplateCompatibilityService(repository);
  assert.deepEqual(
    await service.listCompatibleLayouts({
      templateVersionReference: VERSION_REFERENCE,
      pageType: 'HOME',
    }),
    [],
  );
});

test('27. incompatible layout/page-type assignments are rejected', async () => {
  const service = new TemplateCompatibilityService({
    async findLayout() {
      return {
        layoutReference: LAYOUT_REFERENCE,
        templateVersionReference: VERSION_REFERENCE,
        templateVersionApproved: true,
        enabled: true,
        approvedPageTypes: ['RESULTS'],
      };
    },
    async listLayouts() {
      return [];
    },
  });
  await assert.rejects(
    service.assertLayoutCompatible({
      layoutReference: LAYOUT_REFERENCE,
      pageType: 'SERVICE_DETAIL',
    }),
    /not approved for SERVICE_DETAIL/,
  );
});

test('28. approved compatibility records are returned', async () => {
  const approved: ApprovedLayoutCompatibility = {
    layoutReference: LAYOUT_REFERENCE,
    templateVersionReference: VERSION_REFERENCE,
    templateVersionApproved: true,
    enabled: true,
    approvedPageTypes: ['HOME'],
  };
  const service = new TemplateCompatibilityService({
    async findLayout() {
      return approved;
    },
    async listLayouts() {
      return [approved];
    },
  });
  assert.equal(
    await service.isLayoutCompatible({
      layoutReference: LAYOUT_REFERENCE,
      pageType: 'HOME',
    }),
    true,
  );
  assert.equal(
    (await service.listCompatibleLayouts({
      templateVersionReference: VERSION_REFERENCE,
      pageType: 'HOME',
    })).length,
    1,
  );
});

test('29. approved template versions are immutable', () => {
  assert.throws(
    () => assertTemplateVersionMutable('APPROVED'),
    /create a new version/,
  );
});

test('30. editing an approved version explicitly requires a new version', () => {
  assert.throws(
    () => assertTemplateVersionMutable('APPROVED'),
    (error: unknown) =>
      error instanceof Error
      && 'code' in error
      && error.code === 'TEMPLATE_VERSION_IMMUTABLE',
  );
});

test('31. existing approved versions remain queryable after a new version exists', async () => {
  const oldLayout: ApprovedLayoutCompatibility = {
    layoutReference: LAYOUT_REFERENCE,
    templateVersionReference: VERSION_REFERENCE,
    templateVersionApproved: true,
    enabled: true,
    approvedPageTypes: ['HOME'],
  };
  const repository: TemplateCompatibilityRepository = {
    async findLayout(reference) {
      return reference === LAYOUT_REFERENCE ? oldLayout : null;
    },
    async listLayouts(versionReference) {
      return versionReference === VERSION_REFERENCE ? [oldLayout] : [];
    },
  };
  const service = new TemplateCompatibilityService(repository);
  assert.equal(
    (await service.listCompatibleLayouts({
      templateVersionReference: VERSION_REFERENCE,
      pageType: 'HOME',
    }))[0]?.layoutReference,
    LAYOUT_REFERENCE,
  );
});

function licenceGuard(context: TemplateLicenceContext) {
  const repository: TemplateLicenceRepository = {
    async findLicenceContext() {
      return context;
    },
  };
  return new TemplateLicenceGuard(repository);
}

test('32. ENVATO_HTML requires a site-specific licence', async () => {
  await assert.rejects(
    licenceGuard({
      sourceType: 'ENVATO_HTML',
      siteReference: 'site',
      templateVersionReference: 'version',
      licence: null,
    }).assertTemplateLicensedForSite({
      siteReference: 'site',
      templateVersionReference: 'version',
    }),
    /Envato licence is required/,
  );
});

test('33. GOOGLE_STITCH does not require an Envato licence', async () => {
  const result = await licenceGuard({
    sourceType: 'GOOGLE_STITCH',
    siteReference: 'site',
    templateVersionReference: 'version',
    licence: null,
  }).assertTemplateLicensedForSite({
    siteReference: 'site',
    templateVersionReference: 'version',
  });
  assert.equal(result.required, false);
});

test('34. INTERNAL templates do not require an Envato licence', async () => {
  const result = await licenceGuard({
    sourceType: 'INTERNAL',
    siteReference: 'site',
    templateVersionReference: 'version',
    licence: null,
  }).assertTemplateLicensedForSite({
    siteReference: 'site',
    templateVersionReference: 'version',
  });
  assert.equal(result.required, false);
});

test('39. generated manifests validate against the strict contract', () => {
  assert.equal(TemplateManifestSchema.safeParse(validManifest()).success, true);
  assert.equal(
    TemplateManifestSchema.safeParse({
      ...validManifest(),
      rawArchive: 'not-allowed.zip',
    }).success,
    false,
  );
});

test('42. scripts are inventoried and flagged rather than executed', () => {
  const analysis = analyseTrustedTemplateFiles([
    { relativePath: 'assets/app.js', content: 'throw new Error("must not run")' },
  ]);
  assert.equal(analysis.files[0]?.category, 'JAVASCRIPT');
  assert.equal(analysis.files[0]?.containsExecutableCode, true);
  assert.equal(
    analysis.findings.some(
      (finding) => finding.code === 'SOURCE_SCRIPT_INVENTORIED_NOT_EXECUTED',
    ),
    true,
  );
});

test('43. approval fails while blocking findings remain', () => {
  assert.throws(
    () => assertTemplateApprovalReady({
      manifest: validManifest(),
      unresolvedBlockingFindings: 1,
    }),
    /blocked by unresolved/,
  );
});

test('44. complete production templates require HOME compatibility', () => {
  assert.throws(
    () => assertTemplateApprovalReady({
      manifest: validManifest([
        manifestLayout(['SERVICE_DETAIL'], 'SERVICE_DETAIL'),
      ]),
      unresolvedBlockingFindings: 0,
    }),
    /HOME-compatible/,
  );
});

test('45. templates without service detail compatibility receive a warning', () => {
  const result = assertTemplateApprovalReady({
    manifest: validManifest([manifestLayout(['HOME'])]),
    unresolvedBlockingFindings: 0,
  });
  assert.deepEqual(result.warnings, [
    'TEMPLATE_SERVICE_DETAIL_LAYOUT_RECOMMENDED',
  ]);
});

test('design-system signals extract controlled CSS tokens', () => {
  const signals = extractDesignSignals([fixture('assets/styles.css')]);
  assert.equal(signals.cssCustomProperties.includes('--colour-primary'), true);
  assert.equal(signals.colours.includes('#4b2f63'), true);
  assert.equal(signals.fontFamilies.includes('Fixture Sans'), true);
});

test('responsive signals extract media queries, breakpoints and layout primitives', () => {
  const signals = extractCssResponsiveSignals([fixture('assets/styles.css')]);
  assert.equal(signals.mediaQueryCount, 1);
  assert.equal(signals.breakpoints.includes(768), true);
  assert.equal(signals.usesGrid, true);
  assert.equal(signals.usesFlexbox, true);
});

test('inventory digests are deterministic regardless of input ordering', () => {
  const first = inventoryTemplateFiles([
    { relativePath: 'b.css', content: 'b{}' },
    { relativePath: 'a.html', content: '<main></main>' },
  ]);
  const second = inventoryTemplateFiles([
    { relativePath: 'a.html', content: '<main></main>' },
    { relativePath: 'b.css', content: 'b{}' },
  ]);
  assert.equal(templateArtifactDigest(first), templateArtifactDigest(second));
});
