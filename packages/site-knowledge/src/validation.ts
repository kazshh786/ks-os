import {
  KnowledgeImportBundleSchema,
  KnowledgeValidationReportSchema,
  type KnowledgeConflict,
  type KnowledgeImportBundle,
  type KnowledgeImportFinding,
  type KnowledgePagePlaybook,
  type KnowledgeRule,
} from './contracts.js';
import {
  contentDigest,
  jaccardSimilarity,
  normalisedTextDigest,
  normaliseWhitespace,
} from './normalization.js';

const NEAR_DUPLICATE_THRESHOLD = 0.82;
const MAX_QUOTED_WORDS = 25;
const REQUIRED_LAUNCH_PAGE_TYPES = ['HOME', 'SERVICE_DETAIL', 'BOOKING'] as const;

function finding(
  value: KnowledgeImportFinding,
  target: KnowledgeImportFinding[],
) {
  const key = [
    value.code,
    value.ruleId,
    value.sourceId,
    value.pageType,
    value.sectionType,
  ].join(':');
  if (!target.some(entry => [
    entry.code,
    entry.ruleId,
    entry.sourceId,
    entry.pageType,
    entry.sectionType,
  ].join(':') === key)) {
    target.push(value);
  }
}

function conflict(value: KnowledgeConflict, target: KnowledgeConflict[]) {
  const ruleIds = [...value.ruleIds].sort().join(':');
  const key = [
    value.conflictType,
    ruleIds,
    value.pageType,
    value.sectionType,
  ].join(':');
  if (!target.some(entry => [
    entry.conflictType,
    [...entry.ruleIds].sort().join(':'),
    entry.pageType,
    entry.sectionType,
  ].join(':') === key)) {
    target.push({ ...value, ruleIds: [...value.ruleIds].sort() });
  }
}

function ruleText(rule: KnowledgeRule) {
  return [
    rule.principle,
    rule.implementationInstruction,
    rule.whyItMatters,
  ].filter(Boolean).join(' ');
}

function rulesShareTarget(left: KnowledgeRule, right: KnowledgeRule) {
  if (left.domain !== right.domain) return false;
  const pageOverlap = left.applicablePageTypes.length === 0
    || right.applicablePageTypes.length === 0
    || left.applicablePageTypes.some(page =>
      right.applicablePageTypes.includes(page));
  const sectionOverlap = left.applicableSectionTypes.length === 0
    || right.applicableSectionTypes.length === 0
    || left.applicableSectionTypes.some(section =>
      right.applicableSectionTypes.includes(section));
  return pageOverlap && sectionOverlap;
}

