import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  factFindingQuestionnaireQuestions,
  factFindingQuestionnaires,
  factFindingResponses,
  factFindingResponseVersions,
  getDatabase,
  tenants,
} from '@ks-os/database';
import {
  completionForQuestions,
  FactAnswerValueSchema,
  type FactFindingResponseStatus,
} from '@ks-os/fact-finding';
import type { z } from 'zod';
import { AgencyAuditService, type AgencyActor } from '../agency/agency.service.js';

type Answer = z.infer<typeof FactAnswerValueSchema>;
const fail = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)]));
  return value;
}

function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function safeAnswer(value: unknown): Answer {
  const parsed = FactAnswerValueSchema.safeParse(value);
  if (!parsed.success) throw fail(400, 'FACT_FINDING_ANSWER_INVALID', 'The answer does not match the controlled intake field.');
  const inspect = (item: unknown): void => {
    if (typeof item === 'string' && (/<\s*\/?\s*(?:script|iframe|object|embed|style|form|svg|math)\b/i.test(item) || /(?:javascript|data|vbscript)\s*:/i.test(item))) {
      throw fail(400, 'FACT_FINDING_UNSAFE_ANSWER', 'Executable or embedded answer content is not permitted.');
    }
    if (Array.isArray(item)) item.forEach(inspect);
    else if (item && typeof item === 'object') Object.values(item as Record<string, unknown>).forEach(inspect);
  };
  inspect(parsed.data);
  return parsed.data;
}

export class ManualFactFindingService {
  private readonly db = getDatabase();
  private readonly audit = new AgencyAuditService();

  private async questionnaire(reference: string) {
    const [row] = await this.db.select({
      id: factFindingQuestionnaires.id,
      reference: factFindingQuestionnaires.publicReference,
      tenantId: factFindingQuestionnaires.tenantId,
      tenantName: tenants.name,
      version: factFindingQuestionnaires.questionnaireVersion,
      responseVersion: factFindingQuestionnaires.responseVersion,
      status: factFindingQuestionnaires.status,
      dueAt: factFindingQuestionnaires.dueAt,
    }).from(factFindingQuestionnaires)
      .innerJoin(tenants, eq(factFindingQuestionnaires.tenantId, tenants.id))
      .where(eq(factFindingQuestionnaires.publicReference, reference)).limit(1);
    if (!row) throw fail(404, 'FACT_FINDING_QUESTIONNAIRE_NOT_FOUND', 'Questionnaire was not found.');
    return row;
  }

  async form(reference: string) {
    const questionnaire = await this.questionnaire(reference);
    const [questions, responses] = await Promise.all([
      this.db.select({
        reference: factFindingQuestionnaireQuestions.publicReference,
        sectionReference: factFindingQuestionnaireQuestions.sectionReference,
        key: factFindingQuestionnaireQuestions.questionKey,
        label: factFindingQuestionnaireQuestions.label,
        guidance: factFindingQuestionnaireQuestions.guidance,
        questionType: factFindingQuestionnaireQuestions.questionType,
        fieldMapping: factFindingQuestionnaireQuestions.fieldMapping,
        required: factFindingQuestionnaireQuestions.required,
        systemRequired: factFindingQuestionnaireQuestions.systemRequired,
        evidenceRequired: factFindingQuestionnaireQuestions.evidenceRequired,
        publicUseAllowed: factFindingQuestionnaireQuestions.publicUseAllowed,
        bookingUseAllowed: factFindingQuestionnaireQuestions.bookingUseAllowed,
        generationUseAllowed: factFindingQuestionnaireQuestions.generationUseAllowed,
        agencyVerificationRequired: factFindingQuestionnaireQuestions.agencyVerificationRequired,
        conditions: factFindingQuestionnaireQuestions.conditionsJson,
        options: factFindingQuestionnaireQuestions.optionsJson,
        displayOrder: factFindingQuestionnaireQuestions.displayOrder,
      }).from(factFindingQuestionnaireQuestions)
        .where(and(eq(factFindingQuestionnaireQuestions.questionnaireId, questionnaire.id), eq(factFindingQuestionnaireQuestions.included, true)))
        .orderBy(asc(factFindingQuestionnaireQuestions.displayOrder)),
      this.db.select({
        reference: factFindingResponses.publicReference,
        questionReference: factFindingQuestionnaireQuestions.publicReference,
        answer: factFindingResponses.answerJson,
        status: factFindingResponses.status,
        source: factFindingResponses.source,
        responseVersion: factFindingResponses.responseVersion,
        updatedAt: factFindingResponses.updatedAt,
      }).from(factFindingResponses)
        .innerJoin(factFindingQuestionnaireQuestions, eq(factFindingResponses.questionId, factFindingQuestionnaireQuestions.id))
        .where(eq(factFindingResponses.questionnaireId, questionnaire.id)),
    ]);
    const responseMap = new Map(responses.map(response => [response.questionReference, { status: response.status as FactFindingResponseStatus, answer: response.answer }]));
    const completion = completionForQuestions(questions as never, responseMap);
    return { ...questionnaire, questions, responses, completion };
  }

