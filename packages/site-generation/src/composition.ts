import {
  getSiteComponent,
  listSiteComponents,
  SITE_COMPONENT_REGISTRY_VERSION,
  type SiteComponentDefinition,
} from '@ks-os/site-components';
import type { SiteGenerationKnowledgeContext } from '@ks-os/site-knowledge';
import type { z } from 'zod';
import {
  type BlueprintGenerationPageSchema,
  type GenerationFinding,
  type GenerationPlan,
  type PageCompositionPlan,
  type SiteCompositionStrategy,
  type TemplateGenerationConstraint,
  type VerifiedBusinessFacts,
} from './contracts.js';
import { selectGenerationSafeFacts } from './facts.js';
import { stableGenerationStringify } from './normalization.js';
import { pageCompletenessRecipe } from './recipes.js';

type BlueprintPage = z.infer<typeof BlueprintGenerationPageSchema>;

function finding(code: string, message: string, targetReference?: string): GenerationFinding {
  return {
    severity: 'ERROR',
    category: 'DESIGN',
    code,
    message,
    ...(targetReference ? { targetReference } : {}),
  };
}

function availableComponents(
  page: BlueprintPage,
  template: TemplateGenerationConstraint,
) {
  const allowed = new Set(template.availableComponentKeys);
  const recipe = pageCompletenessRecipe(page.pageType);
  const supportedTypes = new Set([
    ...page.plannedSectionTypes,
    ...template.requiredSectionTypes,
    ...template.sectionOrder,
    ...recipe.recommendedSectionTypes,
  ].filter(type => !template.prohibitedSectionTypes.includes(type)));
  return listSiteComponents({
    pageType: page.pageType,
    conversionRole: page.conversionRole,
  }).filter(component =>
    component.compatibleSectionTypes.some(type => supportedTypes.has(type))
    && (allowed.size === 0 || allowed.has(component.componentKey)));
}

export function componentPromptMetadata(component: SiteComponentDefinition) {
  return {
    componentKey: component.componentKey,
    sectionType: component.sectionType,
    compatibleSectionTypes: component.compatibleSectionTypes,
    supportedPageTypes: component.supportedPageTypes,
    supportedConversionRoles: component.supportedConversionRoles,
    requiredDataBindings: component.requiredDataBindings,
    optionalDataBindings: component.optionalDataBindings,
    supportedAssetSlots: component.supportedAssetSlots,
    requiredAssetSlots: component.requiredAssetSlots,
    contentSlots: component.contentSlots,
    layoutIntent: component.layoutIntent,
    visualWeight: component.visualWeight,
    recommendedPosition: component.recommendedPosition,
    classification: component.classification,
    mobileBehaviour: component.mobileBehaviour,
    accessibilityContract: component.accessibilityContract,
    compatibilityRules: component.compatibilityRules,
  };
}

export function composeSiteStrategyPrompt(input: {
  plan: GenerationPlan;
  facts: VerifiedBusinessFacts;
  componentCount?: number;
}) {
  return stableGenerationStringify({
    systemContract: [
      'Create a site-wide design and composition strategy using only verified inputs.',
      'Return structured JSON only. Do not return HTML, CSS, JavaScript, framework code, URLs or embeds.',
      'Do not invent brand history, claims, services, staff, locations, testimonials, results or assets.',
      'Describe purposeful cross-page variation and mobile-first behaviour.',
    ],
    operation: 'SITE_COMPOSITION_STRATEGY_V2',
    componentRegistryVersion: SITE_COMPONENT_REGISTRY_VERSION,
    availableComponentCount: input.componentCount ?? listSiteComponents().length,
    approvedBlueprint: input.plan,
    verifiedBusinessFacts: selectGenerationSafeFacts(input.facts),
  });
}

