import { createHash } from 'node:crypto';
import type { PublicationPin, PublicationReason } from './contracts.js';

export function publicationIdempotencyKey(input: {
  tenantReference: string;
  pin: PublicationPin;
  reason: PublicationReason;
}): string {
  return createHash('sha256').update(JSON.stringify({
    tenantReference: input.tenantReference,
    siteReference: input.pin.siteReference,
    siteVersionReference: input.pin.siteVersionReference,
    siteVersionDigestSha256: input.pin.siteVersionDigestSha256,
    qualityRunReference: input.pin.qualityRunReference,
    qualityPolicyVersion: input.pin.qualityPolicyVersion,
    knowledgePackDigestSha256: input.pin.knowledgePackDigestSha256,
    templateVersionReference: input.pin.templateVersionReference,
    rendererVersion: input.pin.rendererVersion,
    reason: input.reason,
  })).digest('hex');
}

export function cacheInvalidationKey(input: {
  tenantReference: string;
  siteReference: string;
  snapshotReference: string;
  pointerVersion: number;
}): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}
