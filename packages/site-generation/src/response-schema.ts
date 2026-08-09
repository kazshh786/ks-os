import type { SiteSectionType } from '@ks-os/site-schema';
import type { PageCompositionPlan } from './contracts.js';

type JsonSchema = Record<string, unknown>;

const uuid = { type: 'string', format: 'uuid' } as const;
const text = { type: 'string' } as const;
const shortText = { type: 'string', minLength: 1, maxLength: 240 } as const;
const bodyText = { type: 'string', minLength: 1, maxLength: 8_000 } as const;

const bookingAction: JsonSchema = {
  type: 'object',
  required: ['type', 'label'],
  additionalProperties: false,
  properties: {
    type: { const: 'KS_OS_BOOKING' }, label: shortText,
    serviceReference: uuid, locationReference: uuid, staffReference: uuid,
    campaignReference: text,
  },
};

const internalPageAction: JsonSchema = {
  type: 'object',
  required: ['type', 'label', 'pageReference'],
  additionalProperties: false,
  properties: { type: { const: 'INTERNAL_PAGE' }, label: shortText, pageReference: uuid },
};

const phoneAction: JsonSchema = {
  type: 'object', required: ['type', 'label', 'phoneNumber', 'secondary'], additionalProperties: false,
  properties: { type: { const: 'PHONE' }, label: shortText, phoneNumber: text, secondary: { const: true } },
};

const emailAction: JsonSchema = {
  type: 'object', required: ['type', 'label', 'emailAddress', 'secondary'], additionalProperties: false,
  properties: { type: { const: 'EMAIL' }, label: shortText, emailAddress: text, secondary: { const: true } },
};

const headingBody = { heading: shortText, body: bodyText } as const;
const imageReference = { imageAssetReference: uuid } as const;
const headingBodyItem = {
  type: 'object', required: ['heading', 'body'], additionalProperties: false,
  properties: { heading: shortText, body: bodyText },
} as const;

const richTextLeaf: JsonSchema = {
  anyOf: [
    { type: 'object', required: ['type', 'text'], additionalProperties: false, properties: { type: { const: 'TEXT' }, text } },
    { type: 'object', required: ['type'], additionalProperties: false, properties: { type: { const: 'LINE_BREAK' } } },
  ],
};

const richTextInline: JsonSchema = {
  anyOf: [
    ...(richTextLeaf.anyOf as JsonSchema[]),
    { type: 'object', required: ['type', 'children'], additionalProperties: false, properties: { type: { enum: ['STRONG', 'EMPHASIS'] }, children: { type: 'array', minItems: 1, maxItems: 100, items: richTextLeaf } } },
    { type: 'object', required: ['type', 'pageReference', 'children'], additionalProperties: false, properties: { type: { const: 'INTERNAL_LINK' }, pageReference: uuid, children: { type: 'array', minItems: 1, maxItems: 100, items: richTextLeaf } } },
  ],
};

const richTextDocument: JsonSchema = {
  type: 'object', required: ['blocks'], additionalProperties: false,
  properties: {
    blocks: {
      type: 'array', maxItems: 300, items: {
        anyOf: [
          { type: 'object', required: ['type', 'children'], additionalProperties: false, properties: { type: { enum: ['PARAGRAPH'] }, children: { type: 'array', minItems: 1, items: richTextInline } } },
          { type: 'object', required: ['type', 'level', 'children'], additionalProperties: false, properties: { type: { const: 'HEADING' }, level: { enum: ['H2', 'H3', 'H4'] }, children: { type: 'array', minItems: 1, items: richTextInline } } },
          { type: 'object', required: ['type', 'items'], additionalProperties: false, properties: { type: { enum: ['ORDERED_LIST', 'UNORDERED_LIST'] }, items: { type: 'array', minItems: 1, items: { type: 'object', required: ['children'], additionalProperties: false, properties: { children: { type: 'array', minItems: 1, items: richTextInline } } } } } },
        ],
      },
    },
  },
};

interface SectionFields {
  properties: Record<string, JsonSchema | typeof text | typeof shortText | typeof bodyText | typeof uuid>;
  required: readonly string[];
}

