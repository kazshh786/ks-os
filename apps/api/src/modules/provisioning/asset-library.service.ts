import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, not, or } from 'drizzle-orm';
import {
  factFindingQuestionnaires,
  factFindingUploads,
  getDatabase,
  services,
  siteAssets,
  tenants,
  users,
} from '@ks-os/database';
import { AssetEntityBindingSchema, FactFindingUploadSchema } from '@ks-os/fact-finding';
import type { z } from 'zod';
import { isGovernedSiteAssetPubliclyDeliverable } from '@ks-os/site-generation';
import { getSupabaseAdmin } from '../../lib/supabase-admin.js';
import { AgencyAuditService, type AgencyActor } from '../agency/agency.service.js';

type AssetUploadInput = z.infer<typeof FactFindingUploadSchema>;
type AssetEntityBindingInput = z.infer<typeof AssetEntityBindingSchema>;
const fail = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });

function uploadedFileMatchesMime(bytes: Buffer, mimeType: string) {
  if (bytes.length < 4) return false;
  const hex = bytes.subarray(0, 16).toString('hex');
  if (hex.startsWith('4d5a') || hex.startsWith('7f454c46') || hex.startsWith('0061736d') || hex.startsWith('cffaedfe') || hex.startsWith('feedfacf')) return false;
  if (mimeType === 'image/jpeg') return hex.startsWith('ffd8ff');
  if (mimeType === 'image/png') return hex.startsWith('89504e470d0a1a0a');
  if (mimeType === 'image/webp') return bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if (mimeType === 'image/avif') return bytes.subarray(4, 8).toString('ascii') === 'ftyp' && /^(?:avif|avis)$/.test(bytes.subarray(8, 12).toString('ascii'));
  if (mimeType === 'application/pdf') return bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mimeType === 'text/plain') return !bytes.includes(0) && !bytes.toString('utf8').includes('\uFFFD');
  return false;
}

export class AssetLibraryService {
  private readonly db = getDatabase();
  private readonly audit = new AgencyAuditService();

  private async tenant(reference: string) {
    const [tenant] = await this.db.select({
      id: tenants.id,
      agencyReference: tenants.agencyReference,
      businessReference: tenants.businessReference,
      name: tenants.name,
    }).from(tenants).where(or(
      eq(tenants.agencyReference, reference),
      eq(tenants.businessReference, reference),
    )).limit(1);
    if (!tenant) throw fail(404, 'ASSET_LIBRARY_TENANT_NOT_FOUND', 'Client business was not found.');
    return tenant;
  }

  private async sourceQuestionnaire(tenantId: string) {
    const [questionnaire] = await this.db.select({
      id: factFindingQuestionnaires.id,
      reference: factFindingQuestionnaires.publicReference,
      status: factFindingQuestionnaires.status,
    }).from(factFindingQuestionnaires)
      .where(and(
        eq(factFindingQuestionnaires.tenantId, tenantId),
        not(inArray(factFindingQuestionnaires.status, ['CANCELLED', 'SUPERSEDED'])),
      ))
      .orderBy(desc(factFindingQuestionnaires.questionnaireVersion))
      .limit(1);
    return questionnaire ?? null;
  }

