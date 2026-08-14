import {
  componentForSection,
  getSiteComponent,
  type SiteComponentClassification,
} from '@ks-os/site-components';
import type { PublishedPageSnapshot, SiteSection } from '@ks-os/site-schema';
import type {
  GeneratedPage,
  GenerationFinding,
  PageCompletenessState,
} from './contracts.js';
import { pageCompletenessRecipe } from './recipes.js';

export interface BrowserViewportEvidence {
  width: 390 | 768 | 1440;
  height: number;
  rendered: boolean;
  consoleErrorCount: number;
  horizontalOverflowPixels: number;
  clippedTextCount: number;
  overlappingActionCount: number;
  undersizedTouchTargetCount: number;
  brokenImageCount: number;
  emptySectionCount: number;
  headingOrderValid: boolean;
  navigationUsable: boolean;
  footerComplete: boolean;
}

export interface BrowserQualityEvidence {
  pageReference: string;
  viewports: readonly BrowserViewportEvidence[];
  reviewedWhitespaceOutliers: boolean;
  reviewedCardAlignment: boolean;
  reviewedImageCropping: boolean;
}

function finding(
  severity: GenerationFinding['severity'],
  category: GenerationFinding['category'],
  code: string,
  message: string,
  targetReference: string,
): GenerationFinding {
  return { severity, category, code, message, targetReference };
}

function contentStrings(value: unknown, parentKey = ''): string[] {
  if (typeof value === 'string') {
    if (/reference|componentKey|type|variant/i.test(parentKey)) return [];
    return [value];
  }
  if (Array.isArray(value)) return value.flatMap(item => contentStrings(item, parentKey));
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .flatMap(([key, item]) => contentStrings(item, key));
  }
  return [];
}

function wordCount(value: unknown) {
  return contentStrings(value).join(' ').trim().split(/\s+/).filter(Boolean).length;
}

function sectionHasAsset(section: SiteSection) {
  const visit = (value: unknown, key = ''): boolean => {
    if (typeof value === 'string' && /assetreference/i.test(key)) return true;
    if (Array.isArray(value)) return value.some(item => visit(item, key));
    if (value && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).some(([childKey, item]) => visit(item, childKey));
    }
    return false;
  };
  return visit(section);
}

function classificationCounts(page: GeneratedPage | PublishedPageSnapshot) {
  const counts = new Map<SiteComponentClassification, number>();
  const components: string[] = [];
  const failures: string[] = [];
  for (const section of page.sections) {
    try {
      const component = componentForSection(section, page);
      components.push(component.componentKey);
      counts.set(component.classification, (counts.get(component.classification) ?? 0) + 1);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : 'Component resolution failed.');
    }
  }
  return { counts, components, failures };
}

export function validateBrowserQualityEvidence(
  evidence: BrowserQualityEvidence,
): GenerationFinding[] {
  const findings: GenerationFinding[] = [];
  const expected = new Set([390, 768, 1440]);
  for (const viewport of evidence.viewports) {
    expected.delete(viewport.width);
    if (!viewport.rendered || viewport.consoleErrorCount > 0) {
      findings.push(finding('ERROR', 'BROWSER', 'BROWSER_RENDER_FAILED', `The ${viewport.width}px render failed or emitted console errors.`, evidence.pageReference));
    }
    if (viewport.horizontalOverflowPixels > 0 || viewport.clippedTextCount > 0) {
      findings.push(finding('ERROR', 'BROWSER', 'RESPONSIVE_OVERFLOW', `The ${viewport.width}px render contains overflow or clipped text.`, evidence.pageReference));
    }
    if (viewport.overlappingActionCount > 0 || viewport.undersizedTouchTargetCount > 0) {
      findings.push(finding('ERROR', 'ACCESSIBILITY', 'RESPONSIVE_ACTION_UNUSABLE', `The ${viewport.width}px render contains overlapping or undersized actions.`, evidence.pageReference));
    }
    if (viewport.brokenImageCount > 0 || viewport.emptySectionCount > 0) {
      findings.push(finding('ERROR', 'BROWSER', 'VISUAL_CONTENT_INCOMPLETE', `The ${viewport.width}px render contains broken imagery or empty sections.`, evidence.pageReference));
    }
    if (!viewport.headingOrderValid || !viewport.navigationUsable || !viewport.footerComplete) {
      findings.push(finding('ERROR', 'ACCESSIBILITY', 'PAGE_CHROME_OR_HIERARCHY_INVALID', `The ${viewport.width}px render fails heading, navigation or footer checks.`, evidence.pageReference));
    }
  }
  if (expected.size) {
    findings.push(finding('ERROR', 'BROWSER', 'RESPONSIVE_EVIDENCE_INCOMPLETE', `Missing browser evidence at: ${[...expected].join(', ')}px.`, evidence.pageReference));
  }
  if (!evidence.reviewedWhitespaceOutliers || !evidence.reviewedCardAlignment || !evidence.reviewedImageCropping) {
    findings.push(finding('REVIEW', 'BROWSER', 'VISUAL_REVIEW_EVIDENCE_INCOMPLETE', 'Whitespace, card alignment and image cropping require recorded review evidence.', evidence.pageReference));
  }
  return findings;
}