export function composePageCompositionPrompt(input: {
  page: BlueprintPage;
  template: TemplateGenerationConstraint;
  strategy: SiteCompositionStrategy;
  facts: VerifiedBusinessFacts;
  knowledge: SiteGenerationKnowledgeContext;
  approvedPageReferences: readonly string[];
}) {
  const catalog = availableComponents(input.page, input.template).map(componentPromptMetadata);
  return stableGenerationStringify({
    systemContract: [
      'Create a page composition plan; do not write final page copy.',
      'Select only componentKey values in the supplied page-scoped component catalog.',
      'Preserve the exact approved page identity. Treat the legacy planned sections as a seed, then create a complete purposeful sequence within the approved layout manifest and page recipe.',
      'Use only approved public references. Never invent an asset reference or external URL.',
      'Return structured JSON only; never return HTML, CSS, JavaScript, React, Astro or Tailwind.',
    ],
    operation: 'PAGE_COMPOSITION_PLAN_V2',
    siteStrategy: input.strategy,
    pageRecipe: pageCompletenessRecipe(input.page.pageType),
    approvedBlueprintPage: input.page,
    templateConstraints: input.template,
    componentCatalog: catalog,
    approvedPageReferences: input.approvedPageReferences,
    verifiedBusinessFacts: selectGenerationSafeFacts(input.facts),
    applicableKnowledge: {
      ruleIds: input.knowledge.applicableRuleIds,
      requiredInstructions: input.knowledge.requiredInstructions,
      prohibitedBehaviours: input.knowledge.prohibitedBehaviours,
      pagePlaybook: input.knowledge.pagePlaybook,
    },
  });
}

