import assert from 'node:assert/strict';
import test from 'node:test';
import {
  KnowledgeCtaTypeSchema,
  KnowledgeDomainSchema,
  KnowledgeEnforcementAuthoritySchema,
  KnowledgeImportBundleSchema,
  KnowledgePrioritySchema,
  KnowledgePublicationEffectSchema,
  KnowledgeRuleSchema,
  KnowledgeSourceSchema,
  KnowledgeValidationTypeSchema,
  SitePageTypeSchema,
  SiteSectionTypeSchema,
  assertKnowledgePackContentMutable,
  canTransitionKnowledgePack,
  compareKnowledgePacks,
  contentDigest,
  knowledgePackIsSelectable,
  parseCsvRecords,
  parseKnowledgeCsvBundle,
  parseKnowledgeJsonBundle,
  prepareSiteGenerationKnowledgeContext,
  selectKnowledgeRules,
  validateKnowledgePack,
  type KnowledgeImportBundle,
  type KnowledgePagePlaybook,
  type KnowledgeRule,
  type KnowledgeSource,
} from '../src/index.js';

const sourceBase = {
  sourceId: 'SRC_ONE',
  sourceTitle: 'Synthetic standards reference',
  sourceType: 'STANDARD' as const,
  topicDomains: ['ACCESSIBILITY' as const],
  evidenceAuthority: 'OFFICIAL_STANDARD' as const,
  supportCapability: 'DIRECT' as const,
  temporalClass: 'STABLE' as const,
  citationLocations: ['Section 1'],
};

function makeSource(
  overrides: Partial<KnowledgeSource> = {},
): KnowledgeSource {
  const value = { ...sourceBase, ...overrides };
  return KnowledgeSourceSchema.parse({
    ...value,
    contentDigest: overrides.contentDigest ?? contentDigest(value),
  });
}

const ruleBase = {
  ruleId: 'RULE_ACCESSIBLE_CONTENT',
  ruleName: 'Accessible content',
  ruleScope: 'PUBLIC_SITE' as const,
  domain: 'ACCESSIBILITY' as const,
  subcategory: 'Content',
  principle: 'Content must remain understandable and operable.',
  implementationInstruction: 'Use clear labels and keyboard-operable controls.',
  applicablePageTypes: ['HOME' as const],
  applicableSectionTypes: ['HERO' as const],
  conversionRoles: ['PRIMARY_LANDING' as const],
  priority: 'HIGH' as const,
  validationType: 'DETERMINISTIC' as const,
  publicationEffect: 'WARNING' as const,
  enforcementAuthority: 'OFFICIAL_STANDARD' as const,
  requiredBusinessData: [],
  sourceIds: ['SRC_ONE'],
  temporalClass: 'STABLE' as const,
  verificationSourceIds: [],
  confidence: 0.95,
  status: 'ACCEPTED' as const,
};

function makeRule(overrides: Partial<KnowledgeRule> = {}): KnowledgeRule {
  const value = { ...ruleBase, ...overrides };
  return KnowledgeRuleSchema.parse({
    ...value,
    contentDigest: overrides.contentDigest ?? contentDigest({
      ...value,
      contentDigest: undefined,
    }),
  });
}

function section(
  sectionType: 'HERO' | 'SERVICE_DETAILS' | 'BOOKING_CTA',
  overrides: Partial<KnowledgePagePlaybook['sections'][number]> = {},
) {
  const value = {
    sectionType,
    sectionOrderMin: 1,
    sectionOrderMax: 2,
    requirement: 'REQUIRED' as const,
    userIntent: 'Complete the intended task.',
    sectionPurpose: 'Provide a safe route to the next action.',
    requiredBusinessData: [],
    allowedPrimaryCtaTypes: ['KS_OS_BOOKING' as const],
    allowedSecondaryCtaTypes: [],
    blockingConditions: [],
    commonAntiPatterns: [],
    ruleIds: ['RULE_ACCESSIBLE_CONTENT'],
    sourceIds: ['SRC_ONE'],
    confidence: 0.9,
    ...overrides,
  };
  return {
    ...value,
    contentDigest: overrides.contentDigest ?? contentDigest(value),
  };
}

function playbook(
  pageType: 'HOME' | 'SERVICE_DETAIL' | 'BOOKING',
  sectionType: 'HERO' | 'SERVICE_DETAILS' | 'BOOKING_CTA',
  overrides: Partial<KnowledgePagePlaybook> = {},
): KnowledgePagePlaybook {
  const value = {
    pageType,
    conversionRole: pageType === 'HOME'
      ? 'PRIMARY_LANDING' as const
      : pageType === 'SERVICE_DETAIL'
        ? 'SERVICE_CONVERSION' as const
        : 'BOOKING' as const,
    sections: [section(sectionType)],
    ...overrides,
  };
  return {
    ...value,
    contentDigest: overrides.contentDigest ?? contentDigest(value),
  } as KnowledgePagePlaybook;
}