  async save(actor: AgencyActor, questionnaireReference: string, questionReference: string, rawAnswer: unknown) {
    const questionnaire = await this.questionnaire(questionnaireReference);
    if (!['PREQUALIFIED', 'IN_PROGRESS', 'CLARIFICATION_REQUIRED'].includes(questionnaire.status)) {
      throw fail(409, 'FACT_FINDING_MANUAL_ENTRY_LOCKED', 'Prequalify the form before entering client information.');
    }
    const [question] = await this.db.select().from(factFindingQuestionnaireQuestions).where(and(
      eq(factFindingQuestionnaireQuestions.questionnaireId, questionnaire.id),
      eq(factFindingQuestionnaireQuestions.publicReference, questionReference),
      eq(factFindingQuestionnaireQuestions.included, true),
    )).limit(1);
    if (!question) throw fail(404, 'FACT_FINDING_QUESTION_NOT_FOUND', 'Question is outside this intake form.');
    const answer = safeAnswer(rawAnswer);
    const [existing] = await this.db.select().from(factFindingResponses).where(and(eq(factFindingResponses.questionnaireId, questionnaire.id), eq(factFindingResponses.questionId, question.id))).limit(1);
    const now = new Date();
    const response = await this.db.transaction(async tx => {
      if (existing) {
        const nextVersion = existing.responseVersion + 1;
        const [updated] = await tx.update(factFindingResponses).set({
          participantId: null,
          answerJson: answer,
          answerType: question.questionType,
          source: 'AGENCY_PROVIDED',
          valueDigestSha256: digest(answer),
          status: 'AGENCY_REVIEW_REQUIRED',
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
          questionnaireId: questionnaire.id,
          tenantId: questionnaire.tenantId,
          participantId: null,
          responseVersion: nextVersion,
          answerJson: answer,
          source: 'AGENCY_PROVIDED',
          valueDigestSha256: updated.valueDigestSha256,
          status: updated.status,
        });
        return updated;
      }
      const [created] = await tx.insert(factFindingResponses).values({
        questionnaireId: questionnaire.id,
        tenantId: questionnaire.tenantId,
        questionId: question.id,
        participantId: null,
        fieldMapping: question.fieldMapping,
        answerType: question.questionType,
        answerJson: answer,
        source: 'AGENCY_PROVIDED',
        valueDigestSha256: digest(answer),
        status: 'AGENCY_REVIEW_REQUIRED',
        evidenceRequired: question.evidenceRequired,
      }).returning();
      await tx.insert(factFindingResponseVersions).values({
        responseId: created.id,
        questionnaireId: questionnaire.id,
        tenantId: questionnaire.tenantId,
        participantId: null,
        responseVersion: 1,
        answerJson: answer,
        source: 'AGENCY_PROVIDED',
        valueDigestSha256: created.valueDigestSha256,
        status: created.status,
      });
      return created;
    });
    if (questionnaire.status === 'PREQUALIFIED') await this.db.update(factFindingQuestionnaires).set({ status: 'IN_PROGRESS', updatedAt: now }).where(eq(factFindingQuestionnaires.id, questionnaire.id));
    await this.audit.write(actor, 'FACT_FINDING_AGENCY_RESPONSE_SAVED', 'FACT_FINDING_RESPONSE', response.publicReference, {
      tenantId: questionnaire.tenantId,
      metadata: { questionnaireReference, questionReference, responseVersion: response.responseVersion, source: 'AGENCY_PROVIDED' },
    });
    return { reference: response.publicReference, status: response.status, responseVersion: response.responseVersion, updatedAt: response.updatedAt };
  }

  async submit(actor: AgencyActor, questionnaireReference: string) {
    const questionnaire = await this.questionnaire(questionnaireReference);
    if (!['PREQUALIFIED', 'IN_PROGRESS', 'CLARIFICATION_REQUIRED'].includes(questionnaire.status)) {
      throw fail(409, 'FACT_FINDING_MANUAL_SUBMISSION_LOCKED', 'This intake form is no longer open for agency-assisted completion.');
    }
    const detail = await this.form(questionnaireReference);
    if (!detail.completion.complete) throw fail(409, 'FACT_FINDING_REQUIRED_ANSWERS_MISSING', 'Complete every visible required question before submission.');
    const now = new Date();
    const [updated] = await this.db.transaction(async tx => {
      await tx.update(factFindingResponses).set({ status: 'SUBMITTED', submittedAt: now, updatedAt: now }).where(and(
        eq(factFindingResponses.questionnaireId, questionnaire.id),
        inArray(factFindingResponses.status, ['ANSWERED', 'CLIENT_CONFIRMED', 'AGENCY_REVIEW_REQUIRED', 'IN_PROGRESS']),
      ));
      return tx.update(factFindingQuestionnaires).set({ status: 'SUBMITTED', responseVersion: sql`${factFindingQuestionnaires.responseVersion} + 1`, submittedAt: now, updatedAt: now })
        .where(and(eq(factFindingQuestionnaires.id, questionnaire.id), inArray(factFindingQuestionnaires.status, ['PREQUALIFIED', 'IN_PROGRESS', 'CLARIFICATION_REQUIRED'])))
        .returning();
    });
    if (!updated) throw fail(409, 'FACT_FINDING_ALREADY_SUBMITTED', 'This intake form has already been submitted.');
    await this.audit.write(actor, 'FACT_FINDING_AGENCY_SUBMITTED', 'FACT_FINDING_QUESTIONNAIRE', questionnaireReference, {
      tenantId: questionnaire.tenantId,
      metadata: { responseVersion: updated.responseVersion, source: 'AGENCY_ASSISTED' },
    });
    return { reference: questionnaireReference, status: updated.status, responseVersion: updated.responseVersion, submittedAt: now };
  }
}
