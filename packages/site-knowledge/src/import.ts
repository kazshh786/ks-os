import { z } from 'zod';
import {
  KnowledgeCtaTypeSchema,
  KnowledgeDomainSchema,
  KnowledgeEnforcementAuthoritySchema,
  KnowledgeEvidenceAuthoritySchema,
  KnowledgeImportBundleSchema,
  KnowledgePagePlaybookSchema,
  KnowledgePlaybookRequirementSchema,
  KnowledgePrioritySchema,
  KnowledgePublicationEffectSchema,
  KnowledgeRuleSchema,
  KnowledgeRuleScopeSchema,
  KnowledgeSourceSchema,
  KnowledgeSourceSupportSchema,
  KnowledgeSourceTopicSchema,
  KnowledgeSourceTypeSchema,
  KnowledgeTemporalClassSchema,
  KnowledgeValidationTypeSchema,
  RejectedKnowledgeRuleSchema,
  SiteConversionRoleSchema,
  SitePageTypeSchema,
  SiteSectionTypeSchema,
  type KnowledgeImportBundle,
  type KnowledgePagePlaybook,
  type KnowledgeRule,
  type KnowledgeSectionPlaybook,
  type KnowledgeSource,
} from './contracts.js';
import {
  contentDigest,
  normaliseEnumValue,
  normaliseList,
  normaliseOptional,
  normaliseWhitespace,
  sha256,
} from './normalization.js';

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_CELL_CHARACTERS = 20_000;
const MAX_ROWS_PER_DATASET = 20_000;

type CsvRow = Record<string, string>;

export interface KnowledgeCsvDatasetTexts {
  sourceProvenance: string;
  platformRules: string;
  expertKnowledgeRules: string;
  pageSectionPlaybooks: string;
  rejectedOrPendingRules: string;
}

export interface KnowledgePackMetadata {
  name: string;
  description?: string;
  semanticVersion: string;
  intendedScope: 'PUBLIC_SITE';
}

export class KnowledgeImportError extends Error {
  constructor(
    readonly code: string,
    readonly dataset: string,
    readonly rowNumber?: number,
    message = 'The knowledge import is invalid.',
  ) {
    super(message);
    this.name = 'KnowledgeImportError';
  }
}

function assertSafeText(dataset: string, text: string) {
  if (Buffer.byteLength(text, 'utf8') > MAX_IMPORT_BYTES) {
    throw new KnowledgeImportError(
      'KNOWLEDGE_IMPORT_FILE_TOO_LARGE',
      dataset,
      undefined,
      `${dataset} exceeds the 5 MB import limit.`,
    );
  }
  if (text.includes('\u0000')) {
    throw new KnowledgeImportError(
      'KNOWLEDGE_IMPORT_BINARY_CONTENT',
      dataset,
      undefined,
      `${dataset} contains binary data.`,
    );
  }
  const suspiciousControls = [...text].filter(character => {
    const code = character.charCodeAt(0);
    return code < 32 && !['\r', '\n', '\t'].includes(character);
  }).length;
  if (suspiciousControls > 0) {
    throw new KnowledgeImportError(
      'KNOWLEDGE_IMPORT_UNSUPPORTED_BINARY_DATA',
      dataset,
      undefined,
      `${dataset} contains unsupported control bytes.`,
    );
  }
}