function makeBundle(
  overrides: Partial<KnowledgeImportBundle> = {},
): KnowledgeImportBundle {
  const value = {
    pack: {
      name: 'Synthetic Knowledge',
      semanticVersion: '1.0.0',
      intendedScope: 'PUBLIC_SITE' as const,
      schemaVersion: 1 as const,
    },
    sources: [makeSource()],
    rules: [makeRule()],
    pagePlaybooks: [
      playbook('HOME', 'HERO'),
      playbook('SERVICE_DETAIL', 'SERVICE_DETAILS'),
      playbook('BOOKING', 'BOOKING_CTA'),
    ],
    rejectedRules: [],
    sourceDigest: 'a'.repeat(64),
    ...overrides,
  };
  return KnowledgeImportBundleSchema.parse(value);
}

function selectable(
  bundle = makeBundle(),
  status: 'APPROVED' | 'ACTIVE' | 'REJECTED' = 'ACTIVE',
) {
  return {
    reference: '11111111-1111-4111-8111-111111111111',
    semanticVersion: bundle.pack.semanticVersion,
    schemaVersion: bundle.pack.schemaVersion,
    status,
    bundle,
    conflicts: [],
  } as const;
}

const sourceHeaders = [
  'source_id', 'source_title', 'author', 'edition_or_version', 'source_type',
  'topic_domains', 'evidence_authority', 'support_capability', 'temporal_class',
  'citation_locations', 'copyright_notes', 'verified_at', 'review_due_at', 'notes',
];
const platformHeaders = [
  'rule_id', 'rule_name', 'rule_scope', 'domain', 'subcategory', 'principle',
  'implementation_instruction', 'applicable_page_types',
  'applicable_section_types', 'conversion_roles', 'priority', 'validation_type',
  'publication_effect', 'enforcement_authority', 'required_business_data',
  'prohibited_behaviour', 'deterministic_test_description', 'source_ids',
  'verification_sources', 'temporal_class', 'verified_at', 'review_due_at',
  'confidence', 'notes',
];
const expertHeaders = [
  'rule_id', 'rule_name', 'rule_scope', 'domain', 'subcategory', 'principle',
  'why_it_matters', 'implementation_instruction', 'applicable_page_types',
  'applicable_section_types', 'conversion_roles', 'priority', 'validation_type',
  'publication_effect', 'enforcement_authority', 'required_business_data',
  'prohibited_behaviour', 'anti_pattern', 'ai_review_instruction',
  'human_review_instruction', 'source_ids', 'support_type', 'temporal_class',
  'verification_sources', 'verified_at', 'review_due_at', 'confidence', 'notes',
];
const playbookHeaders = [
  'page_type', 'conversion_role', 'section_type', 'section_order_min',
  'section_order_max', 'required_or_optional', 'user_intent',
  'business_objective', 'section_purpose', 'required_business_data',
  'copy_instruction', 'seo_instruction', 'trust_instruction',
  'booking_instruction', 'mobile_instruction', 'accessibility_instruction',
  'allowed_primary_cta_types', 'allowed_secondary_cta_types',
  'blocking_conditions', 'common_anti_patterns', 'rule_ids', 'source_ids',
  'confidence', 'notes',
];

function csv(headers: string[], rows: Array<Record<string, string>>) {
  const escape = (value = '') =>
    /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  return [
    headers.join(','),
    ...rows.map(row => headers.map(header => escape(row[header])).join(',')),
  ].join('\n');
}