export function validatePageCompositionPlan(input: {
  output: PageCompositionPlan;
  page: BlueprintPage;
  template: TemplateGenerationConstraint;
  approvedPageReferences: readonly string[];
  approvedAssetReferences?: readonly string[];
}): GenerationFinding[] {
  const findings: GenerationFinding[] = [];
  if (input.output.pageReference !== input.page.pageReference) {
    findings.push(finding('COMPOSITION_PAGE_REFERENCE_CHANGED', 'The composition plan changed the approved page reference.', input.page.pageReference));
  }
  const approvedPages = new Set(input.approvedPageReferences);
  for (const link of input.output.internalLinkIntent) {
    if (!approvedPages.has(link.targetPageReference)) {
      findings.push(finding('INTERNAL_LINKING_INCOMPLETE', 'The page plan links outside the approved blueprint.', input.page.pageReference));
    }
  }
  const selectedTypes = input.output.selectedComponents.map(selection => selection.sectionType);
  const selectedTypeSet = new Set(selectedTypes);
  for (const requiredType of input.template.requiredSectionTypes) {
    if (!selectedTypeSet.has(requiredType)) {
      findings.push(finding('MISSING_PAGE_PURPOSE_CONTENT', `The composition plan omitted required layout capability ${requiredType}.`, input.page.pageReference));
    }
  }
  for (const prohibitedType of input.template.prohibitedSectionTypes) {
    if (selectedTypeSet.has(prohibitedType)) {
      findings.push(finding('COMPONENT_PAGE_INCOMPATIBLE', `The composition plan selected prohibited section ${prohibitedType}.`, input.page.pageReference));
    }
  }
  if (input.template.sectionOrder.length) {
    const positions = selectedTypes.map(type => input.template.sectionOrder.indexOf(type));
    if (positions.some(position => position < 0)
      || positions.some((position, index) => index > 0 && position < positions[index - 1]!)) {
      findings.push(finding('PAGE_COMPONENT_SEQUENCE_CHANGED', 'The composition plan violates the approved layout capability order.', input.page.pageReference));
    }
  }
  const templateKeys = new Set(input.template.availableComponentKeys);
  const approvedAssets = new Set(input.approvedAssetReferences ?? []);
  for (const selection of input.output.selectedComponents) {
    const component = getSiteComponent(selection.componentKey);
    if (!component) {
      findings.push(finding('UNKNOWN_COMPONENT_KEY', `Unknown componentKey ${selection.componentKey}.`, input.page.pageReference));
      continue;
    }
    if (component.status !== 'ACTIVE') {
      findings.push(finding('DISABLED_COMPONENT_KEY', `Disabled componentKey ${selection.componentKey}.`, input.page.pageReference));
    }
    if (!component.compatibleSectionTypes.includes(selection.sectionType)
      || !component.supportedPageTypes.includes(input.page.pageType)
      || !component.supportedConversionRoles.includes(input.page.conversionRole)) {
      findings.push(finding('COMPONENT_PAGE_INCOMPATIBLE', `${selection.componentKey} is incompatible with the planned section or page.`, input.page.pageReference));
    }
    if (templateKeys.size && !templateKeys.has(selection.componentKey)) {
      findings.push(finding('COMPONENT_NOT_IN_LAYOUT_MANIFEST', `${selection.componentKey} is absent from the approved layout manifest.`, input.page.pageReference));
    }
    if (component.requiredDataBindings.some(binding => !selection.dataBindings.includes(binding))) {
      findings.push(finding('COMPONENT_REQUIRED_BINDING_MISSING', `${selection.componentKey} is missing a required data binding.`, input.page.pageReference));
    }
    const assignedSlots = new Set(selection.assetAssignments.map(assignment => assignment.slot));
    for (const requiredSlot of component.requiredAssetSlots) {
      if (!assignedSlots.has(requiredSlot)) {
        findings.push(finding('COMPONENT_REQUIRED_ASSET_INTENT_MISSING', `${selection.componentKey} is missing required asset intent for ${requiredSlot}.`, input.page.pageReference));
      }
    }
    for (const assignment of selection.assetAssignments) {
      if (!component.supportedAssetSlots.includes(assignment.slot)) {
        findings.push(finding('COMPONENT_ASSET_SLOT_UNSUPPORTED', `${selection.componentKey} does not support asset slot ${assignment.slot}.`, input.page.pageReference));
      }
      if (assignment.assetReference && !approvedAssets.has(assignment.assetReference)) {
        findings.push(finding('CROSS_TENANT_ASSET_REJECTED', `${selection.componentKey} selected an asset outside the approved tenant inventory.`, input.page.pageReference));
      }
    }
  }
  const recipe = pageCompletenessRecipe(input.page.pageType);
  for (const alternatives of recipe.requiredAnyOf) {
    if (!alternatives.some(type => selectedTypeSet.has(type))) {
      findings.push(finding('MISSING_PAGE_PURPOSE_CONTENT', `The page-purpose recipe requires one of: ${alternatives.join(', ')}.`, input.page.pageReference));
    }
  }
  if (!recipe.bookingDepthExempt) {
    const classifications = input.output.selectedComponents.map(selection =>
      getSiteComponent(selection.componentKey)?.classification);
    const meaningful = classifications.filter(classification =>
      classification !== 'CHROME' && classification !== 'CONVERSION').length;
    const substantive = classifications.filter(classification =>
      classification === 'PRIMARY' || classification === 'SUBSTANTIVE' || classification === 'LEGAL').length;
    const supporting = classifications.filter(classification => classification === 'SUPPORTING').length;
    if (meaningful < recipe.minMeaningfulSections && !input.output.designExemption) {
      findings.push(finding('PAGE_TOO_SHALLOW', `The page plan has ${meaningful} meaningful sections; ${recipe.minMeaningfulSections} are required.`, input.page.pageReference));
    }
    if (substantive < recipe.minSubstantiveSections && !input.output.designExemption) {
      findings.push(finding('PAGE_SUBSTANTIVE_DEPTH_MISSING', `The page plan has ${substantive} substantive sections; ${recipe.minSubstantiveSections} are required.`, input.page.pageReference));
    }
    if (supporting < recipe.minSupportingSections && !input.output.designExemption) {
      findings.push(finding('PAGE_SUPPORTING_EVIDENCE_MISSING', `The page plan has ${supporting} supporting sections; ${recipe.minSupportingSections} are required.`, input.page.pageReference));
    }
    if (input.approvedPageReferences.length > 1 && input.output.internalLinkIntent.length === 0) {
      findings.push(finding('INTERNAL_LINKING_INCOMPLETE', 'The page plan requires at least one purposeful link to another approved page.', input.page.pageReference));
    }
    if (!selectedTypes.some(type => type === 'BOOKING_CTA' || type === 'FINAL_CTA')) {
      findings.push(finding('CONVERSION_INTENT_MISSING', 'The page plan requires a governed end-of-page booking conversion component.', input.page.pageReference));
    }
    if (input.output.selectedComponents.length > recipe.maxRecommendedSections && !input.output.designExemption) {
      findings.push(finding('PAGE_COMPOSITION_OVERFULL', `The page plan exceeds the recommended ${recipe.maxRecommendedSections} section limit.`, input.page.pageReference));
    }
  }
  return findings;
}

