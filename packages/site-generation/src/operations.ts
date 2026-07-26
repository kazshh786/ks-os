import type { SiteGenerationKnowledgeContext } from '@ks-os/site-knowledge';
import { type z } from 'zod';
import {
  GeneratedMetadataSchema,
  GeneratedPageSchema,
  GeneratedSectionSchema,
  GeneratedStructuredDataSchema,
  RegenerationInstructionSchema,
  type GeneratedPage,
  type GenerationFinding,
  type TemplateGenerationConstraint,
  type VerifiedBusinessFacts,
} from './contracts.js';
import { generationDigest, stableGenerationStringify } from './normalization.js';
import { composeGenerationPrompt } from './prompt.js';
import { selectGenerationSafeFacts } from './facts.js';
import type { SiteGenerationProvider } from './provider.js';
import { generateWithControlledRepair } from './repair.js';
import { validateGeneratedPage } from './validation.js';
import { GENERATED_PAGE_RESPONSE_JSON_SCHEMA } from './orchestrator.js';

const GENERATED_SECTION_RESPONSE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['pageReference', 'sectionReference', 'section', 'missingDataFindings', 'claims'],
  properties: {
    pageReference: { type: 'string', format: 'uuid' },
    sectionReference: { type: 'string', format: 'uuid' },
    section: { type: 'object' },
    missingDataFindings: { type: 'array', items: { type: 'object' } },
    claims: { type: 'array', items: { type: 'object' } },
  },
};

const GENERATED_METADATA_RESPONSE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['pageReference', 'seo'],
  properties: {
    pageReference: { type: 'string', format: 'uuid' },
    seo: { type: 'object' },
  },
};

const GENERATED_STRUCTURED_DATA_RESPONSE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['pageReference', 'inputs'],
  properties: {
    pageReference: { type: 'string', format: 'uuid' },
    inputs: { type: 'array', items: { type: 'object' } },
  },
};

type BlueprintPage = Parameters<typeof composeGenerationPrompt>[0]['page'];

export interface StructuredOperationOptions {
  provider: SiteGenerationProvider;
  maxRepairAttempts: number;
  maxOutputCharacters: number;
  signal?: AbortSignal;
}

export async function executeStructuredPageGeneration(input:
  StructuredOperationOptions & {
    page: BlueprintPage;
    template: TemplateGenerationConstraint;
    facts: VerifiedBusinessFacts;
    knowledge: SiteGenerationKnowledgeContext;
    approvedPageReferences: readonly string[];
  }) {
  const result = await generateWithControlledRepair<GeneratedPage>({
    provider: input.provider,
    maxRepairAttempts: input.maxRepairAttempts,
    buildRequest: (repairAttempt, previousFindings) => {
      const composed = composeGenerationPrompt({
        page: input.page,
        template: input.template,
        facts: input.facts,
        knowledge: input.knowledge,
        outputSchemaDescription: GENERATED_PAGE_RESPONSE_JSON_SCHEMA,
        ...(repairAttempt > 0
          ? { repair: { attempt: repairAttempt, findings: previousFindings } }
          : {}),
      });
      return {
        prompt: composed.prompt,
        outputSchema: GeneratedPageSchema as z.ZodType<GeneratedPage>,
        responseJsonSchema: GENERATED_PAGE_RESPONSE_JSON_SCHEMA,
        maxOutputCharacters: input.maxOutputCharacters,
        signal: input.signal,
      };
    },
    validate: value => validateGeneratedPage({
      output: value,
      expected: {
        pageReference: input.page.pageReference,
        pageType: input.page.pageType,
        conversionRole: input.page.conversionRole,
        slug: input.page.slug,
        layoutReference: input.page.layoutReference,
      },
      template: input.template,
      facts: input.facts,
      approvedPageReferences: input.approvedPageReferences,
    }),
  });
  const validation = validateGeneratedPage({
    output: result.response.value,
    expected: {
      pageReference: input.page.pageReference,
      pageType: input.page.pageType,
      conversionRole: input.page.conversionRole,
      slug: input.page.slug,
      layoutReference: input.page.layoutReference,
    },
    template: input.template,
    facts: input.facts,
    approvedPageReferences: input.approvedPageReferences,
  });
  return {
    page: result.response.value,
    findings: validation.findings,
    repairAttempts: result.repairAttempts,
    providerKey: result.response.providerKey,
    modelKey: result.response.modelKey,
    outputContentDigestSha256: generationDigest(result.response.value),
  };
}

function operationPrompt(input: Record<string, unknown>) {
  return stableGenerationStringify({
    systemGenerationContract: [
      'Return only JSON matching the supplied schema.',
      'Never return HTML, CSS, JavaScript, executable code, embeds, or external booking URLs.',
      'Never invent business facts or claims.',
      'Native KS OS booking is the only primary conversion.',
    ],
    ...input,
  });
}