function syntheticCsvBundle() {
  const commonRule = {
    rule_id: 'RULE_ACCESSIBLE_CONTENT',
    rule_name: 'Accessible content',
    rule_scope: 'PUBLIC_SITE',
    domain: 'ACCESSIBILITY',
    subcategory: 'Content',
    principle: 'Content must remain understandable and operable.',
    implementation_instruction: 'Use clear labels and keyboard-operable controls.',
    applicable_page_types: 'HOME|SERVICE_DETAIL|BOOKING',
    applicable_section_types: 'HERO|SERVICE_DETAILS|BOOKING_CTA',
    conversion_roles: 'PRIMARY_LANDING|SERVICE_CONVERSION|BOOKING',
    priority: 'HIGH',
    validation_type: 'DETERMINISTIC',
    publication_effect: 'WARNING',
    enforcement_authority: 'OFFICIAL_STANDARD',
    required_business_data: '',
    prohibited_behaviour: '',
    deterministic_test_description: 'Verify keyboard operation.',
    source_ids: 'SRC_ONE',
    verification_sources: '',
    temporal_class: 'STABLE',
    verified_at: '2026-01-01',
    review_due_at: '2027-01-01',
    confidence: '0.95',
    notes: '',
  };
  const playbookRow = (
    pageType: string,
    conversionRole: string,
    sectionType: string,
  ) => ({
    page_type: pageType,
    conversion_role: conversionRole,
    section_type: sectionType,
    section_order_min: '1',
    section_order_max: '2',
    required_or_optional: 'REQUIRED',
    user_intent: 'Complete the intended task.',
    business_objective: 'Support a safe conversion.',
    section_purpose: 'Provide the next action.',
    required_business_data: '',
    copy_instruction: 'Use concise original copy.',
    seo_instruction: '',
    trust_instruction: '',
    booking_instruction: 'Use native KS OS booking.',
    mobile_instruction: '',
    accessibility_instruction: 'Keep controls keyboard operable.',
    allowed_primary_cta_types: 'KS_OS_BOOKING',
    allowed_secondary_cta_types: 'INTERNAL_PAGE',
    blocking_conditions: '',
    common_anti_patterns: '',
    rule_ids: 'RULE_ACCESSIBLE_CONTENT',
    source_ids: 'SRC_ONE',
    confidence: '0.9',
    notes: '',
  });
  return {
    sourceProvenance: csv(sourceHeaders, [{
      source_id: 'SRC_ONE',
      source_title: 'Synthetic standards reference',
      author: '',
      edition_or_version: '1',
      source_type: 'Standard',
      topic_domains: 'Accessibility',
      evidence_authority: 'OFFICIAL_STANDARD',
      support_capability: 'DIRECT',
      temporal_class: 'STABLE',
      citation_locations: 'Section 1',
      copyright_notes: 'Distilled only',
      verified_at: '2026-01-01',
      review_due_at: '2027-01-01',
      notes: '',
    }]),
    platformRules: csv(platformHeaders, [commonRule]),
    expertKnowledgeRules: csv(expertHeaders, [{
      rule_id: 'RULE_TRUST_GUIDANCE',
      rule_name: 'Trust guidance',
      rule_scope: 'PUBLIC_SITE',
      domain: 'TRUST',
      subcategory: 'Evidence',
      principle: 'Trust statements should remain specific and supportable.',
      why_it_matters: 'Verifiable statements help visitors make informed choices.',
      implementation_instruction: 'Use only evidence-backed trust statements.',
      applicable_page_types: 'HOME',
      applicable_section_types: 'HERO',
      conversion_roles: 'PRIMARY_LANDING',
      priority: 'MEDIUM',
      validation_type: 'HUMAN_REVIEW',
      publication_effect: 'RECOMMENDATION',
      enforcement_authority: 'ADVISORY',
      required_business_data: '',
      prohibited_behaviour: 'Do not invent credentials.',
      anti_pattern: 'Unsupported superlatives.',
      ai_review_instruction: '',
      human_review_instruction: 'Confirm the supporting evidence.',
      source_ids: 'SRC_ONE',
      support_type: 'SYNTHESISED',
      temporal_class: 'STABLE',
      verification_sources: '',
      verified_at: '2026-01-01',
      review_due_at: '2027-01-01',
      confidence: '0.85',
      notes: '',
    }]),
    pageSectionPlaybooks: csv(playbookHeaders, [
      playbookRow('HOME', 'PRIMARY_LANDING', 'HERO'),
      playbookRow('SERVICE_DETAIL', 'SERVICE_CONVERSION', 'SERVICE_DETAILS'),
      playbookRow('BOOKING', 'BOOKING', 'BOOKING_CTA'),
    ]),
    rejectedOrPendingRules: csv(
      ['rule_id', 'rule_name', 'rejection_reason'],
      [{
        rule_id: 'RULE_REJECTED',
        rule_name: 'Rejected rule',
        rejection_reason: 'Insufficient evidence.',
      }],
    ),
  };
}