export const SITE_STRATEGY_RESPONSE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'brandMood', 'visualDirection', 'typographicIntent', 'spacingIntent',
    'imageStrategy', 'surfaceStrategy', 'heroStrategy', 'cardStrategy',
    'conversionStrategy', 'trustStrategy', 'pageRhythm',
    'sectionDiversityStrategy', 'mobileStrategy', 'recommendedDesignTokens',
  ],
  properties: {
    ...Object.fromEntries([
      'brandMood', 'visualDirection', 'typographicIntent', 'spacingIntent',
      'imageStrategy', 'surfaceStrategy', 'heroStrategy', 'cardStrategy',
      'conversionStrategy', 'trustStrategy', 'pageRhythm',
      'sectionDiversityStrategy', 'mobileStrategy',
    ].map(key => [key, { type: 'string', minLength: 10, maxLength: 500 }])),
    recommendedDesignTokens: {
      type: 'object',
      additionalProperties: false,
      required: ['designVersion', 'typography', 'layout', 'shape', 'surface', 'elevation', 'buttons', 'imagery', 'sectionRhythm'],
      properties: {
        designVersion: { type: 'integer', enum: [2] },
        typography: enumObject({
          displayFont: ['SYSTEM_SANS', 'SYSTEM_SERIF', 'EDITORIAL_SERIF'],
          headingFont: ['SYSTEM_SANS', 'SYSTEM_SERIF', 'EDITORIAL_SERIF'],
          bodyFont: ['SYSTEM_SANS', 'SYSTEM_SERIF'],
          displayScale: ['RESTRAINED', 'BALANCED', 'DRAMATIC'],
          headingScale: ['COMPACT', 'BALANCED', 'EXPRESSIVE'],
          bodyScale: ['COMPACT', 'STANDARD', 'GENEROUS'],
          headingWeight: ['REGULAR', 'MEDIUM', 'SEMIBOLD', 'BOLD'],
          bodyWeight: ['REGULAR', 'MEDIUM'],
          displayTracking: ['TIGHT', 'NORMAL', 'WIDE'],
          headingTracking: ['TIGHT', 'NORMAL', 'WIDE'],
          headingLineHeight: ['TIGHT', 'STANDARD', 'RELAXED'],
          bodyLineHeight: ['STANDARD', 'RELAXED', 'SPACIOUS'],
        }),
        layout: enumObject({
          containerWidths: ['COMPACT_RANGE', 'BALANCED_RANGE', 'EXPANSIVE_RANGE'],
          pageGutter: ['COMPACT', 'STANDARD', 'GENEROUS'],
          sectionSpacing: ['COMPACT', 'STANDARD', 'EXPANSIVE'],
          contentSpacing: ['TIGHT', 'STANDARD', 'RELAXED'],
          gridColumns: ['TEN', 'TWELVE', 'SIXTEEN'],
          gridGap: ['TIGHT', 'STANDARD', 'GENEROUS'],
          textMeasure: ['NARROW', 'READABLE', 'WIDE'],
        }),
        shape: enumObject({
          radiusScale: ['NONE', 'SUBTLE', 'SOFT', 'ROUNDED'],
          cardRadius: ['NONE', 'SMALL', 'MEDIUM', 'LARGE'],
          buttonRadius: ['SQUARE', 'SOFT', 'PILL'],
          imageRadius: ['NONE', 'SMALL', 'MEDIUM', 'LARGE'],
        }),
        surface: {
          type: 'object',
          additionalProperties: false,
          required: ['background', 'surface', 'surfaceAlt', 'border', 'mutedSurface'],
          properties: Object.fromEntries(['background', 'surface', 'surfaceAlt', 'border', 'mutedSurface'].map(key => [key, {
            type: 'string', pattern: '^#[0-9A-Fa-f]{6}$',
          }])),
        },
        elevation: { type: 'string', enum: ['NONE', 'SUBTLE', 'MEDIUM', 'STRONG'] },
        buttons: enumObject({
          height: ['COMPACT', 'STANDARD', 'LARGE'],
          padding: ['COMPACT', 'STANDARD', 'GENEROUS'],
          weight: ['MEDIUM', 'SEMIBOLD', 'BOLD'],
          primaryStyle: ['SOLID', 'OUTLINE', 'SOFT', 'HIGH_CONTRAST'],
          secondaryStyle: ['TEXT', 'OUTLINE', 'SOFT'],
        }),
        imagery: enumObject({
          defaultAspectRatio: ['SQUARE', 'FOUR_THREE', 'THREE_TWO', 'SIXTEEN_NINE'],
          portraitAspectRatio: ['THREE_FOUR', 'FOUR_FIVE', 'TWO_THREE'],
          serviceAspectRatio: ['SQUARE', 'FOUR_THREE', 'THREE_TWO', 'SIXTEEN_NINE'],
          cropMode: ['COVER', 'CONTAIN'],
          focalBehaviour: ['ASSET_FOCAL_POINT', 'CENTRE', 'TOP'],
          imageTreatment: ['NATURAL', 'EDITORIAL', 'SOFTENED', 'HIGH_CONTRAST', 'MONOCHROME'],
        }),
        sectionRhythm: { type: 'string', enum: ['CONTINUOUS', 'ALTERNATING_SURFACES', 'EDITORIAL', 'HIGH_CONTRAST', 'SOFT_LUXURY'] },
      },
    },
  },
};