export function parseCsvRecords(dataset: string, text: string): CsvRow[] {
  assertSafeText(dataset, text);
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
    } else if (character === '"') {
      if (cell.length > 0) {
        throw new KnowledgeImportError(
          'KNOWLEDGE_IMPORT_CSV_QUOTE_INVALID',
          dataset,
          records.length + 1,
        );
      }
      quoted = true;
    } else if (character === ',') {
      record.push(cell);
      cell = '';
    } else if (character === '\n') {
      record.push(cell.replace(/\r$/, ''));
      records.push(record);
      record = [];
      cell = '';
    } else {
      cell += character;
    }
    if (cell.length > MAX_CELL_CHARACTERS) {
      throw new KnowledgeImportError(
        'KNOWLEDGE_IMPORT_CELL_TOO_LARGE',
        dataset,
        records.length + 1,
        'A CSV cell exceeds the safe distilled-content limit.',
      );
    }
  }
  if (quoted) {
    throw new KnowledgeImportError(
      'KNOWLEDGE_IMPORT_CSV_UNTERMINATED_QUOTE',
      dataset,
      records.length + 1,
    );
  }
  if (cell.length || record.length) {
    record.push(cell.replace(/\r$/, ''));
    records.push(record);
  }
  const nonEmpty = records.filter(row => row.some(value => value.trim().length));
  if (nonEmpty.length === 0) {
    throw new KnowledgeImportError('KNOWLEDGE_IMPORT_EMPTY', dataset);
  }
  if (nonEmpty.length - 1 > MAX_ROWS_PER_DATASET) {
    throw new KnowledgeImportError('KNOWLEDGE_IMPORT_TOO_MANY_ROWS', dataset);
  }
  const [rawHeader, ...data] = nonEmpty;
  const header = rawHeader.map(value => normaliseWhitespace(value).toLowerCase());
  if (header.some((value, index) => !value || header.indexOf(value) !== index)) {
    throw new KnowledgeImportError(
      'KNOWLEDGE_IMPORT_HEADER_INVALID',
      dataset,
      1,
      'CSV headers must be present and unique.',
    );
  }
  return data.map((values, index) => {
    if (values.length !== header.length) {
      throw new KnowledgeImportError(
        'KNOWLEDGE_IMPORT_COLUMN_COUNT_INVALID',
        dataset,
        index + 2,
      );
    }
    return Object.fromEntries(
      header.map((key, valueIndex) => [key, values[valueIndex] ?? '']),
    );
  });
}

function assertHeaders(
  dataset: string,
  rows: CsvRow[],
  expected: readonly string[],
) {
  const actual = Object.keys(rows[0] ?? {});
  const missing = expected.filter(header => !actual.includes(header));
  const unknown = actual.filter(header => !expected.includes(header));
  if (missing.length || unknown.length) {
    throw new KnowledgeImportError(
      'KNOWLEDGE_IMPORT_COLUMNS_INVALID',
      dataset,
      1,
      `${dataset} has missing or unsupported columns.`,
    );
  }
}

function parseControlled<T extends z.ZodTypeAny>(
  schema: T,
  value: string,
  dataset: string,
  rowNumber: number,
  field: string,
): z.infer<T> {
  const parsed = schema.safeParse(normaliseEnumValue(value));
  if (!parsed.success) {
    throw new KnowledgeImportError(
      'KNOWLEDGE_IMPORT_CONTROLLED_VALUE_INVALID',
      dataset,
      rowNumber,
      `${dataset} row ${rowNumber} has an unsupported ${field}.`,
    );
  }
  return parsed.data;
}

function parseControlledList<T extends z.ZodTypeAny>(
  schema: T,
  value: string,
  dataset: string,
  rowNumber: number,
  field: string,
): Array<z.infer<T>> {
  return normaliseList(value).map(entry =>
    parseControlled(schema, entry, dataset, rowNumber, field));
}

function parseConfidence(value: string, dataset: string, rowNumber: number) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new KnowledgeImportError(
      'KNOWLEDGE_IMPORT_CONFIDENCE_INVALID',
      dataset,
      rowNumber,
      `${dataset} row ${rowNumber} has invalid confidence.`,
    );
  }
  return confidence;
}

function parseInteger(
  value: string,
  dataset: string,
  rowNumber: number,
  field: string,
) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new KnowledgeImportError(
      'KNOWLEDGE_IMPORT_INTEGER_INVALID',
      dataset,
      rowNumber,
      `${dataset} row ${rowNumber} has invalid ${field}.`,
    );
  }
  return parsed;
}

