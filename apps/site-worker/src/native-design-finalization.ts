import { randomUUID } from 'node:crypto';
import { and, desc, eq, getDatabase, inArray } from '@ks-os/database';
import {
  platformAuditEvents,
  siteRenderSnapshots,
  siteSections,
  siteVersions,
  tenants,
} from '@ks-os/database';
import {
  SITE_DESIGN_PRESETS,
  SiteDesignPresetKeySchema,
  SiteStudioSectionVariantSchema,
  type SiteDesignPresetKey,
  type SiteStudioSectionVariant,
} from '@ks-os/contracts';
import {
  prepareSiteRenderSnapshotForStorage,
  validatePublishedSnapshot,
  type PublishedSiteSnapshot,
} from '@ks-os/site-schema';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const EDITORIAL_PRESETS = new Set<SiteDesignPresetKey>(['EDITORIAL', 'LUXURY', 'CREATIVE']);
const STRUCTURED_PRESETS = new Set<SiteDesignPresetKey>(['MODERN', 'CLINICAL']);

export function nativeSectionVariant(
  presetKey: SiteDesignPresetKey,
  sectionType: string,
  fallback: SiteStudioSectionVariant = 'standard',
): SiteStudioSectionVariant {
  if (sectionType === 'HEADER' || sectionType === 'FOOTER') return 'standard';
  if (sectionType === 'HERO') {
    if (presetKey === 'BOLD') return 'featured';
    return 'split';
  }
  if (['FEATURED_SERVICES', 'SERVICE_GRID', 'TEAM', 'GALLERY', 'RESULTS'].includes(sectionType)) {
    if (EDITORIAL_PRESETS.has(presetKey)) return 'editorial';
    return 'grid';
  }
  if (['SERVICE_DETAILS', 'STAFF_PROFILE', 'LOCATION', 'CONTACT'].includes(sectionType)) {
    return EDITORIAL_PRESETS.has(presetKey) ? 'editorial' : 'split';
  }
  if (['TESTIMONIALS', 'TRUST_INDICATORS'].includes(sectionType)) {
    if (presetKey === 'BOLD') return 'compact';
    return EDITORIAL_PRESETS.has(presetKey) ? 'editorial' : 'quiet';
  }
  if (['FAQ', 'RICH_TEXT', 'OPENING_HOURS', 'PRICING'].includes(sectionType)) {
    return STRUCTURED_PRESETS.has(presetKey) ? 'compact' : 'quiet';
  }
  if (['BOOKING_CTA', 'FINAL_CTA'].includes(sectionType)) return 'featured';
  if (['BENEFITS', 'PROCESS'].includes(sectionType)) return STRUCTURED_PRESETS.has(presetKey) ? 'grid' : fallback;
  return fallback;
}

function sameDesign(left: PublishedSiteSnapshot, right: PublishedSiteSnapshot) {
  const leftDesign = {
    theme: left.theme,
    sections: left.pages.flatMap(page => page.sections.map(section => [section.reference, section.variant ?? null])),
  };
  const rightDesign = {
    theme: right.theme,
    sections: right.pages.flatMap(page => page.sections.map(section => [section.reference, section.variant ?? null])),
  };
  return JSON.stringify(leftDesign) === JSON.stringify(rightDesign);
}

