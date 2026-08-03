import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import {
  agencyUsers,
  getDatabase,
  siteDomains,
  siteJobs,
  sitePublicationPointers,
  sitePublicationRuns,
  siteQualityRuns,
  siteRenderSnapshots,
  sites,
  siteVersions,
  tenants,
} from '@ks-os/database';
import {
  CreateSitePublicationPayloadSchema,
  ActivateFallbackDomainPayloadSchema,
  DiscoverCustomDomainDnsPayloadSchema,
  PublicationReasonSchema,
  fallbackHostname,
  normalizeCustomHostname,
} from '@ks-os/site-publishing';
import type { z } from 'zod';
import type { AgencyActor } from '../agency/agency.service.js';

type Database = ReturnType<typeof getDatabase>;
type PublicationReason = z.infer<typeof PublicationReasonSchema>;

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class SitePublicationService {
  constructor(private readonly database: Database = getDatabase()) {}

  async list(siteReference: string) {
    return this.database.select({
      reference: sitePublicationRuns.publicReference,
      status: sitePublicationRuns.status,
      reason: sitePublicationRuns.reason,
      createdAt: sitePublicationRuns.createdAt,
      completedAt: sitePublicationRuns.completedAt,
      failureCode: sitePublicationRuns.failureCode,
      failureMessage: sitePublicationRuns.failureMessage,
    }).from(sitePublicationRuns)
      .innerJoin(sites, eq(sitePublicationRuns.siteId, sites.id))
      .where(eq(sites.publicReference, siteReference))
      .orderBy(desc(sitePublicationRuns.createdAt));
  }

  async live(siteReference: string) {
    const [result] = await this.database.select({
      siteReference: sites.publicReference,
      snapshotReference: siteRenderSnapshots.publicReference,
      pointerVersion: sitePublicationPointers.pointerVersion,
      activatedAt: sitePublicationPointers.activatedAt,
    }).from(sites)
      .leftJoin(sitePublicationPointers, eq(sitePublicationPointers.siteId, sites.id))
      .leftJoin(siteRenderSnapshots, eq(siteRenderSnapshots.id, sitePublicationPointers.activeSnapshotId))
      .where(eq(sites.publicReference, siteReference))
      .limit(1);
    if (!result) throw fail(404, 'SITE_NOT_FOUND', 'Site not found.');
    return result;
  }

  async create(actor: AgencyActor, siteReference: string, input: {
    siteVersionReference: string;
    qualityRunReference: string;
    reason: PublicationReason;
    acknowledgeWarnings: boolean;
  }) {
    const reason = PublicationReasonSchema.exclude(['ROLLBACK', 'DOMAIN_ACTIVATION_RECHECK'])
      .parse(input.reason);
    const [context] = await this.database.select({
      tenantId: tenants.id,
      tenantReference: tenants.businessReference,
      siteId: sites.id,
      siteStatus: sites.status,
      versionId: siteVersions.id,
      versionReference: siteVersions.publicReference,
      versionDigest: siteVersions.generationContentDigestSha256,
      qualityRunId: siteQualityRuns.id,
      qualityRunReference: siteQualityRuns.publicReference,
      qualityStatus: siteQualityRuns.status,
      gateStatus: siteQualityRuns.publicationGateStatus,
      qualityDigest: siteQualityRuns.siteVersionDigestSha256,
      warningCount: siteQualityRuns.warningCount,
    }).from(sites)
      .innerJoin(tenants, eq(sites.tenantId, tenants.id))
      .innerJoin(siteVersions, and(
        eq(siteVersions.siteId, sites.id),
        eq(siteVersions.publicReference, input.siteVersionReference),
      ))
      .innerJoin(siteQualityRuns, and(
        eq(siteQualityRuns.siteVersionId, siteVersions.id),
        eq(siteQualityRuns.publicReference, input.qualityRunReference),
      ))
      .where(eq(sites.publicReference, siteReference))
      .limit(1);
    if (!context) throw fail(404, 'PUBLICATION_SCOPE_NOT_FOUND', 'The requested version and quality run do not belong to this site.');
    if (!context.versionDigest || context.versionDigest !== context.qualityDigest) {
      throw fail(409, 'PUBLICATION_PIN_MISMATCH', 'The quality result does not match the current immutable version digest.');
    }
    if (context.qualityStatus !== 'READY'
      || !['READY', 'READY_WITH_WARNINGS'].includes(context.gateStatus)) {
      throw fail(409, 'PUBLICATION_READINESS_BLOCKED', 'The exact quality run is not ready for publication.');
    }
    if (context.gateStatus === 'READY_WITH_WARNINGS' && !input.acknowledgeWarnings) {
      throw fail(409, 'PUBLICATION_WARNING_ACKNOWLEDGEMENT_REQUIRED', 'Current warnings must be acknowledged.');
    }
    if (['SUSPENDED', 'ARCHIVED'].includes(context.siteStatus)) {
      throw fail(409, 'PUBLICATION_SITE_UNAVAILABLE', 'Suspended or archived sites cannot be published.');
    }
    const [agencyUser] = await this.database.select({
      reference: agencyUsers.publicReference,
    }).from(agencyUsers).where(and(
      eq(agencyUsers.id, actor.agencyUserId),
      eq(agencyUsers.status, 'ACTIVE'),
    )).limit(1);
    if (!agencyUser) throw fail(403, 'AGENCY_ACCESS_DENIED', 'The agency actor is not active.');

    const idempotencyKey = digest({
      tenantReference: context.tenantReference,
      siteReference,
      versionDigest: context.versionDigest,
      qualityRunReference: input.qualityRunReference,
      reason,
    });
    return this.database.transaction(async tx => {
      const [existing] = await tx.select({
        reference: sitePublicationRuns.publicReference,
        status: sitePublicationRuns.status,
      }).from(sitePublicationRuns)
        .where(eq(sitePublicationRuns.idempotencyKey, idempotencyKey))
        .limit(1);
      if (existing) return { ...existing, idempotentReplay: true };
      const [run] = await tx.insert(sitePublicationRuns).values({
        tenantId: context.tenantId,
        siteId: context.siteId,
        siteVersionId: context.versionId,
        qualityRunId: context.qualityRunId,
        reason,
        requestedByAgencyUserId: actor.agencyUserId,
        warningAcknowledgementJson: input.acknowledgeWarnings ? {
          qualityRunReference: input.qualityRunReference,
          siteVersionDigestSha256: context.versionDigest,
          warningCount: context.warningCount,
          acknowledgedByAgencyUserReference: agencyUser.reference,
          acknowledgedAt: new Date().toISOString(),
        } : {},
        idempotencyKey,
      }).returning({
        id: sitePublicationRuns.id,
        reference: sitePublicationRuns.publicReference,
        status: sitePublicationRuns.status,
      });
      const payload = CreateSitePublicationPayloadSchema.parse({
        jobType: 'CREATE_SITE_PUBLICATION',
        siteReference,
        siteVersionReference: context.versionReference,
        qualityRunReference: input.qualityRunReference,
        publicationRunReference: run.reference,
        requestedByAgencyUserReference: agencyUser.reference,
        reason,
        acknowledgeWarnings: input.acknowledgeWarnings,
      });
      const [job] = await tx.insert(siteJobs).values({
        tenantId: context.tenantId,
        siteId: context.siteId,
        versionId: context.versionId,
        jobType: 'CREATE_SITE_PUBLICATION',
        idempotencyKey: `publication:${idempotencyKey}`,
        sourceReference: run.reference,
        sourceDigestSha256: context.versionDigest,
        payloadJson: payload,
        createdByAgencyUserId: actor.agencyUserId,
      }).returning({ id: siteJobs.id, reference: siteJobs.publicReference });
      await tx.update(sitePublicationRuns).set({ siteJobId: job.id })
        .where(eq(sitePublicationRuns.id, run.id));
      return { reference: run.reference, status: run.status, jobReference: job.reference, idempotentReplay: false };
    });
  }

  async domains(siteReference: string) {
    return this.database.select({
      reference: siteDomains.publicReference,
      hostname: siteDomains.hostname,
      type: siteDomains.domainType,
      role: siteDomains.domainRole,
      status: siteDomains.status,
      ownershipStatus: siteDomains.ownershipStatus,
      sslStatus: siteDomains.sslStatus,
      lastHealthyAt: siteDomains.lastHealthyAt,
    }).from(siteDomains)
      .innerJoin(sites, eq(siteDomains.siteId, sites.id))
      .where(eq(sites.publicReference, siteReference))
      .orderBy(desc(siteDomains.createdAt));
  }

  async createFallback(actor: AgencyActor, siteReference: string, fallbackDomain: string) {
    const [context] = await this.database.select({
      tenantId: tenants.id,
      siteId: sites.id,
      subdomain: tenants.subdomain,
    }).from(sites).innerJoin(tenants, eq(sites.tenantId, tenants.id))
      .where(eq(sites.publicReference, siteReference)).limit(1);
    if (!context) throw fail(404, 'SITE_NOT_FOUND', 'Site not found.');
    const hostname = fallbackHostname(context.subdomain, fallbackDomain);
    const agencyReference = await this.agencyReference(actor);
    return this.database.transaction(async tx => {
      const [created] = await tx.insert(siteDomains).values({
        tenantId: context.tenantId,
        siteId: context.siteId,
        hostname,
        domainType: 'FALLBACK',
        domainRole: 'FALLBACK',
        providerKey: 'KS_OS',
        status: 'RESERVED',
      }).onConflictDoNothing().returning({ id: siteDomains.id, reference: siteDomains.publicReference, hostname: siteDomains.hostname, status: siteDomains.status });
      const [domain] = created ? [created] : await tx.select({
        id: siteDomains.id,
        reference: siteDomains.publicReference,
        hostname: siteDomains.hostname,
        status: siteDomains.status,
      }).from(siteDomains).where(and(eq(siteDomains.siteId, context.siteId), eq(siteDomains.domainType, 'FALLBACK'))).limit(1);
      if (!domain) throw fail(409, 'FALLBACK_DOMAIN_UNAVAILABLE', 'A fallback hostname could not be reserved.');
      const payload = ActivateFallbackDomainPayloadSchema.parse({
        jobType: 'ACTIVATE_FALLBACK_DOMAIN',
        siteReference,
        domainReference: domain.reference,
        requestedByAgencyUserReference: agencyReference,
      });
      const [job] = await tx.insert(siteJobs).values({
        tenantId: context.tenantId,
        siteId: context.siteId,
        jobType: 'ACTIVATE_FALLBACK_DOMAIN',
        idempotencyKey: `fallback:${domain.reference}`,
        sourceReference: domain.reference,
        payloadJson: payload,
        createdByAgencyUserId: actor.agencyUserId,
      }).onConflictDoNothing().returning({ reference: siteJobs.publicReference });
      return { reference: domain.reference, hostname: domain.hostname, status: domain.status, jobReference: job?.reference ?? null };
    });
  }

  async createCustom(actor: AgencyActor, siteReference: string, hostnameInput: string) {
    const hostname = normalizeCustomHostname(hostnameInput);
    const [site] = await this.database.select({
      tenantId: sites.tenantId,
      siteId: sites.id,
    }).from(sites).where(eq(sites.publicReference, siteReference)).limit(1);
    if (!site) throw fail(404, 'SITE_NOT_FOUND', 'Site not found.');
    const agencyReference = await this.agencyReference(actor);
    try {
      return await this.database.transaction(async tx => {
        const [created] = await tx.insert(siteDomains).values({
          tenantId: site.tenantId,
          siteId: site.siteId,
          hostname,
          domainType: 'CUSTOM',
          domainRole: 'ALIAS',
          status: 'DNS_DISCOVERY_PENDING',
        }).returning({ id: siteDomains.id, reference: siteDomains.publicReference, hostname: siteDomains.hostname, status: siteDomains.status });
        const payload = DiscoverCustomDomainDnsPayloadSchema.parse({
          jobType: 'DISCOVER_CUSTOM_DOMAIN_DNS',
          siteReference,
          domainReference: created.reference,
          requestedByAgencyUserReference: agencyReference,
        });
        const [job] = await tx.insert(siteJobs).values({
          tenantId: site.tenantId,
          siteId: site.siteId,
          jobType: 'DISCOVER_CUSTOM_DOMAIN_DNS',
          idempotencyKey: `domain-discovery:${created.reference}`,
          sourceReference: created.reference,
          payloadJson: payload,
          createdByAgencyUserId: actor.agencyUserId,
        }).returning({ reference: siteJobs.publicReference });
        return { reference: created.reference, hostname: created.hostname, status: created.status, jobReference: job.reference };
      });
    } catch {
      throw fail(409, 'DOMAIN_ALREADY_ASSIGNED', 'The hostname is already assigned or is cooling down after removal.');
    }
  }

  private async agencyReference(actor: AgencyActor) {
    const [agencyUser] = await this.database.select({ reference: agencyUsers.publicReference })
      .from(agencyUsers).where(and(eq(agencyUsers.id, actor.agencyUserId), eq(agencyUsers.status, 'ACTIVE'))).limit(1);
    if (!agencyUser) throw fail(403, 'AGENCY_ACCESS_DENIED', 'The agency actor is not active.');
    return agencyUser.reference;
  }
}
