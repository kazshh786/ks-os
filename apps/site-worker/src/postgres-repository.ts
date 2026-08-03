import { createHash, randomBytes } from 'node:crypto';
import { getDatabase, sql } from '@ks-os/database';
import type { SiteJobProgress, SiteJobResult } from '@ks-os/site-jobs';
import {
  type LeasedSiteJob,
  type SiteJobCompletionOutcome,
  type SiteJobFailureUpdate,
  type SiteJobRepository,
  type SiteJobRepositoryHealth,
  SiteJobLeaseLostError,
} from './repository.types.js';

type Database = ReturnType<typeof getDatabase>;
type DatabaseExecutor = Pick<Database, 'execute'>;

interface ClaimedRow {
  id: string;
  public_reference: string;
  tenant_id: string;
  tenant_reference: string;
  site_id: string;
  site_reference: string;
  version_reference: string | null;
  blueprint_reference: string | null;
  job_type: string;
  payload_json: unknown;
  payload_schema_version: number;
  attempt_count: number;
  max_attempts: number;
  lease_expires_at: Date | string;
  previous_status: string;
}

interface StatusRow {
  status: string;
  lease_expires_at?: Date | string;
}

function rowsOf<T>(result: unknown): T[] {
  if (!result || typeof result !== 'object' || !('rows' in result)) return [];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? rows as T[] : [];
}

function leaseDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class PostgresSiteJobRepository implements SiteJobRepository {
  constructor(private readonly database: Database = getDatabase()) {}

  async claimNext(
    workerId: string,
    leaseSeconds: number,
  ): Promise<LeasedSiteJob | null> {
    const leaseToken = randomBytes(32).toString('base64url');
    const tokenDigest = leaseDigest(leaseToken);

    return this.database.transaction(async (transaction) => {
      const claimedResult = await transaction.execute(sql`
        WITH candidate AS (
          SELECT job.id, job.status AS previous_status
          FROM site_jobs job
          WHERE (
            (
              job.status IN ('PENDING', 'SCHEDULED', 'RETRY_DELAY')
              AND job.available_at <= now()
            )
            OR (
              job.status IN ('LEASED', 'PROCESSING')
              AND job.lease_expires_at < now()
            )
          )
          AND job.attempt_count < job.max_attempts
          AND NOT EXISTS (
            SELECT 1
            FROM site_jobs active
            WHERE active.tenant_id = job.tenant_id
              AND active.id <> job.id
              AND active.status IN (
                'LEASED', 'PROCESSING', 'CANCEL_REQUESTED'
              )
              AND active.lease_expires_at >= now()
          )
          ORDER BY
            job.priority DESC,
            job.available_at,
            job.created_at,
            job.id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        ),
        claimed AS (
          UPDATE site_jobs job
          SET
            status = 'LEASED',
            lease_owner = ${workerId},
            lease_token_digest = ${tokenDigest},
            leased_at = now(),
            locked_at = now(),
            lease_expires_at = now() + make_interval(secs => ${leaseSeconds}),
            heartbeat_at = now(),
            attempt_count = job.attempt_count + 1,
            failure_code = null,
            failure_message = null,
            retryable = null,
            updated_at = now()
          FROM candidate
          WHERE job.id = candidate.id
          RETURNING job.*, candidate.previous_status
        )
        SELECT
          claimed.*,
          tenant.business_reference AS tenant_reference,
          site.public_reference AS site_reference,
          version.public_reference AS version_reference,
          blueprint.public_reference AS blueprint_reference
        FROM claimed
        JOIN tenants tenant ON tenant.id = claimed.tenant_id
        JOIN sites site
          ON site.id = claimed.site_id
          AND site.tenant_id = claimed.tenant_id
        LEFT JOIN site_versions version
          ON version.id = claimed.version_id
          AND version.site_id = claimed.site_id
          AND version.tenant_id = claimed.tenant_id
        LEFT JOIN site_blueprints blueprint
          ON blueprint.id = claimed.blueprint_id
          AND blueprint.site_id = claimed.site_id
          AND blueprint.tenant_id = claimed.tenant_id
      `);
      const [row] = rowsOf<ClaimedRow>(claimedResult);
      if (!row) return null;

      if (row.previous_status === 'LEASED'
        || row.previous_status === 'PROCESSING') {
        await transaction.execute(sql`
          UPDATE site_job_attempts
          SET
            finished_at = now(),
            outcome = 'LEASE_EXPIRED',
            failure_code = 'LEASE_LOST',
            retryable = true,
            duration_ms = greatest(
              0,
              floor(extract(epoch FROM (now() - started_at)) * 1000)::integer
            )
          WHERE job_id = ${row.id}::uuid
            AND attempt_number = ${row.attempt_count - 1}
            AND finished_at IS NULL
        `);
        await transaction.execute(sql`
          INSERT INTO site_job_events (
            job_id, tenant_id, event_type, status_from, status_to,
            attempt_number, worker_id, failure_code, safe_message
          ) VALUES (
            ${row.id}::uuid,
            ${row.tenant_id}::uuid,
            'JOB_LEASE_EXPIRED',
            ${row.previous_status},
            'LEASED',
            ${row.attempt_count - 1},
            ${workerId},
            'LEASE_LOST',
            'An expired worker lease was recovered.'
          )
        `);
      }

      await transaction.execute(sql`
        INSERT INTO site_job_attempts (
          job_id, tenant_id, attempt_number, worker_id, outcome
        ) VALUES (
          ${row.id}::uuid,
          ${row.tenant_id}::uuid,
          ${row.attempt_count},
          ${workerId},
          'PROCESSING'
        )
      `);
      await transaction.execute(sql`
        INSERT INTO site_job_events (
          job_id, tenant_id, event_type, status_from, status_to,
          attempt_number, worker_id, safe_message
        ) VALUES (
          ${row.id}::uuid,
          ${row.tenant_id}::uuid,
          'JOB_LEASED',
          ${row.previous_status},
          'LEASED',
          ${row.attempt_count},
          ${workerId},
          'The job was leased to a worker.'
        )
      `);

      return {
        id: row.id,
        publicReference: row.public_reference,
        tenantId: row.tenant_id,
        tenantReference: row.tenant_reference,
        siteId: row.site_id,
        siteReference: row.site_reference,
        versionReference: row.version_reference,
        blueprintReference: row.blueprint_reference,
        jobType: row.job_type,
        payload: row.payload_json,
        payloadSchemaVersion: row.payload_schema_version,
        attemptNumber: row.attempt_count,
        maxAttempts: row.max_attempts,
        workerId,
        leaseToken,
        leaseExpiresAt: new Date(row.lease_expires_at),
      };
    });
  }

  async start(job: LeasedSiteJob): Promise<void> {
    const tokenDigest = leaseDigest(job.leaseToken);
    await this.database.transaction(async (transaction) => {
      const started = await transaction.execute(sql`
        UPDATE site_jobs
        SET status = 'PROCESSING', updated_at = now()
        WHERE id = ${job.id}::uuid
          AND lease_owner = ${jobWorker(job)}
          AND lease_token_digest = ${tokenDigest}
          AND status = 'LEASED'
          AND lease_expires_at > now()
        RETURNING id
      `);
      if (rowsOf(started).length !== 1) throw new SiteJobLeaseLostError();
      await transaction.execute(sql`
        INSERT INTO site_job_events (
          job_id, tenant_id, event_type, status_from, status_to,
          attempt_number, worker_id, safe_message
        ) VALUES (
          ${job.id}::uuid,
          ${job.tenantId}::uuid,
          'JOB_STARTED',
          'LEASED',
          'PROCESSING',
          ${job.attemptNumber},
          ${jobWorker(job)},
          'The leased job started processing.'
        )
      `);
    });
  }

  async heartbeat(
    job: LeasedSiteJob,
    leaseSeconds: number,
  ): Promise<{ cancellationRequested: boolean; leaseExpiresAt: Date }> {
    const result = await this.database.execute(sql`
      UPDATE site_jobs
      SET
        heartbeat_at = now(),
        lease_expires_at = now() + make_interval(secs => ${leaseSeconds}),
        updated_at = now()
      WHERE id = ${job.id}::uuid
        AND lease_owner = ${jobWorker(job)}
        AND lease_token_digest = ${leaseDigest(job.leaseToken)}
        AND status IN ('PROCESSING', 'CANCEL_REQUESTED')
        AND lease_expires_at > now()
      RETURNING status, lease_expires_at
    `);
    const [row] = rowsOf<StatusRow>(result);
    if (!row?.lease_expires_at) throw new SiteJobLeaseLostError();
    return {
      cancellationRequested: row.status === 'CANCEL_REQUESTED',
      leaseExpiresAt: new Date(row.lease_expires_at),
    };
  }

  async updateProgress(
    job: LeasedSiteJob,
    progress: SiteJobProgress,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const updated = await transaction.execute(sql`
        UPDATE site_jobs
        SET
          progress_current = ${progress.current},
          progress_total = ${progress.total},
          progress_message = ${progress.message || null},
          updated_at = now()
        WHERE id = ${job.id}::uuid
          AND lease_owner = ${jobWorker(job)}
          AND lease_token_digest = ${leaseDigest(job.leaseToken)}
          AND status IN ('PROCESSING', 'CANCEL_REQUESTED')
          AND lease_expires_at > now()
          AND progress_current <= ${progress.current}
          AND (
            progress_total IS NULL
            OR progress_total = ${progress.total}
          )
        RETURNING id
      `);
      if (rowsOf(updated).length !== 1) throw new SiteJobLeaseLostError();
      await transaction.execute(sql`
        INSERT INTO site_job_events (
          job_id, tenant_id, event_type, status_from, status_to,
          attempt_number, worker_id, safe_message, safe_metadata_json
        ) VALUES (
          ${job.id}::uuid,
          ${job.tenantId}::uuid,
          'JOB_PROGRESS_UPDATED',
          'PROCESSING',
          'PROCESSING',
          ${job.attemptNumber},
          ${jobWorker(job)},
          'Job progress was updated.',
          jsonb_build_object(
            'current', ${progress.current}::integer,
            'total', ${progress.total}::integer
          )
        )
      `);
    });
  }

  async isCancellationRequested(job: LeasedSiteJob): Promise<boolean> {
    const result = await this.database.execute(sql`
      SELECT status
      FROM site_jobs
      WHERE id = ${job.id}::uuid
        AND lease_owner = ${jobWorker(job)}
        AND lease_token_digest = ${leaseDigest(job.leaseToken)}
        AND lease_expires_at > now()
    `);
    const [row] = rowsOf<StatusRow>(result);
    if (!row) throw new SiteJobLeaseLostError();
    return row.status === 'CANCEL_REQUESTED';
  }

  async complete(
    job: LeasedSiteJob,
    result: SiteJobResult,
  ): Promise<SiteJobCompletionOutcome> {
    return this.database.transaction(async (transaction) => {
      const completed = await transaction.execute(sql`
        UPDATE site_jobs
        SET
          status = 'COMPLETED',
          result_json = ${JSON.stringify(result)}::jsonb,
          progress_current = coalesce(progress_total, progress_current),
          completed_at = now(),
          lease_owner = null,
          lease_token_digest = null,
          lease_expires_at = null,
          heartbeat_at = null,
          updated_at = now()
        WHERE id = ${job.id}::uuid
          AND lease_owner = ${jobWorker(job)}
          AND lease_token_digest = ${leaseDigest(job.leaseToken)}
          AND status = 'PROCESSING'
          AND lease_expires_at > now()
        RETURNING id
      `);
      if (rowsOf(completed).length === 1) {
        await this.finishAttempt(
          transaction,
          job,
          'COMPLETED',
          null,
          false,
          result.summary,
        );
        await this.addEvent(
          transaction,
          job,
          'JOB_COMPLETED',
          'PROCESSING',
          'COMPLETED',
          null,
          'The site job completed.',
        );
        return 'COMPLETED';
      }

      const cancelled = await transaction.execute(sql`
        UPDATE site_jobs
        SET
          status = 'CANCELLED',
          failure_code = 'CANCELLED_BY_USER',
          failure_message = 'The job was cancelled by an agency user.',
          retryable = false,
          cancelled_at = coalesce(cancelled_at, now()),
          lease_owner = null,
          lease_token_digest = null,
          lease_expires_at = null,
          heartbeat_at = null,
          updated_at = now()
        WHERE id = ${job.id}::uuid
          AND lease_owner = ${jobWorker(job)}
          AND lease_token_digest = ${leaseDigest(job.leaseToken)}
          AND status = 'CANCEL_REQUESTED'
        RETURNING id
      `);
      if (rowsOf(cancelled).length === 1) {
        await this.finishAttempt(
          transaction,
          job,
          'CANCELLED',
          'CANCELLED_BY_USER',
          false,
          'The job was cancelled.',
        );
        await this.addEvent(
          transaction,
          job,
          'JOB_CANCELLED',
          'CANCEL_REQUESTED',
          'CANCELLED',
          'CANCELLED_BY_USER',
          'The site job was cancelled.',
        );
        return 'CANCELLED';
      }
      throw new SiteJobLeaseLostError();
    });
  }

  async fail(
    job: LeasedSiteJob,
    update: SiteJobFailureUpdate,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const failed = await transaction.execute(sql`
        UPDATE site_jobs
        SET
          status = ${update.targetStatus},
          available_at = ${update.availableAt || new Date()},
          failure_code = ${update.failureCode},
          failure_message = ${update.failureMessage},
          retryable = ${update.retryable},
          failed_at = CASE
            WHEN ${update.targetStatus} IN ('FAILED', 'DEAD_LETTER')
              THEN now()
            ELSE null
          END,
          lease_owner = null,
          lease_token_digest = null,
          lease_expires_at = null,
          heartbeat_at = null,
          updated_at = now()
        WHERE id = ${job.id}::uuid
          AND lease_owner = ${jobWorker(job)}
          AND lease_token_digest = ${leaseDigest(job.leaseToken)}
          AND status IN ('LEASED', 'PROCESSING')
        RETURNING id
      `);
      if (rowsOf(failed).length !== 1) throw new SiteJobLeaseLostError();
      const attemptOutcome = update.targetStatus === 'RETRY_DELAY'
        ? 'RETRY_SCHEDULED'
        : 'FAILED';
      await this.finishAttempt(
        transaction,
        job,
        attemptOutcome,
        update.failureCode,
        update.retryable,
        update.failureMessage,
      );
      const eventType = update.targetStatus === 'RETRY_DELAY'
        ? 'JOB_RETRY_SCHEDULED'
        : update.targetStatus === 'DEAD_LETTER'
          ? 'JOB_MOVED_TO_DEAD_LETTER'
          : 'JOB_FAILED';
      await this.addEvent(
        transaction,
        job,
        eventType,
        'PROCESSING',
        update.targetStatus,
        update.failureCode,
        update.failureMessage,
      );
      if (update.targetStatus === 'DEAD_LETTER') {
        await transaction.execute(sql`
          INSERT INTO platform_audit_events (
            tenant_id, action, target_type, target_id, outcome, metadata,
            event_category, description, environment, source_component
          ) VALUES (
            ${job.tenantId}::uuid,
            'SITE_JOB_DEAD_LETTERED',
            'SITE_JOB',
            ${job.publicReference},
            'FAILED',
            jsonb_build_object(
              'jobType', ${job.jobType}::text,
              'failureCode', ${update.failureCode}::text,
              'attemptNumber', ${job.attemptNumber}::integer
            ),
            'WEBSITE',
            'A site job exhausted its retry policy.',
            ${process.env.NODE_ENV || 'development'},
            'site-worker'
          )
        `);
      }
    });
  }

  async cancelLeased(job: LeasedSiteJob, message: string): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const cancelled = await transaction.execute(sql`
        UPDATE site_jobs
        SET
          status = 'CANCELLED',
          failure_code = 'CANCELLED_BY_USER',
          failure_message = ${message.slice(0, 500)},
          retryable = false,
          cancelled_at = coalesce(cancelled_at, now()),
          lease_owner = null,
          lease_token_digest = null,
          lease_expires_at = null,
          heartbeat_at = null,
          updated_at = now()
        WHERE id = ${job.id}::uuid
          AND lease_owner = ${jobWorker(job)}
          AND lease_token_digest = ${leaseDigest(job.leaseToken)}
          AND status IN ('LEASED', 'PROCESSING', 'CANCEL_REQUESTED')
        RETURNING id
      `);
      if (rowsOf(cancelled).length !== 1) throw new SiteJobLeaseLostError();
      await this.finishAttempt(
        transaction,
        job,
        'CANCELLED',
        'CANCELLED_BY_USER',
        false,
        message,
      );
      await this.addEvent(
        transaction,
        job,
        'JOB_CANCELLED',
        'CANCEL_REQUESTED',
        'CANCELLED',
        'CANCELLED_BY_USER',
        message,
      );
    });
  }

  async recoverExpiredCancellationRequests(limit = 25): Promise<number> {
    return this.database.transaction(async (transaction) => {
      const recovered = await transaction.execute(sql`
        WITH candidates AS (
          SELECT id, lease_owner AS previous_worker
          FROM site_jobs
          WHERE status = 'CANCEL_REQUESTED'
            AND lease_expires_at < now()
          ORDER BY lease_expires_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT ${Math.min(100, Math.max(1, limit))}
        )
        UPDATE site_jobs job
        SET
          status = 'CANCELLED',
          failure_code = 'CANCELLED_BY_USER',
          failure_message = 'Cancellation was recovered after lease expiry.',
          retryable = false,
          cancelled_at = coalesce(cancelled_at, now()),
          lease_owner = null,
          lease_token_digest = null,
          lease_expires_at = null,
          heartbeat_at = null,
          updated_at = now()
        FROM candidates
        WHERE job.id = candidates.id
        RETURNING
          job.id,
          job.tenant_id,
          job.attempt_count,
          candidates.previous_worker
      `);
      const recoveredRows = rowsOf<{
        id: string;
        tenant_id: string;
        attempt_count: number;
        previous_worker: string | null;
      }>(recovered);
      for (const row of recoveredRows) {
        await transaction.execute(sql`
          UPDATE site_job_attempts
          SET
            finished_at = now(),
            outcome = 'CANCELLED',
            failure_code = 'CANCELLED_BY_USER',
            retryable = false,
            safe_result_summary = 'Cancellation recovered after lease expiry.',
            duration_ms = greatest(
              0,
              floor(extract(epoch FROM (now() - started_at)) * 1000)::integer
            )
          WHERE job_id = ${row.id}::uuid
            AND attempt_number = ${row.attempt_count}
            AND finished_at IS NULL
        `);
        await transaction.execute(sql`
          INSERT INTO site_job_events (
            job_id, tenant_id, event_type, status_from, status_to,
            attempt_number, worker_id, failure_code, safe_message
          ) VALUES (
            ${row.id}::uuid,
            ${row.tenant_id}::uuid,
            'JOB_CANCELLED',
            'CANCEL_REQUESTED',
            'CANCELLED',
            ${row.attempt_count},
            ${row.previous_worker},
            'CANCELLED_BY_USER',
            'Cancellation was recovered after lease expiry.'
          )
        `);
      }
      return recoveredRows.length;
    });
  }

  async recoverExpiredTerminalLeases(limit = 25): Promise<number> {
    return this.database.transaction(async (transaction) => {
      const recovered = await transaction.execute(sql`
        WITH candidates AS (
          SELECT
            id,
            status AS previous_status,
            lease_owner AS previous_worker
          FROM site_jobs
          WHERE status IN ('LEASED', 'PROCESSING')
            AND lease_expires_at < now()
            AND attempt_count >= max_attempts
          ORDER BY lease_expires_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT ${Math.min(100, Math.max(1, limit))}
        )
        UPDATE site_jobs job
        SET
          status = 'DEAD_LETTER',
          failure_code = 'LEASE_LOST',
          failure_message =
            'The final permitted attempt ended after its worker lease expired.',
          retryable = true,
          failed_at = now(),
          lease_owner = null,
          lease_token_digest = null,
          lease_expires_at = null,
          heartbeat_at = null,
          updated_at = now()
        FROM candidates
        WHERE job.id = candidates.id
        RETURNING
          job.id,
          job.public_reference,
          job.tenant_id,
          job.job_type,
          job.attempt_count,
          candidates.previous_status,
          candidates.previous_worker
      `);
      const recoveredRows = rowsOf<{
        id: string;
        public_reference: string;
        tenant_id: string;
        job_type: string;
        attempt_count: number;
        previous_status: string;
        previous_worker: string | null;
      }>(recovered);
      for (const row of recoveredRows) {
        await transaction.execute(sql`
          UPDATE site_job_attempts
          SET
            finished_at = now(),
            outcome = 'LEASE_EXPIRED',
            failure_code = 'LEASE_LOST',
            retryable = true,
            safe_result_summary =
              'The final permitted worker lease expired.',
            duration_ms = greatest(
              0,
              floor(extract(epoch FROM (now() - started_at)) * 1000)::integer
            )
          WHERE job_id = ${row.id}::uuid
            AND attempt_number = ${row.attempt_count}
            AND finished_at IS NULL
        `);
        await transaction.execute(sql`
          INSERT INTO site_job_events (
            job_id, tenant_id, event_type, status_from, status_to,
            attempt_number, worker_id, failure_code, safe_message
          ) VALUES (
            ${row.id}::uuid,
            ${row.tenant_id}::uuid,
            'JOB_LEASE_EXPIRED',
            ${row.previous_status},
            'DEAD_LETTER',
            ${row.attempt_count},
            ${row.previous_worker},
            'LEASE_LOST',
            'The final permitted worker lease expired.'
          )
        `);
        await transaction.execute(sql`
          INSERT INTO site_job_events (
            job_id, tenant_id, event_type, status_from, status_to,
            attempt_number, worker_id, failure_code, safe_message
          ) VALUES (
            ${row.id}::uuid,
            ${row.tenant_id}::uuid,
            'JOB_MOVED_TO_DEAD_LETTER',
            ${row.previous_status},
            'DEAD_LETTER',
            ${row.attempt_count},
            ${row.previous_worker},
            'LEASE_LOST',
            'The job exhausted its attempts after lease expiry.'
          )
        `);
        await transaction.execute(sql`
          INSERT INTO platform_audit_events (
            tenant_id, action, target_type, target_id, outcome, metadata,
            event_category, description, environment, source_component
          ) VALUES (
            ${row.tenant_id}::uuid,
            'SITE_JOB_DEAD_LETTERED',
            'SITE_JOB',
            ${row.public_reference}::text,
            'FAILED',
            jsonb_build_object(
              'jobType', ${row.job_type}::text,
              'failureCode', 'LEASE_LOST',
              'attemptNumber', ${row.attempt_count}::integer
            ),
            'WEBSITE',
            'A site job exhausted its attempts after worker lease expiry.',
            ${process.env.NODE_ENV || 'development'},
            'site-worker'
          )
        `);
      }
      return recoveredRows.length;
    });
  }

  async health(): Promise<SiteJobRepositoryHealth> {
    try {
      const result = await this.database.execute(sql`
        SELECT
          1 AS database_available,
          to_regclass('public.site_job_attempts') IS NOT NULL
            AND to_regclass('public.site_job_events') IS NOT NULL
            AS schema_compatible
      `);
      const [row] = rowsOf<{
        database_available: number;
        schema_compatible: boolean;
      }>(result);
      return {
        databaseAvailable: row?.database_available === 1,
        schemaCompatible: row?.schema_compatible === true,
      };
    } catch {
      return { databaseAvailable: false, schemaCompatible: false };
    }
  }

  private async finishAttempt(
    transaction: DatabaseExecutor,
    job: LeasedSiteJob,
    outcome: string,
    failureCode: string | null,
    retryable: boolean,
    summary: string,
  ): Promise<void> {
    await transaction.execute(sql`
      UPDATE site_job_attempts
      SET
        finished_at = now(),
        outcome = ${outcome},
        failure_code = ${failureCode},
        retryable = ${retryable},
        duration_ms = greatest(
          0,
          floor(extract(epoch FROM (now() - started_at)) * 1000)::integer
        ),
        safe_result_summary = ${summary.slice(0, 500)}
      WHERE job_id = ${job.id}::uuid
        AND attempt_number = ${job.attemptNumber}
        AND finished_at IS NULL
    `);
  }

  private async addEvent(
    transaction: DatabaseExecutor,
    job: LeasedSiteJob,
    eventType: string,
    statusFrom: string,
    statusTo: string,
    failureCode: string | null,
    message: string,
  ): Promise<void> {
    await transaction.execute(sql`
      INSERT INTO site_job_events (
        job_id, tenant_id, event_type, status_from, status_to,
        attempt_number, worker_id, failure_code, safe_message
      ) VALUES (
        ${job.id}::uuid,
        ${job.tenantId}::uuid,
        ${eventType},
        ${statusFrom},
        ${statusTo},
        ${job.attemptNumber},
        ${jobWorker(job)},
        ${failureCode},
        ${message.slice(0, 500)}
      )
    `);
  }
}

function jobWorker(job: LeasedSiteJob): string {
  return job.workerId;
}
