import { createHash, randomUUID } from 'node:crypto';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  or,
  sql,
} from 'drizzle-orm';
import {
  emailOutbox,
  factFindingClarifications,
  factFindingInvitations,
  factFindingParticipants,
  factFindingQuestionnaireQuestions,
  factFindingQuestionnaires,
  factFindingResponses,
  factFindingResponseVersions,
  factFindingSessions,
  factFindingTemplateQuestions,
  factFindingTemplateSections,
  factFindingTemplates,
  factFindingUploads,
  getDatabase,
  productionBriefFacts,
  productionBriefs,
  tenants,
} from '@ks-os/database';
import {
  AgencyFactDecisionSchema,
  BuildProductionBriefSchema,
  CreateQuestionnaireSchema,
  CreateQuestionnaireTemplateSchema,
  FactFieldMappingSchema,
  FactFindingUploadSchema,
  PrequalifyQuestionnaireSchema,
  RejectFactResponseSchema,
  RequestClarificationSchema,
  RespondToClarificationSchema,
  SaveFactFindingResponseSchema,
  assertClientCanSaveResponse,
  assertQuestionCanBeRemoved,
  buildProductionBriefData,
  completionForQuestions,
  createFactFindingToken,
  deriveFactFindingInvitationToken,
  digestFactFindingToken,
  evaluateProductionBriefReadiness,
  toClientSafeFactFindingDto,
  verifyFactFindingInvitationToken,
} from '@ks-os/fact-finding';
import type { z } from 'zod';
import { AgencyAuditService, type AgencyActor } from '../agency/agency.service.js';
import { getSupabaseAdmin } from '../../lib/supabase-admin.js';

type CreateTemplate = z.infer<typeof CreateQuestionnaireTemplateSchema>;
type CreateQuestionnaire = z.infer<typeof CreateQuestionnaireSchema>;
type Prequalify = z.infer<typeof PrequalifyQuestionnaireSchema>;
type SaveResponse = z.infer<typeof SaveFactFindingResponseSchema>;
type UploadInput = z.infer<typeof FactFindingUploadSchema>;

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function safeAnswer(value: unknown) {
  const inspect = (item: unknown): void => {
    if (typeof item === 'string' && (
      /<\s*\/?\s*(?:script|iframe|object|embed|style|form|svg|math)\b/i.test(item)
      || /(?:javascript|data|vbscript)\s*:/i.test(item)
    )) throw fail(400, 'FACT_FINDING_UNSAFE_ANSWER', 'Executable or embedded answer content is not permitted.');
    if (Array.isArray(item)) item.forEach(inspect);
    else if (item && typeof item === 'object') Object.values(item as Record<string, unknown>).forEach(inspect);
  };
  inspect(value);
  return value;
}

function uploadedFileMatchesMime(bytes: Buffer, mimeType: string) {
  if (bytes.length < 4) return false;
  const hex = bytes.subarray(0, 16).toString('hex');
  if (hex.startsWith('4d5a') || hex.startsWith('7f454c46') || hex.startsWith('0061736d')
    || hex.startsWith('cffaedfe') || hex.startsWith('feedfacf')) return false;
  if (mimeType === 'image/jpeg') return hex.startsWith('ffd8ff');
  if (mimeType === 'image/png') return hex.startsWith('89504e470d0a1a0a');
  if (mimeType === 'image/webp') return bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if (mimeType === 'image/avif') return bytes.subarray(4, 8).toString('ascii') === 'ftyp'
    && /^(?:avif|avis)$/.test(bytes.subarray(8, 12).toString('ascii'));
  if (mimeType === 'application/pdf') return bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mimeType === 'text/plain') {
    if (bytes.includes(0) || bytes.subarray(0, 2).toString('ascii') === '#!') return false;
    const text = bytes.toString('utf8');
    return !text.includes('\uFFFD');
  }
  return false;
}

export interface FactFindingSessionContext {
  sessionId: string;
  sessionReference: string;
  questionnaireId: string;
  questionnaireReference: string;
  tenantId: string;
  tenantReference: string;
  participantId: string;
  participantReference: string;
  expiresAt: Date;
}

export class FactFindingService {
  private readonly db = getDatabase();
  private readonly audit = new AgencyAuditService();

  private invitationSecret() {
    const value = process.env.FACT_FINDING_INVITATION_SECRET;
    if (!value || value.length < 32) {
      throw fail(503, 'FACT_FINDING_INVITATION_UNAVAILABLE', 'Fact-finding invitations are not configured.');
    }
    return value;
  }

  private async tenantContext(reference: string) {
    const [tenant] = await this.db.select({
      id: tenants.id,
      reference: tenants.agencyReference,
      businessReference: tenants.businessReference,
      name: tenants.name,
      primaryColor: tenants.primaryColor,
    }).from(tenants).where(or(
      eq(tenants.agencyReference, reference),
      eq(tenants.businessReference, reference),
    )).limit(1);
    if (!tenant) throw fail(404, 'FACT_FINDING_TENANT_NOT_FOUND', 'Client business was not found.');
    return tenant;
  }

  async createTemplate(actor: AgencyActor, input: CreateTemplate) {
    const [latest] = await this.db.select({ version: factFindingTemplates.version })
      .from(factFindingTemplates)
      .where(eq(factFindingTemplates.templateKey, input.key))
      .orderBy(desc(factFindingTemplates.version))
      .limit(1);
    const version = (latest?.version || 0) + 1;
    const template = await this.db.transaction(async tx => {
      const [created] = await tx.insert(factFindingTemplates).values({
        templateKey: input.key,
        version,
        name: input.name,
        description: input.description,
        businessCategoriesJson: input.businessCategories,
        planKeysJson: input.planKeys,
        createdByAgencyUserId: actor.agencyUserId,
      }).returning();
      for (const section of [...input.sections].sort((a, b) => a.displayOrder - b.displayOrder)) {
        const [sectionRow] = await tx.insert(factFindingTemplateSections).values({
          publicReference: section.reference,
          templateId: created.id,
          sectionKey: section.key,
          title: section.title,
          description: section.description,
          displayOrder: section.displayOrder,
          optional: section.optional,
        }).returning();
        await tx.insert(factFindingTemplateQuestions).values(section.questions.map(question => ({
          publicReference: question.reference,
          templateId: created.id,
          sectionId: sectionRow.id,
          questionKey: question.key,
          label: question.label,
          guidance: question.guidance,
          questionType: question.questionType,
          fieldMapping: question.fieldMapping,
          required: question.required,
          systemRequired: question.systemRequired,
          evidenceRequired: question.evidenceRequired,
          publicUseAllowed: question.publicUseAllowed,
          bookingUseAllowed: question.bookingUseAllowed,
          generationUseAllowed: question.generationUseAllowed,
          agencyVerificationRequired: question.agencyVerificationRequired,
          conditionsJson: question.conditions,
          optionsJson: question.options,
          displayOrder: question.displayOrder,
        })));
      }
      return created;
    });
    await this.audit.write(actor, 'FACT_FINDING_TEMPLATE_CREATED', 'FACT_FINDING_TEMPLATE', template.publicReference, {
      metadata: { templateKey: input.key, version, sectionCount: input.sections.length },
    });
    return { reference: template.publicReference, key: template.templateKey, version, status: template.status };
  }

  async listTemplates() {
    return this.db.select({
      reference: factFindingTemplates.publicReference,
      key: factFindingTemplates.templateKey,
      version: factFindingTemplates.version,
      name: factFindingTemplates.name,
      description: factFindingTemplates.description,
      businessCategories: factFindingTemplates.businessCategoriesJson,
      planKeys: factFindingTemplates.planKeysJson,
      status: factFindingTemplates.status,
      createdAt: factFindingTemplates.createdAt,
    }).from(factFindingTemplates).orderBy(asc(factFindingTemplates.templateKey), desc(factFindingTemplates.version));
  }

  async activateTemplate(actor: AgencyActor, templateReference: string) {
    const [template] = await this.db.update(factFindingTemplates).set({
      status: 'ACTIVE',
      activatedByAgencyUserId: actor.agencyUserId,
      activatedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(factFindingTemplates.publicReference, templateReference),
      eq(factFindingTemplates.status, 'DRAFT'),
    )).returning();
    if (!template) throw fail(409, 'FACT_FINDING_TEMPLATE_NOT_ACTIVATABLE', 'Only a draft template can be activated.');
    return { reference: template.publicReference, status: template.status };
  }

