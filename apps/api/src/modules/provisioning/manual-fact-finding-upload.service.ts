import { createHash, randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  factFindingQuestionnaireQuestions,
  factFindingQuestionnaires,
  factFindingUploads,
  getDatabase,
} from '@ks-os/database';
import { FactFindingUploadSchema } from '@ks-os/fact-finding';
import type { z } from 'zod';
import { getSupabaseAdmin } from '../../lib/supabase-admin.js';
import { AgencyAuditService, type AgencyActor } from '../agency/agency.service.js';

type UploadInput = z.infer<typeof FactFindingUploadSchema>;
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
  if (mimeType === 'text/plain') {
    if (bytes.includes(0) || bytes.subarray(0, 2).toString('ascii') === '#!') return false;
    return !bytes.toString('utf8').includes('\uFFFD');
  }
  return false;
}

export class ManualFactFindingUploadService {
  private readonly db = getDatabase();
  private readonly audit = new AgencyAuditService();

  private async questionnaire(reference: string) {
    const [row] = await this.db.select({ id: factFindingQuestionnaires.id, tenantId: factFindingQuestionnaires.tenantId, status: factFindingQuestionnaires.status })
      .from(factFindingQuestionnaires)
      .where(eq(factFindingQuestionnaires.publicReference, reference)).limit(1);
    if (!row) throw fail(404, 'FACT_FINDING_QUESTIONNAIRE_NOT_FOUND', 'Questionnaire was not found.');
    if (!['PREQUALIFIED', 'IN_PROGRESS', 'CLARIFICATION_REQUIRED'].includes(row.status)) throw fail(409, 'FACT_FINDING_MANUAL_ENTRY_LOCKED', 'This intake form is not open for assisted uploads.');
    return row;
  }

  async initiate(actor: AgencyActor, questionnaireReference: string, input: UploadInput) {
    const questionnaire = await this.questionnaire(questionnaireReference);
    let questionId: string | undefined;
    if (input.questionReference) {
      const [question] = await this.db.select({ id: factFindingQuestionnaireQuestions.id }).from(factFindingQuestionnaireQuestions).where(and(
        eq(factFindingQuestionnaireQuestions.questionnaireId, questionnaire.id),
        eq(factFindingQuestionnaireQuestions.publicReference, input.questionReference),
        eq(factFindingQuestionnaireQuestions.included, true),
        inArray(factFindingQuestionnaireQuestions.questionType, ['FILE_UPLOAD', 'IMAGE_UPLOAD']),
      )).limit(1);
      if (!question) throw fail(404, 'FACT_FINDING_UPLOAD_QUESTION_INVALID', 'Upload question is outside this intake form.');
      questionId = question.id;
    }
    const uploadReference = randomUUID();
    const safeFilename = input.fileName.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 255);
    const bucket = process.env.FACT_FINDING_STORAGE_BUCKET || 'private-fact-finding';
    const storagePath = `${questionnaireReference}/assisted/${uploadReference}/${safeFilename}`;
    const [upload] = await this.db.insert(factFindingUploads).values({
      publicReference: uploadReference,
      questionnaireId: questionnaire.id,
      tenantId: questionnaire.tenantId,
      participantId: null,
      questionId,
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
      throw fail(503, 'FACT_FINDING_UPLOAD_UNAVAILABLE', 'A private upload URL could not be created.');
    }
    await this.audit.write(actor, 'FACT_FINDING_AGENCY_UPLOAD_STARTED', 'FACT_FINDING_UPLOAD', upload.publicReference, {
      tenantId: questionnaire.tenantId,
      metadata: { questionnaireReference, category: upload.assetCategory, byteSize: upload.byteSize },
    });
    return { reference: upload.publicReference, signedUploadUrl: data.signedUrl, uploadToken: data.token, expiresInSeconds: 7_200, public: false, reviewStatus: upload.agencyReviewStatus };
  }

  async complete(actor: AgencyActor, questionnaireReference: string, uploadReference: string) {
    const questionnaire = await this.questionnaire(questionnaireReference);
    const [upload] = await this.db.select().from(factFindingUploads).where(and(
      eq(factFindingUploads.publicReference, uploadReference),
      eq(factFindingUploads.questionnaireId, questionnaire.id),
      eq(factFindingUploads.tenantId, questionnaire.tenantId),
      isNull(factFindingUploads.participantId),
      eq(factFindingUploads.uploadStatus, 'PENDING_UPLOAD'),
    )).limit(1);
    if (!upload) throw fail(404, 'FACT_FINDING_UPLOAD_NOT_FOUND', 'Pending assisted upload was not found.');
    const { data, error } = await getSupabaseAdmin().storage.from(upload.storageBucket).download(upload.storagePath);
    if (error || !data) throw fail(409, 'FACT_FINDING_UPLOAD_INCOMPLETE', 'The private upload has not completed.');
    const bytes = Buffer.from(await data.arrayBuffer());
    const valid = bytes.byteLength === upload.byteSize
      && createHash('sha256').update(bytes).digest('hex') === upload.digestSha256
      && uploadedFileMatchesMime(bytes, upload.mimeType);
    if (!valid) {
      await this.db.update(factFindingUploads).set({ uploadStatus: 'QUARANTINED', malwareScanStatus: 'FAILED', updatedAt: new Date() }).where(eq(factFindingUploads.id, upload.id));
      await getSupabaseAdmin().storage.from(upload.storageBucket).remove([upload.storagePath]);
      throw fail(400, 'FACT_FINDING_UPLOAD_VERIFICATION_FAILED', 'The uploaded bytes do not match the declared safe file.');
    }
    const [completed] = await this.db.update(factFindingUploads).set({ uploadStatus: 'UPLOADED', updatedAt: new Date() }).where(and(eq(factFindingUploads.id, upload.id), eq(factFindingUploads.uploadStatus, 'PENDING_UPLOAD'))).returning();
    if (!completed) throw fail(409, 'FACT_FINDING_UPLOAD_ALREADY_COMPLETED', 'The upload state changed before completion.');
    await this.audit.write(actor, 'FACT_FINDING_AGENCY_UPLOAD_COMPLETED', 'FACT_FINDING_UPLOAD', completed.publicReference, {
      tenantId: questionnaire.tenantId,
      metadata: { questionnaireReference, category: completed.assetCategory, byteSize: completed.byteSize },
    });
    return { reference: completed.publicReference, uploadStatus: completed.uploadStatus, reviewStatus: completed.agencyReviewStatus };
  }
}
