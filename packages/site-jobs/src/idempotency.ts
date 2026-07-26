import { createHash } from 'node:crypto';
import { SiteJobTypeSchema } from './contracts.js';

const digestPattern = /^[a-f0-9]{64}$/;

export function deriveSiteJobIdempotencyKey(input: {
  tenantReference: string;
  jobType: string;
  targetReference: string;
  sourceDigestSha256: string;
  operationVersion: number;
}): string {
  const jobType = SiteJobTypeSchema.parse(input.jobType);
  if (!digestPattern.test(input.sourceDigestSha256)) {
    throw new Error('A lowercase SHA-256 source digest is required.');
  }
  if (!Number.isInteger(input.operationVersion) || input.operationVersion < 1) {
    throw new Error('Operation version must be a positive integer.');
  }
  const material = [
    'ks-os-site-job-v1',
    input.tenantReference.trim().toLowerCase(),
    jobType,
    input.targetReference.trim().toLowerCase(),
    input.sourceDigestSha256,
    String(input.operationVersion),
  ].join('\u001f');
  return createHash('sha256').update(material).digest('hex');
}
