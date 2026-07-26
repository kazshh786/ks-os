const CLIENT_FORBIDDEN_KEYS = /(^id$|tenantId|siteId|versionId|agencyUserId|tenantUserId|token|digest|secret|credential|prompt|rawResponse|provenance|licen[cs]e|infrastructure|deployment|privateEvidence|internal.*note|internalFinding|auditMetadata|provider)/i;
const AGENCY_FORBIDDEN_KEYS = /(^id$|Id$|_id$|token|secret|credential|prompt|rawResponse|privateEvidence|customerPrivateData)/i;

function shapeSafeValue(
  value: unknown,
  forbiddenKeys: RegExp,
  depth = 0,
): unknown {
  if (depth > 20) return null;
  if (Array.isArray(value)) {
    return value.map((entry) => shapeSafeValue(entry, forbiddenKeys, depth + 1));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (forbiddenKeys.test(key)) continue;
      result[key] = shapeSafeValue(entry, forbiddenKeys, depth + 1);
    }
    return result;
  }
  return value;
}

export function toClientSafeValue(value: unknown): unknown {
  return shapeSafeValue(value, CLIENT_FORBIDDEN_KEYS);
}

export function toAgencySafeValue(value: unknown): unknown {
  return shapeSafeValue(value, AGENCY_FORBIDDEN_KEYS);
}

export interface ReviewProgressInput {
  totalItems: number;
  approvedItems: number;
  openComments: number;
  openChangeRequests: number;
  disputedFacts: number;
}

export function summarizeReviewProgress(input: ReviewProgressInput) {
  const totalItems = Math.max(0, input.totalItems);
  const approvedItems = Math.max(0, Math.min(input.approvedItems, totalItems));
  return {
    totalItems,
    approvedItems,
    completionPercentage: totalItems === 0 ? 0 : Math.floor((approvedItems / totalItems) * 100),
    openComments: Math.max(0, input.openComments),
    openChangeRequests: Math.max(0, input.openChangeRequests),
    disputedFacts: Math.max(0, input.disputedFacts),
  };
}