  async createQuestionnaire(actor: AgencyActor, tenantReference: string, input: CreateQuestionnaire) {
    const tenant = await this.tenantContext(tenantReference);
    const [template] = await this.db.select().from(factFindingTemplates)
      .where(and(eq(factFindingTemplates.publicReference, input.templateReference), inArray(factFindingTemplates.status, ['DRAFT', 'ACTIVE'])))
      .limit(1);
    if (!template) throw fail(404, 'FACT_FINDING_TEMPLATE_NOT_FOUND', 'Questionnaire template was not found.');
    const [sections, questions, versionResult] = await Promise.all([
      this.db.select().from(factFindingTemplateSections).where(eq(factFindingTemplateSections.templateId, template.id)).orderBy(asc(factFindingTemplateSections.displayOrder)),
      this.db.select().from(factFindingTemplateQuestions).where(eq(factFindingTemplateQuestions.templateId, template.id)).orderBy(asc(factFindingTemplateQuestions.displayOrder)),
      this.db.select({ value: sql<number>`coalesce(max(${factFindingQuestionnaires.questionnaireVersion}), 0)::int` })
        .from(factFindingQuestionnaires).where(eq(factFindingQuestionnaires.tenantId, tenant.id)),
    ]);
    const version = Number(versionResult[0]?.value || 0) + 1;
    const sectionReferences = new Map(sections.map(section => [section.id, section.publicReference]));
    const created = await this.db.transaction(async tx => {
      const [questionnaire] = await tx.insert(factFindingQuestionnaires).values({
        tenantId: tenant.id,
        templateId: template.id,
        questionnaireVersion: version,
        assignedReviewerAgencyUserId: input.assignedReviewerReference,
        dueAt: input.dueAt,
        createdByAgencyUserId: actor.agencyUserId,
      }).returning();
      await tx.insert(factFindingQuestionnaireQuestions).values(questions.map((question, index) => ({
        questionnaireId: questionnaire.id,
        tenantId: tenant.id,
        sourceTemplateQuestionId: question.id,
        sectionReference: sectionReferences.get(question.sectionId) || randomUUID(),
        questionKey: question.questionKey,
        label: question.label,
        guidance: question.guidance,
        questionType: question.questionType,
        fieldMapping: question.fieldMapping,
        included: true,
        required: question.required,
        systemRequired: question.systemRequired,
        evidenceRequired: question.evidenceRequired,
        publicUseAllowed: question.publicUseAllowed,
        bookingUseAllowed: question.bookingUseAllowed,
        generationUseAllowed: question.generationUseAllowed,
        agencyVerificationRequired: question.agencyVerificationRequired,
        conditionsJson: question.conditionsJson,
        validationJson: question.validationJson,
        optionsJson: question.optionsJson,
        displayOrder: index,
      })));
      if (input.participant) {
        await tx.insert(factFindingParticipants).values({
          questionnaireId: questionnaire.id,
          tenantId: tenant.id,
          displayName: input.participant.displayName,
          emailNormalized: input.participant.email.trim().toLowerCase(),
        });
      }
      return questionnaire;
    });
    await this.audit.write(actor, 'FACT_FINDING_QUESTIONNAIRE_CREATED', 'FACT_FINDING_QUESTIONNAIRE', created.publicReference, {
      tenantId: tenant.id,
      metadata: { templateReference: template.publicReference, questionnaireVersion: version, questionCount: questions.length },
    });
    return this.questionnaireDetail(created.publicReference);
  }

  async questionnaireDetail(questionnaireReference: string) {
    const [questionnaire] = await this.db.select({
      id: factFindingQuestionnaires.id,
      reference: factFindingQuestionnaires.publicReference,
      tenantReference: tenants.agencyReference,
      tenantName: tenants.name,
      version: factFindingQuestionnaires.questionnaireVersion,
      responseVersion: factFindingQuestionnaires.responseVersion,
      status: factFindingQuestionnaires.status,
      dueAt: factFindingQuestionnaires.dueAt,
      createdAt: factFindingQuestionnaires.createdAt,
      updatedAt: factFindingQuestionnaires.updatedAt,
    }).from(factFindingQuestionnaires)
      .innerJoin(tenants, eq(factFindingQuestionnaires.tenantId, tenants.id))
      .where(eq(factFindingQuestionnaires.publicReference, questionnaireReference)).limit(1);
    if (!questionnaire) throw fail(404, 'FACT_FINDING_QUESTIONNAIRE_NOT_FOUND', 'Questionnaire was not found.');
    const [questions, participants, responses, clarifications, uploads, briefs] = await Promise.all([
      this.db.select({
        reference: factFindingQuestionnaireQuestions.publicReference,
        sectionReference: factFindingQuestionnaireQuestions.sectionReference,
        key: factFindingQuestionnaireQuestions.questionKey,
        label: factFindingQuestionnaireQuestions.label,
        guidance: factFindingQuestionnaireQuestions.guidance,
        questionType: factFindingQuestionnaireQuestions.questionType,
        fieldMapping: factFindingQuestionnaireQuestions.fieldMapping,
        included: factFindingQuestionnaireQuestions.included,
        required: factFindingQuestionnaireQuestions.required,
        systemRequired: factFindingQuestionnaireQuestions.systemRequired,
        conditions: factFindingQuestionnaireQuestions.conditionsJson,
        displayOrder: factFindingQuestionnaireQuestions.displayOrder,
        prefilledAnswer: factFindingQuestionnaireQuestions.prefilledAnswerJson,
      }).from(factFindingQuestionnaireQuestions).where(eq(factFindingQuestionnaireQuestions.questionnaireId, questionnaire.id)).orderBy(asc(factFindingQuestionnaireQuestions.displayOrder)),
      this.db.select({ reference: factFindingParticipants.publicReference, displayName: factFindingParticipants.displayName, email: factFindingParticipants.emailNormalized, status: factFindingParticipants.status, lastAccessedAt: factFindingParticipants.lastAccessedAt }).from(factFindingParticipants).where(eq(factFindingParticipants.questionnaireId, questionnaire.id)),
      this.responses(questionnaireReference),
      this.db.select({ reference: factFindingClarifications.publicReference, status: factFindingClarifications.status, message: factFindingClarifications.agencyMessage, dueAt: factFindingClarifications.dueAt, createdAt: factFindingClarifications.createdAt }).from(factFindingClarifications).where(eq(factFindingClarifications.questionnaireId, questionnaire.id)).orderBy(desc(factFindingClarifications.createdAt)),
      this.db.select({ reference: factFindingUploads.publicReference, category: factFindingUploads.assetCategory, fileName: factFindingUploads.safeFilename, mimeType: factFindingUploads.mimeType, byteSize: factFindingUploads.byteSize, uploadStatus: factFindingUploads.uploadStatus, scanStatus: factFindingUploads.malwareScanStatus, reviewStatus: factFindingUploads.agencyReviewStatus, createdAt: factFindingUploads.createdAt }).from(factFindingUploads).where(eq(factFindingUploads.questionnaireId, questionnaire.id)).orderBy(desc(factFindingUploads.createdAt)),
      this.db.select({ reference: productionBriefs.publicReference, version: productionBriefs.briefVersion, status: productionBriefs.status, readiness: productionBriefs.readinessJson, createdAt: productionBriefs.createdAt }).from(productionBriefs).where(eq(productionBriefs.questionnaireId, questionnaire.id)).orderBy(desc(productionBriefs.briefVersion)),
    ]);
    return { ...questionnaire, questions, participants, responses, clarifications, uploads, briefs };
  }

  private async questionnaireContext(reference: string) {
    const [row] = await this.db.select({
      id: factFindingQuestionnaires.id,
      reference: factFindingQuestionnaires.publicReference,
      tenantId: factFindingQuestionnaires.tenantId,
      tenantReference: tenants.agencyReference,
      tenantName: tenants.name,
      tenantPrimaryColor: tenants.primaryColor,
      templateId: factFindingQuestionnaires.templateId,
      questionnaireVersion: factFindingQuestionnaires.questionnaireVersion,
      responseVersion: factFindingQuestionnaires.responseVersion,
      status: factFindingQuestionnaires.status,
      dueAt: factFindingQuestionnaires.dueAt,
    }).from(factFindingQuestionnaires)
      .innerJoin(tenants, eq(factFindingQuestionnaires.tenantId, tenants.id))
      .where(eq(factFindingQuestionnaires.publicReference, reference)).limit(1);
    if (!row) throw fail(404, 'FACT_FINDING_QUESTIONNAIRE_NOT_FOUND', 'Questionnaire was not found.');
    return row;
  }

