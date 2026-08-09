import type { SiteGenerationKnowledgeContext } from '@ks-os/site-knowledge';
import { getSiteComponent } from '@ks-os/site-components';
import type { z } from 'zod';
import {
  GeneratedPageSchema,
  PageCompositionPlanSchema,
  SiteCompositionStrategySchema,
  SITE_GENERATION_PROMPT_TEMPLATE_VERSION,
  type GeneratedPage,
  type GenerationFinding,
  type GenerationPlan,
  type PageCompositionPlan,
  type SiteCompositionStrategy,
  type TemplateGenerationConstraint,
  type VerifiedBusinessFacts,
} from './contracts.js';
import {
  pageCompositionResponseJsonSchema,
  SITE_STRATEGY_RESPONSE_JSON_SCHEMA,
  composePageCompositionPrompt,
  composeSiteStrategyPrompt,
  validatePageCompositionPlan,
} from './composition.js';
import { createDeterministicAssetCoveragePlan, validateAssetCoveragePlan } from './assets.js';
import { detectCompositionRepetition, validatePageCompleteness } from './completeness.js';
import { composeGenerationPrompt } from './prompt.js';
import type { SiteGenerationProvider } from './provider.js';
import { generateWithControlledRepair } from './repair.js';
import { assertGeneratedPageSetMatchesPlan, validateGenerationPlan } from './planning.js';
import { detectDuplicateContent, validateGeneratedPage } from './validation.js';
import { generationDigest } from './normalization.js';
import { generatedPageResponseJsonSchema } from './response-schema.js';

export interface SiteGenerationPersistence {
  beginRun(input: {
    pageCountPlanned: number;
    sectionCountPlanned: number;
  }): Promise<void>;
  completedPages(): Promise<readonly {
    pageReference: string;
    outputContentDigestSha256: string;
  }[]>;
  persistPage(input: {
    page: GeneratedPage;
    knowledgeContext: SiteGenerationKnowledgeContext;
    knowledgeContextDigestSha256: string;
    outputContentDigestSha256: string;
    providerKey: string;
    modelKey: string;
    repairAttempts: number;
    findings: readonly GenerationFinding[];
  }): Promise<void>;
  persistFindings(findings: readonly GenerationFinding[]): Promise<void>;
  persistCompositionArtifacts?(input: {
    strategy: SiteCompositionStrategy;
    pagePlans: readonly PageCompositionPlan[];
    assetCoveragePlan: NonNullable<ReturnType<typeof createDeterministicAssetCoveragePlan>>;
  }): Promise<void>;
  updatePlannedSectionCount?(sectionCountPlanned: number): Promise<void>;
  completeRun(input: {
    outputContentDigestSha256: string;
    pageCountCompleted: number;
    sectionCountCompleted: number;
    readinessStatus: 'DESIGN_COMPLETE' | 'READY_FOR_REVIEW';
  }): Promise<void>;
  failRun(input: { failureCode: string; failureMessage: string }): Promise<void>;
}

export interface ExecuteSiteGenerationInput {
  plan: GenerationPlan;
  constraints: readonly TemplateGenerationConstraint[];
  facts: VerifiedBusinessFacts;
  knowledgeContexts: ReadonlyMap<string, SiteGenerationKnowledgeContext>;
  provider: SiteGenerationProvider;
  persistence: SiteGenerationPersistence;
  maxRepairAttempts: number;
  maxOutputCharacters: number;
  signal?: AbortSignal;
  updateProgress?: (input: { current: number; total: number; message: string }) => Promise<void>;
  pipelineVersion?: 1 | 2;
}

