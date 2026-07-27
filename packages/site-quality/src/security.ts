import { createHash, timingSafeEqual } from 'node:crypto';

export const NON_WAIVABLE_FINDING_CODES = new Set([
  'CROSS_TENANT_REFERENCE',
  'BROKEN_TENANT_ISOLATION',
  'INVALID_NATIVE_BOOKING',
  'EXTERNAL_BOOKING_DESTINATION',
  'BOOKING_REFERENCE_CROSS_TENANT',
  'MALICIOUS_EXECUTABLE_CONTENT',
  'UNSUPPORTED_ARBITRARY_HTML',
  'MISSING_REQUIRED_PAGE',
  'MISSING_REQUIRED_SECTION',
  'SITE_VERSION_INCOMPLETE',
  'SITE_VERSION_SUPERSEDED',
  'INVALID_SNAPSHOT_STRUCTURE',
  'FABRICATED_PRICE',
  'FABRICATED_LOCATION',
  'FABRICATED_STAFF_CREDENTIAL',
  'FABRICATED_TESTIMONIAL',
  'PROHIBITED_MEDICAL_CLAIM',
  'CRITICAL_KEYBOARD_FAILURE',
  'PRIMARY_JOURNEY_FOCUS_TRAP',
  'UNUSABLE_BOOKING_FLOW',
  'MISSING_AGENCY_APPROVAL',
  'STALE_APPROVAL',
  'UNRESOLVED_PROHIBITED_CLAIM',
  'MISSING_REQUIRED_LEGAL_CONFIGURATION',
  'INVALID_TEMPLATE_LICENCE',
  'UNAPPROVED_PUBLIC_ASSET',
  'RENDER_FAILURE',
]);

export function isNonWaivableFinding(code: string): boolean {
  return NON_WAIVABLE_FINDING_CODES.has(code);
}

export function assertFindingMayBeWaived(input: {
  code: string;
  definitionWaivable: boolean;
  findingWaivable: boolean;
  status: string;
}) {
  if (
    !input.definitionWaivable
    || !input.findingWaivable
    || isNonWaivableFinding(input.code)
  ) {
    throw Object.assign(
      new Error('This finding is non-waivable under the pinned quality policy.'),
      { code: 'SITE_QUALITY_FINDING_NON_WAIVABLE' },
    );
  }
  if (!['OPEN', 'ACKNOWLEDGED', 'IN_REMEDIATION'].includes(input.status)) {
    throw Object.assign(
      new Error('Only a current unresolved finding may be waived.'),
      { code: 'SITE_QUALITY_FINDING_NOT_CURRENT' },
    );
  }
}

export function digestQualityToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function qualityTokenDigestMatches(token: string, digest: string): boolean {
  const actual = Buffer.from(digestQualityToken(token), 'hex');
  const expected = Buffer.from(digest, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const forbiddenSafeMetadataKey =
  /(token|secret|authorization|cookie|password|prompt|response|credential|html|pagebody|medical|payment)/i;

export function assertSafeQualityMetadata(value: unknown, key = 'metadata'): void {
  if (forbiddenSafeMetadataKey.test(key)) {
    throw Object.assign(new Error('Unsafe quality metadata key.'), {
      code: 'SITE_QUALITY_UNSAFE_METADATA',
    });
  }
  if (typeof value === 'string' && value.length > 1_000) {
    throw Object.assign(new Error('Quality metadata strings must be bounded.'), {
      code: 'SITE_QUALITY_UNSAFE_METADATA',
    });
  }
  if (Array.isArray(value)) {
    for (const item of value) assertSafeQualityMetadata(item, key);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
      assertSafeQualityMetadata(child, childKey);
    }
  }
}
