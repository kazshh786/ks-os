import type { GenerationPlan, TemplateGenerationConstraint } from './contracts.js';

export interface PlanValidationResult {
  valid: boolean;
  findings: Array<{ code: string; message: string }>;
}

export function validateGenerationPlan(
  plan: GenerationPlan,
  constraints: readonly TemplateGenerationConstraint[],
): PlanValidationResult {
  const findings: PlanValidationResult['findings'] = [];
  const seenSlugs = new Set<string>();
  const constraintByLayout = new Map(constraints.map(item => [item.layoutReference, item]));
  for (const page of plan.pages) {
    if (seenSlugs.has(page.slug)) {
      findings.push({ code: 'DUPLICATE_PAGE_SLUG', message: `Duplicate approved slug: ${page.slug}.` });
    }
    seenSlugs.add(page.slug);
    const template = constraintByLayout.get(page.layoutReference);
    if (!template) {
      findings.push({ code: 'LAYOUT_NOT_APPROVED', message: 'The approved page layout is unavailable.' });
      continue;
    }
    if (!template.compatiblePageTypes.includes(page.pageType)) {
      findings.push({ code: 'LAYOUT_PAGE_TYPE_INCOMPATIBLE', message: 'The layout is incompatible with the approved page type.' });
    }
    if (template.templateVersionReference !== plan.templateVersionReference) {
      findings.push({ code: 'TEMPLATE_VERSION_MISMATCH', message: 'The layout is not from the pinned template version.' });
    }
    if (template.templateSourceType === 'ENVATO_HTML' && template.licenceStatus !== 'ACTIVE') {
      findings.push({ code: 'TEMPLATE_LICENCE_REQUIRED', message: 'An active Envato licence is required.' });
    }
    for (const required of template.requiredSectionTypes) {
      if (!page.plannedSectionTypes.includes(required)) {
        findings.push({ code: 'TEMPLATE_SECTION_REQUIRED', message: `The layout requires ${required}.` });
      }
    }
    for (const prohibited of template.prohibitedSectionTypes) {
      if (page.plannedSectionTypes.includes(prohibited)) {
        findings.push({ code: 'TEMPLATE_SECTION_PROHIBITED', message: `The layout prohibits ${prohibited}.` });
      }
    }
  }
  return { valid: findings.length === 0, findings };
}

export function assertGeneratedPageSetMatchesPlan(
  plan: GenerationPlan,
  generatedPageReferences: readonly string[],
) {
  const approved = new Set(plan.pages.map(page => page.pageReference));
  const actual = new Set(generatedPageReferences);
  if (actual.size !== generatedPageReferences.length) {
    throw new Error('Completed pages must not be duplicated on resume.');
  }
  if ([...actual].some(reference => !approved.has(reference))) {
    throw new Error('Generation cannot add a page absent from the approved blueprint.');
  }
  if (actual.size !== approved.size) {
    throw new Error('A complete site run must generate every approved blueprint page.');
  }
}
