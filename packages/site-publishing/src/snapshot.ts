import {
  freezePublishedSnapshot,
  type PublishedSiteSnapshot,
} from '@ks-os/site-schema';
import type { PublicationPin } from './contracts.js';

const forbiddenKeys = /(?:password|secret|token|payment|card|questionnaire|internalId|databaseId)/i;

function assertPublicShape(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertPublicShape(child, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenKeys.test(key)) throw new Error(`SNAPSHOT_PRIVATE_FIELD:${path}.${key}`);
    assertPublicShape(child, `${path}.${key}`);
  }
}

export function prepareImmutablePublicationSnapshot(input: {
  snapshot: PublishedSiteSnapshot;
  pin: PublicationPin;
}): {
  snapshot: Readonly<PublishedSiteSnapshot>;
  pin: Readonly<PublicationPin>;
} {
  if (
    input.snapshot.siteReference !== input.pin.siteReference
    || input.snapshot.versionReference !== input.pin.siteVersionReference
    || input.snapshot.templateVersionReference !== input.pin.templateVersionReference
    || input.snapshot.visibility !== 'PUBLISHED'
  ) {
    throw new Error('SNAPSHOT_PIN_MISMATCH');
  }
  assertPublicShape(input.snapshot);
  return {
    snapshot: freezePublishedSnapshot(input.snapshot),
    pin: Object.freeze({ ...input.pin }),
  };
}
