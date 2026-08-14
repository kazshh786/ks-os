import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, not, or } from 'drizzle-orm';
import {
  factFindingQuestionnaires,
  factFindingUploads,
  getDatabase,
  tenants,
} from '@ks-os/database';
import { FactFindingUploadSchema } from '@ks-os/fact-finding';
import type { z } from 'zod';
import { getSupabaseAdmin } from '../../lib/supabase-admin.js';
import { AgencyAuditService, type AgencyActor } from '../agency/agency.service.js';

type AssetUploadInput = z.infer<typeof FactFindingUploadSchema>;
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
    }).from(factFindingUploads)
      .where(and(
        eq(factFindingUploads.tenantId, tenant.id),
        not(eq(factFindingUploads.assetCategory, 'SEARCH_RESEARCH_SOURCE')),
      ))
      .orderBy(desc(factFindingUploads.createdAt))
      .limit(250);

    const assets = await Promise.all(rows.map(async row => {
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
    const [updated] = await this.db.update(factFindingUploads).set({
      publicUsePermission: input.publicUsePermission,
      aiUsePermission: input.aiUsePermission,
      copyrightConfirmed: input.copyrightConfirmed,
      consentStatus: input.consentStatus,
      agencyReviewStatus: 'PENDING',
      reviewedByAgencyUserId: null,
      reviewedAt: null,
      updatedAt: new Date(),
    }).where(and(
      eq(factFindingUploads.publicReference, uploadReference),
      eq(factFindingUploads.tenantId, tenant.id),
      eq(factFindingUploads.uploadStatus, 'UPLOADED'),
      not(eq(factFindingUploads.assetCategory, 'SEARCH_RESEARCH_SOURCE')),
    )).returning();
    if (!updated) throw fail(404, 'ASSET_LIBRARY_ASSET_NOT_FOUND', 'Asset was not found.');
    await this.audit.write(actor, 'CLIENT_ASSET_PERMISSIONS_UPDATED', 'FACT_FINDING_UPLOAD', updated.publicReference, {
      tenantId: tenant.id,
      category: 'WEBSITE',
      metadata: { publicUsePermission: input.publicUsePermission, aiUsePermission: input.aiUsePermission, consentStatus: input.consentStatus },
    });
    return { reference: updated.publicReference, reviewStatus: updated.agencyReviewStatus };
  }
}