function detectDuplicates(
  bundle: KnowledgeImportBundle,
  findings: KnowledgeImportFinding[],
  conflicts: KnowledgeConflict[],
) {
  const ruleIds = new Map<string, KnowledgeRule>();
  const content = new Map<string, KnowledgeRule>();
  for (const rule of bundle.rules) {
    const identifier = rule.ruleId.toLowerCase();
    const existingId = ruleIds.get(identifier);
    if (existingId) {
      finding({
        severity: 'ERROR',
        category: 'DUPLICATE',
        code: existingId.ruleId === rule.ruleId
          ? 'DUPLICATE_RULE_ID'
          : 'CASE_INSENSITIVE_RULE_ID_COLLISION',
        message: 'Rule identifiers must be unique within a pack.',
        blocksApproval: true,
        ruleId: rule.ruleId,
      }, findings);
    } else {
      ruleIds.set(identifier, rule);
    }
    const digest = normalisedTextDigest(
      `${rule.principle} ${rule.implementationInstruction}`,
    );
    const existingContent = content.get(digest);
    if (existingContent && existingContent.ruleId !== rule.ruleId) {
      finding({
        severity: 'ERROR',
        category: 'DUPLICATE',
        code: 'EXACT_DUPLICATE_RULE_CONTENT',
        message: 'Two rule identifiers contain identical normalized guidance.',
        blocksApproval: true,
        ruleId: rule.ruleId,
      }, findings);
      if (existingContent.priority !== rule.priority) {
        conflict({
          conflictType: 'PRIORITY_MISMATCH',
          severity: 'HIGH',
          summary: 'Equivalent rules assign different priorities.',
          ruleIds: [existingContent.ruleId, rule.ruleId],
          resolved: false,
        }, conflicts);
      }
      if (existingContent.publicationEffect !== rule.publicationEffect) {
        conflict({
          conflictType: 'PUBLICATION_EFFECT_MISMATCH',
          severity: 'CRITICAL',
          summary: 'Equivalent rules assign different publication effects.',
          ruleIds: [existingContent.ruleId, rule.ruleId],
          resolved: false,
        }, conflicts);
      }
    } else {
      content.set(digest, rule);
    }
  }

  for (let leftIndex = 0; leftIndex < bundle.rules.length; leftIndex += 1) {
    const left = bundle.rules[leftIndex];
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < bundle.rules.length;
      rightIndex += 1
    ) {
      const right = bundle.rules[rightIndex];
      if (!rulesShareTarget(left, right)) continue;
      const similarity = jaccardSimilarity(ruleText(left), ruleText(right));
      if (similarity >= NEAR_DUPLICATE_THRESHOLD
        && left.contentDigest !== right.contentDigest) {
        finding({
          severity: 'REVIEW',
          category: 'DUPLICATE',
          code: 'NEAR_DUPLICATE_RULE',
          message: 'Two rules contain materially similar guidance and require review.',
          blocksApproval: false,
          ruleId: right.ruleId,
        }, findings);
        if (left.priority !== right.priority) {
          conflict({
            conflictType: 'PRIORITY_MISMATCH',
            severity: 'HIGH',
            summary: 'Similar rules assign different priorities.',
            ruleIds: [left.ruleId, right.ruleId],
            resolved: false,
          }, conflicts);
        }
        if (left.publicationEffect !== right.publicationEffect) {
          conflict({
            conflictType: 'PUBLICATION_EFFECT_MISMATCH',
            severity: left.publicationEffect === 'BLOCK'
              || right.publicationEffect === 'BLOCK'
              ? 'CRITICAL'
              : 'HIGH',
            summary: 'Similar rules assign different publication effects.',
            ruleIds: [left.ruleId, right.ruleId],
            resolved: false,
          }, conflicts);
        }
      }
      const leftText = normaliseWhitespace(ruleText(left)).toLowerCase();
      const rightText = normaliseWhitespace(ruleText(right)).toLowerCase();
      const negationMismatch = /\b(must not|never|prohibit)\b/.test(leftText)
        !== /\b(must not|never|prohibit)\b/.test(rightText);
      if (negationMismatch
        && jaccardSimilarity(
          leftText.replace(/\b(must not|never|prohibit(?:ed)?)\b/g, ''),
          rightText.replace(/\b(must not|never|prohibit(?:ed)?)\b/g, ''),
        ) >= 0.72) {
        conflict({
          conflictType: 'MUTUALLY_EXCLUSIVE_INSTRUCTIONS',
          severity: 'CRITICAL',
          summary: 'Two rules appear to require mutually exclusive behaviour.',
          ruleIds: [left.ruleId, right.ruleId],
          resolved: false,
        }, conflicts);
      }
    }
  }

  const sourceIds = new Set<string>();
  for (const source of bundle.sources) {
    const identifier = source.sourceId.toLowerCase();
    if (sourceIds.has(identifier)) {
      finding({
        severity: 'ERROR',
        category: 'DUPLICATE',
        code: 'DUPLICATE_SOURCE_ID',
        message: 'Source identifiers must be unique within a pack.',
        blocksApproval: true,
        sourceId: source.sourceId,
      }, findings);
    }
    sourceIds.add(identifier);
  }

  const playbookRows = new Set<string>();
  for (const page of bundle.pagePlaybooks) {
    for (const section of page.sections) {
      const key = [
        page.pageType,
        page.conversionRole,
        section.sectionType,
        section.sectionOrderMin,
        section.sectionOrderMax,
      ].join(':');
      if (playbookRows.has(key)) {
        finding({
          severity: 'ERROR',
          category: 'DUPLICATE',
          code: 'DUPLICATE_PAGE_PLAYBOOK_SECTION',
          message: 'Page playbook section rows must be unique.',
          blocksApproval: true,
          pageType: page.pageType,
          sectionType: section.sectionType,
        }, findings);
      }
      playbookRows.add(key);
    }
  }
}