  async list(tenantReference: string) {
    const tenant = await this.tenant(tenantReference);
    const questionnaire = await this.sourceQuestionnaire(tenant.id);
    const rows = await this.db.select({
      reference: factFindingUploads.publicReference,
      category: factFindingUploads.assetCategory,
      fileName: factFindingUploads.safeFilename,
      mimeType: factFindingUploads.mimeType,
      byteSize: factFindingUploads.byteSize,
      provenance: factFindingUploads.provenance,
      publicUsePermission: factFindingUploads.publicUsePermission,
      aiUsePermission: factFindingUploads.aiUsePermission,
      copyrightConfirmed: factFindingUploads.copyrightConfirmed,
      consentStatus: factFindingUploads.consentStatus,
      uploadStatus: factFindingUploads.uploadStatus,
      scanStatus: factFindingUploads.malwareScanStatus,
      reviewStatus: factFindingUploads.agencyReviewStatus,
      storageBucket: factFindingUploads.storageBucket,
      storagePath: factFindingUploads.storagePath,
      createdAt: factFindingUploads.createdAt,
      reviewedAt: factFindingUploads.reviewedAt,
      boundStaffUserId: factFindingUploads.boundStaffUserId,
      boundServiceId: factFindingUploads.boundServiceId,
    }).from(factFindingUploads)
      .where(and(
        eq(factFindingUploads.tenantId, tenant.id),
        not(eq(factFindingUploads.assetCategory, 'SEARCH_RESEARCH_SOURCE')),
      ))
      .orderBy(desc(factFindingUploads.createdAt))
      .limit(250);

    const boundStaffIds = rows.flatMap(row => row.boundStaffUserId ? [row.boundStaffUserId] : []);
    const boundServiceIds = rows.flatMap(row => row.boundServiceId ? [row.boundServiceId] : []);
    const [boundStaff, boundServices] = await Promise.all([
      boundStaffIds.length
        ? this.db.select({ id: users.id, reference: users.publicReference })
          .from(users).where(and(
            eq(users.tenantId, tenant.id),
            inArray(users.id, boundStaffIds),
          ))
        : Promise.resolve([]),
      boundServiceIds.length
        ? this.db.select({ id: services.id, reference: services.publicReference })
          .from(services).where(and(
            eq(services.tenantId, tenant.id),
            inArray(services.id, boundServiceIds),
          ))
        : Promise.resolve([]),
    ]);
    const staffReferences = new Map(boundStaff.map(row => [row.id, row.reference]));
    const serviceReferences = new Map(boundServices.map(row => [row.id, row.reference]));
    const assets = await Promise.all(rows.map(async row => {
      if ((row.boundStaffUserId && !staffReferences.has(row.boundStaffUserId))
        || (row.boundServiceId && !serviceReferences.has(row.boundServiceId))) {
        throw fail(
          409,
          'ASSET_ENTITY_BINDING_INVALID',
          'An asset has an invalid cross-business entity binding.',
        );
      }
      let signedViewUrl: string | null = null;
      if (row.uploadStatus === 'UPLOADED' && !['INFECTED', 'FAILED'].includes(row.scanStatus)) {
        const { data } = await getSupabaseAdmin().storage.from(row.storageBucket).createSignedUrl(row.storagePath, 900);
        signedViewUrl = data?.signedUrl ?? null;
      }
      return {
        ...row,
        storageBucket: undefined,
        storagePath: undefined,
        createdAt: row.createdAt.toISOString(),
        reviewedAt: row.reviewedAt?.toISOString() ?? null,
        entityBinding: row.boundStaffUserId
          ? { entityType: 'STAFF' as const, entityReference: staffReferences.get(row.boundStaffUserId)! }
          : row.boundServiceId
            ? { entityType: 'SERVICE' as const, entityReference: serviceReferences.get(row.boundServiceId)! }
            : { entityType: 'NONE' as const },
        boundStaffUserId: undefined,
        boundServiceId: undefined,
        signedViewUrl,
        usage: { pageReferences: [], note: 'Page usage is recorded after a generated website version references this asset.' },
      };
    }));

    return {
      tenant: { reference: tenant.agencyReference, name: tenant.name },
      canUpload: Boolean(questionnaire),
      sourceQuestionnaireReference: questionnaire?.reference ?? null,
      assets,
    };
  }

