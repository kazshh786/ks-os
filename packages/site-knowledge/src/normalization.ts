import { createHash } from 'node:crypto';

export function normaliseWhitespace(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

export function normaliseEnumValue(value: string): string {
  return normaliseWhitespace(value)
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

export function normaliseOptional(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalised = normaliseWhitespace(value);
  return normalised.length ? normalised : undefined;
}

export function normaliseList(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(
    value
      .split('|')
      .map(normaliseWhitespace)
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right));
}

function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalise(entry)]),
    );
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function contentDigest(value: unknown): string {
  return sha256(stableStringify(value));
}

export function normalisedTextDigest(value: string): string {
  return sha256(
    normaliseWhitespace(value)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\s+/g, ' '),
  );
}

export function tokenSet(value: string): ReadonlySet<string> {
  return new Set(
    normaliseWhitespace(value)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(token => token.length > 2),
  );
}

export function jaccardSimilarity(left: string, right: string): number {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (leftTokens.size === 0 && rightTokens.size === 0) return 1;
  const intersection = [...leftTokens].filter(token => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : intersection / union;
}