export const GENERATED_PAGE_RESPONSE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  description: 'A structured KS OS page. The local Zod contract is authoritative.',
  required: [
    'pageReference', 'title', 'navigationLabel', 'slug', 'pageType',
    'conversionRole', 'layoutReference', 'seo', 'sections', 'internalLinks',
    'structuredDataInputs', 'assetRequirements', 'missingDataFindings', 'claims',
  ],
  additionalProperties: false,
  properties: {
    pageReference: { type: 'string', format: 'uuid' },
    title: { type: 'string' },
    navigationLabel: { type: 'string' },
    slug: { type: 'string' },
    pageType: { type: 'string' },
    conversionRole: { type: 'string' },
    layoutReference: { type: 'string', format: 'uuid' },
    seo: { type: 'object' },
    sections: { type: 'array', items: { type: 'object' } },
    internalLinks: { type: 'array', items: { type: 'object' } },
    structuredDataInputs: { type: 'array', items: { type: 'object' } },
    assetRequirements: { type: 'array', items: { type: 'object' } },
    missingDataFindings: { type: 'array', items: { type: 'object' } },
    claims: { type: 'array', items: { type: 'object' } },
  },
};

export function generationCompletionStatus(pipelineVersion: 1 | 2 = 1) {
  return pipelineVersion === 2
    ? 'DESIGN_COMPLETE' as const
    : 'READY_FOR_REVIEW' as const;
}

