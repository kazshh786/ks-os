const privateKey = /(^id$|Id$|tenantId|agency.*Id|token|digest|storagePath|internal|provider|prompt|raw|private|evidenceReference)/i;

export function toClientSafeFactFindingDto(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toClientSafeFactFindingDto);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !privateKey.test(key))
    .map(([key, item]) => [key, toClientSafeFactFindingDto(item)]));
}
