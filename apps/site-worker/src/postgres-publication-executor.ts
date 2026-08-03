import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { getDatabase } from '@ks-os/database';
import {
  cacheInvalidationKey,
  type PublicationJobPayload,
  PublicationJobPayloadSchema,
} from '@ks-os/site-publishing';
import {
  calculatePublishedSnapshotDigest,
  validatePublishedSnapshot,
} from '@ks-os/site-schema';
import {
  SiteJobExecutionError,
  type SiteJobLeaseContext,
  type SiteJobResult,
} from '@ks-os/site-jobs';
import type {
  SitePublicationJobExecutor,
  SitePublicationJobType,
} from './handlers.js';

type Database = ReturnType<typeof getDatabase>;
type QueryResult = { rows?: unknown[] } | unknown[];
const rowsOf = <T>(result: QueryResult): T[] =>
  (Array.isArray(result) ? result : result.rows ?? []) as T[];

export class PostgresSitePublicationExecutor implements SitePublicationJobExecutor {
  constructor(private readonly database: Database) {}

  async execute(
    jobType: SitePublicationJobType,
    payloadValue: unknown,
    context: SiteJobLeaseContext,
  ): Promise<SiteJobResult> {
    const payload = PublicationJobPayloadSchema.parse(payloadValue);
    if (payload.jobType !== jobType) {
      throw new SiteJobExecutionError('TERMINAL_VALIDATION_FAILURE', 'Publication job payload discriminator mismatch.');
    }
    await context.updateProgress({ current: 1, total: 3, message: 'Revalidating publication scope and governance pins.' });
    if (context.signal.aborted) throw context.signal.reason;

    switch (payload.jobType) {
      case 'CREATE_SITE_PUBLICATION':
        return this.publish(payload, context);
      case 'ACTIVATE_FALLBACK_DOMAIN':
        return this.activateFallback(payload, context);
      case 'ROLLBACK_SITE_PUBLICATION':
        return this.rollback(payload, context);
      case 'INVALIDATE_SITE_CACHE':
        return this.invalidate(payload, context);
      case 'SUSPEND_SITE_DOMAIN':
        return this.suspend(payload, context);
      case 'REMOVE_SITE_DOMAIN':
        return this.remove(payload, context);
      default:
        throw new SiteJobExecutionError(
          'TERMINAL_DATA_MISSING',
          'The required DNS or hostname provider is disabled; no external operation was attempted.',
        );
    }
  }

