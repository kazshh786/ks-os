import { eq, or, sql } from 'drizzle-orm';
import { getDatabase, tenants } from '@ks-os/database';
import { getSupabaseAdmin } from '../../lib/supabase-admin.js';
import { AgencyAuditService, type AgencyActor } from '../agency/agency.service.js';

const fail = (statusCode: number, code: string, message: string, details?: unknown) =>
  Object.assign(new Error(message), { statusCode, code, ...(details ? { details } : {}) });

const asNumber = (value: unknown) => Number(value || 0);

type StorageObject = {
  bucket: string;
  path: string;
};

export class WorkspaceDataService {
  private readonly db = getDatabase();
  private readonly audit = new AgencyAuditService();

  private async tenant(tenantReference: string) {
    const [tenant] = await this.db.select().from(tenants).where(or(
      eq(tenants.id, tenantReference),
      eq(tenants.agencyReference, tenantReference),
      eq(tenants.businessReference, tenantReference),
    )).limit(1);
    if (!tenant) throw fail(404, 'WORKSPACE_NOT_FOUND', 'We could not find this workspace.');
    return tenant;
  }

  private assertPlatformOwner(actor: AgencyActor) {
    if (actor.role !== 'PLATFORM_OWNER') {
      throw fail(403, 'PLATFORM_OWNER_REQUIRED', 'Only the platform owner can use this control.');
    }
  }

  private async storageObjects(tenantId: string, includeFactFinding: boolean): Promise<StorageObject[]> {
    const query = includeFactFinding
      ? await this.db.execute(sql`
          select storage_bucket as bucket, storage_path as path
          from fact_finding_uploads
          where tenant_id = ${tenantId}::uuid
            and storage_bucket is not null
            and storage_path is not null
          union all
          select 'report-exports' as bucket, file_storage_path as path
          from report_export_jobs
          where tenant_id = ${tenantId}::uuid
            and file_storage_path is not null
        `)
      : await this.db.execute(sql`
          select 'report-exports' as bucket, file_storage_path as path
          from report_export_jobs
          where tenant_id = ${tenantId}::uuid
            and file_storage_path is not null
        `);

    const unique = new Map<string, StorageObject>();
    for (const row of query.rows as Array<Record<string, unknown>>) {
      const bucket = String(row.bucket || '').trim();
      const objectPath = String(row.path || '').trim();
      if (!bucket || !objectPath) continue;
      unique.set(`${bucket}:${objectPath}`, { bucket, path: objectPath });
    }
    return [...unique.values()];
  }

  private async removeStorageObjects(objects: StorageObject[]) {
    if (!objects.length) return { removed: 0 };
    const byBucket = new Map<string, string[]>();
    for (const object of objects) {
      const paths = byBucket.get(object.bucket) || [];
      paths.push(object.path);
      byBucket.set(object.bucket, paths);
    }

    let removed = 0;
    for (const [bucket, paths] of byBucket) {
      for (let index = 0; index < paths.length; index += 100) {
        const chunk = paths.slice(index, index + 100);
        const { error } = await getSupabaseAdmin().storage.from(bucket).remove(chunk);
        if (error) {
          throw fail(
            502,
            'WORKSPACE_STORAGE_DELETE_FAILED',
            'We could not remove every private file. No database records were deleted. Try again.',
            { bucket, attempted: chunk.length },
          );
        }
        removed += chunk.length;
      }
    }
    return { removed };
  }

  async previewReset(tenantReference: string) {
    const tenant = await this.tenant(tenantReference);
    const [query, storedFiles] = await Promise.all([
      this.db.execute(sql`
        select
          (select count(*)::int from appointments where tenant_id = ${tenant.id}::uuid) as appointments,
          (select count(*)::int from clients where tenant_id = ${tenant.id}::uuid) as clients,
          (select count(*)::int from checkout_transactions where tenant_id = ${tenant.id}::uuid) as payments,
          (select count(*)::int from client_form_submissions where tenant_id = ${tenant.id}::uuid) as form_submissions,
          ((select count(*) from email_outbox where tenant_id = ${tenant.id}::uuid)
            + (select count(*) from sms_outbox where tenant_id = ${tenant.id}::uuid)
            + (select count(*) from internal_notifications where tenant_id = ${tenant.id}::uuid))::int as messages,
          (select count(*)::int from review_invitations where tenant_id = ${tenant.id}::uuid) as review_invitations,
          (select count(*)::int from waitlist where tenant_id = ${tenant.id}::uuid) as waitlist_entries,
          (select count(*)::int from report_export_jobs where tenant_id = ${tenant.id}::uuid) as generated_reports
      `),
      this.storageObjects(tenant.id, false),
    ]);
    const row = (query.rows[0] || {}) as Record<string, unknown>;
    return {
      workspace: { id: tenant.id, name: tenant.name },
      removes: {
        appointments: asNumber(row.appointments),
        clients: asNumber(row.clients),
        payments: asNumber(row.payments),
        formSubmissions: asNumber(row.form_submissions),
        messages: asNumber(row.messages),
        reviewInvitations: asNumber(row.review_invitations),
        waitlistEntries: asNumber(row.waitlist_entries),
        generatedReports: asNumber(row.generated_reports),
        storedFiles: storedFiles.length,
      },
      keeps: [
        'Services and prices',
        'Staff and access',
        'Locations and opening hours',
        'Availability and booking settings',
        'Forms and automation rules',
        'Website content and domains',
      ],
      confirmationPhrase: 'RESET TEST DATA',
    };
  }