export function validatePageCompleteness(input: {
  page: GeneratedPage | PublishedPageSnapshot;
  browserEvidence?: BrowserQualityEvidence;
}): {
  state: PageCompletenessState;
  findings: GenerationFinding[];
  metrics: {
    meaningfulSections: number;
    substantiveSections: number;
    supportingSections: number;
    substantiveWordCount: number;
    uniqueComponentCount: number;
  };
} {
  const { page } = input;
  const pageReference = 'pageReference' in page ? page.pageReference : page.publicReference;
  const recipe = pageCompletenessRecipe(page.pageType);
  const findings: GenerationFinding[] = [];
  const { counts, components, failures } = classificationCounts(page);
  failures.forEach(message => findings.push(finding('ERROR', 'DESIGN', 'UNKNOWN_COMPONENT_KEY', message, pageReference)));
  const substantiveSections = counts.get('SUBSTANTIVE') ?? 0;
  const supportingSections = counts.get('SUPPORTING') ?? 0;
  const meaningfulSections = substantiveSections + supportingSections + (counts.get('PRIMARY') ?? 0);
  const substantiveWordCount = wordCount(page.sections.filter(section => {
    try {
      const classification = componentForSection(section, page).classification;
      return classification === 'PRIMARY' || classification === 'SUBSTANTIVE' || classification === 'SUPPORTING' || classification === 'LEGAL';
    } catch {
      return false;
    }
  }));

  if (!recipe.bookingDepthExempt) {
    if (meaningfulSections < recipe.minMeaningfulSections) {
      findings.push(finding('ERROR', 'COMPLETENESS', 'PAGE_TOO_SHALLOW', `The page has ${meaningfulSections} meaningful sections; at least ${recipe.minMeaningfulSections} are required.`, pageReference));
    }
    if (substantiveSections < recipe.minSubstantiveSections) {
      findings.push(finding('ERROR', 'COMPLETENESS', 'INSUFFICIENT_SUBSTANTIVE_SECTIONS', `The page has ${substantiveSections} substantive sections; at least ${recipe.minSubstantiveSections} are required.`, pageReference));
    }
    if (supportingSections < recipe.minSupportingSections) {
      findings.push(finding('ERROR', 'COMPLETENESS', 'MISSING_PAGE_PURPOSE_CONTENT', 'The page lacks the supporting depth required for its purpose.', pageReference));
    }
    if (substantiveWordCount < recipe.minSubstantiveWords) {
      findings.push(finding('ERROR', 'COMPLETENESS', 'PAGE_TOO_SHALLOW', `The page has ${substantiveWordCount} substantive words; approximately ${recipe.minSubstantiveWords} useful words are required.`, pageReference));
    }
  }
  const types = new Set(page.sections.map(section => section.type));
  for (const alternatives of recipe.requiredAnyOf) {
    if (!alternatives.some(type => types.has(type))) {
      findings.push(finding('ERROR', 'COMPLETENESS', 'MISSING_PAGE_PURPOSE_CONTENT', `The ${page.pageType} recipe requires one of: ${alternatives.join(', ')}.`, pageReference));
    }
  }
  const typeSpecificCode: Partial<Record<typeof page.pageType, string>> = {
    HOME: 'INCOMPLETE_HOME_CONTENT',
    SERVICE_DETAIL: 'INCOMPLETE_SERVICE_CONTENT',
    TEAM_DETAIL: 'INCOMPLETE_STAFF_CONTENT',
    LOCATION_DETAIL: 'INCOMPLETE_LOCATION_CONTENT',
    ABOUT: 'INCOMPLETE_ABOUT_CONTENT',
  };
  if (typeSpecificCode[page.pageType]
    && findings.some(item => item.category === 'COMPLETENESS' && item.severity === 'ERROR')) {
    findings.push(finding('ERROR', 'COMPLETENESS', typeSpecificCode[page.pageType]!, `${page.pageType} does not yet fulfil its page-purpose contract.`, pageReference));
  }
  const genericPhrases = /\b(?:discover the difference|experience the best|care tailored to you|we(?:'|’)re here for you|your journey starts here)\b/gi;
  const genericCount = (contentStrings(page.sections).join(' ').match(genericPhrases) ?? []).length;
  if (genericCount >= 2) {
    findings.push(finding('REVIEW', 'COMPLETENESS', 'GENERIC_PAGE_COMPOSITION', 'Repeated generic marketing filler should be replaced with verified business detail.', pageReference));
  }
  for (const section of page.sections) {
    try {
      const component = componentForSection(section, page);
      if (component.requiredAssetSlots.length && !sectionHasAsset(section)) {
        findings.push(finding('REVIEW', 'ASSET', 'MISSING_REQUIRED_ASSET', `${component.componentKey} needs an approved asset or an explicit private-preview placeholder.`, pageReference));
      }
    } catch {
      // Component failure is already recorded above.
    }
  }
  if (page.pageType !== 'BOOKING') {
    const hasConversion = page.sections.some(section => section.type === 'BOOKING_CTA' || section.type === 'FINAL_CTA');
    if (!hasConversion) findings.push(finding('ERROR', 'COMPLETENESS', 'WEAK_CONVERSION_PATH', 'The page lacks a final native booking conversion.', pageReference));
  }
  if ('internalLinks' in page && page.pageType !== 'BOOKING' && page.internalLinks.length === 0) {
    findings.push(finding('REVIEW', 'COMPLETENESS', 'INTERNAL_LINKING_INCOMPLETE', 'The page has no structured internal-link intent.', pageReference));
  }

  const browserFindings = input.browserEvidence
    ? validateBrowserQualityEvidence(input.browserEvidence)
    : [finding('REVIEW', 'BROWSER', 'BROWSER_EVIDENCE_REQUIRED', 'Responsive browser evidence is required before human review.', pageReference)];
  findings.push(...browserFindings);
  const blocking = findings.some(item => item.severity === 'ERROR');
  const browserBlocking = browserFindings.some(item => item.severity === 'ERROR');
  const state: PageCompletenessState = blocking
    ? 'SCHEMA_VALID'
    : input.browserEvidence && !browserBlocking
      ? 'READY_FOR_REVIEW'
      : 'DESIGN_COMPLETE';
  return {
    state,
    findings,
    metrics: {
      meaningfulSections,
      substantiveSections,
      supportingSections,
      substantiveWordCount,
      uniqueComponentCount: new Set(components).size,
    },
  };
}

function tokenSet(value: string) {
  return new Set(value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
}

function similarity(left: string, right: string) {
  const a = tokenSet(left);
  const b = tokenSet(right);
  const intersection = [...a].filter(token => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

export function detectCompositionRepetition(pages: readonly GeneratedPage[]): GenerationFinding[] {
  const findings: GenerationFinding[] = [];
  const heroKeys = new Map<string, string[]>();
  const allKeys: string[] = [];
  for (const page of pages) {
    const keys = page.sections.map(section => {
      try { return componentForSection(section, page).componentKey; } catch { return ''; }
    }).filter(Boolean);
    allKeys.push(...keys);
    const heroIndex = page.sections.findIndex(section => section.type === 'HERO');
    if (heroIndex >= 0 && keys[heroIndex]) {
      heroKeys.set(keys[heroIndex]!, [...(heroKeys.get(keys[heroIndex]!) ?? []), page.pageReference]);
    }
  }
  for (const [componentKey, references] of heroKeys) {
    if (references.length >= Math.max(3, Math.ceil(pages.length * 0.5))) {
      findings.push(finding('ERROR', 'DESIGN', 'EXCESSIVE_COMPONENT_REPETITION', `${componentKey} is overused across page heroes.`, references[0]!));
    }
  }
  if (allKeys.length >= 10 && new Set(allKeys).size / allKeys.length < 0.25) {
    findings.push(finding('ERROR', 'DESIGN', 'DESIGN_DIVERSITY_TOO_LOW', 'The site-wide component diversity ratio is too low.', pages[0]!.pageReference));
  }
  for (let left = 0; left < pages.length; left += 1) {
    for (let right = left + 1; right < pages.length; right += 1) {
      const a = pages[left]!;
      const b = pages[right]!;
      const sameFamily = a.pageType === 'SERVICE_DETAIL' && b.pageType === 'SERVICE_DETAIL';
      const score = similarity(contentStrings(a.sections).join(' '), contentStrings(b.sections).join(' '));
      if (score >= (sameFamily ? 0.86 : 0.78)) {
        findings.push(finding(score >= 0.92 ? 'ERROR' : 'REVIEW', 'DUPLICATE', 'EXCESSIVE_COPY_REPETITION', 'Two pages contain excessively similar generated copy.', b.pageReference));
      }
    }
  }
  return findings;
}

export function componentClassification(componentKey: string) {
  return getSiteComponent(componentKey)?.classification ?? null;
}