function required(value: string, dataset: string, rowNumber: number, field: string) {
  const parsed = normaliseWhitespace(value);
  if (!parsed) {
    throw new KnowledgeImportError(
      'KNOWLEDGE_IMPORT_REQUIRED_VALUE_MISSING',
      dataset,
      rowNumber,
      `${dataset} row ${rowNumber} requires ${field}.`,
    );
  }
  return parsed;
}

const SOURCE_COLUMNS = [
  'source_id', 'source_title', 'author', 'edition_or_version', 'source_type',
  'topic_domains', 'evidence_authority', 'support_capability', 'temporal_class',
  'citation_locations', 'copyright_notes', 'verified_at', 'review_due_at',
  'notes',
] as const;

const PLATFORM_RULE_COLUMNS = [
  'rule_id', 'rule_name', 'rule_scope', 'domain', 'subcategory', 'principle',
  'implementation_instruction', 'applicable_page_types',
  'applicable_section_types', 'conversion_roles', 'priority',
  'validation_type', 'publication_effect', 'enforcement_authority',
  'required_business_data', 'prohibited_behaviour',
  'deterministic_test_description', 'source_ids', 'verification_sources',
  'temporal_class', 'verified_at', 'review_due_at', 'confidence', 'notes',
] as const;

const EXPERT_RULE_COLUMNS = [
  'rule_id', 'rule_name', 'rule_scope', 'domain', 'subcategory', 'principle',
  'why_it_matters', 'implementation_instruction', 'applicable_page_types',
  'applicable_section_types', 'conversion_roles', 'priority',
  'validation_type', 'publication_effect', 'enforcement_authority',
  'required_business_data', 'prohibited_behaviour', 'anti_pattern',
  'ai_review_instruction', 'human_review_instruction', 'source_ids',
  'support_type', 'temporal_class', 'verification_sources', 'verified_at',
  'review_due_at', 'confidence', 'notes',
] as const;

const PLAYBOOK_COLUMNS = [
  'page_type', 'conversion_role', 'section_type', 'section_order_min',
  'section_order_max', 'required_or_optional', 'user_intent',
  'business_objective', 'section_purpose', 'required_business_data',
  'copy_instruction', 'seo_instruction', 'trust_instruction',
  'booking_instruction', 'mobile_instruction', 'accessibility_instruction',
  'allowed_primary_cta_types', 'allowed_secondary_cta_types',
  'blocking_conditions', 'common_anti_patterns', 'rule_ids', 'source_ids',
  'confidence', 'notes',
] as const;

const REJECTED_COLUMNS = ['rule_id', 'rule_name', 'rejection_reason'] as const;

function parseSource(row: CsvRow, rowNumber: number): KnowledgeSource {
  const dataset = 'source_provenance';
  const valueWithoutDigest = {
    sourceId: required(row.source_id, dataset, rowNumber, 'source_id'),
    sourceTitle: required(row.source_title, dataset, rowNumber, 'source_title'),
    author: normaliseOptional(row.author),
    editionOrVersion: normaliseOptional(row.edition_or_version),
    sourceType: parseControlled(
      KnowledgeSourceTypeSchema,
      row.source_type,
      dataset,
      rowNumber,
      'source_type',
    ),
    topicDomains: parseControlledList(
      KnowledgeSourceTopicSchema,
      row.topic_domains,
      dataset,
      rowNumber,
      'topic_domains',
    ),
    evidenceAuthority: parseControlled(
      KnowledgeEvidenceAuthoritySchema,
      row.evidence_authority,
      dataset,
      rowNumber,
      'evidence_authority',
    ),
    supportCapability: parseControlled(
      KnowledgeSourceSupportSchema,
      row.support_capability,
      dataset,
      rowNumber,
      'support_capability',
    ),
    temporalClass: parseControlled(
      KnowledgeTemporalClassSchema,
      row.temporal_class,
      dataset,
      rowNumber,
      'temporal_class',
    ),
    citationLocations: normaliseList(row.citation_locations),
    copyrightNotes: normaliseOptional(row.copyright_notes),
    verifiedAt: normaliseOptional(row.verified_at),
    reviewDueAt: normaliseOptional(row.review_due_at),
    reviewNotes: normaliseOptional(row.notes),
  };
  return KnowledgeSourceSchema.parse({
    ...valueWithoutDigest,
    contentDigest: contentDigest(valueWithoutDigest),
  });
}

