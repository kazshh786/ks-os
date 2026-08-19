import type { SiteGenerationKnowledgeContext } from '@ks-os/site-knowledge';
import { getSiteComponent } from '@ks-os/site-components';
import type { z } from 'zod';
import {
  GeneratedPageSchema,
  SITE_GENERATION_PROMPT_TEMPLATE_VERSION,
  type GeneratedPage,
  type GenerationFinding,
  type GenerationPlan,
  type PageCompositionPlan,
  type SiteCompositionStrategy,
  type TemplateGenerationConstraint,
  type VerifiedBusinessFacts,
} from './contracts.js';
import { validatePageCompositionPlan } from './composition.js';
import { createDeterministicAssetCoveragePlan, validateAssetCoveragePlan } from './assets.js';
import { detectCompositionRepetition, validatePageCompleteness } from './completeness.js';
import { composeGenerationPrompt } from './prompt.js';
import type { SiteGenerationProvider } from './provider.js';
import { generateWithControlledRepair } from './repair.js';
import { assertGeneratedPageSetMatchesPlan, validateGenerationPlan } from './planning.js';
import { detectDuplicateContent, validateGeneratedPage } from './validation.js';
import { generationDigest } from './normalization.js';
import { generatedPageResponseJsonSchema } from './response-schema.js';
import { createBaselineComposition } from './baseline-composition.js';
import type { SiteGenerationMode } from './config.js';
import {
  validateGeneratedPageAgainstSeoBrief,
  type PageSeoBrief,
  type SearchIntelligenceStrategyV2,
  type SearchResearchEvidence,
} from './search-intelligence.js';
import {
  SPECIALIST_AGENT_TEAM_VERSION,
  attachSpecialistTeamContext,
  runSpecialistAgentTeam,
  type SpecialistAgentTeamOutput,
} from './specialist-agents.js';

