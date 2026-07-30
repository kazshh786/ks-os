import { desc, eq } from 'drizzle-orm';
import {
  designLibraryGenerations,
  designLibraryItems,
  getDatabase,
} from '@ks-os/database';
import {
  type SiteConversionRole,
  type SitePageType,
} from '@ks-os/contracts';
import {
  prepareSiteGenerationKnowledgeContext,
  type SelectableKnowledgePack,
  type SiteGenerationKnowledgeContext,
} from '@ks-os/site-knowledge';
import type { SiteSectionType } from '@ks-os/site-schema';
import { ProvisioningThemeColourOverridesSchema } from '@ks-os/workspace-provisioning';
import { z } from 'zod';
import { AgencyKnowledgePackService } from './knowledge-pack.service.js';
import { GenerateDesignLibraryItemSchema } from './design-library.service.js';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

export const DesignStudioGenerateRequestSchema = GenerateDesignLibraryItemSchema
  .omit({ prompt: true })
  .extend({
    prompt: z.string().trim().min(12).max(2_200),
    themePreferences: ProvisioningThemeColourOverridesSchema.optional(),
  })
  .strict();

export type DesignStudioGenerateRequest = z.infer<typeof DesignStudioGenerateRequestSchema>;

type Database = ReturnType<typeof getDatabase>;

type KnowledgeTarget = {
  pageType: SitePageType;
  conversionRole: SiteConversionRole;
  plannedSections: SiteSectionType[];
};

const REQUIRED_THEME_TARGETS: Array<Omit<KnowledgeTarget, 'plannedSections'>> = [
  { pageType: 'HOME', conversionRole: 'PRIMARY_LANDING' },
  { pageType: 'SERVICE_HUB', conversionRole: 'SERVICE_CONVERSION' },
  { pageType: 'ABOUT', conversionRole: 'TRUST_BUILDING' },
  { pageType: 'CONTACT', conversionRole: 'LOCAL_DISCOVERY' },
  { pageType: 'POLICIES', conversionRole: 'OBJECTION_HANDLING' },
  { pageType: 'BOOKING', conversionRole: 'BOOKING' },
];

function singleTarget(sectionType: SiteSectionType): Omit<KnowledgeTarget, 'plannedSections'> {
  if (['FEATURED_SERVICES', 'SERVICE_GRID', 'SERVICE_DETAILS', 'BENEFITS', 'PROCESS', 'PRICING'].includes(sectionType)) {
    return { pageType: 'SERVICE_DETAIL', conversionRole: 'SERVICE_CONVERSION' };
  }
  if (['LOCATION', 'OPENING_HOURS', 'CONTACT', 'MAP'].includes(sectionType)) {
    return { pageType: 'CONTACT', conversionRole: 'LOCAL_DISCOVERY' };
  }
  if (['TEAM', 'STAFF_PROFILE', 'TESTIMONIALS', 'REVIEW_SUMMARY', 'TRUST_INDICATORS', 'RESULTS', 'GALLERY'].includes(sectionType)) {
    return { pageType: 'ABOUT', conversionRole: 'TRUST_BUILDING' };
  }
  if (['FAQ', 'POLICIES', 'RICH_TEXT'].includes(sectionType)) {
    return { pageType: 'FAQ', conversionRole: 'OBJECTION_HANDLING' };
  }
  if (['BOOKING_CTA', 'FINAL_CTA', 'BOOKING_WIDGET'].includes(sectionType)) {
    return { pageType: 'BOOKING', conversionRole: 'BOOKING' };
  }
  return { pageType: 'HOME', conversionRole: 'PRIMARY_LANDING' };
}

function playbookSections(
  pack: SelectableKnowledgePack,
  pageType: SitePageType,
  conversionRole: SiteConversionRole,
  fallback: SiteSectionType[],
) {
  const playbook = pack.bundle.pagePlaybooks.find(item =>
    item.pageType === pageType && item.conversionRole === conversionRole);
  const selected = playbook?.sections
    .filter(section => section.requirement !== 'PROHIBITED')
    .sort((left, right) => left.sectionOrderMin - right.sectionOrderMin)
    .map(section => section.sectionType)
    .slice(0, 16) ?? [];
  return selected.length ? selected : fallback;
}

