import { PublicReferenceSchema } from '@ks-os/contracts';
import { z } from 'zod';
import type { PublicLiveSiteData } from './contracts.js';

export const GovernedRecommendationSchema = z.object({
  sourcePageReference: PublicReferenceSchema,
  targetPageReference: PublicReferenceSchema,
  targetServiceReference: PublicReferenceSchema.optional(),
  relationship: z.enum(['RELATED_SERVICE', 'RELEVANT_STAFF', 'USEFUL_GUIDE', 'LOCATION_SERVICE']),
  semanticScore: z.number().min(0).max(1),
  approved: z.literal(true),
}).strict();
export type GovernedRecommendation = z.infer<typeof GovernedRecommendationSchema>;

export function eligibleLiveRecommendations(
  relationships: readonly GovernedRecommendation[],
  live: PublicLiveSiteData | undefined,
) {
  if (!live || live.telemetry.fallbackActivated) return [];
  const services = new Map(live.services.map(service => [service.publicReference, service]));
  return relationships
    .map(item => GovernedRecommendationSchema.parse(item))
    .filter(item => !item.targetServiceReference || services.get(item.targetServiceReference)?.bookingEligible)
    .sort((left, right) => right.semanticScore - left.semanticScore || left.targetPageReference.localeCompare(right.targetPageReference));
}