function detectProvenance(
  bundle: KnowledgeImportBundle,
  findings: KnowledgeImportFinding[],
) {
  const sourceIds = new Set(bundle.sources.map(source => source.sourceId));
  const verify = (
    references: readonly string[],
    target: { ruleId?: string; pageType?: KnowledgePagePlaybook['pageType'] },
  ) => {
    for (const sourceId of references) {
      if (!sourceIds.has(sourceId)) {
        finding({
          severity: 'ERROR',
          category: 'PROVENANCE',
          code: 'CLAIMED_SOURCE_REFERENCE_MISSING',
          message: 'A claimed source identifier does not exist in this pack.',
          blocksApproval: true,
          sourceId,
          ...target,
        }, findings);
      }
    }
  };
  for (const rule of bundle.rules) {
    if (rule.sourceIds.length === 0) {
      finding({
        severity: 'REVIEW',
        category: 'PROVENANCE',
        code: 'RULE_SOURCE_SUPPORT_MISSING',
        message: 'A substantive rule has no source provenance.',
        blocksApproval: true,
        ruleId: rule.ruleId,
      }, findings);
    }
    verify([...rule.sourceIds, ...rule.verificationSourceIds], {
      ruleId: rule.ruleId,
    });
    if (rule.supportType === 'INFERRED') {
      finding({
        severity: 'REVIEW',
        category: 'PROVENANCE',
        code: 'INFERRED_RULE_REQUIRES_REVIEW',
        message: 'An inferred rule requires explicit agency review.',
        blocksApproval: true,
        ruleId: rule.ruleId,
      }, findings);
    }
  }
  for (const source of bundle.sources) {
    if (source.supportCapability === 'INFERRED') {
      finding({
        severity: 'REVIEW',
        category: 'PROVENANCE',
        code: 'INFERRED_SOURCE_REQUIRES_REVIEW',
        message: 'An inferred source relationship requires explicit review.',
        blocksApproval: true,
        sourceId: source.sourceId,
      }, findings);
    }
  }
  for (const playbook of bundle.pagePlaybooks) {
    for (const section of playbook.sections) {
      verify(section.sourceIds, { pageType: playbook.pageType });
      for (const ruleId of section.ruleIds) {
        if (!bundle.rules.some(rule => rule.ruleId === ruleId)) {
          finding({
            severity: 'ERROR',
            category: 'PLAYBOOK',
            code: 'PLAYBOOK_RULE_REFERENCE_MISSING',
            message: 'A page playbook references a rule outside this pack.',
            blocksApproval: true,
            ruleId,
            pageType: playbook.pageType,
            sectionType: section.sectionType,
          }, findings);
        }
      }
    }
  }
}

function quotedWordCount(value: string) {
  const matches = [
    ...value.matchAll(/"([^"]+)"/g),
    ...value.matchAll(/“([^”]+)”/g),
  ];
  return Math.max(
    0,
    ...matches.map(match =>
      match[1].trim().split(/\s+/).filter(Boolean).length),
  );
}