test('1. controlled domain values are accepted', () => {
  assert.equal(KnowledgeDomainSchema.parse('UX'), 'UX');
});
test('2. unknown domain is rejected', () => {
  assert.equal(KnowledgeDomainSchema.safeParse('SALES').success, false);
});
test('3. unknown priority is rejected', () => {
  assert.equal(KnowledgePrioritySchema.safeParse('URGENT').success, false);
});
test('4. unknown validation type is rejected', () => {
  assert.equal(KnowledgeValidationTypeSchema.safeParse('MODEL').success, false);
});
test('5. unknown publication effect is rejected', () => {
  assert.equal(KnowledgePublicationEffectSchema.safeParse('PUBLISH').success, false);
});
test('6. unknown enforcement authority is rejected', () => {
  assert.equal(KnowledgeEnforcementAuthoritySchema.safeParse('BROWSER').success, false);
});
test('7. unknown page type is rejected', () => {
  assert.equal(SitePageTypeSchema.safeParse('LANDING').success, false);
});
test('8. unknown section type is rejected', () => {
  assert.equal(SiteSectionTypeSchema.safeParse('SCRIPT').success, false);
});
test('9. rule identifiers use uppercase snake case', () => {
  assert.equal(KnowledgeRuleSchema.safeParse({ ...makeRule(), ruleId: 'rule_one' }).success, false);
});
test('10. empty implementation instruction is rejected', () => {
  assert.equal(KnowledgeRuleSchema.safeParse({
    ...makeRule(),
    implementationInstruction: '',
  }).success, false);
});
test('11. invalid confidence is rejected', () => {
  assert.equal(KnowledgeRuleSchema.safeParse({
    ...makeRule(),
    confidence: 1.1,
  }).success, false);
});
test('12. CSV parser accepts quoted commas and escaped quotes', () => {
  const rows = parseCsvRecords('synthetic', 'a,b\n"one, two","say ""yes"""');
  assert.deepEqual(rows, [{ a: 'one, two', b: 'say "yes"' }]);
});
test('13. CSV rules import validates', () => {
  const bundle = parseKnowledgeCsvBundle({
    name: 'Synthetic Knowledge',
    semanticVersion: '1.0.0',
    intendedScope: 'PUBLIC_SITE',
  }, syntheticCsvBundle());
  assert.equal(validateKnowledgePack(bundle).readyForApproval, true);
});
test('14. JSON rules import validates', () => {
  const bundle = makeBundle();
  assert.deepEqual(parseKnowledgeJsonBundle(JSON.stringify(bundle)), bundle);
});
test('15. CSV import rejects unknown controlled values', () => {
  const datasets = syntheticCsvBundle();
  datasets.platformRules = datasets.platformRules.replace(
    ',ACCESSIBILITY,',
    ',UNKNOWN_DOMAIN,',
  );
  assert.throws(() => parseKnowledgeCsvBundle({
    name: 'Synthetic Knowledge',
    semanticVersion: '1.0.0',
    intendedScope: 'PUBLIC_SITE',
  }, datasets), /unsupported domain/);
});
test('16. duplicate rule IDs are findings', () => {
  const rule = makeRule();
  const report = validateKnowledgePack(makeBundle({ rules: [rule, rule] }));
  assert.ok(report.findings.some(entry => entry.code === 'DUPLICATE_RULE_ID'));
});
test('17. case-insensitive rule-ID collisions are rejected by normalization boundary', () => {
  assert.equal(KnowledgeRuleSchema.safeParse({
    ...makeRule(),
    ruleId: 'Rule_Accessible_Content',
  }).success, false);
});
test('18. duplicate source IDs are findings', () => {
  const source = makeSource();
  const report = validateKnowledgePack(makeBundle({ sources: [source, source] }));
  assert.ok(report.findings.some(entry => entry.code === 'DUPLICATE_SOURCE_ID'));
});
test('19. missing claimed source creates a blocking finding', () => {
  const report = validateKnowledgePack(makeBundle({
    rules: [makeRule({ sourceIds: ['SRC_MISSING'] })],
  }));
  assert.ok(report.findings.some(entry =>
    entry.code === 'CLAIMED_SOURCE_REFERENCE_MISSING'
    && entry.blocksApproval));
});
test('20. inferred rule requires review', () => {
  const report = validateKnowledgePack(makeBundle({
    rules: [makeRule({ supportType: 'INFERRED' })],
  }));
  assert.ok(report.findings.some(entry =>
    entry.code === 'INFERRED_RULE_REQUIRES_REVIEW'));
});
test('21. long quotation creates copyright finding', () => {
  const quote = `"${Array.from({ length: 26 }, (_, index) =>
    `word${index}`).join(' ')}"`;
  const report = validateKnowledgePack(makeBundle({
    rules: [makeRule({ principle: quote })],
  }));
  assert.ok(report.findings.some(entry => entry.code === 'LONG_SOURCE_QUOTATION'));
});
test('22. raw book-sized content is rejected by schema limits', () => {
  assert.equal(KnowledgeRuleSchema.safeParse({
    ...makeRule(),
    principle: 'x'.repeat(20_000),
  }).success, false);
});
test('23. binary CSV source content is rejected', () => {
  assert.throws(() => parseCsvRecords('binary', 'a\n\u0000'), /binary data/);
});
test('24. import bundle has no source-file or PDF field', () => {
  assert.equal(KnowledgeImportBundleSchema.safeParse({
    ...makeBundle(),
    originalPdf: 'encoded',
  }).success, false);
});
test('25. exact duplicate rule content is detected', () => {
  const first = makeRule();
  const second = makeRule({ ruleId: 'RULE_SECOND' });
  const report = validateKnowledgePack(makeBundle({ rules: [first, second] }));
  assert.ok(report.findings.some(entry =>
    entry.code === 'EXACT_DUPLICATE_RULE_CONTENT'));
});
test('26. near duplicate rule creates review finding', () => {
  const first = makeRule();
  const second = makeRule({
    ruleId: 'RULE_SECOND',
    implementationInstruction:
      'Use clear labels and keyboard operable controls everywhere.',
  });
  const report = validateKnowledgePack(makeBundle({ rules: [first, second] }));
  assert.ok(report.findings.some(entry => entry.code === 'NEAR_DUPLICATE_RULE'));
});
test('27. conflicting priorities are detected', () => {
  const first = makeRule();
  const second = makeRule({ ruleId: 'RULE_SECOND', priority: 'LOW' });
  const report = validateKnowledgePack(makeBundle({ rules: [first, second] }));
  assert.ok(report.conflicts.some(entry =>
    entry.conflictType === 'PRIORITY_MISMATCH'));
});
test('28. conflicting publication effects are detected', () => {
  const first = makeRule();
  const second = makeRule({
    ruleId: 'RULE_SECOND',
    publicationEffect: 'BLOCK',
  });
  const report = validateKnowledgePack(makeBundle({ rules: [first, second] }));
  assert.ok(report.conflicts.some(entry =>
    entry.conflictType === 'PUBLICATION_EFFECT_MISMATCH'));
});
test('29. required versus prohibited section conflict is detected', () => {
  const home = playbook('HOME', 'HERO', {
    sections: [
      section('HERO'),
      section('HERO', {
        sectionOrderMin: 3,
        sectionOrderMax: 4,
        requirement: 'PROHIBITED',
      }),
    ],
  });
  const report = validateKnowledgePack(makeBundle({
    pagePlaybooks: [
      home,
      playbook('SERVICE_DETAIL', 'SERVICE_DETAILS'),
      playbook('BOOKING', 'BOOKING_CTA'),
    ],
  }));
  assert.ok(report.conflicts.some(entry =>
    entry.conflictType === 'REQUIRED_PROHIBITED_SECTION'));
});
test('30. arbitrary external booking CTA type is rejected', () => {
  assert.equal(KnowledgeCtaTypeSchema.safeParse('CALENDLY').success, false);
});
test('31. external booking recommendation creates critical conflict', () => {
  const report = validateKnowledgePack(makeBundle({
    rules: [makeRule({
      implementationInstruction: 'Send visitors to an external booking calendar.',
    })],
  }));
  assert.ok(report.conflicts.some(entry =>
    entry.conflictType === 'EXTERNAL_BOOKING'
    && entry.severity === 'CRITICAL'));
});
test('32. fabricated location instruction is rejected', () => {
  const report = validateKnowledgePack(makeBundle({
    rules: [makeRule({
      implementationInstruction: 'Invent a location for every target town.',
    })],
  }));
  assert.ok(report.findings.some(entry =>
    entry.code === 'FABRICATED_LOCATION_CONTENT_PROHIBITED'));
});
test('33. unsupported claim creates blocking finding', () => {
  const report = validateKnowledgePack(makeBundle({
    rules: [makeRule({
      implementationInstruction: 'Publish claims without evidence.',
    })],
  }));
  assert.ok(report.findings.some(entry =>
    entry.code === 'UNSUPPORTED_CLAIM_PROHIBITED'));
});
test('34. accessibility animation conflict is surfaced', () => {
  const report = validateKnowledgePack(makeBundle({
    rules: [makeRule({
      implementationInstruction: 'Use continuous animation on every control.',
    })],
  }));
  assert.ok(report.conflicts.some(entry =>
    entry.conflictType === 'ACCESSIBILITY_ANIMATION'));
});
test('35. SEO thin-content conflict is surfaced', () => {
  const report = validateKnowledgePack(makeBundle({
    rules: [makeRule({
      domain: 'CONTENT_SEO',
      implementationInstruction: 'Mass-produce pages for every keyword.',
    })],
  }));
  assert.ok(report.conflicts.some(entry =>
    entry.conflictType === 'SEO_THIN_CONTENT'));
});
test('36. conflicts are never silently resolved', () => {
  const report = validateKnowledgePack(makeBundle({
    rules: [makeRule({
      implementationInstruction: 'Publish claims without evidence.',
    })],
  }));
  assert.ok(report.conflicts.every(entry => entry.resolved === false));
});
test('37. valid pack becomes ready for approval', () => {
  assert.equal(validateKnowledgePack(makeBundle()).readyForApproval, true);
});
test('38. blocking finding prevents approval readiness', () => {
  const report = validateKnowledgePack(makeBundle({
    rules: [makeRule({ sourceIds: ['SRC_MISSING'] })],
  }));
  assert.equal(report.readyForApproval, false);
});
test('39. draft pack content is mutable', () => {
  assert.doesNotThrow(() => assertKnowledgePackContentMutable('DRAFT'));
});
test('40. approved pack is immutable', () => {
  assert.throws(() => assertKnowledgePackContentMutable('APPROVED'));
});
test('41. active pack is immutable', () => {
  assert.throws(() => assertKnowledgePackContentMutable('ACTIVE'));
});
test('42. lifecycle allows ready pack approval', () => {
  assert.equal(canTransitionKnowledgePack('READY_FOR_APPROVAL', 'APPROVED'), true);
});
test('43. lifecycle separates approval and activation', () => {
  assert.equal(canTransitionKnowledgePack('READY_FOR_APPROVAL', 'ACTIVE'), false);
});
test('44. lifecycle permits approved activation', () => {
  assert.equal(canTransitionKnowledgePack('APPROVED', 'ACTIVE'), true);
});
test('45. lifecycle permits active supersession', () => {
  assert.equal(canTransitionKnowledgePack('ACTIVE', 'SUPERSEDED'), true);
});
test('46. retired pack remains non-selectable', () => {
  assert.equal(knowledgePackIsSelectable('RETIRED'), false);
});
test('47. rejected pack cannot be selected', () => {
  assert.throws(() => selectKnowledgeRules({ pack: selectable(makeBundle(), 'REJECTED') }));
});
test('48. active pack can be selected', () => {
  assert.equal(selectKnowledgeRules({ pack: selectable() }).rules.length, 1);
});
test('49. approved pack requires explicit caller policy', () => {
  const pack = selectable(makeBundle(), 'APPROVED');
  assert.throws(() => selectKnowledgeRules({ pack }));
  assert.equal(selectKnowledgeRules({
    pack,
    callerPolicy: 'APPROVED_OR_ACTIVE',
  }).rules.length, 1);
});
test('50. rule matching filters by page type', () => {
  assert.equal(selectKnowledgeRules({
    pack: selectable(),
    pageType: 'FAQ',
  }).rules.length, 0);
});
test('51. rule matching filters by section type', () => {
  assert.equal(selectKnowledgeRules({
    pack: selectable(),
    sectionTypes: ['FOOTER'],
  }).rules.length, 0);
});
test('52. rule matching filters by domain', () => {
  assert.equal(selectKnowledgeRules({
    pack: selectable(),
    domains: ['BOOKING'],
  }).rules.length, 0);
});
test('53. rule matching respects priority', () => {
  assert.equal(selectKnowledgeRules({
    pack: selectable(),
    priorities: ['LOW'],
  }).rules.length, 0);
});
test('54. warning rules can be excluded', () => {
  assert.equal(selectKnowledgeRules({
    pack: selectable(),
    includeWarnings: false,
  }).rules.length, 0);
});
test('55. rule ordering is deterministic', () => {
  const low = makeRule({
    ruleId: 'RULE_LOW',
    priority: 'LOW',
    publicationEffect: 'RECOMMENDATION',
  });
  const critical = makeRule({
    ruleId: 'RULE_CRITICAL',
    priority: 'CRITICAL',
    publicationEffect: 'BLOCK',
  });
  const bundle = makeBundle({ rules: [low, critical] });
  assert.deepEqual(
    selectKnowledgeRules({ pack: selectable(bundle) }).rules.map(rule => rule.ruleId),
    ['RULE_CRITICAL', 'RULE_LOW'],
  );
});
test('56. unresolved conflicting rules are excluded', () => {
  const pack = {
    ...selectable(),
    conflicts: [{
      conflictType: 'UNSUPPORTED_CLAIM' as const,
      severity: 'CRITICAL' as const,
      summary: 'Conflict',
      ruleIds: ['RULE_ACCESSIBLE_CONTENT'],
      resolved: false,
    }],
  };
  assert.equal(selectKnowledgeRules({ pack }).rules.length, 0);
});
test('57. rejected rules are excluded', () => {
  const bundle = makeBundle({
    rules: [makeRule({ status: 'REJECTED' })],
  });
  assert.equal(selectKnowledgeRules({ pack: selectable(bundle) }).rules.length, 0);
});
test('58. selection does not mix pack versions', () => {
  const result = selectKnowledgeRules({ pack: selectable() });
  assert.equal(result.semanticVersion, '1.0.0');
  assert.equal(result.rules.length, 1);
});
test('59. page playbook preserves conversion role', () => {
  const context = prepareSiteGenerationKnowledgeContext({
    pack: selectable(),
    pageType: 'HOME',
    plannedSections: ['HERO'],
    conversionRole: 'PRIMARY_LANDING',
  });
  assert.equal(context.pagePlaybook?.conversionRole, 'PRIMARY_LANDING');
});
test('60. SERVICE_DETAIL playbook requires native booking', () => {
  const target = makeBundle().pagePlaybooks.find(page =>
    page.pageType === 'SERVICE_DETAIL')!;
  assert.ok(target.sections[0].allowedPrimaryCtaTypes.includes('KS_OS_BOOKING'));
});
test('61. BOOKING playbook allows no external destination', () => {
  const target = makeBundle().pagePlaybooks.find(page =>
    page.pageType === 'BOOKING')!;
  assert.deepEqual(target.sections[0].allowedPrimaryCtaTypes, ['KS_OS_BOOKING']);
});
test('62. missing business data is reported', () => {
  const bundle = makeBundle({
    rules: [makeRule({ requiredBusinessData: ['legal_business_name'] })],
  });
  assert.deepEqual(
    selectKnowledgeRules({ pack: selectable(bundle) }).missingBusinessData,
    ['legal_business_name'],
  );
});
test('63. DATA_REQUIRED is not automatically satisfied', () => {
  const bundle = makeBundle({
    rules: [makeRule({
      validationType: 'DATA_REQUIRED',
      requiredBusinessData: ['physical_address'],
    })],
  });
  assert.deepEqual(
    selectKnowledgeRules({ pack: selectable(bundle) }).missingBusinessData,
    ['physical_address'],
  );
});
test('64. context includes platform requirements', () => {
  const bundle = makeBundle({
    rules: [makeRule({ enforcementAuthority: 'PLATFORM' })],
  });
  const context = prepareSiteGenerationKnowledgeContext({
    pack: selectable(bundle),
    pageType: 'HOME',
    plannedSections: ['HERO'],
    conversionRole: 'PRIMARY_LANDING',
  });
  assert.deepEqual(context.applicableRuleIds, ['RULE_ACCESSIBLE_CONTENT']);
});
test('65. context preserves prohibited fabrication rules', () => {
  const bundle = makeBundle({
    rules: [makeRule({
      ruleId: 'RULE_NO_FABRICATED_FACTS',
      prohibitedBehaviour: 'Never fabricate business facts.',
    })],
  });
  const context = prepareSiteGenerationKnowledgeContext({
    pack: selectable(bundle),
    pageType: 'HOME',
    plannedSections: ['HERO'],
    conversionRole: 'PRIMARY_LANDING',
    maxRuleCount: 1,
  });
  assert.ok(context.prohibitedBehaviours.includes('Never fabricate business facts.'));
});
test('66. context excludes irrelevant page rules', () => {
  const context = prepareSiteGenerationKnowledgeContext({
    pack: selectable(),
    pageType: 'FAQ',
    plannedSections: ['FAQ'],
    conversionRole: 'OBJECTION_HANDLING',
  });
  assert.equal(context.applicableRuleIds.length, 0);
});
test('67. context excludes source notes and long source text', () => {
  const source = makeSource({ reviewNotes: 'Agency private note.' });
  const bundle = makeBundle({ sources: [source] });
  const context = prepareSiteGenerationKnowledgeContext({
    pack: selectable(bundle),
    pageType: 'HOME',
    plannedSections: ['HERO'],
    conversionRole: 'PRIMARY_LANDING',
  });
  assert.equal(JSON.stringify(context).includes('Agency private note'), false);
});
test('68. context returns semantic version', () => {
  const context = prepareSiteGenerationKnowledgeContext({
    pack: selectable(),
    pageType: 'HOME',
    plannedSections: ['HERO'],
    conversionRole: 'PRIMARY_LANDING',
  });
  assert.equal(context.semanticVersion, '1.0.0');
});
test('69. context returns reproducible digest', () => {
  const input = {
    pack: selectable(),
    pageType: 'HOME' as const,
    plannedSections: ['HERO' as const],
    conversionRole: 'PRIMARY_LANDING' as const,
  };
  assert.equal(
    prepareSiteGenerationKnowledgeContext(input).contentDigest,
    prepareSiteGenerationKnowledgeContext(input).contentDigest,
  );
});
test('70. size limit preserves BLOCK rules', () => {
  const block = makeRule({
    ruleId: 'RULE_BLOCK',
    publicationEffect: 'BLOCK',
    priority: 'LOW',
  });
  const recommendation = makeRule({
    ruleId: 'RULE_REC',
    publicationEffect: 'RECOMMENDATION',
    priority: 'LOW',
  });
  const result = selectKnowledgeRules({
    pack: selectable(makeBundle({ rules: [recommendation, block] })),
    maxRuleCount: 1,
  });
  assert.ok(result.rules.some(rule => rule.ruleId === 'RULE_BLOCK'));
});
test('71. size limit preserves CRITICAL rules', () => {
  const critical = makeRule({ ruleId: 'RULE_CRITICAL', priority: 'CRITICAL' });
  const optional = makeRule({
    ruleId: 'RULE_OPTIONAL',
    priority: 'LOW',
    publicationEffect: 'RECOMMENDATION',
  });
  const result = selectKnowledgeRules({
    pack: selectable(makeBundle({ rules: [optional, critical] })),
    maxRuleCount: 1,
  });
  assert.ok(result.rules.some(rule => rule.ruleId === 'RULE_CRITICAL'));
});
test('72. lower-priority recommendations trim deterministically', () => {
  const one = makeRule({
    ruleId: 'RULE_A',
    priority: 'LOW',
    publicationEffect: 'RECOMMENDATION',
  });
  const two = makeRule({
    ruleId: 'RULE_B',
    priority: 'LOW',
    publicationEffect: 'RECOMMENDATION',
  });
  const result = selectKnowledgeRules({
    pack: selectable(makeBundle({ rules: [two, one] })),
    maxRuleCount: 1,
  });
  assert.deepEqual(result.rules.map(rule => rule.ruleId), ['RULE_A']);
});
test('73. trimmed output reports omitted rule count', () => {
  const rules = [
    makeRule({ ruleId: 'RULE_A', publicationEffect: 'RECOMMENDATION' }),
    makeRule({ ruleId: 'RULE_B', publicationEffect: 'RECOMMENDATION' }),
  ];
  assert.equal(selectKnowledgeRules({
    pack: selectable(makeBundle({ rules })),
    maxRuleCount: 1,
  }).omittedRuleCount, 1);
});
test('74. comparison reports added rules', () => {
  const right = makeBundle({
    rules: [makeRule(), makeRule({ ruleId: 'RULE_ADDED' })],
  });
  assert.deepEqual(compareKnowledgePacks(makeBundle(), right).addedRuleIds, ['RULE_ADDED']);
});
test('75. comparison reports removed rules', () => {
  const left = makeBundle({
    rules: [makeRule(), makeRule({ ruleId: 'RULE_REMOVED' })],
  });
  assert.deepEqual(compareKnowledgePacks(left, makeBundle()).removedRuleIds, ['RULE_REMOVED']);
});
test('76. comparison reports priority changes', () => {
  const right = makeBundle({ rules: [makeRule({ priority: 'LOW' })] });
  assert.equal(compareKnowledgePacks(makeBundle(), right).priorityChanges.length, 1);
});
test('77. comparison reports publication-effect changes', () => {
  const right = makeBundle({
    rules: [makeRule({ publicationEffect: 'RECOMMENDATION' })],
  });
  assert.equal(
    compareKnowledgePacks(makeBundle(), right).publicationEffectChanges.length,
    1,
  );
});
test('78. comparison reports applicability changes', () => {
  const right = makeBundle({
    rules: [makeRule({ applicablePageTypes: ['FAQ'] })],
  });
  assert.deepEqual(
    compareKnowledgePacks(makeBundle(), right).applicabilityChanges,
    ['RULE_ACCESSIBLE_CONTENT'],
  );
});
test('79. comparison reports source changes', () => {
  const right = makeBundle({
    sources: [makeSource({ sourceTitle: 'Changed source title' })],
  });
  assert.deepEqual(compareKnowledgePacks(makeBundle(), right).sourceChanges, ['SRC_ONE']);
});
test('80. comparison reports page-playbook changes', () => {
  const changedHome = playbook('HOME', 'HERO', {
    sections: [section('HERO', { userIntent: 'Changed intent.' })],
  });
  const right = makeBundle({
    pagePlaybooks: [
      changedHome,
      playbook('SERVICE_DETAIL', 'SERVICE_DETAILS'),
      playbook('BOOKING', 'BOOKING_CTA'),
    ],
  });
  assert.ok(compareKnowledgePacks(makeBundle(), right)
    .pagePlaybookChanges.includes('HOME:PRIMARY_LANDING'));
});
test('81. validation digest is stable', () => {
  assert.equal(
    validateKnowledgePack(makeBundle()).contentDigest,
    validateKnowledgePack(makeBundle()).contentDigest,
  );
});
test('81b. validation digest is independent of import row order', () => {
  const bundle = makeBundle();
  const reordered = makeBundle({
    sources: [...bundle.sources].reverse(),
    rules: [...bundle.rules].reverse(),
    pagePlaybooks: [...bundle.pagePlaybooks].reverse().map(page => ({
      ...page,
      sections: [...page.sections].reverse(),
    })),
    rejectedRules: [...bundle.rejectedRules].reverse(),
  });
  assert.equal(
    validateKnowledgePack(bundle).contentDigest,
    validateKnowledgePack(reordered).contentDigest,
  );
});
test('82. rejected rows never enter accepted rules', () => {
  const bundle = parseKnowledgeCsvBundle({
    name: 'Synthetic Knowledge',
    semanticVersion: '1.0.0',
    intendedScope: 'PUBLIC_SITE',
  }, syntheticCsvBundle());
  assert.equal(bundle.rules.some(rule => rule.ruleId === 'RULE_REJECTED'), false);
  assert.equal(bundle.rejectedRules.length, 1);
});
test('83. source digest changes when an input changes', () => {
  const metadata = {
    name: 'Synthetic Knowledge',
    semanticVersion: '1.0.0',
    intendedScope: 'PUBLIC_SITE' as const,
  };
  const first = syntheticCsvBundle();
  const second = syntheticCsvBundle();
  second.sourceProvenance += '\n';
  assert.notEqual(
    parseKnowledgeCsvBundle(metadata, first).sourceDigest,
    parseKnowledgeCsvBundle(metadata, second).sourceDigest,
  );
});
test('84. identical CSV imports derive identical source digests', () => {
  const metadata = {
    name: 'Synthetic Knowledge',
    semanticVersion: '1.0.0',
    intendedScope: 'PUBLIC_SITE' as const,
  };
  assert.equal(
    parseKnowledgeCsvBundle(metadata, syntheticCsvBundle()).sourceDigest,
    parseKnowledgeCsvBundle(metadata, syntheticCsvBundle()).sourceDigest,
  );
});
test('85. strict JSON rejects unknown executable fields', () => {
  assert.equal(KnowledgeImportBundleSchema.safeParse({
    ...makeBundle(),
    modulePath: './handler.js',
  }).success, false);
});