  async resetTestData(actor: AgencyActor, tenantReference: string, confirmationPhrase: string, reason: string) {
    this.assertPlatformOwner(actor);
    const tenant = await this.tenant(tenantReference);
    if (confirmationPhrase.trim() !== 'RESET TEST DATA') {
      throw fail(400, 'RESET_CONFIRMATION_MISMATCH', 'Type RESET TEST DATA exactly to continue.');
    }
    const preview = await this.previewReset(tenant.id);
    const storageObjects = await this.storageObjects(tenant.id, false);
    const storage = await this.removeStorageObjects(storageObjects);
    const response = await this.db.execute(sql`
      select public.ks_reset_tenant_test_data(${tenant.id}::uuid) as result
    `);
    const result = (response.rows[0] as { result?: unknown } | undefined)?.result;
    await this.audit.write(actor, 'WORKSPACE_TEST_DATA_RESET', 'TENANT', tenant.id, {
      tenantId: tenant.id,
      reason,
      description: 'Test activity was cleared while the configured booking system and website were kept.',
      metadata: {
        removed: preview.removes,
        removedStoredFiles: storage.removed,
        confirmationPhrase: 'RESET TEST DATA',
      },
    });
    return { reset: true, workspace: { id: tenant.id, name: tenant.name }, preview, result, storage };
  }

  async previewHardDelete(tenantReference: string) {
    const tenant = await this.tenant(tenantReference);
    const [query, storedFiles] = await Promise.all([
      this.db.execute(sql`
        select
          (select count(*)::int from appointments where tenant_id = ${tenant.id}::uuid) as appointments,
          (select count(*)::int from clients where tenant_id = ${tenant.id}::uuid) as clients,
          (select count(*)::int from users where tenant_id = ${tenant.id}::uuid) as users,
          (select count(*)::int from checkout_transactions where tenant_id = ${tenant.id}::uuid) as payments,
          (select count(*)::int from sites where tenant_id = ${tenant.id}::uuid) as sites
      `),
      this.storageObjects(tenant.id, true),
    ]);
    const row = (query.rows[0] || {}) as Record<string, unknown>;
    return {
      workspace: {
        id: tenant.id,
        name: tenant.name,
        subdomain: tenant.subdomain,
        lifecycleStatus: tenant.lifecycleStatus,
      },
      removes: {
        appointments: asNumber(row.appointments),
        clients: asNumber(row.clients),
        users: asNumber(row.users),
        payments: asNumber(row.payments),
        sites: asNumber(row.sites),
        storedFiles: storedFiles.length,
      },
      warning: 'This permanently removes the workspace, bookings, people, payments, forms, messages, private files, website records and audit history. It cannot be undone.',
      confirmationPhrase: 'DELETE NOW',
    };
  }

  async hardDelete(actor: AgencyActor, tenantReference: string, confirmationName: string, confirmationPhrase: string, reason: string) {
    this.assertPlatformOwner(actor);
    const tenant = await this.tenant(tenantReference);
    if (confirmationName.trim() !== tenant.name) {
      throw fail(400, 'WORKSPACE_NAME_MISMATCH', 'Type the workspace name exactly to continue.');
    }
    if (confirmationPhrase.trim() !== 'DELETE NOW') {
      throw fail(400, 'DELETE_CONFIRMATION_MISMATCH', 'Type DELETE NOW exactly to continue.');
    }

    const preview = await this.previewHardDelete(tenant.id);
    const storageObjects = await this.storageObjects(tenant.id, true);
    const storage = await this.removeStorageObjects(storageObjects);
    const response = await this.db.execute(sql`
      select public.ks_hard_delete_tenant_workspace(${tenant.id}::uuid) as result
    `);
    const result = (response.rows[0] as { result?: unknown } | undefined)?.result as Record<string, unknown> || {};
    const candidates = Array.isArray(result.candidateAuthUserIds) ? result.candidateAuthUserIds as string[] : [];
    const deletedAuthUserIds: string[] = [];
    const retainedAuthUserIds: string[] = [];

    for (const authUserId of candidates) {
      const references = await this.db.execute(sql`
        select (
          exists(select 1 from users where auth_user_id = ${authUserId}::uuid)
          or exists(select 1 from agency_users where auth_user_id = ${authUserId}::uuid)
        ) as still_referenced
      `);
      if (Boolean((references.rows[0] as Record<string, unknown> | undefined)?.still_referenced)) {
        retainedAuthUserIds.push(authUserId);
        continue;
      }
      try {
        const { error } = await getSupabaseAdmin().auth.admin.deleteUser(authUserId);
        if (error) throw error;
        deletedAuthUserIds.push(authUserId);
      } catch {
        retainedAuthUserIds.push(authUserId);
      }
    }

    await this.audit.write(actor, 'WORKSPACE_HARD_DELETED', 'TENANT', tenant.id, {
      reason,
      description: 'The workspace and its tenant-owned records were permanently deleted.',
      metadata: {
        previousName: tenant.name,
        previousSubdomain: tenant.subdomain,
        removed: preview.removes,
        removedStoredFiles: storage.removed,
        deletedAuthIdentities: deletedAuthUserIds.length,
        retainedSharedOrFailedAuthIdentities: retainedAuthUserIds.length,
        confirmationPhrase: 'DELETE NOW',
      },
    });

    return {
      deleted: true,
      workspaceReference: tenant.id,
      removed: preview.removes,
      storage,
      authIdentities: {
        deleted: deletedAuthUserIds.length,
        retained: retainedAuthUserIds.length,
      },
    };
  }
}