function targetsFor(input: DesignStudioGenerateRequest, pack: SelectableKnowledgePack): KnowledgeTarget[] {
  if (input.itemKind === 'SITE_THEME') {
    return REQUIRED_THEME_TARGETS.map(target => ({
      ...target,
      plannedSections: playbookSections(
        pack,
        target.pageType,
        target.conversionRole,
        target.pageType === 'HOME'
          ? ['HEADER', 'HERO', 'FEATURED_SERVICES', 'TRUST_INDICATORS', 'BOOKING_CTA', 'FOOTER']
          : ['HEADER', 'INTRODUCTION', 'BOOKING_CTA', 'FOOTER'],
      ),
    }));
  }
  const sectionType = input.sectionType ?? 'HERO';
  const target = singleTarget(sectionType);
  return [{ ...target, plannedSections: [sectionType] }];
}

const unique = <T>(values: readonly T[]) => [...new Set(values)];
const clipped = (value: string, length = 150) => value.length > length ? `${value.slice(0, length - 1)}…` : value;

function compactKnowledge(
  pack: SelectableKnowledgePack,
  contexts: SiteGenerationKnowledgeContext[],
  themePreferences: DesignStudioGenerateRequest['themePreferences'],
) {
  const ruleIds = unique(contexts.flatMap(context => context.applicableRuleIds)).slice(0, 36);
  const instructions = unique(contexts.flatMap(context => context.requiredInstructions))
    .slice(0, 8)
    .map(value => clipped(value, 150));
  const prohibited = unique(contexts.flatMap(context => context.prohibitedBehaviours))
    .slice(0, 8)
    .map(value => clipped(value, 130));
  const playbooks = contexts.map(context => ({
    pageType: context.pagePlaybook?.pageType,
    conversionRole: context.pagePlaybook?.conversionRole,
    sections: context.pagePlaybook?.sections.map(section => ({
      type: section.sectionType,
      requirement: section.requirement,
      primaryCtas: section.allowedPrimaryCtaTypes,
    })) ?? [],
  }));
  const full = {
    pack: {
      reference: pack.reference,
      semanticVersion: pack.semanticVersion,
      schemaVersion: pack.schemaVersion,
      sourceDigest: pack.bundle.sourceDigest,
    },
    ruleIds,
    instructions,
    prohibited,
    playbooks,
    themePreferences: themePreferences ?? null,
  };
  const serialized = JSON.stringify(full);
  if (serialized.length <= 1_650) return serialized;
  return JSON.stringify({
    pack: full.pack,
    ruleIds: ruleIds.slice(0, 24),
    instructions: instructions.slice(0, 5),
    prohibited: prohibited.slice(0, 5),
    pageStructures: playbooks.map(playbook => ({
      pageType: playbook.pageType,
      sections: playbook.sections.map(section => section.type),
    })),
    themePreferences: themePreferences ?? null,
  });
}

function contextDigest(contexts: SiteGenerationKnowledgeContext[]) {
  return contexts.map(context => context.contentDigest).join(':');
}

export class DesignLibraryKnowledgeService {
  private readonly knowledge: AgencyKnowledgePackService;

  constructor(
    private readonly db: Database = getDatabase(),
    knowledge = new AgencyKnowledgePackService(db),
  ) {
    this.knowledge = knowledge;
  }

  async config() {
    try {
      const pack = await this.knowledge.resolveActive('PUBLIC_SITE');
      return {
        available: true,
        pack: {
          reference: pack.reference,
          semanticVersion: pack.semanticVersion,
          schemaVersion: pack.schemaVersion,
          sourceDigest: pack.bundle.sourceDigest,
          sourceCount: pack.bundle.sources.length,
          ruleCount: pack.bundle.rules.filter(rule => rule.status === 'ACCEPTED').length,
          pagePlaybookCount: pack.bundle.pagePlaybooks.length,
          sectionPlaybookCount: pack.bundle.pagePlaybooks.reduce((total, page) => total + page.sections.length, 0),
        },
      };
    } catch (error) {
      return {
        available: false,
        pack: null,
        message: error instanceof Error ? error.message : 'The active website knowledge pack is unavailable.',
      };
    }
  }