export async function applyProvisionedNativeDesign(
  tx: Transaction,
  input: {
    tenantId: string;
    siteId: string;
    siteReference: string;
    versionId: string;
    agencyUserId: string;
    pagePlan: unknown;
  },
) {
  const design = record(record(input.pagePlan).design);
  if (design.source !== 'KS_NATIVE') return null;

  const presetResult = SiteDesignPresetKeySchema.safeParse(design.presetKey);
  const presetKey = presetResult.success ? presetResult.data : 'NORTHLIGHT';
  const preset = SITE_DESIGN_PRESETS.find(item => item.key === presetKey) ?? SITE_DESIGN_PRESETS[0];
  const fallbackResult = SiteStudioSectionVariantSchema.safeParse(design.defaultSectionVariant);
  const fallbackVariant = fallbackResult.success ? fallbackResult.data : 'standard';

  const [latest] = await tx.select({
    reference: siteRenderSnapshots.publicReference,
    templateVersionId: siteRenderSnapshots.templateVersionId,
    revision: siteRenderSnapshots.revision,
    contentDigest: siteRenderSnapshots.contentDigestSha256,
    content: siteRenderSnapshots.contentJson,
  }).from(siteRenderSnapshots)
    .where(and(
      eq(siteRenderSnapshots.siteId, input.siteId),
      eq(siteRenderSnapshots.siteVersionId, input.versionId),
      inArray(siteRenderSnapshots.snapshotKind, ['PREVIEW', 'PUBLISHED']),
    ))
    .orderBy(desc(siteRenderSnapshots.revision))
    .limit(1);

  if (!latest) throw new Error('The generated secure preview is unavailable for native design finalisation.');

  const current = validatePublishedSnapshot(latest.content);
  const next = JSON.parse(JSON.stringify(current)) as PublishedSiteSnapshot;
  next.theme = { ...preset.theme };
  for (const page of next.pages) {
    for (const section of page.sections) {
      section.variant = nativeSectionVariant(presetKey, section.type, fallbackVariant);
    }
  }

  if (sameDesign(current, next)) {
    return { contentDigest: latest.contentDigest, presetKey, idempotentReplay: true };
  }

  const snapshotReference = randomUUID();
  const prepared = prepareSiteRenderSnapshotForStorage({
    ...next,
    publicReference: snapshotReference,
    visibility: 'PREVIEW',
    versionStatus: 'INTERNAL_REVIEW',
    createdAt: new Date().toISOString(),
    publishedAt: null,
  });

  const variantByReference = new Map(
    next.pages.flatMap(page => page.sections.map(section => [section.reference, section.variant ?? fallbackVariant] as const)),
  );
  const rows = await tx.select({
    id: siteSections.id,
    reference: siteSections.publicReference,
    content: siteSections.contentJson,
  }).from(siteSections).where(eq(siteSections.versionId, input.versionId));
  for (const row of rows) {
    const variant = variantByReference.get(row.reference);
    if (!variant) continue;
    await tx.update(siteSections).set({
      contentJson: { ...record(row.content), variant },
      updatedAt: new Date(),
    }).where(eq(siteSections.id, row.id));
  }

  await tx.insert(siteRenderSnapshots).values({
    publicReference: snapshotReference,
    tenantId: input.tenantId,
    siteId: input.siteId,
    siteVersionId: input.versionId,
    templateVersionId: latest.templateVersionId,
    snapshotKind: 'PREVIEW',
    revision: latest.revision + 1,
    schemaVersion: prepared.schemaVersion,
    contentJson: prepared.content,
    contentDigestSha256: prepared.contentDigestSha256,
    sourceContentDigestSha256: prepared.contentDigestSha256,
    createdByAgencyUserId: input.agencyUserId,
  });
  await tx.update(siteVersions).set({
    generationContentDigestSha256: prepared.contentDigestSha256,
    changeSummary: `Generated with the ${preset.name} KS native design system.`,
    updatedAt: new Date(),
  }).where(eq(siteVersions.id, input.versionId));
  await tx.update(tenants).set({
    primaryColor: preset.theme.primaryColour,
    secondaryColor: preset.theme.secondaryColour,
    accentColor: preset.theme.accentColour,
    updatedAt: new Date(),
  }).where(eq(tenants.id, input.tenantId));
  await tx.insert(platformAuditEvents).values({
    agencyUserId: input.agencyUserId,
    tenantId: input.tenantId,
    action: 'SITE_NATIVE_DESIGN_APPLIED',
    targetType: 'SITE',
    targetId: input.siteReference,
    eventCategory: 'WEBSITE',
    sourceComponent: 'site-worker',
    description: 'The selected KS-native design system and controlled component variations were applied before internal review.',
    metadata: { presetKey, defaultSectionVariant: fallbackVariant, snapshotReference },
  });

  return {
    contentDigest: prepared.contentDigestSha256,
    presetKey,
    snapshotReference,
    idempotentReplay: false,
  };
}
