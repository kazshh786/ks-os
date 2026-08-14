import { createHash } from 'node:crypto';
import {
  PublishedSiteSnapshotSchema,
  type PublishedSiteSnapshot,
  type PublishedSnapshotInput,
} from './contracts.js';
import { assertStructuredDataContentAgreement } from './structured-data.js';

function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalise(child)]),
    );
  }
  return value;
}

export function calculatePublishedSnapshotDigest(input: PublishedSnapshotInput): string {
  const snapshot = PublishedSiteSnapshotSchema.parse(input);
  return createHash('sha256')
    .update(JSON.stringify(canonicalise(snapshot)))
    .digest('hex');
}

export function validatePublishedSnapshot(input: unknown): PublishedSiteSnapshot {
  return PublishedSiteSnapshotSchema.parse(input);
}

export function prepareSiteRenderSnapshotForStorage(input: unknown): {
  content: PublishedSiteSnapshot;
  contentDigestSha256: string;
  schemaVersion: 1;
} {
  const content = validatePublishedSnapshot(input);
  for (const page of content.pages) assertStructuredDataContentAgreement(content, page);
  return {
    content,
    contentDigestSha256: calculatePublishedSnapshotDigest(content),
    schemaVersion: content.schemaVersion,
  };
}

export function freezePublishedSnapshot(input: unknown): Readonly<PublishedSiteSnapshot> {
  const snapshot = validatePublishedSnapshot(input);
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  };
  freeze(snapshot);
  return snapshot;
}