  async prepare(rawInput: unknown) {
    const input = DesignStudioGenerateRequestSchema.parse(rawInput);
    const pack = await this.knowledge.resolveActive('PUBLIC_SITE').catch(error => {
      if (error && typeof error === 'object' && 'statusCode' in error) throw error;
      throw fail(409, 'ACTIVE_KNOWLEDGE_PACK_INVARIANT_FAILED', 'Exactly one active website knowledge pack is required before Design Studio generation.');
    });
    const targets = targetsFor(input, pack);
    const contexts = targets.map(target => prepareSiteGenerationKnowledgeContext({
      pack,
      pageType: target.pageType,
      conversionRole: target.conversionRole,
      plannedSections: target.plannedSections,
      availableBusinessDataKeys: [],
      maxRuleCount: 28,
      maxEstimatedCharacterCount: 8_000,
      includeWarnings: true,
      includeRecommendations: true,
    }));
    const compact = compactKnowledge(pack, contexts, input.themePreferences);
    const prompt = [
      input.prompt,
      '',
      'Apply this server-pinned KS OS knowledge context. It contains approved distilled rules and playbooks, not raw NotebookLM material or source books:',
      compact,
      input.themePreferences
        ? 'Use the supplied agency colour values exactly where possible. Accessibility validation remains mandatory and approval will be blocked if the palette fails WCAG 2.2 AA.'
        : 'Choose an accessible palette appropriate to the requested audience and industry.',
    ].join('\n');
    if (prompt.length > 4_000) {
      throw fail(422, 'DESIGN_KNOWLEDGE_CONTEXT_TOO_LARGE', 'The design request is too long after the approved knowledge context is applied. Shorten the design description and try again.');
    }
    const generationInput = GenerateDesignLibraryItemSchema.parse({
      prompt,
      itemKind: input.itemKind,
      sourceType: input.sourceType,
      category: input.category,
      name: input.name,
      sectionType: input.sectionType,
      industryTags: input.industryTags,
    });
    const applicableRuleIds = unique(contexts.flatMap(context => context.applicableRuleIds));
    const sourceReferences = unique(contexts.flatMap(context => context.sourceReferences.map(source => source.sourceId)));
    return {
      generationInput,
      provenance: {
        knowledgePackReference: pack.reference,
        knowledgePackSemanticVersion: pack.semanticVersion,
        knowledgePackSchemaVersion: pack.schemaVersion,
        knowledgeSourceDigest: pack.bundle.sourceDigest,
        knowledgeContextDigest: contextDigest(contexts),
        applicableRuleIds,
        sourceReferences,
        pagePlaybooks: targets.map(target => ({
          pageType: target.pageType,
          conversionRole: target.conversionRole,
          plannedSections: target.plannedSections,
        })),
        themePreferences: input.themePreferences ?? null,
        rawCsvUsedAtRuntime: false,
        rawNotebookLmContentUsedAtRuntime: false,
      },
    };
  }

  async pinResult(itemReference: string, provenance: Record<string, unknown>) {
    const [item] = await this.db.select({
      id: designLibraryItems.id,
      sourceMetadata: designLibraryItems.sourceMetadataJson,
    }).from(designLibraryItems)
      .where(eq(designLibraryItems.publicReference, itemReference))
      .limit(1);
    if (!item) return;
    await this.db.update(designLibraryItems).set({
      sourceMetadataJson: {
        ...record(item.sourceMetadata),
        knowledge: provenance,
      },
      updatedAt: new Date(),
    }).where(eq(designLibraryItems.id, item.id));
    const [generation] = await this.db.select({
      id: designLibraryGenerations.id,
      safeMetadata: designLibraryGenerations.safeMetadataJson,
    }).from(designLibraryGenerations)
      .where(eq(designLibraryGenerations.itemId, item.id))
      .orderBy(desc(designLibraryGenerations.createdAt))
      .limit(1);
    if (generation) {
      await this.db.update(designLibraryGenerations).set({
        safeMetadataJson: {
          ...record(generation.safeMetadata),
          knowledgePackReference: provenance.knowledgePackReference,
          knowledgePackSemanticVersion: provenance.knowledgePackSemanticVersion,
          knowledgeContextDigest: provenance.knowledgeContextDigest,
          applicableRuleIds: provenance.applicableRuleIds,
          themePreferences: provenance.themePreferences,
        },
        updatedAt: new Date(),
      }).where(eq(designLibraryGenerations.id, generation.id));
    }
  }
}