export async function executeStructuredSiteGeneration(
  input: ExecuteSiteGenerationInput,
) {
  const planValidation = validateGenerationPlan(input.plan, input.constraints);
  if (!planValidation.valid) {
    await input.persistence.failRun({
      failureCode: 'TERMINAL_TEMPLATE_VALIDATION_FAILURE',
      failureMessage: 'The pinned generation plan is not template-compatible.',
    });
    throw new Error('The pinned generation plan is not template-compatible.');
  }
  const sectionCountPlanned = input.plan.pages.reduce(
    (total, page) => total + page.plannedSectionTypes.length,
    0,
  );
  await input.persistence.beginRun({
    pageCountPlanned: input.plan.pages.length,
    sectionCountPlanned,
  });
  const completedRecords = await input.persistence.completedPages();
  const completed = new Set(completedRecords.map(item => item.pageReference));
  const pageDigests = new Map(completedRecords.map(item => [
    item.pageReference,
    item.outputContentDigestSha256,
  ]));
  const generated: GeneratedPage[] = [];
  try {
    let siteStrategy: SiteCompositionStrategy | undefined;
    const pageCompositionPlans = new Map<string, PageCompositionPlan>();
    let assetCoveragePlan: ReturnType<typeof createDeterministicAssetCoveragePlan> | undefined;
    if ((input.pipelineVersion ?? 1) === 2) {
      await input.updateProgress?.({ current: 0, total: input.plan.pages.length + 2, message: 'Creating the governed site-wide composition strategy.' });
      const strategyResponse = await input.provider.generateStructuredOutput({
        prompt: composeSiteStrategyPrompt({ plan: input.plan, facts: input.facts }),
        outputSchema: SiteCompositionStrategySchema,
        responseJsonSchema: SITE_STRATEGY_RESPONSE_JSON_SCHEMA,
        maxOutputCharacters: input.maxOutputCharacters,
        signal: input.signal,
      });
      siteStrategy = strategyResponse.value;
      for (const page of input.plan.pages) {
        const template = input.constraints.find(item => item.layoutReference === page.layoutReference);
        const knowledge = input.knowledgeContexts.get(page.pageReference);
        if (!template || !knowledge) throw new Error('A pinned page composition context is missing.');
        const composed = composePageCompositionPrompt({
          page,
          template,
          strategy: strategyResponse.value,
          facts: input.facts,
          knowledge,
          approvedPageReferences: input.plan.pages.map(item => item.pageReference),
        });
        const planned = await generateWithControlledRepair<PageCompositionPlan>({
          provider: input.provider,
          maxRepairAttempts: input.maxRepairAttempts,
          buildRequest: () => ({
            prompt: composed,
            outputSchema: PageCompositionPlanSchema,
            responseJsonSchema: pageCompositionResponseJsonSchema({
              page,
              template,
              approvedPageReferences: input.plan.pages.map(item => item.pageReference),
            }),
            maxOutputCharacters: input.maxOutputCharacters,
            signal: input.signal,
          }),
          validate: value => {
            const findings = validatePageCompositionPlan({
              output: value,
              page,
              template,
              approvedPageReferences: input.plan.pages.map(item => item.pageReference),
              approvedAssetReferences: input.facts.approvedAssets?.length
                ? input.facts.approvedAssets.map(asset => asset.publicReference)
                : input.facts.assetReferences,
            });
            return { valid: !findings.some(item => item.severity === 'ERROR'), findings };
          },
        });
        pageCompositionPlans.set(page.pageReference, planned.response.value);
      }
      const requiredSlotsByComponentKey = new Map(
        [...pageCompositionPlans.values()].flatMap(page => page.selectedComponents)
          .map(selection => [
            selection.componentKey,
            getSiteComponent(selection.componentKey)?.requiredAssetSlots ?? [],
          ] as const),
      );
      assetCoveragePlan = createDeterministicAssetCoveragePlan({
        facts: input.facts,
        pages: [...pageCompositionPlans.values()],
        requiredSlotsByComponentKey,
      });
      await input.persistence.updatePlannedSectionCount?.(
        [...pageCompositionPlans.values()].reduce(
          (total, pagePlan) => total + pagePlan.selectedComponents.length,
          0,
        ),
      );
      await input.persistence.persistCompositionArtifacts?.({
        strategy: strategyResponse.value,
        pagePlans: [...pageCompositionPlans.values()],
        assetCoveragePlan,
      });
      const assetFindings = validateAssetCoveragePlan({
        plan: assetCoveragePlan,
        facts: input.facts,
        approvedPageReferences: input.plan.pages.map(item => item.pageReference),
      });
      await input.persistence.persistFindings(assetFindings);
      if (assetFindings.some(item => item.severity === 'ERROR')) {
        throw new Error('The deterministic tenant-scoped asset coverage plan is invalid.');
      }
    }
    for (const [index, page] of input.plan.pages.entries()) {
      if (input.signal?.aborted) throw new Error('Generation was cancelled.');
      if (completed.has(page.pageReference)) continue;
      const template = input.constraints.find(item =>
        item.layoutReference === page.layoutReference);
      const knowledge = input.knowledgeContexts.get(page.pageReference);
      if (!template || !knowledge) {
        throw new Error('A pinned page generation context is missing.');
      }
      await input.updateProgress?.({
        current: index,
        total: input.plan.pages.length,
        message: `Generating approved page ${index + 1} of ${input.plan.pages.length}.`,
      });
      const result = await generateWithControlledRepair<GeneratedPage>({
        provider: input.provider,
        maxRepairAttempts: input.maxRepairAttempts,
        buildRequest: (repairAttempt, previousFindings) => {
          const pageCompositionPlan = pageCompositionPlans.get(page.pageReference);
          const responseJsonSchema = pageCompositionPlan
            ? generatedPageResponseJsonSchema({
              pageType: page.pageType,
              conversionRole: page.conversionRole,
              selectedComponents: pageCompositionPlan.selectedComponents,
            })
            : GENERATED_PAGE_RESPONSE_JSON_SCHEMA;
          const composed = composeGenerationPrompt({
            page,
            template,
            facts: input.facts,
            knowledge,
            outputSchemaDescription: responseJsonSchema,
            ...(siteStrategy ? { siteStrategy } : {}),
            ...(pageCompositionPlan
              ? { pageCompositionPlan }
              : {}),
            ...(assetCoveragePlan ? { assetCoveragePlan } : {}),
            ...(repairAttempt > 0
              ? { repair: { attempt: repairAttempt, findings: previousFindings } }
              : {}),
          });
          return {
            prompt: composed.prompt,
            outputSchema: GeneratedPageSchema as z.ZodType<GeneratedPage>,
            responseJsonSchema,
            maxOutputCharacters: input.maxOutputCharacters,
            signal: input.signal,
          };
        },
        validate: value => {
          const validation = validateGeneratedPage({
            output: value,
            expected: {
              pageReference: page.pageReference,
              pageType: page.pageType,
              conversionRole: page.conversionRole,
              slug: page.slug,
              layoutReference: page.layoutReference,
            },
            template,
            facts: input.facts,
            approvedPageReferences: input.plan.pages.map(item => item.pageReference),
          });
          const composition = pageCompositionPlans.get(page.pageReference);
          if (validation.page && composition) {
            const selected = composition.selectedComponents;
            const componentsMatch = validation.page.sections.length === selected.length
              && validation.page.sections.every((section, sectionIndex) =>
                section.type === selected[sectionIndex]?.sectionType
                && section.componentKey === selected[sectionIndex]?.componentKey);
            if (!componentsMatch) {
              validation.findings.push({
                severity: 'ERROR',
                category: 'DESIGN',
                code: 'GENERATED_COMPONENT_PLAN_CHANGED',
                message: 'Generated content changed or omitted an allow-listed component selection.',
                targetReference: page.pageReference,
              });
            }
          }
          return { ...validation, valid: !validation.findings.some(item => item.severity === 'ERROR') };
        },
      });
      const pageValidation = validateGeneratedPage({
        output: result.response.value,
        expected: {
          pageReference: page.pageReference,
          pageType: page.pageType,
          conversionRole: page.conversionRole,
          slug: page.slug,
          layoutReference: page.layoutReference,
        },
        template,
        facts: input.facts,
        approvedPageReferences: input.plan.pages.map(item => item.pageReference),
      });
      const completeness = (input.pipelineVersion ?? 1) === 2
        ? validatePageCompleteness({ page: result.response.value })
        : null;
      const pageFindings = [
        ...pageValidation.findings,
        ...(completeness?.findings ?? []),
      ];
      await input.persistence.persistPage({
        page: result.response.value,
        knowledgeContext: knowledge,
        knowledgeContextDigestSha256: knowledge.contentDigest,
        outputContentDigestSha256: generationDigest(result.response.value),
        providerKey: result.response.providerKey,
        modelKey: result.response.modelKey,
        repairAttempts: result.repairAttempts,
        findings: pageFindings,
      });
      generated.push(result.response.value);
      completed.add(page.pageReference);
      pageDigests.set(page.pageReference, generationDigest(result.response.value));
      await input.updateProgress?.({
        current: index + 1,
        total: input.plan.pages.length,
        message: `Validated approved page ${index + 1} of ${input.plan.pages.length}.`,
      });
    }
    assertGeneratedPageSetMatchesPlan(input.plan, [...completed]);
    const duplicateFindings = detectDuplicateContent(generated);
    const compositionFindings = (input.pipelineVersion ?? 1) === 2
      ? detectCompositionRepetition(generated)
      : [];
    await input.persistence.persistFindings([...duplicateFindings, ...compositionFindings]);
    if ([...duplicateFindings, ...compositionFindings].some(item => item.severity === 'ERROR')) {
      throw new Error('Blocking cross-page completeness findings prevent review readiness.');
    }
    const outputContentDigestSha256 = generationDigest(
      [...pageDigests.entries()]
        .map(([reference, digest]) => ({ reference, digest }))
        .sort((left, right) => left.reference.localeCompare(right.reference)),
    );
    const readinessStatus = generationCompletionStatus(input.pipelineVersion ?? 1);
    await input.persistence.completeRun({
      outputContentDigestSha256,
      pageCountCompleted: completed.size,
      sectionCountCompleted: generated.reduce((total, page) => total + page.sections.length, 0),
      readinessStatus,
    });
    return {
      status: readinessStatus,
      pageReferences: [...completed].sort(),
      outputContentDigestSha256,
      promptTemplateVersion: SITE_GENERATION_PROMPT_TEMPLATE_VERSION,
      findingCount: duplicateFindings.length + compositionFindings.length,
    };
  } catch (error) {
    const abortCode = input.signal?.aborted
      && input.signal.reason
      && typeof input.signal.reason === 'object'
      && 'code' in input.signal.reason
      ? String(input.signal.reason.code)
      : null;
    if (abortCode === 'WORKER_SHUTDOWN' || abortCode === 'LEASE_LOST') {
      throw error;
    }
    await input.persistence.failRun({
      failureCode: input.signal?.aborted ? 'CANCELLED_BY_USER' : 'SITE_GENERATION_FAILED',
      failureMessage: input.signal?.aborted
        ? 'Structured generation was cancelled.'
        : 'Structured generation failed before the draft was ready for review.',
    });
    throw error;
  }
}
