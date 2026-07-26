import { and, eq, sql } from 'drizzle-orm';
import {
  getDatabase,
  siteBlueprints,
  siteJobEvents,
  siteJobs,
  sites,
  siteVersions,
  tenants,
} from '@ks-os/database';
import {
  SiteJobPayloadSchema,
  SiteJobTypeSchema,
  deriveSiteJobIdempotencyKey,
  type SiteJobPayload,
  type SiteJobType,
} from '@ks-os/site-jobs';
import {
  AgencyAuditService,
  type AgencyActor,
} from '../agency/agency.service.js';

type Database = ReturnType<typeof getDatabase>;

export interface EnqueueSiteJobInput {
  tenantReference: string;
  siteReference: string;
  versionReference?: string;
  blueprintReference?: string;
  jobType: SiteJobType;
  payload: SiteJobPayload;
  sourceReference?: string;
  sourceDigestSha256: string;
  operationVersion: number;
  priority?: number;
  scheduledFor?: Date;
  maxAttempts?: number;
}

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

/**
 * Server-side enqueue boundary for future domain services.
 *
 * The default allowlist is intentionally empty in Phase 15.6A because no
 * production website handler is implemented yet. A later domain service must
 * explicitly supply the job types whose real handlers it installs.
 */
export class SiteJobEnqueueService {
  constructor(
    private readonly database: Database = getDatabase(),
    private readonly enqueueableJobTypes: ReadonlySet<SiteJobType>
      = new Set<SiteJobType>(),
    private readonly audit = new AgencyAuditService(),
  ) {}

  async enqueue(actor: AgencyActor, input: EnqueueSiteJobInput) {
    const jobType = SiteJobTypeSchema.parse(input.jobType);
    if (!this.enqueueableJobTypes.has(jobType)) {
      throw fail(
        409,
        'SITE_JOB_HANDLER_NOT_IMPLEMENTED',
        'This site job type does not have an implemented production handler.',
      );
    }
    const payload = SiteJobPayloadSchema.parse(input.payload);
    if (payload.jobType !== jobType) {
      throw fail(
        400,
        'SITE_JOB_PAYLOAD_TYPE_MISMATCH',
        'The payload discriminator does not match the requested job type.',
      );
    }
    if ('siteReference' in payload
      && payload.siteReference !== input.siteReference) {
      throw fail(
        400,
        'SITE_JOB_SITE_REFERENCE_MISMATCH',
        'The payload site reference does not match the requested site.',
      );
    }

    const [context] = await this.database
      .select({
        tenantId: tenants.id,
        tenantReference: tenants.businessReference,
        siteId: sites.id,
      })
      .from(sites)
      .innerJoin(tenants, eq(sites.tenantId, tenants.id))
      .where(and(
        eq(tenants.businessReference, input.tenantReference),
        eq(sites.publicReference, input.siteReference),
      ))
      .limit(1);
    if (!context) {
      throw fail(
        404,
        'SITE_JOB_SITE_NOT_FOUND',
        'The site does not belong to the requested tenant.',
      );
    }

    const versionId = input.versionReference
      ? await this.resolveVersion(
        context.tenantId,
        context.siteId,
        input.versionReference,
      )
      : null;
    const blueprintId = input.blueprintReference
      ? await this.resolveBlueprint(
        context.tenantId,
        context.siteId,
        input.blueprintReference,
      )
      : null;
    const targetReference = input.versionReference
      || input.blueprintReference
      || input.siteReference;
    const idempotencyKey = deriveSiteJobIdempotencyKey({
      tenantReference: context.tenantReference,
      jobType,
      targetReference,
      sourceDigestSha256: input.sourceDigestSha256,
      operationVersion: input.operationVersion,
    });
    const scheduledFor = input.scheduledFor || new Date();
    const status = scheduledFor > new Date() ? 'SCHEDULED' : 'PENDING';

    return this.database.transaction(async transaction => {
      await transaction.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`site-job:${idempotencyKey}`}::text, 0)
        )
      `);
      const [existing] = await transaction
        .select({
          reference: siteJobs.publicReference,
          status: siteJobs.status,
        })
        .from(siteJobs)
        .where(and(
          eq(siteJobs.tenantId, context.tenantId),
          eq(siteJobs.idempotencyKey, idempotencyKey),
        ))
        .limit(1);
      if (existing) return { ...existing, idempotentReplay: true };

      const [job] = await transaction
        .insert(siteJobs)
        .values({
          tenantId: context.tenantId,
          siteId: context.siteId,
          versionId,
          blueprintId,
          jobType,
          status,
          idempotencyKey,
          sourceReference: input.sourceReference,
          sourceDigestSha256: input.sourceDigestSha256,
          payloadJson: payload,
          payloadSchemaVersion: 1,
          priority: input.priority || 100,
          scheduledFor,
          availableAt: scheduledFor,
          maxAttempts: input.maxAttempts || 5,
          createdByAgencyUserId: actor.agencyUserId,
        })
        .returning({
          id: siteJobs.id,
          reference: siteJobs.publicReference,
          status: siteJobs.status,
        });
      await transaction.insert(siteJobEvents).values({
        jobId: job.id,
        tenantId: context.tenantId,
        eventType: status === 'SCHEDULED' ? 'JOB_SCHEDULED' : 'JOB_CREATED',
        statusTo: status,
        createdByAgencyUserId: actor.agencyUserId,
        safeMessage: status === 'SCHEDULED'
          ? 'A validated site job was scheduled.'
          : 'A validated site job was created.',
      });
      await this.audit.write(actor, 'SITE_JOB_ENQUEUED', 'SITE_JOB', job.reference, {
        tenantId: context.tenantId,
        category: 'WEBSITE',
        metadata: {
          jobType,
          siteReference: input.siteReference,
          versionReference: input.versionReference,
          blueprintReference: input.blueprintReference,
        },
        tx: transaction,
      });
      return {
        reference: job.reference,
        status: job.status,
        idempotentReplay: false,
      };
    });
  }

  private async resolveVersion(
    tenantId: string,
    siteId: string,
    versionReference: string,
  ) {
    const [version] = await this.database
      .select({ id: siteVersions.id })
      .from(siteVersions)
      .where(and(
        eq(siteVersions.publicReference, versionReference),
        eq(siteVersions.tenantId, tenantId),
        eq(siteVersions.siteId, siteId),
      ))
      .limit(1);
    if (!version) {
      throw fail(
        404,
        'SITE_JOB_VERSION_NOT_FOUND',
        'The site version does not belong to the requested site.',
      );
    }
    return version.id;
  }

  private async resolveBlueprint(
    tenantId: string,
    siteId: string,
    blueprintReference: string,
  ) {
    const [blueprint] = await this.database
      .select({ id: siteBlueprints.id })
      .from(siteBlueprints)
      .where(and(
        eq(siteBlueprints.publicReference, blueprintReference),
        eq(siteBlueprints.tenantId, tenantId),
        eq(siteBlueprints.siteId, siteId),
      ))
      .limit(1);
    if (!blueprint) {
      throw fail(
        404,
        'SITE_JOB_BLUEPRINT_NOT_FOUND',
        'The blueprint does not belong to the requested site.',
      );
    }
    return blueprint.id;
  }
}
