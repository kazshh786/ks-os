import { createHash } from 'node:crypto';

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]),
    );
  }
  return value;
}

export function stableGenerationStringify(value: unknown) {
  return JSON.stringify(normalize(value));
}

export function generationDigest(value: unknown) {
  return createHash('sha256').update(stableGenerationStringify(value)).digest('hex');
}

export function generationIdempotencyKey(input: {
  tenantReference: string;
  siteReference: string;
  blueprintReference: string;
  blueprintRevision: number;
  templateVersionReference: string;
  knowledgePackReference: string;
  knowledgePackSemanticVersion: string;
  verifiedBusinessDataDigestSha256: string;
  generatorVersion: string;
  generationReason: string;
}) {
  return generationDigest(input);
}