export interface ApprovedSearchIntelligenceInput {
  strategy: SearchIntelligenceStrategyV2;
  briefs: readonly PageSeoBrief[];
  evidence: readonly SearchResearchEvidence[];
}

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
  persistSpecialistArtifacts?(artifacts: SpecialistAgentTeamOutput): Promise<void>;
  persistCompositionArtifacts?(input: {
    strategy: SiteCompositionStrategy;
    pagePlans: readonly PageCompositionPlan[];
    assetCoveragePlan: ReturnType<typeof createDeterministicAssetCoveragePlan>;
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
  generationMode?: SiteGenerationMode;
  searchIntelligence?: ApprovedSearchIntelligenceInput;
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

function warning(input: {
  code: string;
  message: string;
  category?: GenerationFinding['category'];
  targetReference?: string;
}): GenerationFinding {
  return {
    severity: 'WARNING',
    category: input.category ?? 'PROVIDER',
    code: input.code,
    message: input.message,
    ...(input.targetReference ? { targetReference: input.targetReference } : {}),
  };
}

function asWarnings(findings: readonly GenerationFinding[]) {
  return findings.map(finding => ({ ...finding, severity: 'WARNING' as const }));
}

function seoReviewFindings(input: {
  page: GeneratedPage;
  brief?: PageSeoBrief;
  facts: VerifiedBusinessFacts;
}): GenerationFinding[] {
  if (!input.brief) return [];
  return validateGeneratedPageAgainstSeoBrief({
    brief: input.brief,
    page: input.page,
    facts: input.facts,
  }).map(item => ({
    severity: 'WARNING' as const,
    category: 'METADATA' as const,
    code: item.code,
    message: item.message,
    targetReference: item.pageReference,
  }));
}

function validateLockedComponentPlan(input: {
  page: GeneratedPage;
  composition?: PageCompositionPlan;
  targetReference: string;
}): GenerationFinding[] {
  if (!input.composition) return [];
  const selected = input.composition.selectedComponents;
  const componentsMatch = input.page.sections.length === selected.length
    && input.page.sections.every((section, sectionIndex) =>
      section.type === selected[sectionIndex]?.sectionType
      && section.componentKey === selected[sectionIndex]?.componentKey);
  return componentsMatch ? [] : [{
    severity: 'ERROR',
    category: 'DESIGN',
    code: 'GENERATED_COMPONENT_PLAN_CHANGED',
    message: 'Generated content changed or omitted an allow-listed component selection.',
    targetReference: input.targetReference,
  }];
}

export async function executeStructuredSiteGeneration(
  input: ExecuteSiteGenerationInput,
) {
  const pipelineVersion = input.pipelineVersion ?? 1;
  const generationMode = input.generationMode ?? 'ai-composition';
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
  const generatedByReference = new Map<string, GeneratedPage>();

  try {
    let siteStrategy: SiteCompositionStrategy | undefined;
    let specialistArtifacts: SpecialistAgentTeamOutput | undefined;
    const pageCompositionPlans = new Map<string, PageCompositionPlan>();
    let assetCoveragePlan: ReturnType<typeof createDeterministicAssetCoveragePlan> | undefined;

    // Structure is deterministic. The first creative provider call is the actual website draft.
    // This prevents planning agents or research availability from blocking page creation.
    if (pipelineVersion === 2) {
      await input.updateProgress?.({
        current: 0,
        total: input.plan.pages.length,
        message: 'Preparing the governed page structure for the complete draft.',
      });
      const baseline = createBaselineComposition({
        plan: input.plan,
        constraints: input.constraints,
        facts: input.facts,
        briefs: input.searchIntelligence?.briefs,
      });
      siteStrategy = baseline.strategy;

      const compositionWarnings: GenerationFinding[] = [];
      for (const pagePlan of baseline.pagePlans) {
        const page = input.plan.pages.find(item => item.pageReference === pagePlan.pageReference);
        const template = page
          ? input.constraints.find(item => item.layoutReference === page.layoutReference)
          : undefined;
        if (!page || !template) continue;
        const findings = validatePageCompositionPlan({
          output: pagePlan,
          page,
          template,
          approvedPageReferences: input.plan.pages.map(item => item.pageReference),
          approvedAssetReferences: input.facts.approvedAssets?.length
            ? input.facts.approvedAssets.map(asset => asset.publicReference)
            : input.facts.assetReferences,
        });
        if (findings.some(item => item.severity === 'ERROR')) {
          compositionWarnings.push(...asWarnings(findings));
          continue;
        }
        pageCompositionPlans.set(pagePlan.pageReference, pagePlan);
      }
      if (compositionWarnings.length) {
        await input.persistence.persistFindings(compositionWarnings);
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
        ) || sectionCountPlanned,
      );

      if (pageCompositionPlans.size === input.plan.pages.length) {
        await input.persistence.persistCompositionArtifacts?.({
          strategy: siteStrategy,
          pagePlans: [...pageCompositionPlans.values()],
          assetCoveragePlan,
        });
      }

      const assetFindings = validateAssetCoveragePlan({
        plan: assetCoveragePlan,
        facts: input.facts,
        approvedPageReferences: input.plan.pages.map(item => item.pageReference),
      });
      if (assetFindings.length) {
        await input.persistence.persistFindings(asWarnings(assetFindings));
      }
    }

    // Phase 1: create the complete usable draft before asking any specialist to refine it.
    for (const [index, page] of input.plan.pages.entries()) {
      if (input.signal?.aborted) throw new Error('Generation was cancelled.');
      if (completed.has(page.pageReference)) continue;
      const template = input.constraints.find(item => item.layoutReference === page.layoutReference);
      const knowledge = input.knowledgeContexts.get(page.pageReference);
      if (!template || !knowledge) throw new Error('A pinned page generation context is missing.');
      const pageCompositionPlan = pageCompositionPlans.get(page.pageReference);
      const responseJsonSchema = pageCompositionPlan
        ? generatedPageResponseJsonSchema({
          pageType: page.pageType,
          conversionRole: page.conversionRole,
          selectedComponents: pageCompositionPlan.selectedComponents,
        })
        : GENERATED_PAGE_RESPONSE_JSON_SCHEMA;

      await input.updateProgress?.({
        current: index,
        total: input.plan.pages.length,
        message: `Generating complete draft page ${index + 1} of ${input.plan.pages.length}.`,
      });
      const result = await generateWithControlledRepair<GeneratedPage>({
        provider: input.provider,
        maxRepairAttempts: input.maxRepairAttempts,
        buildRequest: (repairAttempt, previousFindings) => ({
          prompt: composeGenerationPrompt({
            page,
            template,
            facts: input.facts,
            knowledge,
            outputSchemaDescription: responseJsonSchema,
            approvedSearchStrategy: input.searchIntelligence?.strategy,
            pageSeoBrief: input.searchIntelligence?.briefs.find(brief => brief.pageReference === page.pageReference),
            ...(siteStrategy ? { siteStrategy } : {}),
            ...(pageCompositionPlan ? { pageCompositionPlan } : {}),
            ...(assetCoveragePlan ? { assetCoveragePlan } : {}),
            generationPhase: 'INITIAL_DRAFT',
            ...(repairAttempt > 0
              ? { repair: { attempt: repairAttempt, findings: previousFindings } }
              : {}),
          }).prompt,
          outputSchema: GeneratedPageSchema as z.ZodType<GeneratedPage>,
          responseJsonSchema,
          maxOutputCharacters: input.maxOutputCharacters,
          signal: input.signal,
        }),
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
          if (validation.page) {
            validation.findings.push(...validateLockedComponentPlan({
              page: validation.page,
              composition: pageCompositionPlan,
              targetReference: page.pageReference,
            }));
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
      const completeness = pipelineVersion === 2
        ? validatePageCompleteness({ page: result.response.value })
        : null;
      const pageFindings = [
        ...pageValidation.findings,
        ...validateLockedComponentPlan({
          page: result.response.value,
          composition: pageCompositionPlan,
          targetReference: page.pageReference,
        }),
        ...seoReviewFindings({
          page: result.response.value,
          brief: input.searchIntelligence?.briefs.find(brief => brief.pageReference === page.pageReference),
          facts: input.facts,
        }),
        ...asWarnings(completeness?.findings ?? []),
      ];
      const digest = generationDigest(result.response.value);
      await input.persistence.persistPage({
        page: result.response.value,
        knowledgeContext: knowledge,
        knowledgeContextDigestSha256: knowledge.contentDigest,
        outputContentDigestSha256: digest,
        providerKey: result.response.providerKey,
        modelKey: result.response.modelKey,
        repairAttempts: result.repairAttempts,
        findings: pageFindings,
      });
      generatedByReference.set(page.pageReference, result.response.value);
      completed.add(page.pageReference);
      pageDigests.set(page.pageReference, digest);
      await input.updateProgress?.({
        current: index + 1,
        total: input.plan.pages.length,
        message: `Draft page ${index + 1} of ${input.plan.pages.length} created.`,
      });
    }

    assertGeneratedPageSetMatchesPlan(input.plan, [...completed]);

    // Phase 2: specialists are an enhancement layer. A valid draft must survive if this layer is unavailable.
    const canRefineCurrentDraft = pipelineVersion === 2
      && generationMode === 'ai-composition'
      && Boolean(input.searchIntelligence)
      && completedRecords.length === 0
      && generatedByReference.size === input.plan.pages.length;

    if (canRefineCurrentDraft) {
      await input.updateProgress?.({
        current: input.plan.pages.length,
        total: input.plan.pages.length,
        message: 'Complete draft created. Specialist team is reviewing it for refinement.',
      });
      try {
        specialistArtifacts = await runSpecialistAgentTeam({
          plan: input.plan,
          facts: input.facts,
          searchIntelligence: input.searchIntelligence!,
          knowledgeContexts: input.knowledgeContexts,
          provider: input.provider,
          maxOutputCharacters: input.maxOutputCharacters,
          signal: input.signal,
          updateStatus: async message => {
            await input.updateProgress?.({
              current: input.plan.pages.length,
              total: input.plan.pages.length,
              message: `Refining draft: ${message}`,
            });
          },
        });
        await input.persistence.persistSpecialistArtifacts?.(specialistArtifacts);
      } catch (error) {
        if (input.signal?.aborted) throw error;
        await input.persistence.persistFindings([
          warning({
            code: 'SPECIALIST_REFINEMENT_SKIPPED',
            message: 'The complete draft was preserved because specialist refinement could not finish. Continue with validation and human review, or run refinement again later.',
          }),
        ]);
      }

      if (specialistArtifacts) {
        for (const [index, page] of input.plan.pages.entries()) {
          if (input.signal?.aborted) throw new Error('Generation was cancelled.');
          const existingDraftPage = generatedByReference.get(page.pageReference);
          const template = input.constraints.find(item => item.layoutReference === page.layoutReference);
          const knowledge = input.knowledgeContexts.get(page.pageReference);
          const pageCompositionPlan = pageCompositionPlans.get(page.pageReference);
          if (!existingDraftPage || !template || !knowledge) continue;
          const responseJsonSchema = pageCompositionPlan
            ? generatedPageResponseJsonSchema({
              pageType: page.pageType,
              conversionRole: page.conversionRole,
              selectedComponents: pageCompositionPlan.selectedComponents,
            })
            : GENERATED_PAGE_RESPONSE_JSON_SCHEMA;

          await input.updateProgress?.({
            current: input.plan.pages.length,
            total: input.plan.pages.length,
            message: `Applying specialist refinement to page ${index + 1} of ${input.plan.pages.length}.`,
          });

          let refined;
          try {
            refined = await generateWithControlledRepair<GeneratedPage>({
              provider: input.provider,
              maxRepairAttempts: input.maxRepairAttempts,
              buildRequest: (repairAttempt, previousFindings) => {
                const base = composeGenerationPrompt({
                  page,
                  template,
                  facts: input.facts,
                  knowledge,
                  outputSchemaDescription: responseJsonSchema,
                  approvedSearchStrategy: input.searchIntelligence?.strategy,
                  pageSeoBrief: input.searchIntelligence?.briefs.find(brief => brief.pageReference === page.pageReference),
                  ...(siteStrategy ? { siteStrategy } : {}),
                  ...(pageCompositionPlan ? { pageCompositionPlan } : {}),
                  ...(assetCoveragePlan ? { assetCoveragePlan } : {}),
                  generationPhase: 'SPECIALIST_REFINEMENT',
                  existingDraftPage,
                  ...(repairAttempt > 0
                    ? { repair: { attempt: repairAttempt, findings: previousFindings } }
                    : {}),
                });
                return {
                  prompt: attachSpecialistTeamContext({
                    prompt: base.prompt,
                    team: specialistArtifacts!,
                    scope: 'CONTENT',
                    pageReference: page.pageReference,
                  }),
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
                if (validation.page) {
                  validation.findings.push(...validateLockedComponentPlan({
                    page: validation.page,
                    composition: pageCompositionPlan,
                    targetReference: page.pageReference,
                  }));
                }
                return { ...validation, valid: !validation.findings.some(item => item.severity === 'ERROR') };
              },
            });
          } catch (error) {
            if (input.signal?.aborted) throw error;
            await input.persistence.persistFindings([
              warning({
                code: 'PAGE_REFINEMENT_SKIPPED',
                message: 'The original valid draft page was preserved because its specialist refinement pass could not complete.',
                targetReference: page.pageReference,
              }),
            ]);
            continue;
          }

          const refinementValidation = validateGeneratedPage({
            output: refined.response.value,
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
          const completeness = validatePageCompleteness({ page: refined.response.value });
          const refinementFindings = [
            ...refinementValidation.findings,
            ...validateLockedComponentPlan({
              page: refined.response.value,
              composition: pageCompositionPlan,
              targetReference: page.pageReference,
            }),
            ...seoReviewFindings({
              page: refined.response.value,
              brief: input.searchIntelligence?.briefs.find(brief => brief.pageReference === page.pageReference),
              facts: input.facts,
            }),
            ...asWarnings(completeness.findings),
          ];
          const digest = generationDigest(refined.response.value);
          await input.persistence.persistPage({
            page: refined.response.value,
            knowledgeContext: knowledge,
            knowledgeContextDigestSha256: knowledge.contentDigest,
            outputContentDigestSha256: digest,
            providerKey: refined.response.providerKey,
            modelKey: refined.response.modelKey,
            repairAttempts: refined.repairAttempts,
            findings: refinementFindings,
          });
          generatedByReference.set(page.pageReference, refined.response.value);
          pageDigests.set(page.pageReference, digest);
        }
      }
    } else if (pipelineVersion === 2 && generationMode === 'ai-composition' && !input.searchIntelligence) {
      await input.persistence.persistFindings([
        warning({
          code: 'SEARCH_REFINEMENT_NOT_AVAILABLE',
          category: 'METADATA',
          message: 'The complete draft was generated without Search Intelligence specialist refinement. Search review can be completed before publication.',
        }),
      ]);
    }

    if (input.signal?.aborted) throw new Error('Generation was cancelled.');
    await input.updateProgress?.({
      current: input.plan.pages.length,
      total: input.plan.pages.length,
      message: 'Validating the complete draft for human review.',
    });
    const generated = [...generatedByReference.values()];
    const duplicateFindings = detectDuplicateContent(generated);
    const compositionFindings = pipelineVersion === 2
      ? detectCompositionRepetition(generated)
      : [];
    await input.persistence.persistFindings(asWarnings([
      ...duplicateFindings,
      ...compositionFindings,
    ]));

    const outputContentDigestSha256 = generationDigest(
      [...pageDigests.entries()]
        .map(([reference, digest]) => ({ reference, digest }))
        .sort((left, right) => left.reference.localeCompare(right.reference)),
    );
    const readinessStatus = generationCompletionStatus(pipelineVersion);
    const generatedSectionCount = generated.reduce((total, page) => total + page.sections.length, 0);
    await input.persistence.completeRun({
      outputContentDigestSha256,
      pageCountCompleted: completed.size,
      sectionCountCompleted: generatedSectionCount || sectionCountPlanned,
      readinessStatus,
    });
    return {
      status: readinessStatus,
      pageReferences: [...completed].sort(),
      outputContentDigestSha256,
      promptTemplateVersion: SITE_GENERATION_PROMPT_TEMPLATE_VERSION,
      ...(specialistArtifacts
        ? { specialistAgentTeamVersion: SPECIALIST_AGENT_TEAM_VERSION }
        : {}),
      refinementCompleted: Boolean(specialistArtifacts),
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
        : 'The initial structured draft could not be completed.',
    });
    throw error;
  }
}
