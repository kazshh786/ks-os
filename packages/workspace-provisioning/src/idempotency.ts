import { createHash } from 'node:crypto';

export function provisioningIdentity(input: {
  draftReference: string;
  productionBriefReference: string;
  productionBriefDigestSha256: string;
  idempotencyKey: string;
}) {
  return createHash('sha256').update(JSON.stringify({
    draftReference: input.draftReference,
    productionBriefReference: input.productionBriefReference,
    productionBriefDigestSha256: input.productionBriefDigestSha256,
    idempotencyKey: input.idempotencyKey,
  })).digest('hex');
}

export function canonicalStepIdempotencyKey(runReference: string, stepKey: string) {
  return `provisioning:${runReference}:${stepKey}`;
}
