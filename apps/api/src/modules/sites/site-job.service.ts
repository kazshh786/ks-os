import {
  and,
  asc,
  desc,
  eq,
  lt,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  getDatabase,
  siteBlueprints,
  siteJobAttempts,
  siteJobEvents,
  siteJobs,
  sites,
  siteVersions,
  tenants,
} from '@ks-os/database';
import {
  SiteJobResultSchema,
  type SiteJobListQuery,
} from '@ks-os/site-jobs';
import {
  AgencyAuditService,
  type AgencyActor,
} from '../agency/agency.service.js';

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface SiteJobRequeueContext {
  id: string;
  tenantId: string;
  previousStatus: 'FAILED' | 'DEAD_LETTER';
}

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

const productionJob = sql`${siteJobs.jobType} NOT LIKE 'TEST\\_%' ESCAPE '\\'`;

export class AgencySiteJobService {
  constructor(
    private readonly database: Database = getDatabase(),
    private readonly audit = new AgencyAuditService(),
  ) {}

  async list(query: SiteJobListQuery) {
    const conditions: SQL[] = [productionJob];
    if (query.siteReference) {
      conditions.push(eq(sites.publicReference, query.siteReference));
    }
    if (query.status) conditions.push(eq(siteJobs.status, query.status));
    if (query.jobType) conditions.push(eq(siteJobs.jobType, query.jobType));
    if (query.before) conditions.push(lt(siteJobs.createdAt, query.before));

    const rows = await this.database
      .select(this.summarySelection())
      .from(siteJobs)
      .innerJoin(tenants, eq(siteJobs.tenantId, tenants.id))
      .innerJoin(sites, and(
        eq(siteJobs.siteId, sites.id),
        eq(siteJobs.tenantId, sites.tenantId),
      ))
      .leftJoin(siteVersions, and(
        eq(siteJobs.versionId, siteVersions.id),
        eq(siteJobs.siteId, siteVersions.siteId),
        eq(siteJobs.tenantId, siteVersions.tenantId),
      ))
      .leftJoin(siteBlueprints, and(
        eq(siteJobs.blueprintId, siteBlueprints.id),
        eq(siteJobs.siteId, siteBlueprints.siteId),
        eq(siteJobs.tenantId, siteBlueprints.tenantId),
      ))
      .where(and(...conditions))
      .orderBy(desc(siteJobs.createdAt), desc(siteJobs.publicReference))
      .limit(query.limit);
    return rows;
  }

  async listForSite(siteReference: string, query: SiteJobListQuery) {
    return this.list({ ...query, siteReference });
  }

  async get(jobReference: string) {
    const [row] = await this.database
      .select({
        ...this.summarySelection(),
        sourceReference: siteJobs.sourceReference,
        payloadSchemaVersion: siteJobs.payloadSchemaVersion,
        resultJson: siteJobs.resultJson,
      })
      .from(siteJobs)
      .innerJoin(tenants, eq(siteJobs.tenantId, tenants.id))
      .innerJoin(sites, and(
        eq(siteJobs.siteId, sites.id),
        eq(siteJobs.tenantId, sites.tenantId),
      ))
      .leftJoin(siteVersions, and(
        eq(siteJobs.versionId, siteVersions.id),
        eq(siteJobs.siteId, siteVersions.siteId),
        eq(siteJobs.tenantId, siteVersions.tenantId),
      ))
      .leftJoin(siteBlueprints, and(
        eq(siteJobs.blueprintId, siteBlueprints.id),
        eq(siteJobs.siteId, siteBlueprints.siteId),
        eq(siteJobs.tenantId, siteBlueprints.tenantId),
      ))
      .where(and(
        eq(siteJobs.publicReference, jobReference),
        productionJob,
      ))
      .limit(1);
    if (!row) {
      throw fail(404, 'SITE_JOB_NOT_FOUND', 'Site job not found.');
    }
    const parsedResult = SiteJobResultSchema.safeParse(row.resultJson);
    const { resultJson: _resultJson, ...summary } = row;
    return {
      ...summary,
      sourceReference: row.sourceReference,
      payloadSchemaVersion: row.payloadSchemaVersion,
      result: parsedResult.success ? parsedResult.data : null,
    };
  }