  async prequalify(actor: AgencyActor, questionnaireReference: string, input: Prequalify) {
    const questionnaire = await this.questionnaireContext(questionnaireReference);
    if (questionnaire.status !== 'DRAFT') throw fail(409, 'FACT_FINDING_PREQUALIFICATION_LOCKED', 'Only a draft questionnaire can be prequalified.');
    const rows = await this.db.select().from(factFindingQuestionnaireQuestions)
      .where(eq(factFindingQuestionnaireQuestions.questionnaireId, questionnaire.id));
    const byReference = new Map(rows.map(row => [row.publicReference, row]));
    await this.db.transaction(async tx => {
      for (const override of input.questionOverrides) {
        const question = byReference.get(override.questionReference);
        if (!question) throw fail(404, 'FACT_FINDING_QUESTION_NOT_FOUND', 'A prequalification question was not found.');
        if (!override.included) assertQuestionCanBeRemoved({
          reference: question.publicReference,
          key: question.questionKey,
          label: question.label,
          guidance: question.guidance || undefined,
          questionType: question.questionType as never,
          fieldMapping: question.fieldMapping as never,
          required: question.required,
          systemRequired: question.systemRequired,
          evidenceRequired: question.evidenceRequired,
          publicUseAllowed: question.publicUseAllowed,
          bookingUseAllowed: question.bookingUseAllowed,
          generationUseAllowed: question.generationUseAllowed,
          agencyVerificationRequired: question.agencyVerificationRequired,
          conditions: question.conditionsJson as never,
          options: question.optionsJson as never,
          displayOrder: question.displayOrder,
        });
        await tx.update(factFindingQuestionnaireQuestions).set({
          included: override.included,
          required: question.systemRequired ? true : (override.required ?? question.required),
          guidance: override.guidance ?? question.guidance,
          prefilledAnswerJson: override.prefilledAnswer,
          conditionsJson: override.conditions ?? question.conditionsJson,
          updatedAt: new Date(),
        }).where(eq(factFindingQuestionnaireQuestions.id, question.id));
      }
      await tx.update(factFindingQuestionnaires).set({
        status: 'PREQUALIFIED',
        dueAt: input.dueAt ?? questionnaire.dueAt,
        prequalifiedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(factFindingQuestionnaires.id, questionnaire.id));
    });
    await this.audit.write(actor, 'FACT_FINDING_QUESTIONNAIRE_PREQUALIFIED', 'FACT_FINDING_QUESTIONNAIRE', questionnaire.reference, {
      tenantId: questionnaire.tenantId,
      metadata: { overrideCount: input.questionOverrides.length },
    });
    return this.questionnaireDetail(questionnaireReference);
  }

  async invite(actor: AgencyActor, questionnaireReference: string, participantReference?: string) {
    const questionnaire = await this.questionnaireContext(questionnaireReference);
    if (!['PREQUALIFIED', 'INVITED', 'IN_PROGRESS', 'CLARIFICATION_REQUIRED'].includes(questionnaire.status)) {
      throw fail(409, 'FACT_FINDING_INVITATION_STATUS_INVALID', 'Prequalify the questionnaire before inviting a participant.');
    }
    const conditions = [eq(factFindingParticipants.questionnaireId, questionnaire.id)];
    if (participantReference) conditions.push(eq(factFindingParticipants.publicReference, participantReference));
    const [participant] = await this.db.select().from(factFindingParticipants).where(and(...conditions)).orderBy(asc(factFindingParticipants.createdAt)).limit(1);
    if (!participant || participant.status === 'REVOKED') throw fail(404, 'FACT_FINDING_PARTICIPANT_NOT_FOUND', 'An active questionnaire participant was not found.');
    const invitationReference = randomUUID();
    const invitationToken = deriveFactFindingInvitationToken({
      invitationReference,
      questionnaireReference: questionnaire.reference,
      participantReference: participant.publicReference,
      secret: this.invitationSecret(),
    });
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1_000);
    const now = new Date();
    const invitation = await this.db.transaction(async tx => {
      await tx.update(factFindingInvitations).set({ status: 'REVOKED', revokedAt: now })
        .where(and(eq(factFindingInvitations.questionnaireId, questionnaire.id), eq(factFindingInvitations.participantId, participant.id), inArray(factFindingInvitations.status, ['PENDING', 'SENT', 'ACCEPTED'])));
      const [created] = await tx.insert(factFindingInvitations).values({
        publicReference: invitationReference,
        questionnaireId: questionnaire.id,
        tenantId: questionnaire.tenantId,
        participantId: participant.id,
        questionnaireVersion: questionnaire.questionnaireVersion,
        tokenDigestSha256: digestFactFindingToken(invitationToken),
        expiresAt,
        createdByAgencyUserId: actor.agencyUserId,
      }).returning();
      const templateData = {
        tenantName: questionnaire.tenantName,
        tenantPrimaryColor: questionnaire.tenantPrimaryColor,
        participantName: participant.displayName,
        invitationReference,
        questionnaireReference: questionnaire.reference,
        participantReference: participant.publicReference,
        questionnaireVersion: questionnaire.questionnaireVersion,
        expiresAt: expiresAt.toISOString(),
      };
      await tx.insert(emailOutbox).values({
        tenantId: questionnaire.tenantId,
        recipientEmail: participant.emailNormalized,
        recipientName: participant.displayName,
        templateKey: 'fact-finding-invitation',
        templateVersion: '1.0.0',
        templateDataJson: templateData,
        idempotencyKey: `fact-finding:${questionnaire.reference}:${questionnaire.questionnaireVersion}:${participant.publicReference}:invitation`,
        relatedEntityType: 'fact_finding_invitation',
        relatedEntityId: created.id,
      }).onConflictDoNothing({ target: emailOutbox.idempotencyKey });
      await tx.insert(emailOutbox).values({
        tenantId: questionnaire.tenantId,
        recipientEmail: participant.emailNormalized,
        recipientName: participant.displayName,
        templateKey: 'fact-finding-notification',
        templateVersion: '1.0.0',
        templateDataJson: { ...templateData, heading: 'Your business questionnaire is still open', message: 'Please complete the remaining sections before the due date.' },
        idempotencyKey: `fact-finding:${questionnaire.reference}:${questionnaire.questionnaireVersion}:${participant.publicReference}:reminder`,
        relatedEntityType: 'fact_finding_invitation',
        relatedEntityId: created.id,
        scheduledFor: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
        nextAttemptAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
      }).onConflictDoNothing({ target: emailOutbox.idempotencyKey });
      await tx.update(factFindingParticipants).set({ status: 'INVITED', invitedAt: now }).where(eq(factFindingParticipants.id, participant.id));
      await tx.update(factFindingQuestionnaires).set({ status: 'INVITED', invitedAt: now, updatedAt: now }).where(eq(factFindingQuestionnaires.id, questionnaire.id));
      return created;
    });
    await this.audit.write(actor, 'FACT_FINDING_INVITATION_SENT', 'FACT_FINDING_INVITATION', invitation.publicReference, {
      tenantId: questionnaire.tenantId,
      metadata: { questionnaireReference: questionnaire.reference, participantReference: participant.publicReference },
    });
    return { reference: invitation.publicReference, status: invitation.status, expiresAt };
  }

  async responses(questionnaireReference: string) {
    const questionnaire = await this.questionnaireContext(questionnaireReference);
    return this.db.select({
      reference: factFindingResponses.publicReference,
      questionReference: factFindingQuestionnaireQuestions.publicReference,
      fieldMapping: factFindingResponses.fieldMapping,
      answer: factFindingResponses.answerJson,
      source: factFindingResponses.source,
      status: factFindingResponses.status,
      responseVersion: factFindingResponses.responseVersion,
      publicUseEligible: factFindingResponses.publicUseEligible,
      bookingUseEligible: factFindingResponses.bookingUseEligible,
      generationUseEligible: factFindingResponses.generationUseEligible,
      approvedValue: factFindingResponses.approvedValueJson,
      submittedAt: factFindingResponses.submittedAt,
      approvedAt: factFindingResponses.approvedAt,
      updatedAt: factFindingResponses.updatedAt,
    }).from(factFindingResponses)
      .innerJoin(factFindingQuestionnaireQuestions, eq(factFindingResponses.questionId, factFindingQuestionnaireQuestions.id))
      .where(eq(factFindingResponses.questionnaireId, questionnaire.id))
      .orderBy(asc(factFindingQuestionnaireQuestions.displayOrder));
  }

