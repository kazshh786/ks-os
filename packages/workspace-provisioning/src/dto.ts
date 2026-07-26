const privateKey = /(^id$|Id$|tenantId|agency.*Id|token|secret|digest|payload|internal|provider|stripeAccount|prompt|raw)/i;

export function toSafeProvisioningDto<T>(value: T): T {
  if (Array.isArray(value)) return value.map(toSafeProvisioningDto) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !privateKey.test(key))
    .map(([key, item]) => [key, toSafeProvisioningDto(item)])) as T;
}