  async attempts(jobReference: string) {
    const job = await this.jobContext(jobReference);
    return this.database
      .select({
        reference: siteJobAttempts.publicReference,
        attemptNumber: siteJobAttempts.attemptNumber,
        workerId: siteJobAttempts.workerId,
        startedAt: siteJobAttempts.startedAt,
        finishedAt: siteJobAttempts.finishedAt,
        outcome: siteJobAttempts.outcome,
        failureCode: siteJobAttempts.failureCode,
        retryable: siteJobAttempts.retryable,
        durationMs: siteJobAttempts.durationMs,
        safeResultSummary: siteJobAttempts.safeResultSummary,
      })
      .from(siteJobAttempts)
      .where(and(
        eq(siteJobAttempts.jobId, job.id),
        eq(siteJobAttempts.tenantId, job.tenantId),
      ))
      .orderBy(asc(siteJobAttempts.attemptNumber));
  }

  async events(jobReference: string) {
    const job = await this.jobContext(jobReference);
    return this.database
      .select({
        reference: siteJobEvents.publicReference,
        eventType: siteJobEvents.eventType,
        statusFrom: siteJobEvents.statusFrom,
        statusTo: siteJobEvents.statusTo,
        attemptNumber: siteJobEvents.attemptNumber,
        workerId: siteJobEvents.workerId,
        failureCode: siteJobEvents.failureCode,
        safeMessage: siteJobEvents.safeMessage,
        safeMetadata: siteJobEvents.safeMetadataJson,
        occurredAt: siteJobEvents.occurredAt,
      })
      .from(siteJobEvents)
      .where(and(
        eq(siteJobEvents.jobId, job.id),
        eq(siteJobEvents.tenantId, job.tenantId),
      ))
      .orderBy(asc(siteJobEvents.occurredAt), asc(siteJobEvents.id));
  }

  async cancel(
    actor: AgencyActor,
    jobReference: string,
    reason: string,
  ) {
    return this.database.transaction(async transaction => {
      const result = await transaction.execute(sql`
        SELECT id, tenant_id, status
        FROM site_jobs
        WHERE public_reference = ${jobReference}::uuid
          AND job_type NOT LIKE 'TEST\\_%' ESCAPE '\\'
        FOR UPDATE
      `);
      const [job] = rowsOf<{
        id: string;
        tenant_id: string;
        status: string;
      }>(result);
      if (!job) {
        throw fail(404, 'SITE_JOB_NOT_FOUND', 'Site job not found.');
      }
      if (['COMPLETED', 'CANCELLED'].includes(job.status)) {
        throw fail(
          409,
          'SITE_JOB_NOT_CANCELLABLE',
          'Completed and cancelled jobs cannot be cancelled.',
        );
      }
      if (['FAILED', 'DEAD_LETTER'].includes(job.status)) {
        throw fail(
          409,
          'SITE_JOB_NOT_CANCELLABLE',
          'Terminal jobs cannot be cancelled.',
        );
      }
      const immediate = ['PENDING', 'SCHEDULED', 'RETRY_DELAY']
        .includes(job.status);
      const nextStatus = immediate ? 'CANCELLED' : 'CANCEL_REQUESTED';
      await transaction.execute(sql`
        UPDATE site_jobs
        SET
          status = ${nextStatus},
          cancelled_by_agency_user_id = ${actor.agencyUserId}::uuid,
          cancelled_at = CASE
            WHEN ${immediate} THEN now()
            ELSE cancelled_at
          END,
          failure_code = CASE
            WHEN ${immediate} THEN 'CANCELLED_BY_USER'
            ELSE failure_code
          END,
          failure_message = CASE
            WHEN ${immediate} THEN 'Cancelled before processing started.'
            ELSE failure_message
          END,
          retryable = CASE
            WHEN ${immediate} THEN false
            ELSE retryable
          END,
          updated_at = now()
        WHERE id = ${job.id}::uuid
      `);
      await transaction.execute(sql`
        INSERT INTO site_job_events (
          job_id, tenant_id, event_type, status_from, status_to,
          created_by_agency_user_id, failure_code, safe_message
        ) VALUES (
          ${job.id}::uuid,
          ${job.tenant_id}::uuid,
          ${immediate ? 'JOB_CANCELLED' : 'JOB_CANCEL_REQUESTED'},
          ${job.status},
          ${nextStatus},
          ${actor.agencyUserId}::uuid,
          ${immediate ? 'CANCELLED_BY_USER' : null},
          ${immediate
            ? 'An agency user cancelled the queued job.'
            : 'An agency user requested cooperative cancellation.'}
        )
      `);
      await this.audit.write(
        actor,
        immediate ? 'SITE_JOB_CANCELLED' : 'SITE_JOB_CANCEL_REQUESTED',
        'SITE_JOB',
        jobReference,
        {
          tenantId: job.tenant_id,
          reason,
          category: 'WEBSITE',
          tx: transaction,
        },
      );
      return { reference: jobReference, status: nextStatus };
    });
  }

