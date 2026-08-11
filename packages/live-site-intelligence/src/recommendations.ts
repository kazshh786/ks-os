import { PublicReferenceSchema } from '@ks-os/contracts';
import { z } from 'zod';
import type { PublicLiveSiteData } from './contracts.js';

export const GovernedRecommendationSchema = z.object({
  sourcePageReference: PublicReferenceSchema,
  targetPageReference: PublicReferenceSchema,
  anchorText: z.string().trim().min(1).max(120).optional(),
  targetServiceReference: PublicReferenceSchema.optional(),
  relationship: z.enum(['RELATED_SERVICE', 'RELEVANT_STAFF', 'USEFUL_GUIDE', 'LOCATION_SERVICE']),
  semanticScore: z.number().min(0).max(1).optional(),
  governedOrder: z.number().int().nonnegative().max(100).optional(),
  approved: z.literal(true),
}).strict();
export type GovernedRecommendation = z.infer<typeof GovernedRecommendationSchema>;

export const PublishedRecommendationLinksSchema = z.array(z.object({
  targetPageReference: PublicReferenceSchema,
  anchorText: z.string().trim().min(1).max(120),
}).strict()).max(100);

export function eligibleLiveRecommendations(
  relationships: readonly GovernedRecommendation[],
  live: PublicLiveSiteData | undefined,
) {
  const approved = relationships.map(item => GovernedRecommendationSchema.parse(item));
  if (!live || live.telemetry.fallbackActivated) return approved;
  const services = new Map(live.services.map(service => [service.publicReference, service]));
  return approved
    .filter(item => !item.targetServiceReference || services.get(item.targetServiceReference)?.bookingEligible)
    .sort((left, right) => (left.governedOrder ?? Number.MAX_SAFE_INTEGER)
      - (right.governedOrder ?? Number.MAX_SAFE_INTEGER)
      || (right.semanticScore ?? 0) - (left.semanticScore ?? 0)
      || left.targetPageReference.localeCompare(right.targetPageReference));
}