function detectCopyright(
  bundle: KnowledgeImportBundle,
  findings: KnowledgeImportFinding[],
) {
  for (const rule of bundle.rules) {
    const combined = [
      rule.principle,
      rule.whyItMatters,
      rule.implementationInstruction,
      rule.notes,
    ].filter(Boolean).join(' ');
    if (quotedWordCount(combined) > MAX_QUOTED_WORDS) {
      finding({
        severity: 'WARNING',
        category: 'COPYRIGHT',
        code: 'LONG_SOURCE_QUOTATION',
        message: 'A rule contains a quotation longer than the permitted review threshold.',
        blocksApproval: true,
        ruleId: rule.ruleId,
      }, findings);
    }
    if (combined.length > 8_000
      || /\b(chapter\s+\d+|full\s+(?:book|chapter|source)\s+text)\b/i.test(combined)) {
      finding({
        severity: 'ERROR',
        category: 'COPYRIGHT',
        code: 'RAW_SOURCE_CONTENT_PROHIBITED',
        message: 'Knowledge records may contain only distilled original guidance.',
        blocksApproval: true,
        ruleId: rule.ruleId,
      }, findings);
    }
  }
}

function containsPositiveInstruction(
  value: string,
  positive: RegExp,
): boolean {
  const lower = value.toLowerCase();
  if (/\b(do not|must not|never|prohibit|avoid)\b/.test(lower)) return false;
  return positive.test(lower);
}

