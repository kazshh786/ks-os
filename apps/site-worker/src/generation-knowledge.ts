import { and, asc, eq } from 'drizzle-orm';
import {
  getDatabase,
  knowledgePacks,
  knowledgePagePlaybooks,
  knowledgeRejectedRules,
  knowledgeRuleConversionRoles,
  knowledgeRulePageTypes,
  knowledgeRuleSectionTypes,
  knowledgeRules,
  knowledgeRuleSources,
  knowledgeSectionPlaybooks,
  knowledgeSources,
} from '@ks-os/database';
import {
  KnowledgeImportBundleSchema,
  prepareSiteGenerationKnowledgeContext,
  type SelectableKnowledgePack,
} from '@ks-os/site-knowledge';
import {
  SiteJobExecutionError,
  isRetryableDatabaseError,
} from '@ks-os/site-jobs';
import type { SiteConversionRole, SitePageType } from '@ks-os/contracts';
import type { SiteSectionType } from '@ks-os/site-schema';

type Database = ReturnType<typeof getDatabase>;

function asStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

const defaultSleep = (milliseconds: number) =>
  new Promise<void>(resolve => setTimeout(resolve, milliseconds));

export async function retryCoherentKnowledgeRead<T>(
  operation: () => Promise<T>,
  options: {
    maximumAttempts?: number;
    sleep?: (milliseconds: number) => Promise<void>;
    random?: () => number;
  } = {},
): Promise<T> {
  const maximumAttempts = options.maximumAttempts ?? 3;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  let latestError: unknown;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      latestError = error;
      if (!isRetryableDatabaseError(error)) throw error;
      if (attempt >= maximumAttempts) break;
      const baseDelay = attempt === 1 ? 100 : 300;
      const jitter = Math.round(Math.max(0, Math.min(1, random())) * 100);
      await sleep(baseDelay + jitter);
    }
  }
  const failure = new SiteJobExecutionError(
    'RETRYABLE_DATABASE_CONTENTION',
    'The website build was interrupted by a temporary database connection problem. Retry the build.',
  );
  Object.defineProperty(failure, 'cause', {
    value: latestError,
    enumerable: false,
    configurable: true,
  });
  throw failure;
}