const EXECUTABLE_TEXT = /(?:<\/?[a-z][^>]*>|javascript:|data:text\/html|```(?:html|css|js|javascript)|\b(?:eval|new\s+Function)\s*\()/i;

function pageValidationInput(input: {
  page: GeneratedPage;
  template: TemplateGenerationConstraint;
  facts: VerifiedBusinessFacts;
  approvedPageReferences: readonly string[];
}) {
  return {
    output: input.page,
    expected: {
      pageReference: input.page.pageReference,
      pageType: input.page.pageType,
      conversionRole: input.page.conversionRole,
      slug: input.page.slug,
      layoutReference: input.page.layoutReference,
    },
    template: input.template,
    facts: input.facts,
    approvedPageReferences: input.approvedPageReferences,
  } as const;
}

export async function executeStructuredSectionRegeneration(input:
  StructuredOperationOptions & {
    currentPage: GeneratedPage;
    sectionReference: string;
    instruction: string;
    template: TemplateGenerationConstraint;
    facts: VerifiedBusinessFacts;
    knowledge: SiteGenerationKnowledgeContext;
    approvedPageReferences: readonly string[];
  }) {
  const instruction = RegenerationInstructionSchema.parse(input.instruction);
  const sectionIndex = input.currentPage.sections.findIndex(
    section => section.reference === input.sectionReference,
  );
  if (sectionIndex < 0) throw new Error('The draft section does not belong to the page.');
  const currentSection = input.currentPage.sections[sectionIndex]!;
  const result = await generateWithControlledRepair<z.output<typeof GeneratedSectionSchema>>({
    provider: input.provider,
    maxRepairAttempts: input.maxRepairAttempts,
    buildRequest: (repairAttempt, previousFindings) => ({
      prompt: operationPrompt({
        operation: 'REGENERATE_SECTION',
        instruction,
        immutableIdentity: {
          pageReference: input.currentPage.pageReference,
          sectionReference: input.sectionReference,
          sectionType: currentSection.type,
        },
        currentStructuredSection: currentSection,
        safeVerifiedFacts: selectGenerationSafeFacts(input.facts),
        applicableRuleIds: input.knowledge.applicableRuleIds,
        requiredInstructions: input.knowledge.requiredInstructions,
        prohibitedBehaviours: input.knowledge.prohibitedBehaviours,
        nativeBookingRequirements: { actionType: 'KS_OS_BOOKING', destinationResolvedByServer: true },
        outputSchema: GENERATED_SECTION_RESPONSE_JSON_SCHEMA,
        repair: repairAttempt > 0 ? { repairAttempt, previousFindings } : undefined,
      }),
      outputSchema: GeneratedSectionSchema as z.ZodType<z.output<typeof GeneratedSectionSchema>>,
      responseJsonSchema: GENERATED_SECTION_RESPONSE_JSON_SCHEMA,
      maxOutputCharacters: input.maxOutputCharacters,
      signal: input.signal,
    }),
    validate: value => {
      const findings: GenerationFinding[] = [];
      findings.push(...value.missingDataFindings);
      if (value.pageReference !== input.currentPage.pageReference
        || value.sectionReference !== input.sectionReference) {
        findings.push({
          severity: 'ERROR', category: 'SCHEMA', code: 'SECTION_IDENTITY_MISMATCH',
          message: 'Section regeneration changed a pinned public reference.',
          targetReference: input.sectionReference,
        });
      }
      if (value.section.type !== currentSection.type) {
        findings.push({
          severity: 'ERROR', category: 'TEMPLATE', code: 'SECTION_TYPE_CHANGED',
          message: 'Section regeneration changed the approved section type.',
          targetReference: input.sectionReference,
        });
      }
      const candidate: GeneratedPage = {
        ...input.currentPage,
        sections: input.currentPage.sections.map((section, index) =>
          index === sectionIndex ? value.section : section),
        claims: [...input.currentPage.claims, ...value.claims],
        missingDataFindings: [
          ...input.currentPage.missingDataFindings,
          ...value.missingDataFindings,
        ],
      };
      findings.push(...validateGeneratedPage(pageValidationInput({
        page: candidate,
        template: input.template,
        facts: input.facts,
        approvedPageReferences: input.approvedPageReferences,
      })).findings);
      return { valid: !findings.some(finding => finding.severity === 'ERROR'), findings };
    },
  });
  return {
    output: result.response.value,
    repairAttempts: result.repairAttempts,
    outputContentDigestSha256: generationDigest(result.response.value.section),
  };
}

export async function executeStructuredMetadataGeneration(input:
  StructuredOperationOptions & {
    page: GeneratedPage;
    facts: VerifiedBusinessFacts;
    knowledge: SiteGenerationKnowledgeContext;
  }) {
  const result = await generateWithControlledRepair({
    provider: input.provider,
    maxRepairAttempts: input.maxRepairAttempts,
    buildRequest: (repairAttempt, previousFindings) => ({
      prompt: operationPrompt({
        operation: 'GENERATE_METADATA',
        immutablePage: {
          pageReference: input.page.pageReference,
          pageType: input.page.pageType,
          title: input.page.title,
          slug: input.page.slug,
        },
        safeVerifiedFacts: selectGenerationSafeFacts(input.facts),
        applicableRuleIds: input.knowledge.applicableRuleIds,
        outputSchema: GENERATED_METADATA_RESPONSE_JSON_SCHEMA,
        repair: repairAttempt > 0 ? { repairAttempt, previousFindings } : undefined,
      }),
      outputSchema: GeneratedMetadataSchema,
      responseJsonSchema: GENERATED_METADATA_RESPONSE_JSON_SCHEMA,
      maxOutputCharacters: input.maxOutputCharacters,
      signal: input.signal,
    }),
    validate: value => {
      const findings: Array<{ code: string; message: string }> = [];
      if (value.pageReference !== input.page.pageReference) {
        findings.push({ code: 'PAGE_IDENTITY_MISMATCH', message: 'Metadata changed the page reference.' });
      }
      const expectedPath = `/${input.page.slug}`;
      if (value.seo.canonicalPath !== expectedPath) {
        findings.push({ code: 'CANONICAL_PATH_MISMATCH', message: 'Metadata changed the canonical page path.' });
      }
      if ([
        value.seo.title,
        value.seo.description,
        value.seo.openGraphTitle,
        value.seo.openGraphDescription,
      ].some(text => EXECUTABLE_TEXT.test(text))) {
        findings.push({ code: 'UNSAFE_METADATA', message: 'Metadata must contain plain text only.' });
      }
      return { valid: findings.length === 0, findings };
    },
  });
  return {
    output: result.response.value,
    repairAttempts: result.repairAttempts,
    outputContentDigestSha256: generationDigest(result.response.value),
  };
}

export async function executeStructuredDataGeneration(input:
  StructuredOperationOptions & {
    page: GeneratedPage;
    facts: VerifiedBusinessFacts;
    knowledge: SiteGenerationKnowledgeContext;
  }) {
  const result = await generateWithControlledRepair({
    provider: input.provider,
    maxRepairAttempts: input.maxRepairAttempts,
    buildRequest: (repairAttempt, previousFindings) => ({
      prompt: operationPrompt({
        operation: 'GENERATE_STRUCTURED_DATA_INPUTS',
        immutablePage: {
          pageReference: input.page.pageReference,
          pageType: input.page.pageType,
          title: input.page.title,
        },
        safeVerifiedFacts: selectGenerationSafeFacts(input.facts),
        applicableRuleIds: input.knowledge.applicableRuleIds,
        prohibitedBehaviours: input.knowledge.prohibitedBehaviours,
        outputSchema: GENERATED_STRUCTURED_DATA_RESPONSE_JSON_SCHEMA,
        repair: repairAttempt > 0 ? { repairAttempt, previousFindings } : undefined,
      }),
      outputSchema: GeneratedStructuredDataSchema,
      responseJsonSchema: GENERATED_STRUCTURED_DATA_RESPONSE_JSON_SCHEMA,
      maxOutputCharacters: input.maxOutputCharacters,
      signal: input.signal,
    }),
    validate: value => {
      const findings: Array<{ code: string; message: string }> = [];
      if (value.pageReference !== input.page.pageReference) {
        findings.push({ code: 'PAGE_IDENTITY_MISMATCH', message: 'Structured data changed the page reference.' });
      }
      const serviceReferences = new Set(input.facts.services.map(item => item.publicReference));
      const locationReferences = new Set(input.facts.locations.map(item => item.publicReference));
      const approvedPages = new Set([input.page.pageReference, ...input.page.internalLinks.map(link => link.targetPageReference)]);
      for (const item of value.inputs) {
        if (EXECUTABLE_TEXT.test(JSON.stringify(item))) {
          findings.push({ code: 'EXECUTABLE_STRUCTURED_DATA_FORBIDDEN', message: 'Structured-data inputs must contain plain structured values only.' });
        }
        if (item.type === 'SERVICE' && !serviceReferences.has(item.serviceReference)) {
          findings.push({ code: 'UNKNOWN_SERVICE_REFERENCE', message: 'Structured data references an unknown service.' });
        }
        if (item.type === 'LOCAL_BUSINESS' && item.locationReference
          && !locationReferences.has(item.locationReference)) {
          findings.push({ code: 'UNKNOWN_LOCATION_REFERENCE', message: 'Structured data references an unknown location.' });
        }
        if (item.type === 'BREADCRUMB'
          && item.pageReferences.some(reference => !approvedPages.has(reference))) {
          findings.push({ code: 'UNKNOWN_INTERNAL_PAGE_REFERENCE', message: 'Structured data references an unapproved page.' });
        }
      }
      return { valid: findings.length === 0, findings };
    },
  });
  return {
    output: result.response.value,
    repairAttempts: result.repairAttempts,
    outputContentDigestSha256: generationDigest(result.response.value),
  };
}