function detectSemanticConflicts(
  bundle: KnowledgeImportBundle,
  findings: KnowledgeImportFinding[],
  conflicts: KnowledgeConflict[],
) {
  for (const playbook of bundle.pagePlaybooks) {
    const sectionRequirements = new Map<string, Set<string>>();
    for (const section of playbook.sections) {
      const requirements = sectionRequirements.get(section.sectionType)
        ?? new Set<string>();
      requirements.add(section.requirement);
      sectionRequirements.set(section.sectionType, requirements);

      const ctas = [
        ...section.allowedPrimaryCtaTypes,
        ...section.allowedSecondaryCtaTypes,
      ];
      if (
        (playbook.pageType === 'BOOKING'
          || playbook.pageType === 'SERVICE_DETAIL')
        && section.requirement === 'REQUIRED'
        && !ctas.includes('KS_OS_BOOKING')
      ) {
        finding({
          severity: 'ERROR',
          category: 'BOOKING',
          code: 'NATIVE_BOOKING_CTA_REQUIRED',
          message: 'Booking conversion playbooks require a native KS OS booking action.',
          blocksApproval: true,
          pageType: playbook.pageType,
          sectionType: section.sectionType,
        }, findings);
      }
      const bookingText = section.bookingInstruction ?? '';
      if (containsPositiveInstruction(
        bookingText,
        /\b(external booking|calendly|external calendar)\b/,
      )) {
        conflict({
          conflictType: 'EXTERNAL_BOOKING',
          severity: 'CRITICAL',
          summary: 'A playbook recommends an external booking destination.',
          ruleIds: section.ruleIds,
          pageType: playbook.pageType,
          sectionType: section.sectionType,
          resolved: false,
        }, conflicts);
      }
    }
    for (const [sectionType, requirements] of sectionRequirements) {
      if (requirements.has('PROHIBITED')
        && [...requirements].some(value => value !== 'PROHIBITED')) {
        conflict({
          conflictType: 'REQUIRED_PROHIBITED_SECTION',
          severity: 'CRITICAL',
          summary: 'A page playbook both prohibits and requests the same section.',
          ruleIds: [],
          pageType: playbook.pageType,
          sectionType: sectionType as KnowledgeConflict['sectionType'],
          resolved: false,
        }, conflicts);
      }
    }
  }

  for (const rule of bundle.rules) {
    const positiveText = `${rule.principle} ${rule.implementationInstruction}`;
    if (containsPositiveInstruction(
      positiveText,
      /\b(external booking|calendly|external calendar)\b/,
    )) {
      finding({
        severity: 'ERROR',
        category: 'BOOKING',
        code: 'EXTERNAL_BOOKING_BEHAVIOUR_PROHIBITED',
        message: 'Knowledge rules cannot replace native KS OS booking.',
        blocksApproval: true,
        ruleId: rule.ruleId,
      }, findings);
      conflict({
        conflictType: 'EXTERNAL_BOOKING',
        severity: 'CRITICAL',
        summary: 'A rule recommends an external booking destination.',
        ruleIds: [rule.ruleId],
        resolved: false,
      }, conflicts);
    }
    if (containsPositiveInstruction(
      positiveText,
      /\b(?:invent|fabricate|create)\s+(?:a\s+|the\s+)?(?:location|address)\b/,
    )) {
      finding({
        severity: 'ERROR',
        category: 'BUSINESS_DATA',
        code: 'FABRICATED_LOCATION_CONTENT_PROHIBITED',
        message: 'Location content must be based on verified business data.',
        blocksApproval: true,
        ruleId: rule.ruleId,
      }, findings);
    }
    if (containsPositiveInstruction(
      positiveText,
      /\b(?:unsupported|unverified|invented|fabricated)\s+claims?\b|\bclaims?\s+without\s+evidence\b/,
    )) {
      finding({
        severity: 'ERROR',
        category: 'BUSINESS_DATA',
        code: 'UNSUPPORTED_CLAIM_PROHIBITED',
        message: 'Claims require verified business data or evidence.',
        blocksApproval: true,
        ruleId: rule.ruleId,
      }, findings);
      conflict({
        conflictType: 'UNSUPPORTED_CLAIM',
        severity: 'CRITICAL',
        summary: 'A rule requests a claim without verified evidence.',
        ruleIds: [rule.ruleId],
        resolved: false,
      }, conflicts);
    }
    if (
      rule.domain === 'ACCESSIBILITY'
      && containsPositiveInstruction(
        positiveText,
        /\b(?:continuous|autoplay|mandatory|unrestricted)\s+animation\b/,
      )
    ) {
      conflict({
        conflictType: 'ACCESSIBILITY_ANIMATION',
        severity: 'CRITICAL',
        summary: 'Animation guidance may conflict with accessibility requirements.',
        ruleIds: [rule.ruleId],
        resolved: false,
      }, conflicts);
    }
    if (
      ['CONTENT_SEO', 'TECHNICAL_SEO', 'LOCAL_SEO'].includes(rule.domain)
      && containsPositiveInstruction(
        positiveText,
        /\b(?:thin|duplicate)\s+(?:page|content)|mass[- ]produce\s+pages\b/,
      )
    ) {
      conflict({
        conflictType: 'SEO_THIN_CONTENT',
        severity: 'HIGH',
        summary: 'SEO guidance may encourage duplicate or thin pages.',
        ruleIds: [rule.ruleId],
        resolved: false,
      }, conflicts);
    }
    if (
      rule.domain === 'COPYWRITING'
      && containsPositiveInstruction(
        positiveText,
        /\b(?:fake urgency|false scarcity|invented deadline)\b/,
      )
    ) {
      conflict({
        conflictType: 'URGENCY_TRUST',
        severity: 'HIGH',
        summary: 'Urgency guidance may conflict with trust and evidence rules.',
        ruleIds: [rule.ruleId],
        resolved: false,
      }, conflicts);
    }
  }
}

function detectGovernance(
  bundle: KnowledgeImportBundle,
  findings: KnowledgeImportFinding[],
) {
  for (const requiredPageType of REQUIRED_LAUNCH_PAGE_TYPES) {
    if (!bundle.pagePlaybooks.some(playbook =>
      playbook.pageType === requiredPageType)) {
      finding({
        severity: 'ERROR',
        category: 'GOVERNANCE',
        code: 'REQUIRED_LAUNCH_PLAYBOOK_MISSING',
        message: 'A required launch page type has no page playbook.',
        blocksApproval: true,
        pageType: requiredPageType,
      }, findings);
    }
  }
  for (const rule of bundle.rules) {
    if (
      rule.publicationEffect === 'BLOCK'
      && !['PLATFORM', 'OFFICIAL_STANDARD', 'OFFICIAL_DOCUMENTATION', 'EXPERT_APPROVED']
        .includes(rule.enforcementAuthority)
    ) {
      finding({
        severity: 'ERROR',
        category: 'GOVERNANCE',
        code: 'BLOCKING_AUTHORITY_INVALID',
        message: 'Advisory rules cannot become publication blockers.',
        blocksApproval: true,
        ruleId: rule.ruleId,
      }, findings);
    }
  }
}