function parseRule(
  row: CsvRow,
  rowNumber: number,
  dataset: 'platform_rules' | 'expert_knowledge_rules',
): KnowledgeRule {
  const valueWithoutDigest = {
    ruleId: required(row.rule_id, dataset, rowNumber, 'rule_id'),
    ruleName: required(row.rule_name, dataset, rowNumber, 'rule_name'),
    ruleScope: parseControlled(
      KnowledgeRuleScopeSchema,
      row.rule_scope,
      dataset,
      rowNumber,
      'rule_scope',
    ),
    domain: parseControlled(
      KnowledgeDomainSchema,
      row.domain,
      dataset,
      rowNumber,
      'domain',
    ),
    subcategory: required(row.subcategory, dataset, rowNumber, 'subcategory'),
    principle: required(row.principle, dataset, rowNumber, 'principle'),
    whyItMatters: normaliseOptional(row.why_it_matters),
    implementationInstruction: required(
      row.implementation_instruction,
      dataset,
      rowNumber,
      'implementation_instruction',
    ),
    applicablePageTypes: parseControlledList(
      SitePageTypeSchema,
      row.applicable_page_types,
      dataset,
      rowNumber,
      'applicable_page_types',
    ),
    applicableSectionTypes: parseControlledList(
      SiteSectionTypeSchema,
      row.applicable_section_types,
      dataset,
      rowNumber,
      'applicable_section_types',
    ),
    conversionRoles: parseControlledList(
      SiteConversionRoleSchema,
      row.conversion_roles,
      dataset,
      rowNumber,
      'conversion_roles',
    ),
    priority: parseControlled(
      KnowledgePrioritySchema,
      row.priority,
      dataset,
      rowNumber,
      'priority',
    ),
    validationType: parseControlled(
      KnowledgeValidationTypeSchema,
      row.validation_type,
      dataset,
      rowNumber,
      'validation_type',
    ),
    publicationEffect: parseControlled(
      KnowledgePublicationEffectSchema,
      row.publication_effect,
      dataset,
      rowNumber,
      'publication_effect',
    ),
    enforcementAuthority: parseControlled(
      KnowledgeEnforcementAuthoritySchema,
      row.enforcement_authority,
      dataset,
      rowNumber,
      'enforcement_authority',
    ),
    requiredBusinessData: normaliseList(row.required_business_data),
    prohibitedBehaviour: normaliseOptional(row.prohibited_behaviour),
    antiPattern: normaliseOptional(row.anti_pattern),
    deterministicTestDescription: normaliseOptional(
      row.deterministic_test_description,
    ),
    aiReviewInstruction: normaliseOptional(row.ai_review_instruction),
    humanReviewInstruction: normaliseOptional(row.human_review_instruction),
    sourceIds: normaliseList(row.source_ids),
    supportType: row.support_type
      ? parseControlled(
        KnowledgeSourceSupportSchema,
        row.support_type,
        dataset,
        rowNumber,
        'support_type',
      )
      : undefined,
    temporalClass: parseControlled(
      KnowledgeTemporalClassSchema,
      row.temporal_class,
      dataset,
      rowNumber,
      'temporal_class',
    ),
    verificationSourceIds: normaliseList(row.verification_sources),
    verifiedAt: normaliseOptional(row.verified_at),
    reviewDueAt: normaliseOptional(row.review_due_at),
    confidence: parseConfidence(row.confidence, dataset, rowNumber),
    notes: normaliseOptional(row.notes),
    status: 'ACCEPTED' as const,
  };
  return KnowledgeRuleSchema.parse({
    ...valueWithoutDigest,
    contentDigest: contentDigest(valueWithoutDigest),
  });
}