const SECTION_FIELDS: Record<SiteSectionType, SectionFields> = {
  HEADER: { properties: { primaryAction: bookingAction }, required: ['primaryAction'] },
  ANNOUNCEMENT_BAR: { properties: { message: shortText }, required: ['message'] },
  HERO: { properties: { ...headingBody, eyebrow: shortText, ...imageReference, primaryAction: bookingAction, secondaryAction: internalPageAction }, required: ['heading', 'body', 'primaryAction'] },
  INTRODUCTION: { properties: { ...headingBody, supportingPoints: { type: 'array', minItems: 2, maxItems: 8, items: shortText }, ...imageReference }, required: ['heading', 'body'] },
  FEATURED_SERVICES: { properties: { heading: shortText, serviceReferences: { type: 'array', minItems: 1, maxItems: 12, items: uuid } }, required: ['heading', 'serviceReferences'] },
  SERVICE_GRID: { properties: { heading: shortText, serviceReferences: { type: 'array', minItems: 1, maxItems: 100, items: uuid } }, required: ['heading', 'serviceReferences'] },
  SERVICE_DETAILS: { properties: { ...headingBody, serviceReference: uuid, ...imageReference, primaryAction: bookingAction }, required: ['heading', 'body', 'serviceReference', 'primaryAction'] },
  BENEFITS: { properties: { heading: shortText, items: { type: 'array', minItems: 1, maxItems: 20, items: headingBodyItem }, ...imageReference }, required: ['heading', 'items'] },
  PROCESS: { properties: { heading: shortText, steps: { type: 'array', minItems: 1, maxItems: 20, items: headingBodyItem }, ...imageReference }, required: ['heading', 'steps'] },
  PRICING: { properties: { heading: shortText, items: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', required: ['label', 'priceText'], additionalProperties: false, properties: { label: shortText, priceText: text, description: text } } } }, required: ['heading', 'items'] },
  TEAM: { properties: { heading: shortText, staffReferences: { type: 'array', minItems: 1, maxItems: 100, items: uuid } }, required: ['heading', 'staffReferences'] },
  STAFF_PROFILE: { properties: { staffReference: uuid, primaryAction: bookingAction }, required: ['staffReference'] },
  GALLERY: { properties: { heading: shortText, assetReferences: { type: 'array', minItems: 1, maxItems: 50, items: uuid } }, required: ['heading', 'assetReferences'] },
  RESULTS: { properties: { heading: shortText, items: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'object', required: ['afterAssetReference'], additionalProperties: false, properties: { beforeAssetReference: uuid, afterAssetReference: uuid, caption: shortText } } } }, required: ['heading', 'items'] },
  TESTIMONIALS: { properties: { heading: shortText, items: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'object', required: ['quote', 'attribution'], additionalProperties: false, properties: { quote: text, attribution: shortText } } } }, required: ['heading', 'items'] },
  TRUST_INDICATORS: { properties: { heading: shortText, items: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'object', required: ['label'], additionalProperties: false, properties: { label: shortText, detail: text } } } }, required: ['items'] },
  FAQ: { properties: { heading: shortText, items: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'object', required: ['question', 'answer'], additionalProperties: false, properties: { question: shortText, answer: text } } } }, required: ['heading', 'items'] },
  LOCATION: { properties: { heading: shortText, locationReference: uuid, ...imageReference }, required: ['heading', 'locationReference'] },
  OPENING_HOURS: { properties: { heading: shortText, locationReference: uuid, ...imageReference }, required: ['heading', 'locationReference'] },
  CONTACT: { properties: { heading: shortText, body: bodyText, locationReference: uuid, secondaryActions: { type: 'array', maxItems: 4, items: { anyOf: [phoneAction, emailAction] } }, ...imageReference }, required: ['heading', 'secondaryActions'] },
  BOOKING_CTA: { properties: { ...headingBody, primaryAction: bookingAction, ...imageReference }, required: ['heading', 'body', 'primaryAction'] },
  FINAL_CTA: { properties: { ...headingBody, primaryAction: bookingAction, ...imageReference }, required: ['heading', 'body', 'primaryAction'] },
  FOOTER: { properties: { primaryAction: bookingAction, legalText: text }, required: ['primaryAction'] },
  RICH_TEXT: { properties: { heading: shortText, document: richTextDocument }, required: ['document'] },
};

export function generatedSectionResponseJsonSchema(input: {
  sectionType: SiteSectionType;
  componentKeys: readonly string[];
}): JsonSchema {
  const fields = SECTION_FIELDS[input.sectionType];
  return {
    type: 'object',
    required: ['reference', 'type', 'componentKey', ...fields.required],
    additionalProperties: false,
    properties: {
      reference: uuid,
      type: { const: input.sectionType },
      componentKey: { type: 'string', enum: [...input.componentKeys] },
      variant: { enum: ['editorial', 'grid', 'split', 'compact', 'standard', 'featured', 'quiet'] },
      ...fields.properties,
    },
  };
}

export function generatedSectionContentSlots(sectionType: SiteSectionType): readonly string[] {
  return Object.keys(SECTION_FIELDS[sectionType].properties);
}

const seo: JsonSchema = {
  type: 'object',
  required: ['title', 'description', 'canonicalPath', 'index', 'follow', 'openGraphTitle', 'openGraphDescription', 'twitterCard'],
  additionalProperties: false,
  properties: {
    title: text, description: text, canonicalPath: text, index: { type: 'boolean' }, follow: { type: 'boolean' },
    openGraphTitle: text, openGraphDescription: text, openGraphImageAssetReference: uuid,
    twitterCard: { enum: ['summary', 'summary_large_image'] },
  },
};

