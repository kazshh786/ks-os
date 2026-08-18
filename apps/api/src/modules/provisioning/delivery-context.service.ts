import { and, desc, eq, inArray, isNotNull, or } from 'drizzle-orm';
import {
  designLibraryAssignments,
  designLibraryItems,
  getDatabase,
  knowledgePacks,
  locations,
  platformPlans,
  platformPlanVersions,
  productionBriefs,
  provisioningDrafts,
  provisioningRuns,
  services,
  sites,
  templateLayoutPageTypes,
  templateLayoutRenderers,
  templateLayouts,
  templateSources,
  templateVersions,
  tenantPlanAssignments,
  tenants,
  users,
} from '@ks-os/database';
import { SITE_DESIGN_PRESETS } from '@ks-os/contracts';
import { isSiteGenerationProviderReady, parseSiteGenerationConfig } from '@ks-os/site-generation';
import { ProvisioningService } from './provisioning.service.js';

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

function labels(value: unknown): string[] {
  const source = Array.isArray(value) ? value : [];
  const output: string[] = [];
  const visit = (item: unknown) => {
    if (typeof item === 'string' && item.trim()) output.push(item.trim());
    else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === 'object') {
      const row = item as Record<string, unknown>;
      for (const key of ['name', 'label', 'value', 'text']) {
        if (typeof row[key] === 'string' && String(row[key]).trim()) {
          output.push(String(row[key]).trim());
          return;
        }
      }
    }
  };
  source.forEach(visit);
  return [...new Set(output)];
}

const REQUIRED_NATIVE_PAGE_TYPES = [
  'HOME',
  'SERVICE_HUB',
  'ABOUT',
  'CONTACT',
  'POLICIES',
  'BOOKING',
] as const;
const APPROVED_V3_NATIVE_TEMPLATE_REFERENCE = 'e054818e-c185-44fd-b453-010000000005';

export class DeliveryContextService {
  private readonly provisioning: ProvisioningService;

  constructor(private readonly db = getDatabase()) {
    this.provisioning = new ProvisioningService(db);
  }