function parseSectionPlaybook(
  row: CsvRow,
  rowNumber: number,
): {
  pageType: z.infer<typeof SitePageTypeSchema>;
  conversionRole: z.infer<typeof SiteConversionRoleSchema>;
  section: KnowledgeSectionPlaybook;
} {
  const dataset = 'page_section_playbooks';
  const valueWithoutDigest = {
    sectionType: parseControlled(
      SiteSectionTypeSchema,
      row.section_type,
      dataset,
      rowNumber,
      'section_type',
    ),
    sectionOrderMin: parseInteger(
      row.section_order_min,
      dataset,
      rowNumber,
      'section_order_min',
    ),
    sectionOrderMax: parseInteger(
      row.section_order_max,
      dataset,
      rowNumber,
      'section_order_max',
    ),
    requirement: parseControlled(
      KnowledgePlaybookRequirementSchema,
      row.required_or_optional,
      dataset,
      rowNumber,
      'required_or_optional',
    ),
    userIntent: required(row.user_intent, dataset, rowNumber, 'user_intent'),
    businessObjective: normaliseOptional(row.business_objective),
    sectionPurpose: required(
      row.section_purpose,
      dataset,
      rowNumber,
      'section_purpose',
    ),
    requiredBusinessData: normaliseList(row.required_business_data),
    copyInstruction: normaliseOptional(row.copy_instruction),
    seoInstruction: normaliseOptional(row.seo_instruction),
    trustInstruction: normaliseOptional(row.trust_instruction),
    bookingInstruction: normaliseOptional(row.booking_instruction),
    mobileInstruction: normaliseOptional(row.mobile_instruction),
    accessibilityInstruction: normaliseOptional(row.accessibility_instruction),
    allowedPrimaryCtaTypes: parseControlledList(
      KnowledgeCtaTypeSchema,
      row.allowed_primary_cta_types,
      dataset,
      rowNumber,
      'allowed_primary_cta_types',
    ),
    allowedSecondaryCtaTypes: parseControlledList(
      KnowledgeCtaTypeSchema,
      row.allowed_secondary_cta_types,
      dataset,
      rowNumber,
      'allowed_secondary_cta_types',
    ),
    blockingConditions: normaliseList(row.blocking_conditions),
    commonAntiPatterns: normaliseList(row.common_anti_patterns),
    ruleIds: normaliseList(row.rule_ids),
    sourceIds: normaliseList(row.source_ids),
    confidence: parseConfidence(row.confidence, dataset, rowNumber),
    notes: normaliseOptional(row.notes),
  };
  const section = {
    ...valueWithoutDigest,
    contentDigest: contentDigest(valueWithoutDigest),
  };
  return {
    pageType: parseControlled(
      SitePageTypeSchema,
      row.page_type,
      dataset,
      rowNumber,
      'page_type',
    ),
    conversionRole: parseControlled(
      SiteConversionRoleSchema,
      row.conversion_role,
      dataset,
      rowNumber,
      'conversion_role',
    ),
    section: KnowledgePagePlaybookSchema.shape.sections.element.parse(section),
  };
}

function groupPagePlaybooks(
  sections: ReturnType<typeof parseSectionPlaybook>[],
): KnowledgePagePlaybook[] {
  const grouped = new Map<string, {
    pageType: z.infer<typeof SitePageTypeSchema>;
    conversionRole: z.infer<typeof SiteConversionRoleSchema>;
    sections: KnowledgeSectionPlaybook[];
  }>();
  for (const row of sections) {
    const key = `${row.pageType}:${row.conversionRole}`;
    const group = grouped.get(key) ?? {
      pageType: row.pageType,
      conversionRole: row.conversionRole,
      sections: [],
    };
    group.sections.push(row.section);
    grouped.set(key, group);
  }
  return [...grouped.values()]
    .map(group => {
      const orderedSections = [...group.sections].sort((left, right) =>
        left.sectionOrderMin - right.sectionOrderMin
        || left.sectionOrderMax - right.sectionOrderMax
        || left.sectionType.localeCompare(right.sectionType));
      return KnowledgePagePlaybookSchema.parse({
        ...group,
        sections: orderedSections,
        contentDigest: contentDigest({
          pageType: group.pageType,
          conversionRole: group.conversionRole,
          sections: orderedSections,
        }),
      });
    })
    .sort((left, right) =>
      left.pageType.localeCompare(right.pageType)
      || left.conversionRole.localeCompare(right.conversionRole));
}

