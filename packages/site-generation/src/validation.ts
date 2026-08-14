import { componentForSection } from '@ks-os/site-components';
import type { SiteSection } from '@ks-os/site-schema';
import {
  GeneratedPageSchema,
  type GeneratedClaim,
  type GeneratedPage,
  type GenerationFinding,
  type TemplateGenerationConstraint,
  type VerifiedBusinessFacts,
} from './contracts.js';
import { availableBusinessDataKeys, safePublicEntityReferences } from './facts.js';

export interface PageValidationInput {
  output: unknown;
  expected: {
    pageReference: string;
    pageType: string;
    conversionRole: string;
    slug: string;
    layoutReference: string;
  };
  template: TemplateGenerationConstraint;
  facts: VerifiedBusinessFacts;
  approvedPageReferences: readonly string[];
}

export interface PageValidationResult {
  valid: boolean;
  page?: GeneratedPage;
  findings: GenerationFinding[];
}

const EXECUTABLE_PATTERN = /(?:<\/?(?:script|style|iframe|object|embed)\b|javascript:|data:text\/html|\bon\w+\s*=|```|@import\b|expression\s*\()/i;
const EXTERNAL_URL_PATTERN = /https?:\/\//i;
const SUPERLATIVE_PATTERN = /\b(?:best|leading|number\s+one|#1|top[- ]rated|world[- ]class|unmatched|unbeatable)\b/i;
const GUARANTEE_PATTERN = /\b(?:guarantee(?:d)?|risk[- ]free|permanent result|will cure|100% effective)\b/i;

function allStrings(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') found.push(value);
  else if (Array.isArray(value)) value.forEach(item => allStrings(item, found));
  else if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(item => allStrings(item, found));
  }
  return found;
}

function finding(
  severity: GenerationFinding['severity'],
  category: GenerationFinding['category'],
  code: string,
  message: string,
  targetReference?: string,
): GenerationFinding {
  return { severity, category, code, message, ...(targetReference ? { targetReference } : {}) };
}

function validateActionReferences(
  section: SiteSection,
  references: ReturnType<typeof safePublicEntityReferences>,
  approvedPages: ReadonlySet<string>,
  findings: GenerationFinding[],
) {
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const object = value as Record<string, unknown>;
    if (object.type === 'KS_OS_BOOKING') {
      if ('url' in object || 'destinationUrl' in object || 'href' in object) {
        findings.push(finding('ERROR', 'BOOKING', 'BOOKING_DESTINATION_FORBIDDEN', 'Booking destinations are resolved by the KS OS server.'));
      }
      if (typeof object.serviceReference === 'string'
        && !references.services.has(object.serviceReference)) {
        findings.push(finding('ERROR', 'FACT', 'SERVICE_REFERENCE_NOT_VERIFIED', 'The booking service reference is not a verified public tenant reference.'));
      }
      if (typeof object.locationReference === 'string'
        && !references.locations.has(object.locationReference)) {
        findings.push(finding('ERROR', 'FACT', 'LOCATION_REFERENCE_NOT_VERIFIED', 'The booking location reference is not a verified public tenant reference.'));
      }
      if (typeof object.staffReference === 'string'
        && !references.staff.has(object.staffReference)) {
        findings.push(finding('ERROR', 'FACT', 'STAFF_REFERENCE_NOT_VERIFIED', 'The booking staff reference is not a verified public tenant reference.'));
      }
    }
    if (object.type === 'INTERNAL_PAGE'
      && typeof object.pageReference === 'string'
      && !approvedPages.has(object.pageReference)) {
      findings.push(finding('ERROR', 'LINK', 'INTERNAL_PAGE_NOT_APPROVED', 'An internal action targets a page outside the approved blueprint.'));
    }
    Object.values(object).forEach(visit);
  };
  visit(section);
}

function validateClaims(
  claims: readonly GeneratedClaim[],
  verifiedFactKeys: ReadonlySet<string>,
  findings: GenerationFinding[],
) {
  for (const claim of claims) {
    const highRisk = new Set<GeneratedClaim['claimType']>([
      'TESTIMONIAL', 'REVIEW', 'STAFF_CREDENTIAL', 'QUALIFICATION', 'AWARD',
      'YEARS_EXPERIENCE', 'GUARANTEE', 'RESULT', 'HEALTH_OR_TREATMENT_CLAIM',
      'COMPARATIVE_CLAIM', 'SUPERLATIVE_CLAIM',
    ]);
    const factKeysGrounded = claim.factKeys.length > 0
      && claim.factKeys.every(key => verifiedFactKeys.has(key));
    if (claim.status === 'GROUNDED' && !factKeysGrounded) {
      findings.push(finding('ERROR', 'CLAIM', 'CLAIM_FACT_REFERENCE_INVALID', 'A grounded claim references missing or unverified facts.'));
    }
    if (claim.status === 'PROHIBITED') {
      findings.push(finding('ERROR', 'CLAIM', 'PROHIBITED_CLAIM', 'A prohibited claim remains in generated content.'));
    } else if (claim.status === 'UNSUPPORTED' || (highRisk.has(claim.claimType) && !factKeysGrounded)) {
      findings.push(finding('ERROR', 'CLAIM', 'UNSUPPORTED_CLAIM', 'A high-risk claim is not grounded in a verified fact.'));
    } else if (claim.status === 'REQUIRES_REVIEW') {
      findings.push(finding('REVIEW', 'CLAIM', 'CLAIM_REQUIRES_REVIEW', 'A generated claim requires agency review.'));
    }
    if (SUPERLATIVE_PATTERN.test(claim.claimText)) {
      findings.push(finding('REVIEW', 'CLAIM', 'UNSUPPORTED_SUPERLATIVE', 'A superlative claim requires evidence and agency review.'));
    }
    if (GUARANTEE_PATTERN.test(claim.claimText) && !factKeysGrounded) {
      findings.push(finding('ERROR', 'CLAIM', 'UNSUPPORTED_GUARANTEE', 'A guarantee or outcome claim is unsupported.'));
    }
  }
}

function validateTemplate(
  page: GeneratedPage,
  template: TemplateGenerationConstraint,
  findings: GenerationFinding[],
) {
  const types = page.sections.map(section => section.type);
  const availableComponentKeys = new Set(template.availableComponentKeys);
  for (const section of page.sections) {
    try {
      const component = componentForSection(section, page);
      if (availableComponentKeys.size && !availableComponentKeys.has(component.componentKey)) {
        findings.push(finding('ERROR', 'TEMPLATE', 'COMPONENT_NOT_IN_LAYOUT_MANIFEST', `${component.componentKey} is not available to the approved layout.`, page.pageReference));
      }
    } catch (error) {
      findings.push(finding(
        'ERROR',
        'DESIGN',
        'UNKNOWN_COMPONENT_KEY',
        error instanceof Error ? error.message : 'The generated componentKey is invalid.',
        page.pageReference,
      ));
    }
  }
  for (const required of template.requiredSectionTypes) {
    if (!types.includes(required)) {
      findings.push(finding('ERROR', 'TEMPLATE', 'REQUIRED_SECTION_MISSING', `The approved layout requires ${required}.`, page.pageReference));
    }
  }
  for (const prohibited of template.prohibitedSectionTypes) {
    if (types.includes(prohibited)) {
      findings.push(finding('ERROR', 'TEMPLATE', 'PROHIBITED_SECTION_PRESENT', `The approved layout prohibits ${prohibited}.`, page.pageReference));
    }
  }
  if (template.sectionOrder.length) {
    const positions = types.map(type => template.sectionOrder.indexOf(type));
    const recognised = positions.filter(position => position >= 0);
    if (recognised.some((position, index) => index > 0 && position < recognised[index - 1]!)) {
      findings.push(finding('ERROR', 'TEMPLATE', 'SECTION_ORDER_INVALID', 'Generated sections violate the approved layout order.', page.pageReference));
    }
  }
}

function validateBooking(page: GeneratedPage, findings: GenerationFinding[]) {
  const types = new Set(page.sections.map(section => section.type));
  const required = ['HEADER', 'FOOTER'] as const;
  for (const type of required) {
    if (!types.has(type)) {
      findings.push(finding('ERROR', 'BOOKING', `${type}_BOOKING_ACTION_REQUIRED`, `${type} with native booking is required.`));
    }
  }
  if (!types.has('BOOKING_CTA') && !types.has('FINAL_CTA')) {
    findings.push(finding('ERROR', 'BOOKING', 'FINAL_BOOKING_ACTION_REQUIRED', 'A page-ending native booking action is required.'));
  }
  if (page.pageType !== 'BOOKING'
    && !types.has('HERO')
    && !types.has('SERVICE_DETAILS')
    && !types.has('STAFF_PROFILE')) {
    findings.push(finding('ERROR', 'BOOKING', 'PRIMARY_BOOKING_ACTION_REQUIRED', 'A primary conversion section with native booking is required.'));
  }
}

export function validateGeneratedPage(input: PageValidationInput): PageValidationResult {
  const findings: GenerationFinding[] = [];
  const unsafeStrings = allStrings(input.output);
  if (unsafeStrings.some(value => EXECUTABLE_PATTERN.test(value))) {
    findings.push(finding('ERROR', 'SCHEMA', 'EXECUTABLE_CONTENT_FORBIDDEN', 'Generated output contains executable or markup content.'));
  }
  const parsed = GeneratedPageSchema.safeParse(input.output);
  if (!parsed.success) {
    findings.push(finding('ERROR', 'SCHEMA', 'STRUCTURED_OUTPUT_INVALID', 'Generated output does not match the strict page schema.'));
    return { valid: false, findings };
  }
  const page = parsed.data;
  const locked = input.expected;
  if (page.pageReference !== locked.pageReference
    || page.pageType !== locked.pageType
    || page.conversionRole !== locked.conversionRole
    || page.slug !== locked.slug
    || page.layoutReference !== locked.layoutReference) {
    findings.push(finding('ERROR', 'SCHEMA', 'BLUEPRINT_FIELDS_CHANGED', 'AI output changed server-controlled blueprint fields.', page.pageReference));
  }
  if (page.seo.canonicalPath !== `/${page.slug}`) {
    findings.push(finding('ERROR', 'METADATA', 'CANONICAL_PATH_MISMATCH', 'Metadata canonical path must be site-relative and match the approved slug.'));
  }
  const metadataStrings = [
    page.seo.title,
    page.seo.description,
    page.seo.openGraphTitle,
    page.seo.openGraphDescription,
  ];
  if (metadataStrings.some(value => /[<>]/.test(value) || EXECUTABLE_PATTERN.test(value))) {
    findings.push(finding('ERROR', 'METADATA', 'UNSAFE_METADATA', 'Metadata must contain plain text only.'));
  }
  const approvedPages = new Set(input.approvedPageReferences);
  for (const link of page.internalLinks) {
    if (!approvedPages.has(link.targetPageReference)) {
      findings.push(finding('ERROR', 'LINK', 'INTERNAL_LINK_NOT_APPROVED', 'An internal link targets a page outside the approved blueprint.'));
    }
    if (EXTERNAL_URL_PATTERN.test(link.anchorText)) {
      findings.push(finding('ERROR', 'LINK', 'ABSOLUTE_INTERNAL_LINK_FORBIDDEN', 'Internal links cannot store an absolute production domain.'));
    }
  }
  const references = safePublicEntityReferences(input.facts);
  for (const section of page.sections) {
    validateActionReferences(section, references, approvedPages, findings);
    if ('serviceReference' in section
      && !references.services.has(section.serviceReference)) {
      findings.push(finding('ERROR', 'FACT', 'SERVICE_REFERENCE_NOT_VERIFIED', 'A section uses an unverified service reference.'));
    }
    if ('locationReference' in section
      && section.locationReference
      && !references.locations.has(section.locationReference)) {
      findings.push(finding('ERROR', 'FACT', 'LOCATION_REFERENCE_NOT_VERIFIED', 'A section uses an unverified location reference.'));
    }
    if ('staffReference' in section
      && !references.staff.has(section.staffReference)) {
      findings.push(finding('ERROR', 'FACT', 'STAFF_REFERENCE_NOT_VERIFIED', 'A section uses an unverified staff reference.'));
    }
  }
  validateClaims(page.claims, new Set(availableBusinessDataKeys(input.facts)), findings);
  validateTemplate(page, input.template, findings);
  validateBooking(page, findings);
  return {
    valid: !findings.some(item => item.severity === 'ERROR'),
    page,
    findings,
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

export function detectDuplicateContent(pages: readonly GeneratedPage[]): GenerationFinding[] {
  const findings: GenerationFinding[] = [];
  const titles = new Map<string, string>();
  const descriptions = new Map<string, string>();
  for (const page of pages) {
    const titleKey = page.title.trim().toLowerCase();
    const existingTitle = titles.get(titleKey);
    if (existingTitle) findings.push(finding('WARNING', 'DUPLICATE', 'DUPLICATE_PAGE_TITLE', 'Two generated pages use the same title.', page.pageReference));
    else titles.set(titleKey, page.pageReference);
    const descriptionKey = page.seo.description.trim().toLowerCase();
    const existingDescription = descriptions.get(descriptionKey);
    if (existingDescription) findings.push(finding('WARNING', 'DUPLICATE', 'DUPLICATE_META_DESCRIPTION', 'Two generated pages use the same meta description.', page.pageReference));
    else descriptions.set(descriptionKey, page.pageReference);
  }
  for (let left = 0; left < pages.length; left += 1) {
    for (let right = left + 1; right < pages.length; right += 1) {
      const leftBody = allStrings(pages[left]!.sections).join(' ');
      const rightBody = allStrings(pages[right]!.sections).join(' ');
      if (similarity(leftBody, rightBody) >= 0.8) {
        findings.push(finding('REVIEW', 'DUPLICATE', 'NEAR_DUPLICATE_PAGE_CONTENT', 'Generated page content is substantially duplicated.', pages[right]!.pageReference));
      }
    }
  }
  return findings;
}

export function escapeMetadataText(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