  async initiate(actor: AgencyActor, tenantReference: string, input: AssetUploadInput) {
    const tenant = await this.tenant(tenantReference);
    const questionnaire = await this.sourceQuestionnaire(tenant.id);
    if (!questionnaire) {
      throw fail(409, 'ASSET_LIBRARY_DISCOVERY_REQUIRED', 'Start client discovery before adding governed brand assets.');
    }
    const uploadReference = randomUUID();
    const safeFilename = input.fileName.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 255);
    const bucket = process.env.FACT_FINDING_STORAGE_BUCKET || 'private-fact-finding';
    const storagePath = `${tenant.agencyReference}/asset-library/${uploadReference}/${safeFilename}`;
    const [upload] = await this.db.insert(factFindingUploads).values({
      publicReference: uploadReference,
      questionnaireId: questionnaire.id,
      tenantId: tenant.id,
      participantId: null,
      questionId: null,
      storageBucket: bucket,
      storagePath,
      safeFilename,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      digestSha256: input.digestSha256,
      assetCategory: input.category,
      provenance: 'AGENCY_SUPPLIED',
      publicUsePermission: input.publicUsePermission,
      aiUsePermission: input.aiUsePermission,
      copyrightConfirmed: input.copyrightConfirmed,
      consentStatus: input.consentStatus,
    }).returning();
    const { data, error } = await getSupabaseAdmin().storage.from(bucket).createSignedUploadUrl(storagePath);
    if (error || !data) {
      await this.db.update(factFindingUploads).set({ uploadStatus: 'REJECTED', updatedAt: new Date() }).where(eq(factFindingUploads.id, upload.id));
      throw fail(503, 'ASSET_LIBRARY_UPLOAD_UNAVAILABLE', 'A private upload URL could not be created.');
    }
    await this.audit.write(actor, 'CLIENT_ASSET_UPLOAD_STARTED', 'FACT_FINDING_UPLOAD', upload.publicReference, {
      tenantId: tenant.id,
      category: 'WEBSITE',
      metadata: { category: input.category, byteSize: input.byteSize, sourceQuestionnaireReference: questionnaire.reference },
    });
    return { reference: upload.publicReference, signedUploadUrl: data.signedUrl, uploadToken: data.token, expiresInSeconds: 7_200, public: false };
  }

  async complete(actor: AgencyActor, tenantReference: string, uploadReference: string) {
    const tenant = await this.tenant(tenantReference);
    const [upload] = await this.db.select().from(factFindingUploads).where(and(
      eq(factFindingUploads.publicReference, uploadReference),
      eq(factFindingUploads.tenantId, tenant.id),
      eq(factFindingUploads.uploadStatus, 'PENDING_UPLOAD'),
      not(eq(factFindingUploads.assetCategory, 'SEARCH_RESEARCH_SOURCE')),
    )).limit(1);
    if (!upload) throw fail(404, 'ASSET_LIBRARY_UPLOAD_NOT_FOUND', 'Pending asset upload was not found.');
    const { data, error } = await getSupabaseAdmin().storage.from(upload.storageBucket).download(upload.storagePath);
    if (error || !data) throw fail(409, 'ASSET_LIBRARY_UPLOAD_INCOMPLETE', 'The private upload has not completed.');
    const bytes = Buffer.from(await data.arrayBuffer());
    const valid = bytes.byteLength === upload.byteSize
      && createHash('sha256').update(bytes).digest('hex') === upload.digestSha256
      && uploadedFileMatchesMime(bytes, upload.mimeType);
    if (!valid) {
      await this.db.update(factFindingUploads).set({ uploadStatus: 'QUARANTINED', malwareScanStatus: 'FAILED', updatedAt: new Date() }).where(eq(factFindingUploads.id, upload.id));
      await getSupabaseAdmin().storage.from(upload.storageBucket).remove([upload.storagePath]);
      throw fail(400, 'ASSET_LIBRARY_UPLOAD_VERIFICATION_FAILED', 'The uploaded bytes do not match the declared safe file.');
    }
    const [completed] = await this.db.update(factFindingUploads).set({ uploadStatus: 'UPLOADED', updatedAt: new Date() }).where(and(
      eq(factFindingUploads.id, upload.id),
      eq(factFindingUploads.uploadStatus, 'PENDING_UPLOAD'),
    )).returning();
    if (!completed) throw fail(409, 'ASSET_LIBRARY_UPLOAD_ALREADY_COMPLETED', 'The upload state changed before completion.');
    await this.audit.write(actor, 'CLIENT_ASSET_UPLOAD_COMPLETED', 'FACT_FINDING_UPLOAD', completed.publicReference, {
      tenantId: tenant.id,
      category: 'WEBSITE',
      metadata: { category: completed.assetCategory, byteSize: completed.byteSize },
    });
    return { reference: completed.publicReference, uploadStatus: completed.uploadStatus, reviewStatus: completed.agencyReviewStatus };
  }

  async updatePermissions(actor: AgencyActor, tenantReference: string, uploadReference: string, input: {
    publicUsePermission: boolean;
    aiUsePermission: boolean;
    copyrightConfirmed: boolean;
    consentStatus: 'NOT_APPLICABLE' | 'CONFIRMED' | 'REQUIRED';
  }) {
    const tenant = await this.tenant(tenantReference);
    const updated = await this.db.transaction(async transaction => {
      const [current] = await transaction.select().from(factFindingUploads).where(and(
        eq(factFindingUploads.publicReference, uploadReference),
        eq(factFindingUploads.tenantId, tenant.id),
        eq(factFindingUploads.uploadStatus, 'UPLOADED'),
        not(eq(factFindingUploads.assetCategory, 'SEARCH_RESEARCH_SOURCE')),
      )).limit(1).for('update');
      if (!current) throw fail(404, 'ASSET_LIBRARY_ASSET_NOT_FOUND', 'Asset was not found.');
      const publicPolicyChanged = current.publicUsePermission !== input.publicUsePermission
        || current.copyrightConfirmed !== input.copyrightConfirmed
        || current.consentStatus !== input.consentStatus;
      const nextReviewStatus = publicPolicyChanged ? 'PENDING' : current.agencyReviewStatus;
      const [record] = await transaction.update(factFindingUploads).set({
        publicUsePermission: input.publicUsePermission,
        aiUsePermission: input.aiUsePermission,
        copyrightConfirmed: input.copyrightConfirmed,
        consentStatus: input.consentStatus,
        agencyReviewStatus: nextReviewStatus,
        ...(publicPolicyChanged ? {
          reviewedByAgencyUserId: null,
          reviewedAt: null,
        } : {}),
        updatedAt: new Date(),
      }).where(eq(factFindingUploads.id, current.id)).returning();
      const siteAssetStatus = isGovernedSiteAssetPubliclyDeliverable(record)
        ? 'READY'
        : 'REJECTED';
      await transaction.update(siteAssets).set({
        status: siteAssetStatus,
        updatedAt: new Date(),
      }).where(and(
        eq(siteAssets.sourceFactFindingUploadId, record.id),
        eq(siteAssets.tenantId, tenant.id),
      ));
      await this.audit.write(actor, 'CLIENT_ASSET_PERMISSIONS_UPDATED', 'FACT_FINDING_UPLOAD', record.publicReference, {
        tenantId: tenant.id,
        category: 'WEBSITE',
        metadata: {
          publicUsePermission: input.publicUsePermission,
          aiUsePermission: input.aiUsePermission,
          consentStatus: input.consentStatus,
          publicPolicyChanged,
          siteAssetStatus,
        },
        tx: transaction,
      });
      return record;
    });
    return { reference: updated.publicReference, reviewStatus: updated.agencyReviewStatus };
  }

  async updateEntityBinding(
    actor: AgencyActor,
    tenantReference: string,
    uploadReference: string,
    input: AssetEntityBindingInput,
  ) {
    const tenant = await this.tenant(tenantReference);
    return this.db.transaction(async transaction => {
      const [upload] = await transaction.select().from(factFindingUploads).where(and(
        eq(factFindingUploads.publicReference, uploadReference),
        eq(factFindingUploads.tenantId, tenant.id),
        eq(factFindingUploads.uploadStatus, 'UPLOADED'),
        not(eq(factFindingUploads.assetCategory, 'SEARCH_RESEARCH_SOURCE')),
      )).limit(1).for('update');
      if (!upload) throw fail(404, 'ASSET_LIBRARY_ASSET_NOT_FOUND', 'Asset was not found.');
      const [materialized] = await transaction.select({ id: siteAssets.id })
        .from(siteAssets).where(and(
          eq(siteAssets.sourceFactFindingUploadId, upload.id),
          eq(siteAssets.tenantId, tenant.id),
        )).limit(1);
      if (materialized) {
        throw fail(
          409,
          'ASSET_ENTITY_BINDING_IMMUTABLE',
          'An asset binding cannot change after the asset has entered a governed website input.',
        );
      }
      let boundStaffUserId: string | null = null;
      let boundServiceId: string | null = null;
      if (input.entityType === 'STAFF') {
        if (upload.assetCategory !== 'TEAM_PHOTO') {
          throw fail(409, 'ASSET_ENTITY_BINDING_INVALID', 'Only a team photo can bind to a staff member.');
        }
        const [staff] = await transaction.select({ id: users.id }).from(users).where(and(
          eq(users.publicReference, input.entityReference),
          eq(users.tenantId, tenant.id),
          eq(users.accountStatus, 'ACTIVE'),
        )).limit(1);
        if (!staff) throw fail(404, 'ASSET_ENTITY_NOT_FOUND', 'The staff member was not found for this business.');
        boundStaffUserId = staff.id;
      } else if (input.entityType === 'SERVICE') {
        if (upload.assetCategory !== 'SERVICE_PHOTO') {
          throw fail(409, 'ASSET_ENTITY_BINDING_INVALID', 'Only a service photo can bind to a service.');
        }
        const [service] = await transaction.select({ id: services.id }).from(services).where(and(
          eq(services.publicReference, input.entityReference),
          eq(services.tenantId, tenant.id),
          eq(services.isActive, true),
        )).limit(1);
        if (!service) throw fail(404, 'ASSET_ENTITY_NOT_FOUND', 'The service was not found for this business.');
        boundServiceId = service.id;
      }
      const [updated] = await transaction.update(factFindingUploads).set({
        boundStaffUserId,
        boundServiceId,
        agencyReviewStatus: 'PENDING',
        reviewedByAgencyUserId: null,
        reviewedAt: null,
        updatedAt: new Date(),
      }).where(eq(factFindingUploads.id, upload.id)).returning();
      await this.audit.write(actor, 'CLIENT_ASSET_ENTITY_BINDING_UPDATED', 'FACT_FINDING_UPLOAD', uploadReference, {
        tenantId: tenant.id,
        category: 'WEBSITE',
        metadata: {
          entityType: input.entityType,
          entityReference: input.entityType === 'NONE' ? null : input.entityReference,
        },
        tx: transaction,
      });
      return { reference: updated!.publicReference, reviewStatus: updated!.agencyReviewStatus, entityBinding: input };
    });
  }
}