export function parseKnowledgeCsvBundle(
  metadata: KnowledgePackMetadata,
  datasets: KnowledgeCsvDatasetTexts,
): KnowledgeImportBundle {
  const sources = parseCsvRecords('source_provenance', datasets.sourceProvenance);
  const platformRules = parseCsvRecords('platform_rules', datasets.platformRules);
  const expertRules = parseCsvRecords(
    'expert_knowledge_rules',
    datasets.expertKnowledgeRules,
  );
  const playbookRows = parseCsvRecords(
    'page_section_playbooks',
    datasets.pageSectionPlaybooks,
  );
  const rejectedRows = parseCsvRecords(
    'rejected_or_pending_rules',
    datasets.rejectedOrPendingRules,
  );
  assertHeaders('source_provenance', sources, SOURCE_COLUMNS);
  assertHeaders('platform_rules', platformRules, PLATFORM_RULE_COLUMNS);
  assertHeaders('expert_knowledge_rules', expertRules, EXPERT_RULE_COLUMNS);
  assertHeaders('page_section_playbooks', playbookRows, PLAYBOOK_COLUMNS);
  assertHeaders('rejected_or_pending_rules', rejectedRows, REJECTED_COLUMNS);

  const parsedSources = sources.map((row, index) => parseSource(row, index + 2));
  const parsedRules = [
    ...platformRules.map((row, index) =>
      parseRule(row, index + 2, 'platform_rules')),
    ...expertRules.map((row, index) =>
      parseRule(row, index + 2, 'expert_knowledge_rules')),
  ];
  const pagePlaybooks = groupPagePlaybooks(
    playbookRows.map((row, index) => parseSectionPlaybook(row, index + 2)),
  );
  const rejectedRules = rejectedRows.map((row, index) =>
    RejectedKnowledgeRuleSchema.parse({
      ruleId: required(
        row.rule_id,
        'rejected_or_pending_rules',
        index + 2,
        'rule_id',
      ),
      ruleName: required(
        row.rule_name,
        'rejected_or_pending_rules',
        index + 2,
        'rule_name',
      ),
      rejectionReason: required(
        row.rejection_reason,
        'rejected_or_pending_rules',
        index + 2,
        'rejection_reason',
      ),
    }));
  const sourceDigest = sha256([
    ['expert_knowledge_rules_v3.csv', datasets.expertKnowledgeRules],
    ['page_section_playbooks_v3.csv', datasets.pageSectionPlaybooks],
    ['platform_rules_v3.csv', datasets.platformRules],
    ['rejected_or_pending_rules_v3.csv', datasets.rejectedOrPendingRules],
    ['source_provenance_v3.csv', datasets.sourceProvenance],
  ].map(([name, text]) =>
    `${name}\n${text.replace(/\r\n?/g, '\n')}`).join('\n--dataset--\n'));
  return KnowledgeImportBundleSchema.parse({
    pack: {
      ...metadata,
      schemaVersion: 1,
    },
    sources: parsedSources,
    rules: parsedRules,
    pagePlaybooks,
    rejectedRules,
    sourceDigest,
  });
}

export function parseKnowledgeJsonBundle(text: string): KnowledgeImportBundle {
  assertSafeText('knowledge_json', text);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new KnowledgeImportError(
      'KNOWLEDGE_IMPORT_JSON_INVALID',
      'knowledge_json',
    );
  }
  return KnowledgeImportBundleSchema.parse(value);
}
