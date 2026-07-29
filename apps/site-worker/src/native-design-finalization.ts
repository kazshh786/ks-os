import { randomUUID } from 'node:crypto';
import { and, desc, eq, getDatabase, inArray } from '@ks-os/database';
import {
  designLibraryAssignments,
  designLibraryItems,
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
  SiteThemeEditorSchema,
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

async function resolveDesign(
  tx: Transaction,
  tenantId: string,
  pagePlan: unknown,
) {
  const design = record(record(pagePlan).design);
  const explicitReference = typeof design.libraryItemReference === 'string'
    ? design.libraryItemReference
    : null;

  const [custom] = explicitReference
    ? await tx.select({
        reference: designLibraryItems.publicReference,
        name: designLibraryItems.name,
        theme: designLibraryItems.themeJson,
        definition: designLibraryItems.definitionJson,
      }).from(designLibraryItems).where(and(
        eq(designLibraryItems.publicReference, explicitReference),
        eq(designLibraryItems.itemKind, 'SITE_THEME'),
        eq(designLibraryItems.status, 'APPROVED'),
        eq(designLibraryItems.availableForClientDelivery, true),
      )).limit(1)
    : await tx.select({
        reference: designLibraryItems.publicReference,
        name: designLibraryItems.name,
        theme: designLibraryItems.themeJson,
        definition: designLibraryItems.definitionJson,
      }).from(designLibraryAssignments)
        .innerJoin(designLibraryItems, eq(designLibraryAssignments.itemId, designLibraryItems.id))
        .where(and(
          eq(designLibraryAssignments.tenantId, tenantId),
          eq(designLibraryAssignments.status, 'ACTIVE'),
          eq(designLibraryItems.itemKind, 'SITE_THEME'),
          eq(designLibraryItems.status, 'APPROVED'),
          eq(designLibraryItems.availableForClientDelivery, true),
        ))
        .orderBy(desc(designLibraryAssignments.assignedAt))
        .limit(1);

  if (custom) {
    const theme = SiteThemeEditorSchema.parse(custom.theme);
    const definition = record(custom.definition);
    const fallbackResult = SiteStudioSectionVariantSchema.safeParse(
      definition.defaultSectionVariant ?? design.defaultSectionVariant,
    );
    const fallbackVariant = fallbackResult.success ? fallbackResult.data : 'standard';
    const rawRules = record(definition.variantRules);
    const variantRules = new Map<string, SiteStudioSectionVariant>();
    for (const [sectionType, value] of Object.entries(rawRules)) {
      const parsed = SiteStudioSectionVariantSchema.safeParse(value);
      if (parsed.success) variantRules.set(sectionType, parsed.data);
    }
    return {
      kind: 'LIBRARY' as const,
      reference: custom.reference,
      name: custom.name,
      theme,
      fallbackVariant,
      variantFor(sectionType: string) {
        return variantRules.get(sectionType) ?? fallbackVariant;
      },
    };
  }

  const presetResult = SiteDesignPresetKeySchema.safeParse(design.presetKey);
  const presetKey = presetResult.success ? presetResult.data : 'NORTHLIGHT';
  const preset = SITE_DESIGN_PRESETS.find(item => item.key === presetKey) ?? SITE_DESIGN_PRESETS[0];
  const fallbackResult = SiteStudioSectionVariantSchema.safeParse(design.defaultSectionVariant);
  const fallbackVariant = fallbackResult.success ? fallbackResult.data : 'standard';
  return {
    kind: 'PRESET' as const,
    reference: presetKey,
    name: preset.name,
    theme: preset.theme,
    fallbackVariant,
    variantFor(sectionType: string) {
      return nativeSectionVariant(presetKey, sectionType, fallbackVariant);
    },
  };
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

  const selected = await resolveDesign(tx, input.tenantId, input.pagePlan);

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
  next.theme = { ...selected.theme };
  for (const page of next.pages) {
    for (const section of page.sections) {
      section.variant = selected.variantFor(section.type);
    }
  }

  if (sameDesign(current, next)) {
    return {
      contentDigest: latest.contentDigest,
      presetKey: selected.reference,
      designReference: selected.reference,
      designName: selected.name,
      idempotentReplay: true,
    };
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
    next.pages.flatMap(page => page.sections.map(section => [section.reference, section.variant ?? selected.fallbackVariant] as const)),
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
    changeSummary: `Generated with the ${selected.name} KS native design system.`,
    updatedAt: new Date(),
  }).where(eq(siteVersions.id, input.versionId));
  await tx.update(tenants).set({
    primaryColor: selected.theme.primaryColour,
    secondaryColor: selected.theme.secondaryColour,
    accentColor: selected.theme.accentColour,
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
    metadata: {
      designSource: selected.kind,
      designReference: selected.reference,
      designName: selected.name,
      defaultSectionVariant: selected.fallbackVariant,
      snapshotReference,
    },
  });

  return {
    contentDigest: prepared.contentDigestSha256,
    presetKey: selected.reference,
    designReference: selected.reference,
    designName: selected.name,
    snapshotReference,
    idempotentReplay: false,
  };
}