function enumObject(properties: Record<string, readonly string[]>): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties: Object.fromEntries(Object.entries(properties).map(([key, values]) => [key, {
      type: 'string', enum: values,
    }])),
  };
}

export function pageCompositionResponseJsonSchema(input: {
  page: BlueprintPage;
  template: TemplateGenerationConstraint;
  approvedPageReferences: readonly string[];
}): Record<string, unknown> {
  const catalog = availableComponents(input.page, input.template);
  return {
    type: 'object',
    additionalProperties: false,
    required: ['pageReference', 'pagePurpose', 'conversionGoal', 'contentNarrative', 'selectedComponents', 'internalLinkIntent', 'ctaIntent'],
    properties: {
      pageReference: { type: 'string', enum: [input.page.pageReference] },
      pagePurpose: { type: 'string', minLength: 10, maxLength: 800 },
      conversionGoal: { type: 'string', minLength: 10, maxLength: 500 },
      contentNarrative: { type: 'string', minLength: 10, maxLength: 1_000 },
      selectedComponents: {
        type: 'array', minItems: 1, maxItems: 100,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['sectionType', 'componentKey', 'purpose', 'dataBindings', 'assetAssignments'],
          properties: {
            sectionType: { type: 'string', enum: [...new Set(catalog.flatMap(component => component.compatibleSectionTypes))] },
            componentKey: { type: 'string', enum: catalog.map(component => component.componentKey) },
            purpose: { type: 'string', minLength: 5, maxLength: 500 },
            dataBindings: {
              type: 'array', maxItems: 12, uniqueItems: true,
              items: { type: 'string', enum: ['BUSINESS', 'SERVICES', 'LOCATIONS', 'STAFF', 'BOOKING', 'TESTIMONIALS', 'GALLERY', 'RESULTS', 'OPENING_HOURS', 'CONTACT', 'POLICIES'] },
            },
            assetAssignments: {
              type: 'array', maxItems: 12,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['slot'],
                properties: {
                  slot: { type: 'string', enum: ['LOGO', 'PRIMARY_IMAGE', 'SECONDARY_IMAGE', 'PORTRAIT', 'LOCATION_IMAGE', 'GALLERY_SET', 'RESULT_PAIR', 'DECORATIVE_IMAGE'] },
                  assetReference: { type: 'string', format: 'uuid' },
                  placeholderCode: { type: 'string', enum: ['SERVICE_IMAGE_REQUIRED', 'STAFF_PORTRAIT_REQUIRED', 'LOCATION_IMAGE_REQUIRED', 'GALLERY_ASSET_REQUIRED', 'RESULT_ASSET_REQUIRED', 'BRAND_IMAGE_REQUIRED'] },
                },
              },
            },
          },
        },
      },
      internalLinkIntent: {
        type: 'array', maxItems: 100,
        items: {
          type: 'object', additionalProperties: false, required: ['targetPageReference', 'intent'],
          properties: {
            targetPageReference: { type: 'string', enum: input.approvedPageReferences },
            intent: { type: 'string', minLength: 5, maxLength: 300 },
          },
        },
      },
      ctaIntent: { type: 'string', minLength: 10, maxLength: 500 },
      designExemption: {
        type: 'object', additionalProperties: false, required: ['code', 'rationale'],
        properties: {
          code: { type: 'string', minLength: 3, maxLength: 100 },
          rationale: { type: 'string', minLength: 20, maxLength: 500 },
        },
      },
    },
  };
}