  private async responseContext(reference: string) {
    const [row] = await this.db.select({
      response: factFindingResponses,
      question: factFindingQuestionnaireQuestions,
      questionnaire: factFindingQuestionnaires,
    }).from(factFindingResponses)
      .innerJoin(factFindingQuestionnaireQuestions, eq(factFindingResponses.questionId, factFindingQuestionnaireQuestions.id))
      .innerJoin(factFindingQuestionnaires, eq(factFindingResponses.questionnaireId, factFindingQuestionnaires.id))
      .where(eq(factFindingResponses.publicReference, reference)).limit(1);
    if (!row) throw fail(404, 'FACT_FINDING_RESPONSE_NOT_FOUND', 'Questionnaire response was not found.');
    return row;
  }

  async approveResponse(actor: AgencyActor, responseReference: string, input: z.infer<typeof AgencyFactDecisionSchema>) {
    const context = await this.responseContext(responseReference);
    if (!['SUBMITTED', 'AGENCY_REVIEW_REQUIRED', 'CLARIFICATION_REQUIRED', 'CLIENT_CONFIRMED'].includes(context.response.status)) {
      throw fail(409, 'FACT_FINDING_RESPONSE_NOT_REVIEWABLE', 'The response is not ready for agency approval.');
    }
    const approvedValue = safeAnswer(input.approvedValue ?? context.response.answerJson);
    const [updated] = await this.db.update(factFindingResponses).set({
      status: 'AGENCY_APPROVED',
      agencyReviewerId: actor.agencyUserId,
      approvedValueJson: approvedValue,
      publicUseEligible: context.question.publicUseAllowed && input.publicUseEligible,
      bookingUseEligible: context.question.bookingUseAllowed && input.bookingUseEligible,
      generationUseEligible: context.question.generationUseAllowed && input.generationUseEligible,
      rejectionReason: null,
      approvedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(factFindingResponses.id, context.response.id)).returning();
    await this.audit.write(actor, 'FACT_FINDING_FACT_APPROVED', 'FACT_FINDING_RESPONSE', updated.publicReference, {
      tenantId: context.questionnaire.tenantId,
      metadata: { fieldMapping: updated.fieldMapping, publicUseEligible: updated.publicUseEligible, bookingUseEligible: updated.bookingUseEligible, generationUseEligible: updated.generationUseEligible },
    });
    return { reference: updated.publicReference, status: updated.status, approvedAt: updated.approvedAt };
  }

  async rejectResponse(actor: AgencyActor, responseReference: string, input: z.infer<typeof RejectFactResponseSchema>) {
    const context = await this.responseContext(responseReference);
    const [updated] = await this.db.update(factFindingResponses).set({
      status: 'AGENCY_REJECTED',
      agencyReviewerId: actor.agencyUserId,
      approvedValueJson: null,
      publicUseEligible: false,
      bookingUseEligible: false,
      generationUseEligible: false,
      rejectionReason: input.reason,
      updatedAt: new Date(),
    }).where(eq(factFindingResponses.id, context.response.id)).returning();
    await this.audit.write(actor, 'FACT_FINDING_FACT_REJECTED', 'FACT_FINDING_RESPONSE', updated.publicReference, {
      tenantId: context.questionnaire.tenantId,
      metadata: { fieldMapping: updated.fieldMapping },
    });
    return { reference: updated.publicReference, status: updated.status };
  }

  async requestClarification(actor: AgencyActor, responseReference: string, input: z.infer<typeof RequestClarificationSchema>) {
    const context = await this.responseContext(responseReference);
    const clarification = await this.db.transaction(async tx => {
      const [created] = await tx.insert(factFindingClarifications).values({
        questionnaireId: context.questionnaire.id,
        tenantId: context.questionnaire.tenantId,
        responseId: context.response.id,
        questionId: context.question.id,
        requestedByAgencyUserId: actor.agencyUserId,
        agencyMessage: input.message,
        requiredResponseType: input.requiredResponseType,
        evidenceRequested: input.evidenceRequested,
        dueAt: input.dueAt,
      }).returning();
      await tx.update(factFindingResponses).set({ status: 'CLARIFICATION_REQUIRED', updatedAt: new Date() }).where(eq(factFindingResponses.id, context.response.id));
      await tx.update(factFindingQuestionnaires).set({ status: 'CLARIFICATION_REQUIRED', updatedAt: new Date() }).where(eq(factFindingQuestionnaires.id, context.questionnaire.id));
      return created;
    });
    await this.audit.write(actor, 'FACT_FINDING_CLARIFICATION_REQUESTED', 'FACT_FINDING_CLARIFICATION', clarification.publicReference, {
      tenantId: context.questionnaire.tenantId,
      metadata: { responseReference: context.response.publicReference, questionReference: context.question.publicReference, evidenceRequested: input.evidenceRequested },
    });
    return { reference: clarification.publicReference, status: clarification.status, dueAt: clarification.dueAt };
  }

  private async readinessSignals(questionnaireId: string) {
    const [questions, responses, uploads, clarifications] = await Promise.all([
      this.db.select().from(factFindingQuestionnaireQuestions).where(and(eq(factFindingQuestionnaireQuestions.questionnaireId, questionnaireId), eq(factFindingQuestionnaireQuestions.included, true))),
      this.db.select().from(factFindingResponses).where(eq(factFindingResponses.questionnaireId, questionnaireId)),
      this.db.select().from(factFindingUploads).where(eq(factFindingUploads.questionnaireId, questionnaireId)),
      this.db.select().from(factFindingClarifications).where(and(eq(factFindingClarifications.questionnaireId, questionnaireId), inArray(factFindingClarifications.status, ['OPEN', 'CLIENT_RESPONDED']))),
    ]);
    const approved = responses.filter(response => response.status === 'AGENCY_APPROVED');
    const mappings = new Map<string, unknown[]>();
    for (const response of approved) {
      if (response.fieldMapping) (mappings.get(response.fieldMapping) || (mappings.set(response.fieldMapping, []), mappings.get(response.fieldMapping)!)).push(response.approvedValueJson);
    }
    const has = (mapping: string) => (mappings.get(mapping)?.length || 0) > 0;
    const requiredUploadQuestions = questions.filter(question => question.required && ['FILE_UPLOAD', 'IMAGE_UPLOAD'].includes(question.questionType));
    const approvedUploads = uploads.filter(upload => upload.uploadStatus === 'UPLOADED' && upload.agencyReviewStatus === 'APPROVED' && !['INFECTED', 'FAILED'].includes(upload.malwareScanStatus));
    return evaluateProductionBriefReadiness({
      legalBusinessName: has('BUSINESS.LEGAL_NAME'),
      tradingName: has('BUSINESS.TRADING_NAME'),
      publicContact: has('BUSINESS.PUBLIC_PHONE') || has('BUSINESS.PUBLIC_EMAIL'),
      validLocation: has('LOCATION.NAME') && has('LOCATION.ADDRESS'),
      validRemoteServiceConfiguration: has('LOCATION.SERVICE_AREA'),
      bookableServiceCount: mappings.get('SERVICE.NAME')?.length || 0,
      invalidServiceDurationCount: has('SERVICE.NAME') && !has('SERVICE.DURATION') ? 1 : 0,
      invalidServicePriceCount: has('SERVICE.NAME') && !has('SERVICE.PRICE') ? 1 : 0,
      staffRequired: has('STAFF.NAME'),
      eligibleStaffCount: mappings.get('STAFF.NAME')?.length || 0,
      validAvailability: has('LOCATION.OPENING_HOURS') || has('STAFF.AVAILABILITY'),
      bookingPolicyPresent: has('BOOKING.CANCELLATION_POLICY') || has('BOOKING.MINIMUM_NOTICE'),
      requiredFormsPresent: !questions.some(question => question.required && question.fieldMapping === 'SERVICE.INTAKE_REQUIREMENTS') || has('SERVICE.INTAKE_REQUIREMENTS'),
      unverifiedCredentialCount: responses.filter(response => response.fieldMapping === 'STAFF.CREDENTIALS' && response.status !== 'AGENCY_APPROVED').length,
      unverifiedTestimonialCount: responses.filter(response => response.fieldMapping === 'CONTENT.TESTIMONIAL' && response.status !== 'AGENCY_APPROVED').length,
      unverifiedResultCount: responses.filter(response => response.fieldMapping === 'CONTENT.RESULT' && response.status !== 'AGENCY_APPROVED').length,
      brandDirectionPresent: has('BRAND.VISUAL_DIRECTION') || has('BRAND.TONE'),
      requiredAssetMissingCount: Math.max(0, requiredUploadQuestions.length - approvedUploads.length),
      optionalAssetMissingCount: approvedUploads.length === 0 ? 1 : 0,
      unresolvedClarificationCount: clarifications.length,
      unapprovedPublicFactCount: questions.filter(question => question.publicUseAllowed && question.fieldMapping && !approved.some(response => response.questionId === question.id && response.publicUseEligible)).length,
      unsafeUploadCount: uploads.filter(upload => upload.uploadStatus === 'QUARANTINED' || upload.malwareScanStatus === 'INFECTED').length,
      approvedFactCount: approved.length,
      unverifiedFactCount: responses.filter(response => !['AGENCY_APPROVED', 'AGENCY_REJECTED', 'SUPERSEDED', 'NOT_APPLICABLE'].includes(response.status)).length,
      answeredQuestionCount: responses.length,
      visibleQuestionCount: questions.length,
    });
  }

  async buildBrief(actor: AgencyActor, questionnaireReference: string, input: z.infer<typeof BuildProductionBriefSchema>) {
    const questionnaire = await this.questionnaireContext(questionnaireReference);
    if (!['SUBMITTED', 'AGENCY_REVIEW', 'CLARIFICATION_REQUIRED', 'APPROVED'].includes(questionnaire.status)) {
      throw fail(409, 'PRODUCTION_BRIEF_SOURCE_NOT_READY', 'Submit the questionnaire before building a production brief.');
    }
    const responseConditions = [
      eq(factFindingResponses.questionnaireId, questionnaire.id),
      eq(factFindingResponses.status, 'AGENCY_APPROVED'),
    ];
    if (input.includeResponseReferences?.length) responseConditions.push(inArray(factFindingResponses.publicReference, input.includeResponseReferences));
    const [responses, uploads, versionRows, readiness] = await Promise.all([
      this.db.select().from(factFindingResponses).where(and(...responseConditions)).orderBy(asc(factFindingResponses.createdAt)),
      this.db.select().from(factFindingUploads).where(and(
        eq(factFindingUploads.questionnaireId, questionnaire.id),
        eq(factFindingUploads.uploadStatus, 'UPLOADED'),
        eq(factFindingUploads.agencyReviewStatus, 'APPROVED'),
        inArray(factFindingUploads.malwareScanStatus, ['NOT_AVAILABLE', 'CLEAN']),
      )),
      this.db.select({ value: sql<number>`coalesce(max(${productionBriefs.briefVersion}), 0)::int` }).from(productionBriefs).where(eq(productionBriefs.questionnaireId, questionnaire.id)),
      this.readinessSignals(questionnaire.id),
    ]);
    const facts = responses.flatMap(response => {
      const mapping = FactFieldMappingSchema.safeParse(response.fieldMapping);
      if (!mapping.success || response.approvedValueJson === null || !response.agencyReviewerId || !response.approvedAt) return [];
      return [{
        responseReference: response.publicReference,
        questionnaireReference: questionnaire.reference,
        questionReference: response.questionId,
        mapping: mapping.data,
        approvedValue: response.approvedValueJson,
        valueDigestSha256: digest(response.approvedValueJson),
        submittedByReference: response.participantId,
        submittedAt: (response.submittedAt || response.updatedAt).toISOString(),
        reviewedByReference: response.agencyReviewerId,
        approvedAt: response.approvedAt.toISOString(),
        publicUseEligible: response.publicUseEligible,
        bookingUseEligible: response.bookingUseEligible,
        generationUseEligible: response.generationUseEligible,
      }];
    });
    const assets = uploads.map(upload => ({
      assetReference: upload.publicReference,
      category: upload.assetCategory,
      digestSha256: upload.digestSha256,
      publicUsePermission: upload.publicUsePermission,
      aiUsePermission: upload.aiUsePermission,
      consentStatus: upload.consentStatus,
      agencyReviewStatus: 'APPROVED' as const,
    }));
    const built = buildProductionBriefData({ facts, assets });
    const briefVersion = Number(versionRows[0]?.value || 0) + 1;
    const approvedFactSetDigestSha256 = digest(facts.map(fact => [fact.responseReference, fact.valueDigestSha256]));
    const approvedAssetSetDigestSha256 = digest(assets.map(asset => [asset.assetReference, asset.digestSha256]));
    const brief = await this.db.transaction(async tx => {
      await tx.update(productionBriefs).set({ status: 'SUPERSEDED', supersededAt: new Date(), updatedAt: new Date() })
        .where(and(eq(productionBriefs.questionnaireId, questionnaire.id), inArray(productionBriefs.status, ['DRAFT', 'BUILDING', 'REVIEW_REQUIRED'])));
      const [created] = await tx.insert(productionBriefs).values({
        tenantId: questionnaire.tenantId,
        questionnaireId: questionnaire.id,
        questionnaireVersion: questionnaire.questionnaireVersion,
        responseVersion: questionnaire.responseVersion || 1,
        briefVersion,
        status: 'REVIEW_REQUIRED',
        briefJson: built.data,
        readinessJson: readiness,
        contentDigestSha256: built.contentDigestSha256,
        approvedFactSetDigestSha256,
        approvedAssetSetDigestSha256,
        createdByAgencyUserId: actor.agencyUserId,
      }).returning();
      if (facts.length) await tx.insert(productionBriefFacts).values(facts.map(fact => {
        const response = responses.find(row => row.publicReference === fact.responseReference)!;
        return {
          productionBriefId: created.id,
          tenantId: questionnaire.tenantId,
          sourceQuestionnaireId: questionnaire.id,
          sourceQuestionId: response.questionId,
          sourceResponseId: response.id,
          sourceResponseVersion: response.responseVersion,
          fieldMapping: fact.mapping,
          approvedValueJson: fact.approvedValue,
          valueDigestSha256: fact.valueDigestSha256,
          submittedByParticipantId: response.participantId,
          submittedAt: response.submittedAt || response.updatedAt,
          reviewedByAgencyUserId: response.agencyReviewerId!,
          publicUseEligible: response.publicUseEligible,
          bookingUseEligible: response.bookingUseEligible,
          generationUseEligible: response.generationUseEligible,
          approvedAt: response.approvedAt!,
        };
      }));
      await tx.update(factFindingQuestionnaires).set({ status: 'AGENCY_REVIEW', updatedAt: new Date() }).where(eq(factFindingQuestionnaires.id, questionnaire.id));
      return created;
    });
    await this.audit.write(actor, 'PRODUCTION_BRIEF_CREATED', 'PRODUCTION_BRIEF', brief.publicReference, {
      tenantId: questionnaire.tenantId,
      metadata: { questionnaireReference, briefVersion, approvedFactCount: facts.length, approvedAssetCount: assets.length, readyForProvisioning: readiness.readyForProvisioning },
    });
    return this.brief(brief.publicReference);
  }

  async brief(reference: string) {
    const [brief] = await this.db.select({
      reference: productionBriefs.publicReference,
      tenantReference: tenants.agencyReference,
      questionnaireReference: factFindingQuestionnaires.publicReference,
      questionnaireVersion: productionBriefs.questionnaireVersion,
      responseVersion: productionBriefs.responseVersion,
      version: productionBriefs.briefVersion,
      status: productionBriefs.status,
      brief: productionBriefs.briefJson,
      readiness: productionBriefs.readinessJson,
      contentDigestSha256: productionBriefs.contentDigestSha256,
      approvedFactSetDigestSha256: productionBriefs.approvedFactSetDigestSha256,
      approvedAssetSetDigestSha256: productionBriefs.approvedAssetSetDigestSha256,
      approvedAt: productionBriefs.approvedAt,
      lockedAt: productionBriefs.lockedAt,
      createdAt: productionBriefs.createdAt,
    }).from(productionBriefs)
      .innerJoin(tenants, eq(productionBriefs.tenantId, tenants.id))
      .innerJoin(factFindingQuestionnaires, eq(productionBriefs.questionnaireId, factFindingQuestionnaires.id))
      .where(eq(productionBriefs.publicReference, reference)).limit(1);
    if (!brief) throw fail(404, 'PRODUCTION_BRIEF_NOT_FOUND', 'Production brief was not found.');
    return brief;
  }

  async approveBrief(actor: AgencyActor, reference: string) {
    const current = await this.brief(reference);
    const readiness = current.readiness as { readyForProvisioning?: boolean };
    if (!readiness.readyForProvisioning) throw fail(409, 'PRODUCTION_BRIEF_NOT_READY', 'Resolve every production-brief blocker before approval.');
    const [updated] = await this.db.update(productionBriefs).set({
      status: 'APPROVED',
      approvedByAgencyUserId: actor.agencyUserId,
      approvedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(eq(productionBriefs.publicReference, reference), eq(productionBriefs.status, 'REVIEW_REQUIRED'))).returning();
    if (!updated) throw fail(409, 'PRODUCTION_BRIEF_NOT_APPROVABLE', 'Only a review-required brief can be approved.');
    await this.audit.write(actor, 'PRODUCTION_BRIEF_APPROVED', 'PRODUCTION_BRIEF', reference, { tenantId: updated.tenantId, metadata: { briefVersion: updated.briefVersion } });
    return this.brief(reference);
  }

  async lockBrief(actor: AgencyActor, reference: string) {
    const [updated] = await this.db.update(productionBriefs).set({
      status: 'LOCKED_FOR_PROVISIONING',
      lockedByAgencyUserId: actor.agencyUserId,
      lockedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(eq(productionBriefs.publicReference, reference), eq(productionBriefs.status, 'APPROVED'))).returning();
    if (!updated) throw fail(409, 'PRODUCTION_BRIEF_NOT_LOCKABLE', 'Approve the production brief before locking it.');
    await this.audit.write(actor, 'PRODUCTION_BRIEF_LOCKED', 'PRODUCTION_BRIEF', reference, { tenantId: updated.tenantId, metadata: { briefVersion: updated.briefVersion } });
    return this.brief(reference);
  }

  async reviewUpload(actor: AgencyActor, uploadReference: string, decision: 'APPROVED' | 'REJECTED') {
    const [upload] = await this.db.update(factFindingUploads).set({
      agencyReviewStatus: decision,
      reviewedByAgencyUserId: actor.agencyUserId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(factFindingUploads.publicReference, uploadReference),
      eq(factFindingUploads.uploadStatus, 'UPLOADED'),
      inArray(factFindingUploads.malwareScanStatus, ['NOT_AVAILABLE', 'CLEAN']),
    )).returning();
    if (!upload) throw fail(409, 'FACT_FINDING_UPLOAD_NOT_REVIEWABLE', 'Only a safe completed upload can be reviewed.');
    await this.audit.write(actor, decision === 'APPROVED' ? 'FACT_FINDING_ASSET_APPROVED' : 'FACT_FINDING_ASSET_REJECTED', 'FACT_FINDING_UPLOAD', upload.publicReference, { tenantId: upload.tenantId, metadata: { category: upload.assetCategory } });
    return { reference: upload.publicReference, reviewStatus: upload.agencyReviewStatus };
  }

  async exchangeSession(invitationToken: string) {
    const parsed = verifyFactFindingInvitationToken(invitationToken, this.invitationSecret());
    if (!parsed) throw fail(401, 'FACT_FINDING_INVITATION_INVALID', 'The questionnaire invitation is invalid.');
    const tokenDigest = digestFactFindingToken(invitationToken);
    const [row] = await this.db.select({
      invitation: factFindingInvitations,
      questionnaire: factFindingQuestionnaires,
      participant: factFindingParticipants,
      tenantReference: tenants.agencyReference,
    }).from(factFindingInvitations)
      .innerJoin(factFindingQuestionnaires, eq(factFindingInvitations.questionnaireId, factFindingQuestionnaires.id))
      .innerJoin(factFindingParticipants, eq(factFindingInvitations.participantId, factFindingParticipants.id))
      .innerJoin(tenants, eq(factFindingInvitations.tenantId, tenants.id))
      .where(and(
        eq(factFindingInvitations.tokenDigestSha256, tokenDigest),
        eq(factFindingInvitations.publicReference, parsed.invitationReference),
        eq(factFindingQuestionnaires.publicReference, parsed.questionnaireReference),
        eq(factFindingParticipants.publicReference, parsed.participantReference),
        inArray(factFindingInvitations.status, ['PENDING', 'SENT', 'ACCEPTED']),
        inArray(factFindingQuestionnaires.status, ['INVITED', 'IN_PROGRESS', 'CLARIFICATION_REQUIRED']),
        inArray(factFindingParticipants.status, ['INVITED', 'ACTIVE']),
      )).limit(1);
    if (!row || row.invitation.expiresAt.getTime() <= Date.now()) throw fail(401, 'FACT_FINDING_INVITATION_EXPIRED', 'The questionnaire invitation has expired or was revoked.');
    const sessionToken = createFactFindingToken();
    const expiresAt = new Date(Math.min(Date.now() + 60 * 60 * 1_000, row.invitation.expiresAt.getTime()));
    const now = new Date();
    const [session] = await this.db.transaction(async tx => {
      const created = await tx.insert(factFindingSessions).values({
        questionnaireId: row.questionnaire.id,
        tenantId: row.questionnaire.tenantId,
        participantId: row.participant.id,
        invitationId: row.invitation.id,
        tokenDigestSha256: digestFactFindingToken(sessionToken),
        expiresAt,
      }).returning();
      await tx.update(factFindingInvitations).set({ status: 'ACCEPTED', acceptedAt: row.invitation.acceptedAt || now }).where(eq(factFindingInvitations.id, row.invitation.id));
      await tx.update(factFindingParticipants).set({ status: 'ACTIVE', acceptedAt: row.participant.acceptedAt || now, lastAccessedAt: now }).where(eq(factFindingParticipants.id, row.participant.id));
      await tx.update(factFindingQuestionnaires).set({ status: row.questionnaire.status === 'INVITED' ? 'IN_PROGRESS' : row.questionnaire.status, updatedAt: now }).where(eq(factFindingQuestionnaires.id, row.questionnaire.id));
      return created;
    });
    return { sessionToken, sessionReference: session.publicReference, questionnaireReference: row.questionnaire.publicReference, expiresAt };
  }

  async sessionContext(sessionToken: string): Promise<FactFindingSessionContext> {
    if (!sessionToken || sessionToken.length < 32) throw fail(401, 'FACT_FINDING_SESSION_REQUIRED', 'A questionnaire session is required.');
    const [row] = await this.db.select({
      sessionId: factFindingSessions.id,
      sessionReference: factFindingSessions.publicReference,
      questionnaireId: factFindingSessions.questionnaireId,
      questionnaireReference: factFindingQuestionnaires.publicReference,
      tenantId: factFindingSessions.tenantId,
      tenantReference: tenants.agencyReference,
      participantId: factFindingSessions.participantId,
      participantReference: factFindingParticipants.publicReference,
      expiresAt: factFindingSessions.expiresAt,
    }).from(factFindingSessions)
      .innerJoin(factFindingQuestionnaires, eq(factFindingSessions.questionnaireId, factFindingQuestionnaires.id))
      .innerJoin(factFindingParticipants, eq(factFindingSessions.participantId, factFindingParticipants.id))
      .innerJoin(tenants, eq(factFindingSessions.tenantId, tenants.id))
      .where(and(
        eq(factFindingSessions.tokenDigestSha256, digestFactFindingToken(sessionToken)),
        isNull(factFindingSessions.revokedAt),
        inArray(factFindingQuestionnaires.status, ['IN_PROGRESS', 'CLARIFICATION_REQUIRED']),
        eq(factFindingParticipants.status, 'ACTIVE'),
      )).limit(1);
    if (!row || row.expiresAt.getTime() <= Date.now()) throw fail(401, 'FACT_FINDING_SESSION_EXPIRED', 'The questionnaire session expired or was revoked.');
    await this.db.update(factFindingSessions).set({ lastAccessedAt: new Date() }).where(eq(factFindingSessions.id, row.sessionId));
    return row;
  }

  async clientQuestionnaire(session: FactFindingSessionContext) {
    const [questionnaire, questions, responses, clarifications] = await Promise.all([
      this.questionnaireContext(session.questionnaireReference),
      this.db.select({
        reference: factFindingQuestionnaireQuestions.publicReference,
        sectionReference: factFindingQuestionnaireQuestions.sectionReference,
        key: factFindingQuestionnaireQuestions.questionKey,
        label: factFindingQuestionnaireQuestions.label,
        guidance: factFindingQuestionnaireQuestions.guidance,
        questionType: factFindingQuestionnaireQuestions.questionType,
        required: factFindingQuestionnaireQuestions.required,
        conditions: factFindingQuestionnaireQuestions.conditionsJson,
        options: factFindingQuestionnaireQuestions.optionsJson,
        displayOrder: factFindingQuestionnaireQuestions.displayOrder,
      }).from(factFindingQuestionnaireQuestions).where(and(eq(factFindingQuestionnaireQuestions.questionnaireId, session.questionnaireId), eq(factFindingQuestionnaireQuestions.included, true))).orderBy(asc(factFindingQuestionnaireQuestions.displayOrder)),
      this.db.select({ reference: factFindingResponses.publicReference, questionReference: factFindingQuestionnaireQuestions.publicReference, answer: factFindingResponses.answerJson, status: factFindingResponses.status, approvedValue: factFindingResponses.approvedValueJson, updatedAt: factFindingResponses.updatedAt }).from(factFindingResponses).innerJoin(factFindingQuestionnaireQuestions, eq(factFindingResponses.questionId, factFindingQuestionnaireQuestions.id)).where(eq(factFindingResponses.questionnaireId, session.questionnaireId)),
      this.db.select({ reference: factFindingClarifications.publicReference, questionReference: factFindingQuestionnaireQuestions.publicReference, message: factFindingClarifications.agencyMessage, requiredResponseType: factFindingClarifications.requiredResponseType, evidenceRequested: factFindingClarifications.evidenceRequested, dueAt: factFindingClarifications.dueAt, status: factFindingClarifications.status }).from(factFindingClarifications).innerJoin(factFindingQuestionnaireQuestions, eq(factFindingClarifications.questionId, factFindingQuestionnaireQuestions.id)).where(and(eq(factFindingClarifications.questionnaireId, session.questionnaireId), inArray(factFindingClarifications.status, ['OPEN', 'CLIENT_RESPONDED']))),
    ]);
    const responseMap = new Map(responses.map(response => [response.questionReference, { status: response.status as never, answer: response.answer }]));
    const completion = completionForQuestions(questions.map(question => ({
      ...question,
      fieldMapping: undefined,
      systemRequired: false,
      evidenceRequired: false,
      publicUseAllowed: false,
      bookingUseAllowed: false,
      generationUseAllowed: false,
      agencyVerificationRequired: false,
    })) as never, responseMap);
    return toClientSafeFactFindingDto({
      reference: questionnaire.reference,
      tenantName: questionnaire.tenantName,
      version: questionnaire.questionnaireVersion,
      status: questionnaire.status,
      dueAt: questionnaire.dueAt,
      questions,
      responses,
      clarifications,
      completion,
    });
  }

  async saveClientResponse(session: FactFindingSessionContext, input: SaveResponse) {
    const [question] = await this.db.select().from(factFindingQuestionnaireQuestions).where(and(
      eq(factFindingQuestionnaireQuestions.questionnaireId, session.questionnaireId),
      eq(factFindingQuestionnaireQuestions.publicReference, input.questionReference),
      eq(factFindingQuestionnaireQuestions.included, true),
    )).limit(1);
    if (!question) throw fail(404, 'FACT_FINDING_QUESTION_NOT_FOUND', 'Question is outside this questionnaire.');
    const questionnaire = await this.questionnaireContext(session.questionnaireReference);
    assertClientCanSaveResponse({
      questionnaireStatus: questionnaire.status,
      question: {
        reference: question.publicReference,
        key: question.questionKey,
        label: question.label,
        guidance: question.guidance || undefined,
        questionType: question.questionType as never,
        fieldMapping: question.fieldMapping as never,
        required: question.required,
        systemRequired: question.systemRequired,
        evidenceRequired: question.evidenceRequired,
        publicUseAllowed: question.publicUseAllowed,
        bookingUseAllowed: question.bookingUseAllowed,
        generationUseAllowed: question.generationUseAllowed,
        agencyVerificationRequired: question.agencyVerificationRequired,
        conditions: question.conditionsJson as never,
        options: question.optionsJson as never,
        displayOrder: question.displayOrder,
      },
      answer: input.answer,
    });
    const answer = safeAnswer(input.answer);
    const now = new Date();
    const [existing] = await this.db.select().from(factFindingResponses).where(and(eq(factFindingResponses.questionnaireId, session.questionnaireId), eq(factFindingResponses.questionId, question.id))).limit(1);
    const response = await this.db.transaction(async tx => {
      if (existing) {
        const nextVersion = existing.responseVersion + 1;
        const [updated] = await tx.update(factFindingResponses).set({
          participantId: session.participantId,
          answerJson: answer,
          answerType: question.questionType,
          source: 'CLIENT_PROVIDED',
          valueDigestSha256: digest(answer),
          status: input.clientConfirmed ? 'CLIENT_CONFIRMED' : 'ANSWERED',
          responseVersion: nextVersion,
          agencyReviewerId: null,
          approvedValueJson: null,
          publicUseEligible: false,
          bookingUseEligible: false,
          generationUseEligible: false,
          approvedAt: null,
          rejectionReason: null,
          updatedAt: now,
        }).where(eq(factFindingResponses.id, existing.id)).returning();
        await tx.insert(factFindingResponseVersions).values({
          responseId: updated.id,
          questionnaireId: session.questionnaireId,
          tenantId: session.tenantId,
          participantId: session.participantId,
          responseVersion: nextVersion,
          answerJson: answer,
          source: 'CLIENT_PROVIDED',
          valueDigestSha256: updated.valueDigestSha256,
          status: updated.status,
        });
        return updated;
      }
      const [created] = await tx.insert(factFindingResponses).values({
        questionnaireId: session.questionnaireId,
        tenantId: session.tenantId,
        questionId: question.id,
        participantId: session.participantId,
        fieldMapping: question.fieldMapping,
        answerType: question.questionType,
        answerJson: answer,
        source: 'CLIENT_PROVIDED',
        valueDigestSha256: digest(answer),
        status: input.clientConfirmed ? 'CLIENT_CONFIRMED' : 'ANSWERED',
        evidenceRequired: question.evidenceRequired,
      }).returning();
      await tx.insert(factFindingResponseVersions).values({
        responseId: created.id,
        questionnaireId: session.questionnaireId,
        tenantId: session.tenantId,
        participantId: session.participantId,
        responseVersion: 1,
        answerJson: answer,
        source: 'CLIENT_PROVIDED',
        valueDigestSha256: created.valueDigestSha256,
        status: created.status,
      });
      return created;
    });
    await this.audit.write(null, 'FACT_FINDING_RESPONSE_SAVED', 'FACT_FINDING_RESPONSE', response.publicReference, {
      tenantId: session.tenantId,
      metadata: { questionnaireReference: session.questionnaireReference, questionReference: question.publicReference, source: 'CLIENT_PROVIDED', responseVersion: response.responseVersion },
      sourceComponent: 'fact-finding-client-api',
    });
    return { reference: response.publicReference, status: response.status, responseVersion: response.responseVersion, updatedAt: response.updatedAt };
  }

  async submit(session: FactFindingSessionContext) {
    const [questions, responses] = await Promise.all([
      this.db.select().from(factFindingQuestionnaireQuestions).where(and(eq(factFindingQuestionnaireQuestions.questionnaireId, session.questionnaireId), eq(factFindingQuestionnaireQuestions.included, true))).orderBy(asc(factFindingQuestionnaireQuestions.displayOrder)),
      this.db.select().from(factFindingResponses).where(eq(factFindingResponses.questionnaireId, session.questionnaireId)),
    ]);
    const responseMap = new Map(responses.map(response => [questions.find(question => question.id === response.questionId)?.publicReference || '', { status: response.status as never, answer: response.answerJson }]));
    const completion = completionForQuestions(questions.map(question => ({
      reference: question.publicReference,
      key: question.questionKey,
      label: question.label,
      guidance: question.guidance || undefined,
      questionType: question.questionType as never,
      fieldMapping: question.fieldMapping as never,
      required: question.required,
      systemRequired: question.systemRequired,
      evidenceRequired: question.evidenceRequired,
      publicUseAllowed: question.publicUseAllowed,
      bookingUseAllowed: question.bookingUseAllowed,
      generationUseAllowed: question.generationUseAllowed,
      agencyVerificationRequired: question.agencyVerificationRequired,
      conditions: question.conditionsJson as never,
      options: question.optionsJson as never,
      displayOrder: question.displayOrder,
    })), responseMap);
    if (!completion.complete) throw fail(409, 'FACT_FINDING_REQUIRED_ANSWERS_MISSING', 'Complete every visible required question before submission.');
    const now = new Date();
    const [questionnaire] = await this.db.transaction(async tx => {
      await tx.update(factFindingResponses).set({ status: 'SUBMITTED', submittedAt: now, updatedAt: now }).where(and(eq(factFindingResponses.questionnaireId, session.questionnaireId), inArray(factFindingResponses.status, ['ANSWERED', 'CLIENT_CONFIRMED', 'IN_PROGRESS'])));
      const updated = await tx.update(factFindingQuestionnaires).set({ status: 'SUBMITTED', responseVersion: sql`${factFindingQuestionnaires.responseVersion} + 1`, submittedAt: now, updatedAt: now }).where(and(eq(factFindingQuestionnaires.id, session.questionnaireId), inArray(factFindingQuestionnaires.status, ['IN_PROGRESS', 'CLARIFICATION_REQUIRED']))).returning();
      await tx.update(factFindingParticipants).set({ status: 'COMPLETED', lastAccessedAt: now }).where(eq(factFindingParticipants.id, session.participantId));
      await tx.update(factFindingSessions).set({ revokedAt: now }).where(eq(factFindingSessions.id, session.sessionId));
      await tx.update(emailOutbox).set({ status: 'CANCELLED' }).where(and(eq(emailOutbox.relatedEntityType, 'fact_finding_invitation'), inArray(emailOutbox.status, ['PENDING', 'DELAYED'])));
      return updated;
    });
    if (!questionnaire) throw fail(409, 'FACT_FINDING_ALREADY_SUBMITTED', 'This questionnaire is no longer open for submission.');
    await this.audit.write(null, 'FACT_FINDING_SUBMITTED', 'FACT_FINDING_QUESTIONNAIRE', session.questionnaireReference, {
      tenantId: session.tenantId,
      metadata: { participantReference: session.participantReference, responseVersion: questionnaire.responseVersion, answeredQuestionCount: responses.length },
      sourceComponent: 'fact-finding-client-api',
    });
    return { reference: session.questionnaireReference, status: questionnaire.status, responseVersion: questionnaire.responseVersion, submittedAt: now };
  }

  async clientClarifications(session: FactFindingSessionContext) {
    return toClientSafeFactFindingDto(await this.db.select({
      reference: factFindingClarifications.publicReference,
      questionReference: factFindingQuestionnaireQuestions.publicReference,
      message: factFindingClarifications.agencyMessage,
      requiredResponseType: factFindingClarifications.requiredResponseType,
      evidenceRequested: factFindingClarifications.evidenceRequested,
      dueAt: factFindingClarifications.dueAt,
      status: factFindingClarifications.status,
      clientResponse: factFindingClarifications.clientResponseJson,
    }).from(factFindingClarifications)
      .innerJoin(factFindingQuestionnaireQuestions, eq(factFindingClarifications.questionId, factFindingQuestionnaireQuestions.id))
      .where(and(eq(factFindingClarifications.questionnaireId, session.questionnaireId), inArray(factFindingClarifications.status, ['OPEN', 'CLIENT_RESPONDED'])))
      .orderBy(asc(factFindingClarifications.dueAt), asc(factFindingClarifications.createdAt)));
  }

  async respondToClarification(session: FactFindingSessionContext, reference: string, input: z.infer<typeof RespondToClarificationSchema>) {
    const responseValue = safeAnswer(input.response);
    const [clarification] = await this.db.select().from(factFindingClarifications).where(and(
      eq(factFindingClarifications.publicReference, reference),
      eq(factFindingClarifications.questionnaireId, session.questionnaireId),
      eq(factFindingClarifications.status, 'OPEN'),
    )).limit(1);
    if (!clarification) throw fail(404, 'FACT_FINDING_CLARIFICATION_NOT_FOUND', 'Open clarification was not found.');
    const [updated] = await this.db.update(factFindingClarifications).set({
      clientResponseJson: responseValue,
      status: 'CLIENT_RESPONDED',
      respondedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(factFindingClarifications.id, clarification.id)).returning();
    await this.audit.write(null, 'FACT_FINDING_CLARIFICATION_RESPONDED', 'FACT_FINDING_CLARIFICATION', updated.publicReference, {
      tenantId: session.tenantId,
      metadata: { questionnaireReference: session.questionnaireReference, participantReference: session.participantReference },
      sourceComponent: 'fact-finding-client-api',
    });
    return { reference: updated.publicReference, status: updated.status, respondedAt: updated.respondedAt };
  }

  async initiateUpload(session: FactFindingSessionContext, input: UploadInput) {
    let questionId: string | undefined;
    if (input.questionReference) {
      const [question] = await this.db.select({ id: factFindingQuestionnaireQuestions.id }).from(factFindingQuestionnaireQuestions).where(and(
        eq(factFindingQuestionnaireQuestions.questionnaireId, session.questionnaireId),
        eq(factFindingQuestionnaireQuestions.publicReference, input.questionReference),
        eq(factFindingQuestionnaireQuestions.included, true),
        inArray(factFindingQuestionnaireQuestions.questionType, ['FILE_UPLOAD', 'IMAGE_UPLOAD']),
      )).limit(1);
      if (!question) throw fail(404, 'FACT_FINDING_UPLOAD_QUESTION_INVALID', 'Upload question is outside this questionnaire.');
      questionId = question.id;
    }
    const uploadReference = randomUUID();
    const safeFilename = input.fileName.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 255);
    const bucket = process.env.FACT_FINDING_STORAGE_BUCKET || 'private-fact-finding';
    const storagePath = `${session.questionnaireReference}/${session.participantReference}/${uploadReference}/${safeFilename}`;
    const [upload] = await this.db.insert(factFindingUploads).values({
      publicReference: uploadReference,
      questionnaireId: session.questionnaireId,
      tenantId: session.tenantId,
      participantId: session.participantId,
      questionId,
      storageBucket: bucket,
      storagePath,
      safeFilename,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      digestSha256: input.digestSha256,
      assetCategory: input.category,
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
    return {
      reference: upload.publicReference,
      signedUploadUrl: data.signedUrl,
      uploadToken: data.token,
      expiresInSeconds: 7_200,
      public: false,
      reviewStatus: upload.agencyReviewStatus,
    };
  }

  async completeUpload(session: FactFindingSessionContext, uploadReference: string) {
    const [upload] = await this.db.select().from(factFindingUploads).where(and(
      eq(factFindingUploads.publicReference, uploadReference),
      eq(factFindingUploads.questionnaireId, session.questionnaireId),
      eq(factFindingUploads.tenantId, session.tenantId),
      eq(factFindingUploads.participantId, session.participantId),
      eq(factFindingUploads.uploadStatus, 'PENDING_UPLOAD'),
    )).limit(1);
    if (!upload) throw fail(404, 'FACT_FINDING_UPLOAD_NOT_FOUND', 'Pending upload was not found in this questionnaire session.');
    const { data, error } = await getSupabaseAdmin().storage.from(upload.storageBucket).download(upload.storagePath);
    if (error || !data) throw fail(409, 'FACT_FINDING_UPLOAD_INCOMPLETE', 'The private upload has not completed.');
    const bytes = Buffer.from(await data.arrayBuffer());
    const digestMatches = createHash('sha256').update(bytes).digest('hex') === upload.digestSha256;
    const valid = bytes.byteLength === upload.byteSize
      && digestMatches
      && uploadedFileMatchesMime(bytes, upload.mimeType);
    if (!valid) {
      await this.db.update(factFindingUploads).set({
        uploadStatus: 'QUARANTINED',
        malwareScanStatus: 'FAILED',
        updatedAt: new Date(),
      }).where(eq(factFindingUploads.id, upload.id));
      await getSupabaseAdmin().storage.from(upload.storageBucket).remove([upload.storagePath]);
      throw fail(400, 'FACT_FINDING_UPLOAD_VERIFICATION_FAILED', 'The uploaded bytes do not match the declared safe file.');
    }
    const [completed] = await this.db.update(factFindingUploads).set({
      uploadStatus: 'UPLOADED',
      updatedAt: new Date(),
    }).where(and(
      eq(factFindingUploads.id, upload.id),
      eq(factFindingUploads.uploadStatus, 'PENDING_UPLOAD'),
    )).returning();
    if (!completed) throw fail(409, 'FACT_FINDING_UPLOAD_ALREADY_COMPLETED', 'The upload state changed before completion.');
    await this.audit.write(null, 'FACT_FINDING_UPLOAD_COMPLETED', 'FACT_FINDING_UPLOAD', completed.publicReference, {
      tenantId: session.tenantId,
      metadata: { category: completed.assetCategory, byteSize: completed.byteSize },
      sourceComponent: 'fact-finding-client-api',
    });
    return { reference: completed.publicReference, uploadStatus: completed.uploadStatus, reviewStatus: completed.agencyReviewStatus };
  }
}