  async get(tenantReference: string) {
    let generationProvider: { enabled: boolean; ready: boolean; generationMode: string; providerKey: string | null; modelKey: string | null; blocker: string | null };
    try {
      const config = parseSiteGenerationConfig(process.env);
      const ready = isSiteGenerationProviderReady(config);
      generationProvider = {
        enabled: config.enabled,
        ready,
        generationMode: config.generationMode,
        providerKey: config.provider,
        modelKey: config.model || null,
        blocker: ready ? null : 'Complete the selected server-side provider configuration.',
      };
    } catch {
      generationProvider = {
        enabled: process.env.SITE_AI_GENERATION_ENABLED === 'true',
        ready: false,
        generationMode: process.env.SITE_AI_GENERATION_MODE || 'ai-composition',
        providerKey: process.env.SITE_AI_PROVIDER || null,
        modelKey: process.env.SITE_AI_MODEL || null,
        blocker: 'The selected server-side generation provider configuration is incomplete.',
      };
    }
    const [tenant] = await this.db.select({
      id: tenants.id,
      agencyReference: tenants.agencyReference,
      businessReference: tenants.businessReference,
      name: tenants.name,
      subdomain: tenants.subdomain,
      lifecycleStatus: tenants.lifecycleStatus,
      timezone: tenants.timezone,
      currency: tenants.currency,
      launchedAt: tenants.launchedAt,
    }).from(tenants).where(or(
      eq(tenants.id, tenantReference),
      eq(tenants.agencyReference, tenantReference),
      eq(tenants.businessReference, tenantReference),
    )).limit(1);

    const removed = tenant
      && tenant.lifecycleStatus === 'OFFBOARDED'
      && tenant.name === 'Deleted workspace'
      && tenant.subdomain.startsWith('deleted-');
    if (!tenant || removed) {
      throw fail(404, 'TENANT_NOT_FOUND', 'The client workspace was not found.');
    }

    const [
      planRows,
      briefRows,
      templateRows,
      nativeRows,
      themeRows,
      assignedThemeRows,
      knowledgeRows,
      draftRows,
      runRows,
      siteRows,
      canonical,
    ] = await Promise.all([
      this.db.select({
        versionReference: platformPlanVersions.id,
        key: platformPlans.key,
        name: platformPlanVersions.name,
        version: platformPlanVersions.version,
        currency: platformPlanVersions.currency,
        monthlyPriceMinor: platformPlanVersions.monthlyPriceMinor,
      }).from(tenantPlanAssignments)
        .innerJoin(platformPlanVersions, eq(tenantPlanAssignments.planVersionId, platformPlanVersions.id))
        .innerJoin(platformPlans, eq(platformPlanVersions.planId, platformPlans.id))
        .where(and(eq(tenantPlanAssignments.tenantId, tenant.id), eq(tenantPlanAssignments.status, 'ACTIVE')))
        .orderBy(desc(tenantPlanAssignments.startsAt)).limit(1),
      this.db.select({
        reference: productionBriefs.publicReference,
        version: productionBriefs.briefVersion,
        status: productionBriefs.status,
        readiness: productionBriefs.readinessJson,
        brief: productionBriefs.briefJson,
        createdAt: productionBriefs.createdAt,
      }).from(productionBriefs).where(eq(productionBriefs.tenantId, tenant.id))
        .orderBy(desc(productionBriefs.briefVersion), desc(productionBriefs.createdAt)).limit(1),
      this.db.select({
        reference: templateVersions.publicReference,
        version: templateVersions.versionNumber,
        sourceName: templateSources.name,
        sourceType: templateSources.sourceType,
      }).from(templateVersions)
        .innerJoin(templateSources, eq(templateVersions.templateSourceId, templateSources.id))
        .where(and(
          eq(templateVersions.status, 'APPROVED'),
          eq(templateVersions.analysisStatus, 'APPROVED'),
          inArray(templateSources.sourceType, ['ENVATO_HTML', 'GOOGLE_STITCH']),
        ))
        .orderBy(desc(templateVersions.createdAt)).limit(50),
      this.db.select({
        versionReference: templateVersions.publicReference,
        pageType: templateLayoutPageTypes.pageType,
        rendererStatus: templateLayoutRenderers.rendererStatus,
      }).from(templateVersions)
        .innerJoin(templateSources, eq(templateVersions.templateSourceId, templateSources.id))
        .innerJoin(templateLayouts, eq(templateLayouts.templateVersionId, templateVersions.id))
        .innerJoin(templateLayoutPageTypes, eq(templateLayoutPageTypes.templateLayoutId, templateLayouts.id))
        .innerJoin(templateLayoutRenderers, eq(templateLayoutRenderers.templateLayoutId, templateLayouts.id))
        .where(and(
          eq(templateSources.sourceReference, 'ks-native-component-system'),
          eq(templateVersions.publicReference, APPROVED_V3_NATIVE_TEMPLATE_REFERENCE),
          eq(templateSources.sourceType, 'INTERNAL'),
          eq(templateSources.status, 'APPROVED'),
          eq(templateVersions.status, 'APPROVED'),
          eq(templateVersions.analysisStatus, 'APPROVED'),
          eq(templateLayouts.status, 'APPROVED'),
          eq(templateLayoutRenderers.rendererStatus, 'READY'),
          isNotNull(templateLayoutPageTypes.approvedAt),
        )),
      this.db.select({
        reference: designLibraryItems.publicReference,
        name: designLibraryItems.name,
        description: designLibraryItems.description,
        theme: designLibraryItems.themeJson,
        preview: designLibraryItems.previewJson,
        previewImageUrl: designLibraryItems.previewImageUrl,
        tags: designLibraryItems.tagsJson,
        isSystem: designLibraryItems.isSystem,
        updatedAt: designLibraryItems.updatedAt,
      }).from(designLibraryItems).where(and(
        eq(designLibraryItems.itemKind, 'SITE_THEME'),
        eq(designLibraryItems.status, 'APPROVED'),
        eq(designLibraryItems.availableForClientDelivery, true),
      )).orderBy(desc(designLibraryItems.isSystem), desc(designLibraryItems.updatedAt)).limit(100),
      this.db.select({
        reference: designLibraryItems.publicReference,
        name: designLibraryItems.name,
        description: designLibraryItems.description,
        theme: designLibraryItems.themeJson,
        preview: designLibraryItems.previewJson,
        previewImageUrl: designLibraryItems.previewImageUrl,
        tags: designLibraryItems.tagsJson,
        isSystem: designLibraryItems.isSystem,
        assignedAt: designLibraryAssignments.assignedAt,
      }).from(designLibraryAssignments)
        .innerJoin(designLibraryItems, eq(designLibraryAssignments.itemId, designLibraryItems.id))
        .where(and(
          eq(designLibraryAssignments.tenantId, tenant.id),
          eq(designLibraryAssignments.status, 'ACTIVE'),
          eq(designLibraryItems.itemKind, 'SITE_THEME'),
          eq(designLibraryItems.status, 'APPROVED'),
          eq(designLibraryItems.availableForClientDelivery, true),
        ))
        .orderBy(desc(designLibraryAssignments.assignedAt))
        .limit(1),
      this.db.select({
        reference: knowledgePacks.publicReference,
        name: knowledgePacks.name,
        semanticVersion: knowledgePacks.semanticVersion,
        sourceDigest: knowledgePacks.sourceDigestSha256,
        contentDigest: knowledgePacks.contentDigestSha256,
        sourceCount: knowledgePacks.sourceCount,
        ruleCount: knowledgePacks.ruleCount,
        pagePlaybookCount: knowledgePacks.pagePlaybookCount,
        sectionPlaybookCount: knowledgePacks.sectionPlaybookCount,
      }).from(knowledgePacks).where(and(
        eq(knowledgePacks.intendedScope, 'PUBLIC_SITE'),
        eq(knowledgePacks.status, 'ACTIVE'),
      )).limit(2),
      this.db.select({ reference: provisioningDrafts.publicReference })
        .from(provisioningDrafts).where(eq(provisioningDrafts.tenantId, tenant.id))
        .orderBy(desc(provisioningDrafts.createdAt)).limit(1),
      this.db.select({ reference: provisioningRuns.publicReference })
        .from(provisioningRuns).where(eq(provisioningRuns.tenantId, tenant.id))
        .orderBy(desc(provisioningRuns.createdAt)).limit(1),
      this.db.select({ reference: sites.publicReference, status: sites.status })
        .from(sites).where(eq(sites.tenantId, tenant.id)).orderBy(desc(sites.createdAt)).limit(1),
      Promise.all([
        this.db.select({ reference: services.publicReference, name: services.name }).from(services).where(and(eq(services.tenantId, tenant.id), eq(services.isActive, true))),
        this.db.select({ reference: locations.publicReference, name: locations.name }).from(locations).where(and(eq(locations.tenantId, tenant.id), eq(locations.isActive, true))),
        this.db.select({ reference: users.publicReference, name: users.name }).from(users).where(and(eq(users.tenantId, tenant.id), eq(users.accountStatus, 'ACTIVE'))),
      ]),
    ]);

    const brief = briefRows[0] || null;
    const verifiedFacts = record(record(brief?.brief).verifiedFacts);
    const draft = draftRows[0] ? await this.provisioning.getDraft(draftRows[0].reference) : null;
    const run = runRows[0] ? await this.provisioning.getRun(runRows[0].reference) : null;
    const readiness = await this.provisioning.readiness(tenant.agencyReference);
    const nativePageTypes = new Set(nativeRows.map(row => row.pageType));
    const nativeTemplateReady = Boolean(
      nativeRows[0]?.versionReference
      && REQUIRED_NATIVE_PAGE_TYPES.every(pageType => nativePageTypes.has(pageType)),
    );
    const knowledgeReady = knowledgeRows.length === 1;
    const assignedTheme = assignedThemeRows[0]
      ? {
          ...assignedThemeRows[0],
          theme: record(assignedThemeRows[0].theme),
          preview: record(assignedThemeRows[0].preview),
          tags: Array.isArray(assignedThemeRows[0].tags) ? assignedThemeRows[0].tags : [],
        }
      : null;

    return {
      tenant,
      plan: planRows[0] || null,
      productionBrief: brief ? {
        reference: brief.reference,
        version: brief.version,
        status: brief.status,
        readyForProvisioning: record(brief.readiness).readyForProvisioning === true,
      } : null,
      knowledge: knowledgeReady ? {
        ready: true,
        ...knowledgeRows[0],
      } : {
        ready: false,
        reference: null,
        name: null,
        semanticVersion: null,
        sourceDigest: null,
        contentDigest: null,
        sourceCount: 0,
        ruleCount: 0,
        pagePlaybookCount: 0,
        sectionPlaybookCount: 0,
      },
      generationProvider,
      designLibrary: {
        defaultSource: 'KS_NATIVE',
        defaultPresetKey: 'NORTHLIGHT',
        nativeTemplateReady,
        nativeTemplateVersionReference: nativeTemplateReady ? nativeRows[0].versionReference : null,
        assignedTheme,
        presets: SITE_DESIGN_PRESETS,
        themes: themeRows.map(item => ({
          ...item,
          theme: record(item.theme),
          preview: record(item.preview),
          tags: Array.isArray(item.tags) ? item.tags : [],
        })),
        sectionVariants: ['editorial', 'grid', 'split', 'compact', 'standard', 'featured', 'quiet'],
      },
      approvedTemplates: templateRows.map(item => ({
        ...item,
        label: `${item.sourceName} · version ${item.version}`,
      })),
      draft,
      run,
      site: siteRows[0] || null,
      readiness,
      sourcePreview: {
        services: labels(verifiedFacts['SERVICE.NAME']),
        locations: labels(verifiedFacts['LOCATION.NAME']),
        staff: labels(verifiedFacts['STAFF.NAME']),
        hasAvailability: Boolean(
          (Array.isArray(verifiedFacts['STAFF.AVAILABILITY']) && verifiedFacts['STAFF.AVAILABILITY'].length)
          || (Array.isArray(verifiedFacts['LOCATION.OPENING_HOURS']) && verifiedFacts['LOCATION.OPENING_HOURS'].length)
        ),
        hasBookingRules: Object.keys(verifiedFacts).some(key => key.startsWith('BOOKING.')),
      },
      websiteRequirements: {
        requestedPageTypes: labels(verifiedFacts['WEBSITE.REQUESTED_PAGE_TYPES']),
        explicitPages: labels(verifiedFacts['WEBSITE.EXPLICIT_PAGES']),
        commercialPriorities: labels(verifiedFacts['WEBSITE.COMMERCIAL_PRIORITIES']),
        prioritisedServices: labels(verifiedFacts['WEBSITE.PRIORITIZED_SERVICES']),
        prioritisedLocations: labels(verifiedFacts['WEBSITE.PRIORITIZED_LOCATIONS']),
        requiredContent: labels(verifiedFacts['WEBSITE.REQUIRED_CONTENT']),
        prohibitedContent: labels(verifiedFacts['WEBSITE.PROHIBITED_CONTENT']),
        imageSourcePolicy: labels(verifiedFacts['CONTENT.IMAGE_SOURCE_POLICY'])[0] || null,
      },
      canonical: {
        services: canonical[0],
        locations: canonical[1],
        staff: canonical[2],
        serviceCount: canonical[0].length,
        locationCount: canonical[1].length,
        activeUserCount: canonical[2].length,
      },
    };
  }
}