export function validateKnowledgePack(
  input: KnowledgeImportBundle,
): ReturnType<typeof KnowledgeValidationReportSchema.parse> {
  const bundle = KnowledgeImportBundleSchema.parse(input);
  const findings: KnowledgeImportFinding[] = [];
  const conflicts: KnowledgeConflict[] = [];
  detectDuplicates(bundle, findings, conflicts);
  detectProvenance(bundle, findings);
  detectCopyright(bundle, findings);
  detectSemanticConflicts(bundle, findings, conflicts);
  detectGovernance(bundle, findings);

  findings.sort((left, right) =>
    Number(right.blocksApproval) - Number(left.blocksApproval)
    || left.severity.localeCompare(right.severity)
    || left.code.localeCompare(right.code)
    || (left.ruleId ?? '').localeCompare(right.ruleId ?? ''));
  conflicts.sort((left, right) =>
    left.severity.localeCompare(right.severity)
    || left.conflictType.localeCompare(right.conflictType)
    || left.ruleIds.join(':').localeCompare(right.ruleIds.join(':')));
  const blocking = findings.some(entry => entry.blocksApproval)
    || conflicts.some(entry => !entry.resolved && entry.severity === 'CRITICAL');
  const report = {
    valid: !findings.some(entry => entry.severity === 'ERROR'),
    readyForApproval: !blocking,
    findings,
    conflicts,
    counts: {
      sources: bundle.sources.length,
      rules: bundle.rules.length,
      pagePlaybooks: bundle.pagePlaybooks.length,
      sectionPlaybooks: bundle.pagePlaybooks.reduce(
        (total, page) => total + page.sections.length,
        0,
      ),
      rejectedRules: bundle.rejectedRules.length,
    },
    contentDigest: contentDigest({
      schemaVersion: bundle.pack.schemaVersion,
      sources: [...bundle.sources].sort((left, right) =>
        left.sourceId.localeCompare(right.sourceId)),
      rules: [...bundle.rules].sort((left, right) =>
        left.ruleId.localeCompare(right.ruleId)),
      pagePlaybooks: bundle.pagePlaybooks
        .map(playbook => ({
          ...playbook,
          sections: [...playbook.sections].sort((left, right) =>
            left.sectionOrderMin - right.sectionOrderMin
            || left.sectionOrderMax - right.sectionOrderMax
            || left.sectionType.localeCompare(right.sectionType)),
        }))
        .sort((left, right) =>
          left.pageType.localeCompare(right.pageType)
          || left.conversionRole.localeCompare(right.conversionRole)),
      rejectedRules: [...bundle.rejectedRules].sort((left, right) =>
        left.ruleId.localeCompare(right.ruleId)),
    }),
  };
  return KnowledgeValidationReportSchema.parse(report);
}

export function publicationEffectSummary(rules: readonly KnowledgeRule[]) {
  return {
    blockers: rules.filter(rule => rule.publicationEffect === 'BLOCK').length,
    warnings: rules.filter(rule => rule.publicationEffect === 'WARNING').length,
    recommendations: rules.filter(
      rule => rule.publicationEffect === 'RECOMMENDATION',
    ).length,
    /**
     * Phase 15.6B reports effects only. Publication enforcement remains
     * explicitly deferred to Phase 15.8.
     */
    enforcementApplied: false as const,
  };
}