  private async publish(
    payload: Extract<PublicationJobPayload, { jobType: 'CREATE_SITE_PUBLICATION' }>,
    context: SiteJobLeaseContext,
  ): Promise<SiteJobResult> {
    const output = await this.database.transaction(async tx => {
      const result = await tx.execute(sql`
        SELECT
          pr.id AS publication_run_id,
          pr.tenant_id,
          pr.site_id,
          pr.site_version_id,
          qr.id AS quality_run_id,
          qr.status AS quality_status,
          qr.publication_gate_status,
          qr.site_version_digest_sha256,
          qr.policy_version,
          qr.knowledge_pack_id,
          qr.knowledge_pack_semantic_version,
          qr.knowledge_pack_digest_sha256,
          qr.renderer_version,
          sv.public_reference AS version_reference,
          sv.status AS version_status,
          sv.generation_content_digest_sha256,
          srs.source_content_digest_sha256,
          EXISTS (
            SELECT 1 FROM site_review_cycles review
            WHERE review.tenant_id = pr.tenant_id
              AND review.site_id = pr.site_id
              AND review.site_version_id = pr.site_version_id
              AND review.status = 'AGENCY_APPROVED'
              AND review.pinned_content_digest_sha256 = sv.generation_content_digest_sha256
          ) AS review_approved,
          EXISTS (
            SELECT 1 FROM site_domains domain
            WHERE domain.tenant_id = pr.tenant_id
              AND domain.site_id = pr.site_id
              AND domain.status = 'ACTIVE'
              AND domain.ownership_status = 'VERIFIED'
              AND domain.ssl_status = 'ACTIVE'
              AND (
                domain.domain_type = 'FALLBACK'
                OR (domain.domain_type = 'CUSTOM' AND domain.domain_role = 'CANONICAL')
              )
          ) AS managed_hostname_active,
          srs.id AS preview_snapshot_id,
          srs.template_version_id,
          srs.schema_version,
          srs.hostname_configuration_version,
          srs.content_json,
          spp.active_snapshot_id AS previous_snapshot_id,
          spp.pointer_version
        FROM site_publication_runs pr
        JOIN sites s ON s.id = pr.site_id AND s.public_reference = ${payload.siteReference}::uuid
        JOIN site_versions sv ON sv.id = pr.site_version_id
          AND sv.public_reference = ${payload.siteVersionReference}::uuid
        JOIN site_quality_runs qr ON qr.id = pr.quality_run_id
          AND qr.public_reference = ${payload.qualityRunReference}::uuid
        JOIN LATERAL (
          SELECT *
          FROM site_render_snapshots candidate
          WHERE candidate.tenant_id = pr.tenant_id
            AND candidate.site_id = pr.site_id
            AND candidate.site_version_id = pr.site_version_id
            AND candidate.snapshot_kind = 'PREVIEW'
            AND candidate.source_content_digest_sha256 = sv.generation_content_digest_sha256
          ORDER BY candidate.revision DESC
          LIMIT 1
        ) srs ON true
        LEFT JOIN site_publication_pointers spp ON spp.site_id = pr.site_id
        WHERE pr.public_reference = ${payload.publicationRunReference}::uuid
        FOR UPDATE OF pr, sv
      `);
      const [row] = rowsOf<{
        publication_run_id: string; tenant_id: string; site_id: string;
        site_version_id: string; quality_run_id: string; quality_status: string;
        publication_gate_status: string; site_version_digest_sha256: string;
        policy_version: string; knowledge_pack_id: string;
        knowledge_pack_semantic_version: string; knowledge_pack_digest_sha256: string;
        renderer_version: string; version_reference: string; version_status: string;
        generation_content_digest_sha256: string; source_content_digest_sha256: string;
        review_approved: boolean; managed_hostname_active: boolean; template_version_id: string;
        schema_version: number; hostname_configuration_version: number;
        content_json: unknown; previous_snapshot_id: string | null; pointer_version: number | null;
      }>(result);
      if (!row) throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'Publication scope or preview snapshot is missing.');
      if (
        row.quality_status !== 'READY'
        || !['READY', 'READY_WITH_WARNINGS'].includes(row.publication_gate_status)
        || row.site_version_digest_sha256 !== row.generation_content_digest_sha256
        || row.source_content_digest_sha256 !== row.generation_content_digest_sha256
      ) {
        throw new SiteJobExecutionError('TERMINAL_VALIDATION_FAILURE', 'Publication readiness changed or no longer matches the exact version digest.');
      }
      if (!row.review_approved || !['APPROVED', 'PUBLISHED'].includes(row.version_status)) {
        throw new SiteJobExecutionError('TERMINAL_VALIDATION_FAILURE', 'The exact digest no longer has an agency approval.');
      }
      if (!row.managed_hostname_active) {
        throw new SiteJobExecutionError('TERMINAL_VALIDATION_FAILURE', 'No active managed hostname remains available for this site.');
      }
      if (row.publication_gate_status === 'READY_WITH_WARNINGS' && !payload.acknowledgeWarnings) {
        throw new SiteJobExecutionError('TERMINAL_VALIDATION_FAILURE', 'Digest-bound warning acknowledgement is required.');
      }

      const snapshotReference = randomUUID();
      const candidate = structuredClone(row.content_json) as Record<string, unknown>;
      candidate.publicReference = snapshotReference;
      candidate.visibility = 'PUBLISHED';
      candidate.siteStatus = 'LIVE';
      candidate.versionStatus = 'PUBLISHED';
      candidate.publishedAt = new Date().toISOString();
      const publishedSnapshot = validatePublishedSnapshot(candidate);
      const contentDigest = calculatePublishedSnapshotDigest(publishedSnapshot);
      const now = new Date();
      await tx.execute(sql`
        UPDATE site_publication_runs SET status = 'SNAPSHOTTING', started_at = COALESCE(started_at, ${now}), updated_at = ${now}
        WHERE id = ${row.publication_run_id}::uuid
      `);
      await tx.execute(sql`
        UPDATE site_versions SET status = 'PUBLISHED', published_at = ${now}, updated_at = ${now}
        WHERE id = ${row.site_version_id}::uuid
      `);
      const inserted = await tx.execute(sql`
        INSERT INTO site_render_snapshots (
          public_reference, tenant_id, site_id, site_version_id, template_version_id,
          snapshot_kind, revision, schema_version, hostname_configuration_version,
          content_json, content_digest_sha256, source_content_digest_sha256,
          site_version_digest_sha256, quality_run_id, quality_policy_version,
          knowledge_pack_id, knowledge_pack_semantic_version,
          knowledge_pack_digest_sha256, renderer_release_version, published_at
        ) VALUES (
          ${snapshotReference}::uuid, ${row.tenant_id}::uuid, ${row.site_id}::uuid,
          ${row.site_version_id}::uuid, ${row.template_version_id}::uuid,
          'PUBLISHED',
          COALESCE((SELECT max(revision) + 1 FROM site_render_snapshots WHERE site_version_id = ${row.site_version_id}::uuid AND snapshot_kind = 'PUBLISHED'), 1),
          ${row.schema_version}, ${row.hostname_configuration_version},
          ${JSON.stringify(publishedSnapshot)}::jsonb, ${contentDigest},
          ${row.generation_content_digest_sha256}, ${row.site_version_digest_sha256},
          ${row.quality_run_id}::uuid, ${row.policy_version},
          ${row.knowledge_pack_id}::uuid, ${row.knowledge_pack_semantic_version},
          ${row.knowledge_pack_digest_sha256}, ${row.renderer_version}, ${now}
        )
        RETURNING id
      `);
      const [snapshot] = rowsOf<{ id: string }>(inserted);
      if (!snapshot) throw new SiteJobExecutionError('UNEXPECTED_HANDLER_FAILURE', 'Published snapshot insert did not return an identity.');
      const nextPointerVersion = (row.pointer_version ?? 0) + 1;
      await tx.execute(sql`
        INSERT INTO site_publication_pointers (
          tenant_id, site_id, active_snapshot_id, previous_snapshot_id,
          publication_run_id, pointer_version, activated_at, updated_at
        ) VALUES (
          ${row.tenant_id}::uuid, ${row.site_id}::uuid, ${snapshot.id}::uuid,
          ${row.previous_snapshot_id}::uuid, ${row.publication_run_id}::uuid,
          ${nextPointerVersion}, ${now}, ${now}
        )
        ON CONFLICT (site_id) DO UPDATE SET
          previous_snapshot_id = site_publication_pointers.active_snapshot_id,
          active_snapshot_id = EXCLUDED.active_snapshot_id,
          publication_run_id = EXCLUDED.publication_run_id,
          pointer_version = site_publication_pointers.pointer_version + 1,
          activated_at = EXCLUDED.activated_at,
          updated_at = EXCLUDED.updated_at
      `);
      await tx.execute(sql`
        UPDATE sites SET status = 'LIVE', published_version_id = ${row.site_version_id}::uuid, updated_at = ${now}
        WHERE id = ${row.site_id}::uuid
      `);
      await tx.execute(sql`
        UPDATE site_publication_runs
        SET snapshot_id = ${snapshot.id}::uuid,
            previous_snapshot_id = ${row.previous_snapshot_id}::uuid,
            status = 'LIVE', completed_at = ${now}, updated_at = ${now}
        WHERE id = ${row.publication_run_id}::uuid
      `);
      return { snapshotReference, publicationRunReference: payload.publicationRunReference };
    });
    await context.updateProgress({ current: 3, total: 3, message: 'Immutable snapshot is live through the atomic publication pointer.' });
    return { summary: 'Site publication completed through the shared renderer.', outputReferences: [output.publicationRunReference, output.snapshotReference], metrics: { published: 1 } };
  }

  private async activateFallback(
    payload: Extract<PublicationJobPayload, { jobType: 'ACTIVATE_FALLBACK_DOMAIN' }>,
    context: SiteJobLeaseContext,
  ) {
    const result = await this.database.execute(sql`
      UPDATE site_domains d SET status = 'ACTIVE', ownership_status = 'VERIFIED',
        ssl_status = 'ACTIVE', updated_at = now()
      FROM sites s
      WHERE d.site_id = s.id AND s.public_reference = ${payload.siteReference}::uuid
        AND d.public_reference = ${payload.domainReference}::uuid
        AND d.domain_type = 'FALLBACK' AND d.provider_key = 'KS_OS'
      RETURNING d.public_reference
    `);
    const [domain] = rowsOf<{ public_reference: string }>(result);
    if (!domain) throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'Fallback domain not found in the requested site scope.');
    await context.updateProgress({ current: 3, total: 3, message: 'Fallback hostname activated.' });
    return { summary: 'Managed fallback hostname activated.', outputReferences: [domain.public_reference], metrics: { activated: 1 } };
  }

  private async rollback(
    payload: Extract<PublicationJobPayload, { jobType: 'ROLLBACK_SITE_PUBLICATION' }>,
    context: SiteJobLeaseContext,
  ) {
    const pointer = await this.database.transaction(async tx => {
      const scopeResult = await tx.execute(sql`
        SELECT
          pointer.tenant_id,
          pointer.site_id,
          pointer.active_snapshot_id,
          target.id AS target_snapshot_id,
          publication.id AS publication_run_id,
          agency_user.id AS requested_by_agency_user_id
        FROM site_publication_pointers pointer
        JOIN sites site
          ON site.id = pointer.site_id
         AND site.public_reference = ${payload.siteReference}::uuid
        JOIN site_render_snapshots target
          ON target.public_reference = ${payload.targetSnapshotReference}::uuid
         AND target.site_id = site.id
         AND target.tenant_id = site.tenant_id
         AND target.snapshot_kind = 'PUBLISHED'
        JOIN site_publication_runs publication
          ON publication.public_reference = ${payload.publicationRunReference}::uuid
         AND publication.site_id = site.id
         AND publication.tenant_id = site.tenant_id
        JOIN agency_users agency_user
          ON agency_user.public_reference = ${payload.requestedByAgencyUserReference}::uuid
        FOR UPDATE OF pointer
      `);
      const [scope] = rowsOf<{
        tenant_id: string;
        site_id: string;
        active_snapshot_id: string;
        target_snapshot_id: string;
        publication_run_id: string;
        requested_by_agency_user_id: string;
      }>(scopeResult);
      if (!scope || scope.active_snapshot_id === scope.target_snapshot_id) {
        throw new SiteJobExecutionError(
          'TERMINAL_VALIDATION_FAILURE',
          'Rollback target is not a different published snapshot owned by this site.',
        );
      }

      const result = await tx.execute(sql`
        UPDATE site_publication_pointers SET
          previous_snapshot_id = ${scope.active_snapshot_id}::uuid,
          active_snapshot_id = ${scope.target_snapshot_id}::uuid,
          pointer_version = pointer_version + 1,
          activated_at = now(),
          updated_at = now()
        WHERE site_id = ${scope.site_id}::uuid
        RETURNING pointer_version
      `);
      const [updatedPointer] = rowsOf<{ pointer_version: number }>(result);
      if (!updatedPointer) {
        throw new SiteJobExecutionError('UNEXPECTED_HANDLER_FAILURE', 'Publication pointer update returned no identity.');
      }
      await tx.execute(sql`
        INSERT INTO site_rollback_events (
          tenant_id, site_id, publication_run_id,
          from_snapshot_id, to_snapshot_id,
          requested_by_agency_user_id, reason, status,
          pointer_version, completed_at
        ) VALUES (
          ${scope.tenant_id}::uuid, ${scope.site_id}::uuid,
          ${scope.publication_run_id}::uuid, ${scope.active_snapshot_id}::uuid,
          ${scope.target_snapshot_id}::uuid,
          ${scope.requested_by_agency_user_id}::uuid,
          ${payload.reason}, 'COMPLETED',
          ${updatedPointer.pointer_version}, now()
        )
      `);
      return updatedPointer;
    });
    await context.updateProgress({ current: 3, total: 3, message: 'Publication pointer rolled back atomically.' });
    return { summary: 'Site publication rolled back.', outputReferences: [payload.publicationRunReference, payload.targetSnapshotReference], metrics: { pointerVersion: pointer.pointer_version } };
  }

  private async invalidate(
    payload: Extract<PublicationJobPayload, { jobType: 'INVALIDATE_SITE_CACHE' }>,
    context: SiteJobLeaseContext,
  ) {
    const result = await this.database.execute(sql`
      SELECT t.business_reference AS tenant_reference, pointer.pointer_version,
        pr.id AS publication_run_id, snapshot.id AS snapshot_id, s.id AS site_id, s.tenant_id
      FROM sites s JOIN tenants t ON t.id = s.tenant_id
      JOIN site_publication_pointers pointer ON pointer.site_id = s.id
      JOIN site_publication_runs pr ON pr.public_reference = ${payload.publicationRunReference}::uuid AND pr.site_id = s.id
      JOIN site_render_snapshots snapshot ON snapshot.public_reference = ${payload.snapshotReference}::uuid AND snapshot.id = pointer.active_snapshot_id
      WHERE s.public_reference = ${payload.siteReference}::uuid
    `);
    const [row] = rowsOf<{ tenant_reference: string; pointer_version: number; publication_run_id: string; snapshot_id: string; site_id: string; tenant_id: string }>(result);
    if (!row) throw new SiteJobExecutionError('TERMINAL_VALIDATION_FAILURE', 'Cache invalidation identity is stale or outside the site scope.');
    const key = cacheInvalidationKey({ tenantReference: row.tenant_reference, siteReference: payload.siteReference, snapshotReference: payload.snapshotReference, pointerVersion: row.pointer_version });
    await this.database.execute(sql`
      INSERT INTO site_cache_invalidation_events (
        tenant_id, site_id, publication_run_id, snapshot_id, pointer_version,
        idempotency_key, status, safe_tags_json, completed_at
      ) VALUES (
        ${row.tenant_id}::uuid, ${row.site_id}::uuid, ${row.publication_run_id}::uuid,
        ${row.snapshot_id}::uuid, ${row.pointer_version}, ${key}, 'SUCCEEDED',
        ${JSON.stringify([`site:${payload.siteReference}`, `snapshot:${payload.snapshotReference}`])}::jsonb, now()
      ) ON CONFLICT (idempotency_key) DO NOTHING
    `);
    await context.updateProgress({ current: 3, total: 3, message: 'Tenant-scoped cache tags invalidated.' });
    return { summary: 'Site cache invalidation recorded.', outputReferences: [payload.snapshotReference], metrics: { invalidated: 1 } };
  }

  private async suspend(payload: Extract<PublicationJobPayload, { jobType: 'SUSPEND_SITE_DOMAIN' }>, context: SiteJobLeaseContext) {
    return this.updateDomainState(payload, context, 'SUSPENDED', 'Domain suspended.');
  }

  private async remove(payload: Extract<PublicationJobPayload, { jobType: 'REMOVE_SITE_DOMAIN' }>, context: SiteJobLeaseContext) {
    return this.updateDomainState(payload, context, 'REMOVED', 'Domain removed with cooldown.', true);
  }

  private async updateDomainState(
    payload: Extract<PublicationJobPayload, { jobType: 'SUSPEND_SITE_DOMAIN' | 'REMOVE_SITE_DOMAIN' }>,
    context: SiteJobLeaseContext,
    state: 'SUSPENDED' | 'REMOVED',
    message: string,
    remove = false,
  ) {
    const result = await this.database.execute(sql`
      UPDATE site_domains d SET status = ${state},
        suspended_at = CASE WHEN ${state} = 'SUSPENDED' THEN now() ELSE suspended_at END,
        removed_at = CASE WHEN ${state} = 'REMOVED' THEN now() ELSE removed_at END,
        removal_cooldown_until = CASE WHEN ${remove} THEN now() + interval '30 days' ELSE removal_cooldown_until END,
        updated_at = now()
      FROM sites s WHERE d.site_id = s.id
        AND s.public_reference = ${payload.siteReference}::uuid
        AND d.public_reference = ${payload.domainReference}::uuid
      RETURNING d.public_reference
    `);
    const [domain] = rowsOf<{ public_reference: string }>(result);
    if (!domain) throw new SiteJobExecutionError('TERMINAL_DATA_MISSING', 'Domain not found in the requested site scope.');
    await context.updateProgress({ current: 3, total: 3, message });
    return { summary: message, outputReferences: [domain.public_reference], metrics: { changed: 1 } };
  }
}