  async retry(
    actor: AgencyActor,
    jobReference: string,
    reason: string,
    afterRequeue?: (
      transaction: Transaction,
      context: SiteJobRequeueContext,
    ) => Promise<void>,
  ) {
    return this.database.transaction(async transaction => {
      const result = await transaction.execute(sql`
        SELECT id, tenant_id, status
        FROM site_jobs
        WHERE public_reference = ${jobReference}::uuid
          AND job_type NOT LIKE 'TEST\\_%' ESCAPE '\\'
        FOR UPDATE
      `);
      const [job] = rowsOf<{
        id: string;
        tenant_id: string;
        status: string;
      }>(result);
      if (!job) {
        throw fail(404, 'SITE_JOB_NOT_FOUND', 'Site job not found.');
      }
      if (!['FAILED', 'DEAD_LETTER'].includes(job.status)) {
        throw fail(
          409,
          'SITE_JOB_NOT_RETRYABLE',
          'Only terminal failed jobs can be retried manually.',
        );
      }
      await transaction.execute(sql`
        UPDATE site_jobs
        SET
          status = 'PENDING',
          available_at = now(),
          max_attempts = greatest(max_attempts, attempt_count + 1),
          progress_current = 0,
          progress_total = null,
          progress_message = null,
          failure_code = null,
          failure_message = null,
          retryable = null,
          failed_at = null,
          updated_at = now()
        WHERE id = ${job.id}::uuid
      `);
      await afterRequeue?.(transaction, {
        id: job.id,
        tenantId: job.tenant_id,
        previousStatus: job.status as SiteJobRequeueContext['previousStatus'],
      });
      await transaction.execute(sql`
        INSERT INTO site_job_events (
          job_id, tenant_id, event_type, status_from, status_to,
          created_by_agency_user_id, safe_message
        ) VALUES (
          ${job.id}::uuid,
          ${job.tenant_id}::uuid,
          'JOB_RETRIED_MANUALLY',
          ${job.status},
          'PENDING',
          ${actor.agencyUserId}::uuid,
          'An authorised agency user queued one additional attempt.'
        )
      `);
      await this.audit.write(
        actor,
        'SITE_JOB_MANUALLY_RETRIED',
        'SITE_JOB',
        jobReference,
        {
          tenantId: job.tenant_id,
          reason,
          category: 'WEBSITE',
          tx: transaction,
        },
      );
      return { reference: jobReference, status: 'PENDING' as const };
    });
  }

  private async jobContext(jobReference: string) {
    const [job] = await this.database
      .select({
        id: siteJobs.id,
        tenantId: siteJobs.tenantId,
      })
      .from(siteJobs)
      .where(and(
        eq(siteJobs.publicReference, jobReference),
        productionJob,
      ))
      .limit(1);
    if (!job) {
      throw fail(404, 'SITE_JOB_NOT_FOUND', 'Site job not found.');
    }
    return job;
  }

  private summarySelection() {
    return {
      reference: siteJobs.publicReference,
      tenantReference: tenants.businessReference,
      siteReference: sites.publicReference,
      versionReference: siteVersions.publicReference,
      blueprintReference: siteBlueprints.publicReference,
      jobType: siteJobs.jobType,
      status: siteJobs.status,
      priority: siteJobs.priority,
      attemptCount: siteJobs.attemptCount,
      maxAttempts: siteJobs.maxAttempts,
      progressCurrent: siteJobs.progressCurrent,
      progressTotal: siteJobs.progressTotal,
      progressMessage: siteJobs.progressMessage,
      failureCode: siteJobs.failureCode,
      failureMessage: siteJobs.failureMessage,
      retryable: siteJobs.retryable,
      scheduledFor: siteJobs.scheduledFor,
      availableAt: siteJobs.availableAt,
      completedAt: siteJobs.completedAt,
      failedAt: siteJobs.failedAt,
      cancelledAt: siteJobs.cancelledAt,
      createdAt: siteJobs.createdAt,
      updatedAt: siteJobs.updatedAt,
    };
  }

}

function rowsOf<T>(result: unknown): T[] {
  if (!result || typeof result !== 'object' || !('rows' in result)) return [];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? rows as T[] : [];
}