/** Loads one coherent copy of the pinned database records. */
async function loadActiveGenerationKnowledgeOnce(
  database: Database,
  expectedReference: string,
): Promise<SelectableKnowledgePack> {
  const packs = await database.select().from(knowledgePacks).where(and(
    eq(knowledgePacks.publicReference, expectedReference),
    eq(knowledgePacks.intendedScope, 'PUBLIC_SITE'),
    eq(knowledgePacks.status, 'ACTIVE'),
  )).limit(2);
  if (packs.length !== 1 || !packs[0]?.sourceDigestSha256) {
    throw new Error('The pinned ACTIVE PUBLIC_SITE knowledge pack is unavailable.');
  }
  const pack = packs[0];
  const [
    sourceRows,
    ruleRows,
    pageTypeRows,
    sectionTypeRows,
    conversionRoleRows,
    sourceLinkRows,
    pageRows,
    sectionRows,
    rejectedRows,
  ] = await Promise.all([
    database.select().from(knowledgeSources)
      .where(eq(knowledgeSources.knowledgePackId, pack.id))
      .orderBy(asc(knowledgeSources.sourceId)),
    database.select().from(knowledgeRules)
      .where(eq(knowledgeRules.knowledgePackId, pack.id))
      .orderBy(asc(knowledgeRules.ruleId)),
    database.select().from(knowledgeRulePageTypes)
      .where(eq(knowledgeRulePageTypes.knowledgePackId, pack.id)),
    database.select().from(knowledgeRuleSectionTypes)
      .where(eq(knowledgeRuleSectionTypes.knowledgePackId, pack.id)),
    database.select().from(knowledgeRuleConversionRoles)
      .where(eq(knowledgeRuleConversionRoles.knowledgePackId, pack.id)),
    database.select({
      ruleId: knowledgeRuleSources.knowledgeRuleId,
      sourceIdentifier: knowledgeSources.sourceId,
      relationshipType: knowledgeRuleSources.relationshipType,
    }).from(knowledgeRuleSources)
      .innerJoin(knowledgeSources, eq(knowledgeRuleSources.knowledgeSourceId, knowledgeSources.id))
      .where(eq(knowledgeRuleSources.knowledgePackId, pack.id)),
    database.select().from(knowledgePagePlaybooks)
      .where(eq(knowledgePagePlaybooks.knowledgePackId, pack.id)),
    database.select().from(knowledgeSectionPlaybooks)
      .where(eq(knowledgeSectionPlaybooks.knowledgePackId, pack.id))
      .orderBy(asc(knowledgeSectionPlaybooks.sectionOrderMin), asc(knowledgeSectionPlaybooks.id)),
    database.select().from(knowledgeRejectedRules)
      .where(eq(knowledgeRejectedRules.knowledgePackId, pack.id))
      .orderBy(asc(knowledgeRejectedRules.ruleId)),
  ]);
  const bundle = KnowledgeImportBundleSchema.parse({
    pack: {
      name: pack.name,
      description: pack.description ?? undefined,
      semanticVersion: pack.semanticVersion,
      intendedScope: pack.intendedScope,
      schemaVersion: pack.schemaVersion,
    },
    sources: sourceRows.map(source => ({
      sourceId: source.sourceId,
      sourceTitle: source.sourceTitle,
      author: source.author ?? undefined,
      editionOrVersion: source.editionOrVersion ?? undefined,
      sourceType: source.sourceType,
      topicDomains: asStrings(source.topicDomainsJson),
      evidenceAuthority: source.evidenceAuthority,
      supportCapability: source.supportCapability,
      strengthOfSupport: source.strengthOfSupport ?? undefined,
      temporalClass: source.temporalClass,
      citationLocations: asStrings(source.citationLocationsJson),
      copyrightNotes: source.copyrightNotes ?? undefined,
      verifiedAt: source.verifiedAt ?? undefined,
      reviewDueAt: source.reviewDueAt ?? undefined,
      reviewNotes: source.reviewNotes ?? undefined,
      contentDigest: source.contentDigestSha256,
    })),
    rules: ruleRows.map(rule => ({
      ruleId: rule.ruleId,
      ruleName: rule.ruleName,
      ruleScope: rule.ruleScope,
      domain: rule.domain,
      subcategory: rule.subcategory,
      principle: rule.principle,
      whyItMatters: rule.whyItMatters ?? undefined,
      implementationInstruction: rule.implementationInstruction,
      applicablePageTypes: pageTypeRows.filter(row => row.knowledgeRuleId === rule.id).map(row => row.pageType),
      applicableSectionTypes: sectionTypeRows.filter(row => row.knowledgeRuleId === rule.id).map(row => row.sectionType),
      conversionRoles: conversionRoleRows.filter(row => row.knowledgeRuleId === rule.id).map(row => row.conversionRole),
      priority: rule.priority,
      validationType: rule.validationType,
      publicationEffect: rule.publicationEffect,
      enforcementAuthority: rule.enforcementAuthority,
      requiredBusinessData: asStrings(rule.requiredBusinessDataJson),
      prohibitedBehaviour: rule.prohibitedBehaviour ?? undefined,
      antiPattern: rule.antiPattern ?? undefined,
      deterministicTestDescription: rule.deterministicTestDescription ?? undefined,
      aiReviewInstruction: rule.aiReviewInstruction ?? undefined,
      humanReviewInstruction: rule.humanReviewInstruction ?? undefined,
      sourceIds: sourceLinkRows.filter(row =>
        row.ruleId === rule.id && row.relationshipType === 'SUPPORT')
        .map(row => row.sourceIdentifier),
      supportType: rule.supportType ?? undefined,
      temporalClass: rule.temporalClass,
      verificationSourceIds: asStrings(rule.verificationSourceIdsJson),
      verifiedAt: rule.verifiedAt ?? undefined,
      reviewDueAt: rule.reviewDueAt ?? undefined,
      confidence: Number(rule.confidence),
      notes: rule.notes ?? undefined,
      status: rule.status,
      contentDigest: rule.contentDigestSha256,
    })),
    pagePlaybooks: pageRows.map(page => ({
      pageType: page.pageType,
      conversionRole: page.conversionRole,
      sections: sectionRows.filter(section => section.pagePlaybookId === page.id).map(section => ({
        sectionType: section.sectionType,
        sectionOrderMin: section.sectionOrderMin,
        sectionOrderMax: section.sectionOrderMax,
        requirement: section.requirement,
        userIntent: section.userIntent,
        businessObjective: section.businessObjective ?? undefined,
        sectionPurpose: section.sectionPurpose,
        requiredBusinessData: asStrings(section.requiredBusinessDataJson),
        copyInstruction: section.copyInstruction ?? undefined,
        seoInstruction: section.seoInstruction ?? undefined,
        trustInstruction: section.trustInstruction ?? undefined,
        bookingInstruction: section.bookingInstruction ?? undefined,
        mobileInstruction: section.mobileInstruction ?? undefined,
        accessibilityInstruction: section.accessibilityInstruction ?? undefined,
        allowedPrimaryCtaTypes: asStrings(section.allowedPrimaryCtaTypesJson),
        allowedSecondaryCtaTypes: asStrings(section.allowedSecondaryCtaTypesJson),
        blockingConditions: asStrings(section.blockingConditionsJson),
        commonAntiPatterns: asStrings(section.commonAntiPatternsJson),
        ruleIds: asStrings(section.ruleIdsJson),
        sourceIds: asStrings(section.sourceIdsJson),
        confidence: Number(section.confidence),
        notes: section.notes ?? undefined,
        contentDigest: section.contentDigestSha256,
      })),
      contentDigest: page.contentDigestSha256,
    })),
    rejectedRules: rejectedRows.map(rule => ({
      ruleId: rule.ruleId,
      ruleName: rule.ruleName,
      rejectionReason: rule.rejectionReason,
    })),
    sourceDigest: pack.sourceDigestSha256,
  });
  return {
    reference: pack.publicReference,
    semanticVersion: pack.semanticVersion,
    schemaVersion: pack.schemaVersion,
    status: 'ACTIVE',
    bundle,
    conflicts: [],
  };
}

/**
 * Loads the pinned knowledge bundle. Any transient connection failure restarts
 * the whole read so callers never receive a bundle assembled from mixed reads.
 */
export async function loadActiveGenerationKnowledge(
  database: Database,
  expectedReference: string,
): Promise<SelectableKnowledgePack> {
  return retryCoherentKnowledgeRead(
    () => loadActiveGenerationKnowledgeOnce(database, expectedReference),
  );
}

export function prepareDatabaseGenerationContext(input: {
  pack: SelectableKnowledgePack;
  pageType: SitePageType;
  conversionRole: SiteConversionRole;
  plannedSections: readonly SiteSectionType[];
  availableBusinessData: ReadonlySet<string>;
  maximumContextCharacters: number;
}) {
  return prepareSiteGenerationKnowledgeContext({
    pack: input.pack,
    pageType: input.pageType,
    conversionRole: input.conversionRole,
    plannedSections: input.plannedSections,
    availableBusinessDataKeys: [...input.availableBusinessData],
    maxEstimatedCharacterCount: input.maximumContextCharacters,
  });
}
