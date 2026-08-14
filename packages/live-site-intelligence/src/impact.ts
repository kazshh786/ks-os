import { PublicReferenceSchema, SitePageTypeSchema } from '@ks-os/contracts';
import { z } from 'zod';

export const SiteOperationalChangeKindSchema = z.enum([
  'PRICE_CHANGED',
  'BOOKABILITY_CHANGED',
  'SERVICE_DISABLED',
  'SERVICE_DESCRIPTION_CHANGED',
  'STAFF_BOOKABILITY_CHANGED',
  'STAFF_DEACTIVATED',
  'LOCATION_TEMPORARILY_CLOSED',
  'LOCATION_CLOSED',
  'LOCATION_ADDRESS_CHANGED',
  'LOCATION_PHONE_CHANGED',
  'OPENING_HOURS_CHANGED',
  'LOCATION_ADDED',
  'AUTHORITY_DATA_CHANGED',
  'CAMPAIGN_SCHEDULE_CHANGED',
]);
export type SiteOperationalChangeKind = z.infer<typeof SiteOperationalChangeKindSchema>;

export const SiteOperationalChangeSchema = z.object({
  publicReference: PublicReferenceSchema,
  tenantReference: PublicReferenceSchema,
  siteReference: PublicReferenceSchema,
  entityType: z.enum(['SERVICE', 'STAFF', 'LOCATION', 'CAMPAIGN', 'AUTHORITY']),
  entityReference: PublicReferenceSchema,
  kind: SiteOperationalChangeKindSchema,
  changedFields: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,79}$/)).min(1).max(50),
  occurredAt: z.string().datetime(),
}).strict();
export type SiteOperationalChange = z.infer<typeof SiteOperationalChangeSchema>;

export const SiteImpactPageContextSchema = z.object({
  pageReference: PublicReferenceSchema,
  path: z.string().startsWith('/').max(500),
  pageType: SitePageTypeSchema,
  entityReferences: z.array(PublicReferenceSchema).max(1_000),
  structuredDataTypes: z.array(z.string().max(80)).max(50),
  internalLinkTargets: z.array(PublicReferenceSchema).max(500),
  seoBriefReference: PublicReferenceSchema.optional(),
}).strict();
export type SiteImpactPageContext = z.infer<typeof SiteImpactPageContextSchema>;

export const SiteImpactAssessmentSchema = z.object({
  schemaVersion: z.literal(1),
  classification: z.enum(['AUTO_APPLY_LIVE', 'REQUIRE_SITE_REVIEW']),
  change: SiteOperationalChangeSchema,
  immediateOperationalEffects: z.array(z.string().max(240)).max(20),
  affectedPages: z.array(z.object({
    pageReference: PublicReferenceSchema,
    path: z.string().startsWith('/').max(500),
    reason: z.string().max(240),
  }).strict()).max(100),
  affectedSchema: z.array(z.string().max(80)).max(50),
  affectedSeoBriefs: z.array(PublicReferenceSchema).max(100),
  affectedInternalLinks: z.array(PublicReferenceSchema).max(500),
  affectedBookingJourneys: z.array(z.string().max(240)).max(100),
  affectedStructuredData: z.array(z.string().max(80)).max(50),
  recommendedPublishedChanges: z.array(z.string().max(500)).max(50),
}).strict();
export type SiteImpactAssessment = z.infer<typeof SiteImpactAssessmentSchema>;

const REVIEW_REQUIRED = new Set<SiteOperationalChangeKind>([
  'SERVICE_DISABLED',
  'SERVICE_DESCRIPTION_CHANGED',
  'STAFF_DEACTIVATED',
  'LOCATION_CLOSED',
  'LOCATION_ADDRESS_CHANGED',
  'LOCATION_PHONE_CHANGED',
  'LOCATION_ADDED',
  'AUTHORITY_DATA_CHANGED',
]);

export function assessSiteImpact(input: {
  change: SiteOperationalChange;
  pages: readonly SiteImpactPageContext[];
}): SiteImpactAssessment {
  const change = SiteOperationalChangeSchema.parse(input.change);
  const pages = input.pages.map(page => SiteImpactPageContextSchema.parse(page));
  const directlyAffected = pages.filter(page => page.entityReferences.includes(change.entityReference));
  const hubs = pages.filter(page => {
    if (change.entityType === 'SERVICE') return page.pageType === 'SERVICE_HUB';
    if (change.entityType === 'STAFF') return page.pageType === 'TEAM_HUB';
    if (change.entityType === 'LOCATION') return page.pageType === 'LOCATION_HUB';
    return false;
  });
  const affected = [...new Map([...directlyAffected, ...hubs].map(page => [page.pageReference, page])).values()];
  const classification = REVIEW_REQUIRED.has(change.kind) ? 'REQUIRE_SITE_REVIEW' : 'AUTO_APPLY_LIVE';
  const schema = [...new Set(affected.flatMap(page => page.structuredDataTypes))];
  const recommendations = classification === 'REQUIRE_SITE_REVIEW'
    ? [
      'Keep the stable page and canonical URL until an agency review is approved.',
      'Review copy, structured data, navigation and redirects as one versioned site change.',
    ]
    : ['Apply the bounded operational state without changing canonical SEO content.'];
  if (change.kind === 'SERVICE_DISABLED') {
    recommendations.unshift('Disable booking immediately and propose retention or an approved redirect for the service page.');
  }
  if (change.kind === 'STAFF_DEACTIVATED') {
    recommendations.unshift('Disable staff booking immediately and review whether the indexed profile should be retained, archived or redirected.');
  }
  return SiteImpactAssessmentSchema.parse({
    schemaVersion: 1,
    classification,
    change,
    immediateOperationalEffects: [
      classification === 'AUTO_APPLY_LIVE'
        ? 'The safe live state may update immediately.'
        : 'Unsafe booking paths are disabled immediately while published marketing state remains stable.',
    ],
    affectedPages: affected.map(page => ({
      pageReference: page.pageReference,
      path: page.path,
      reason: directlyAffected.some(item => item.pageReference === page.pageReference)
        ? 'The page references the changed canonical entity.'
        : 'The collection page may describe or link to the changed entity.',
    })),
    affectedSchema: schema,
    affectedSeoBriefs: affected.flatMap(page => page.seoBriefReference ? [page.seoBriefReference] : []),
    affectedInternalLinks: [...new Set(pages.filter(page => page.internalLinkTargets.some(target => affected.some(item => item.pageReference === target))).map(page => page.pageReference))],
    affectedBookingJourneys: affected.map(page => `Review booking context originating from ${page.path}.`),
    affectedStructuredData: schema,
    recommendedPublishedChanges: recommendations,
  });
}

export const SiteChangeProposalSchema = z.object({
  publicReference: PublicReferenceSchema,
  siteReference: PublicReferenceSchema,
  assessmentReference: PublicReferenceSchema,
  status: z.enum(['DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'APPLIED']),
  summary: z.string().trim().min(1).max(500),
  affectedPageReferences: z.array(PublicReferenceSchema).max(100),
  recommendations: z.array(z.string().max(500)).max(50),
  requiresHumanApproval: z.literal(true),
}).strict();
export type SiteChangeProposal = z.infer<typeof SiteChangeProposalSchema>;