const finding: JsonSchema = {
  type: 'object', required: ['severity', 'category', 'code', 'message'], additionalProperties: false,
  properties: { severity: { enum: ['ERROR', 'WARNING', 'REVIEW'] }, category: { enum: ['FACT', 'CLAIM', 'KNOWLEDGE', 'TEMPLATE', 'BOOKING', 'LINK', 'DUPLICATE', 'METADATA', 'STRUCTURED_DATA', 'PROVIDER', 'SCHEMA', 'COMPLETENESS', 'DESIGN', 'ASSET', 'BROWSER', 'ACCESSIBILITY'] }, code: text, message: text, targetReference: uuid },
};

const structuredDataInput: JsonSchema = {
  anyOf: [
    { type: 'object', required: ['type', 'businessName'], additionalProperties: false, properties: { type: { const: 'LOCAL_BUSINESS' }, businessName: text, locationReference: uuid } },
    { type: 'object', required: ['type', 'serviceReference', 'serviceName'], additionalProperties: false, properties: { type: { const: 'SERVICE' }, serviceReference: uuid, serviceName: text } },
    { type: 'object', required: ['type', 'items'], additionalProperties: false, properties: { type: { const: 'FAQ' }, items: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'object', required: ['question', 'answer'], additionalProperties: false, properties: { question: shortText, answer: text } } } } },
    { type: 'object', required: ['type', 'pageReferences'], additionalProperties: false, properties: { type: { const: 'BREADCRUMB' }, pageReferences: { type: 'array', minItems: 1, maxItems: 20, items: uuid } } },
  ],
};

export function generatedPageResponseJsonSchema(input: {
  pageType: string;
  conversionRole: string;
  selectedComponents: PageCompositionPlan['selectedComponents'];
}): JsonSchema {
  return {
    type: 'object',
    description: 'A governed KS OS V2 page. Component selection and section contracts are closed and authoritative.',
    required: ['pageReference', 'title', 'navigationLabel', 'slug', 'pageType', 'conversionRole', 'layoutReference', 'seo', 'sections', 'internalLinks', 'structuredDataInputs', 'assetRequirements', 'missingDataFindings', 'claims'],
    additionalProperties: false,
    properties: {
      pageReference: uuid, title: text, navigationLabel: text, slug: text,
      pageType: { const: input.pageType }, conversionRole: { const: input.conversionRole }, layoutReference: uuid,
      seo,
      sections: {
        type: 'array', minItems: input.selectedComponents.length, maxItems: input.selectedComponents.length,
        prefixItems: input.selectedComponents.map(selection => generatedSectionResponseJsonSchema({ sectionType: selection.sectionType, componentKeys: [selection.componentKey] })),
        items: false,
      },
      internalLinks: { type: 'array', maxItems: 100, items: { type: 'object', required: ['targetPageReference', 'anchorText'], additionalProperties: false, properties: { targetPageReference: uuid, anchorText: shortText } } },
      structuredDataInputs: { type: 'array', maxItems: 100, items: structuredDataInput },
      assetRequirements: { type: 'array', maxItems: 100, items: { type: 'object', required: ['purpose', 'description', 'required'], additionalProperties: false, properties: { purpose: { enum: ['HERO', 'SERVICE', 'LOCATION', 'STAFF', 'GALLERY', 'SOCIAL'] }, description: text, required: { type: 'boolean' } } } },
      missingDataFindings: { type: 'array', maxItems: 100, items: finding },
      claims: { type: 'array', maxItems: 500, items: { type: 'object', required: ['claimType', 'claimText', 'status', 'factKeys'], additionalProperties: false, properties: { claimType: { enum: ['BUSINESS_IDENTITY', 'SERVICE_AVAILABILITY', 'SERVICE_PRICE', 'SERVICE_DURATION', 'STAFF_CREDENTIAL', 'YEARS_EXPERIENCE', 'LOCATION', 'OPENING_HOURS', 'QUALIFICATION', 'GUARANTEE', 'RESULT', 'TESTIMONIAL', 'REVIEW', 'AWARD', 'SAFETY', 'HEALTH_OR_TREATMENT_CLAIM', 'COMPARATIVE_CLAIM', 'SUPERLATIVE_CLAIM'] }, claimText: text, status: { enum: ['GROUNDED', 'REQUIRES_REVIEW', 'UNSUPPORTED', 'PROHIBITED', 'NOT_APPLICABLE'] }, factKeys: { type: 'array', maxItems: 20, items: text } } } },
    },
  };
}
