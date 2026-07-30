import { createHash } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  bookingPages,
  factFindingQuestionnaireQuestions,
  factFindingQuestionnaires,
  factFindingResponses,
  factFindingResponseVersions,
  getDatabase,
  locations,
  services,
  staffSchedules,
  tenants,
  users,
} from '@ks-os/database';
import {
  FactAnswerValueSchema,
  FactFieldMappingSchema,
  type FactFieldMapping,
} from '@ks-os/fact-finding';
import type { AgencyActor } from '../agency/agency.service.js';
import { AgencyAuditService } from '../agency/agency.service.js';

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

type Database = ReturnType<typeof getDatabase>;
type Answer = ReturnType<typeof FactAnswerValueSchema.parse>;

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

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function integer(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function bookingRule(page: { bookingRules: unknown }, keys: string[]): unknown {
  const rules = object(page.bookingRules);
  for (const key of keys) {
    if (rules[key] !== undefined && rules[key] !== null) return rules[key];
  }
  return null;
}

function groupedHours(rows: Array<{ dayOfWeek: number; startTime: string; endTime: string }>) {
  const byDay = new Map<number, Array<{ startTime: string; endTime: string }>>();
  for (const row of rows) {
    const entries = byDay.get(row.dayOfWeek) || [];
    entries.push(row);
    byDay.set(row.dayOfWeek, entries);
  }
  return [...byDay.entries()].sort(([left], [right]) => left - right).map(([dayOfWeek, entries]) => ({
    dayOfWeek,
    opensAt: entries.map(item => item.startTime).sort()[0]!,
    closesAt: entries.map(item => item.endTime).sort().at(-1)!,
    closed: false,
  }));
}

/**
 * Creates versioned questionnaire responses from existing booking-owned data.
 * Human responses always win: the sync only creates missing responses or
 * refreshes records previously sourced from BOOKING_SYSTEM. Imported values
 * still require normal agency review before a production brief can be built.
 */
export class BookingFactSyncService {
  constructor(
    private readonly db: Database = getDatabase(),
    private readonly audit = new AgencyAuditService(),
  ) {}

  async sync(actor: AgencyActor, questionnaireReference: string) {
    const [questionnaire] = await this.db.select({
      id: factFindingQuestionnaires.id,
      tenantId: factFindingQuestionnaires.tenantId,
      status: factFindingQuestionnaires.status,
      responseVersion: factFindingQuestionnaires.responseVersion,
    }).from(factFindingQuestionnaires)
      .where(eq(factFindingQuestionnaires.publicReference, questionnaireReference))
      .limit(1);
    if (!questionnaire) throw fail(404, 'FACT_FINDING_QUESTIONNAIRE_NOT_FOUND', 'Questionnaire was not found.');
    if (!['PREQUALIFIED', 'IN_PROGRESS', 'CLARIFICATION_REQUIRED'].includes(questionnaire.status)) {
      return { questionnaireReference, imported: 0, refreshed: 0, skipped: 0, status: questionnaire.status };
    }

    const [business, serviceRows, locationRows, staffRows, scheduleRows, bookingRows, questions, existingRows] = await Promise.all([
      this.db.select({
        legalName: tenants.legalBusinessName,
        tradingName: tenants.name,
        phone: tenants.operationalPhone,
        email: tenants.replyToEmail,
        currency: tenants.currency,
        cancellationNoticeMinutes: tenants.minimumCancellationNoticeMinutes,
        rescheduleNoticeMinutes: tenants.minimumRescheduleNoticeMinutes,
        cancellationMessage: tenants.lateCancellationMessage,
        depositPolicyMessage: tenants.depositPolicyMessage,
      }).from(tenants).where(eq(tenants.id, questionnaire.tenantId)).limit(1).then(rows => rows[0]),
      this.db.select({
        name: services.name,
        description: services.description,
        duration: services.duration,
        buffer: services.bufferTime,
        price: services.price,
        active: services.isActive,
      }).from(services).where(and(eq(services.tenantId, questionnaire.tenantId), eq(services.isActive, true))).orderBy(asc(services.createdAt)),
      this.db.select({ name: locations.name }).from(locations)
        .where(and(eq(locations.tenantId, questionnaire.tenantId), eq(locations.isActive, true)))
        .orderBy(asc(locations.isPrimary), asc(locations.createdAt)),
      this.db.select({
        id: users.id,
        name: users.name,
        role: users.jobTitle,
        bio: users.bio,
      }).from(users).where(and(
        eq(users.tenantId, questionnaire.tenantId),
        eq(users.accountStatus, 'ACTIVE'),
        eq(users.bookingEnabled, true),
      )).orderBy(asc(users.createdAt)),
      this.db.select({
        userId: staffSchedules.userId,
        dayOfWeek: staffSchedules.dayOfWeek,
        startTime: staffSchedules.startTime,
        endTime: staffSchedules.endTime,
      }).from(staffSchedules).where(eq(staffSchedules.tenantId, questionnaire.tenantId))
        .orderBy(asc(staffSchedules.dayOfWeek), asc(staffSchedules.startTime)),
      this.db.select({
        bookingRules: bookingPages.bookingRules,
        confirmationSettings: bookingPages.confirmationSettings,
        cancellationSettings: bookingPages.cancellationSettings,
        enabled: bookingPages.enabled,
      }).from(bookingPages).where(eq(bookingPages.tenantId, questionnaire.tenantId)).limit(1),
      this.db.select({
        id: factFindingQuestionnaireQuestions.id,
        reference: factFindingQuestionnaireQuestions.publicReference,
        fieldMapping: factFindingQuestionnaireQuestions.fieldMapping,
        questionType: factFindingQuestionnaireQuestions.questionType,
        evidenceRequired: factFindingQuestionnaireQuestions.evidenceRequired,
      }).from(factFindingQuestionnaireQuestions).where(and(
        eq(factFindingQuestionnaireQuestions.questionnaireId, questionnaire.id),
        eq(factFindingQuestionnaireQuestions.included, true),
      )),
      this.db.select().from(factFindingResponses)
        .where(eq(factFindingResponses.questionnaireId, questionnaire.id)),
    ]);
    if (!business) throw fail(409, 'BOOKING_FACT_SYNC_TENANT_MISSING', 'The client workspace could not be resolved.');

    const primaryService = serviceRows[0];
    const primaryLocation = locationRows[0];
    const primaryStaff = staffRows[0];
    const booking = bookingRows[0];
    const staffHours = primaryStaff
      ? groupedHours(scheduleRows.filter(row => row.userId === primaryStaff.id))
      : [];
    const businessHours = groupedHours(scheduleRows);
    const cancellationSettings = object(booking?.cancellationSettings);
    const confirmationSettings = object(booking?.confirmationSettings);
    const minimumNotice = integer(booking ? bookingRule(booking, ['minimumNoticeMinutes', 'minimum_notice_minutes', 'minNoticeMinutes']) : null);
    const maximumAdvance = integer(booking ? bookingRule(booking, ['maximumAdvanceDays', 'maximum_advance_days', 'maxAdvanceDays']) : null);

    const answers = new Map<FactFieldMapping, Answer>();
    const put = (mapping: FactFieldMapping, value: unknown) => {
      if (value === null || value === undefined || value === '') return;
      const parsed = FactAnswerValueSchema.safeParse(value);
      if (parsed.success) answers.set(mapping, parsed.data);
    };
    put('BUSINESS.LEGAL_NAME', text(business.legalName));
    put('BUSINESS.TRADING_NAME', text(business.tradingName));
    put('BUSINESS.PUBLIC_PHONE', text(business.phone));
    put('BUSINESS.PUBLIC_EMAIL', text(business.email));
    put('LOCATION.NAME', text(primaryLocation?.name));
    if (businessHours.length) put('LOCATION.OPENING_HOURS', businessHours);
    put('SERVICE.NAME', text(primaryService?.name));
    put('SERVICE.DESCRIPTION', text(primaryService?.description));
    put('SERVICE.DURATION', primaryService?.duration);
    if (primaryService) put('SERVICE.PRICE', { amountMinor: primaryService.price, currency: business.currency });
    put('SERVICE.BUFFER', primaryService?.buffer ?? 0);
    put('STAFF.NAME', text(primaryStaff?.name));
    put('STAFF.ROLE', text(primaryStaff?.role));
    put('STAFF.BIO', text(primaryStaff?.bio));
    if (staffHours.length) put('STAFF.AVAILABILITY', staffHours);
    put('BOOKING.MINIMUM_NOTICE', minimumNotice);
    put('BOOKING.MAXIMUM_ADVANCE', maximumAdvance);
    put('BOOKING.CANCELLATION_POLICY', text(cancellationSettings.publicMessage) || text(business.cancellationMessage));
    put('BOOKING.RESCHEDULING_POLICY', text(cancellationSettings.rescheduleMessage)
      || `Customers may reschedule online until ${business.rescheduleNoticeMinutes} minutes before the appointment.`);
    put('BOOKING.DEPOSIT_POLICY', text(cancellationSettings.depositMessage) || text(business.depositPolicyMessage));
    put('BOOKING.CONFIRMATION_BEHAVIOUR', text(confirmationSettings.behaviour)
      || text(confirmationSettings.mode)
      || (booking?.enabled ? 'AUTO_CONFIRM' : null));

    const existingByQuestion = new Map(existingRows.map(row => [row.questionId, row]));
    let imported = 0;
    let refreshed = 0;
    let skipped = 0;
    const now = new Date();
    await this.db.transaction(async tx => {
      for (const question of questions) {
        const mapping = FactFieldMappingSchema.safeParse(question.fieldMapping);
        if (!mapping.success) continue;
        const answer = answers.get(mapping.data);
        if (answer === undefined) continue;
        const existing = existingByQuestion.get(question.id);
        if (existing && existing.source !== 'BOOKING_SYSTEM') {
          skipped += 1;
          continue;
        }
        const valueDigestSha256 = digest(answer);
        if (existing) {
          if (existing.valueDigestSha256 === valueDigestSha256) continue;
          const nextVersion = existing.responseVersion + 1;
          const [updated] = await tx.update(factFindingResponses).set({
            participantId: null,
            answerJson: answer,
            answerType: question.questionType,
            source: 'BOOKING_SYSTEM',
            valueDigestSha256,
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
            source: 'BOOKING_SYSTEM',
            valueDigestSha256,
            status: 'AGENCY_REVIEW_REQUIRED',
          });
          refreshed += 1;
        } else {
          const [created] = await tx.insert(factFindingResponses).values({
            questionnaireId: questionnaire.id,
            tenantId: questionnaire.tenantId,
            questionId: question.id,
            participantId: null,
            fieldMapping: mapping.data,
            answerType: question.questionType,
            answerJson: answer,
            source: 'BOOKING_SYSTEM',
            valueDigestSha256,
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
            source: 'BOOKING_SYSTEM',
            valueDigestSha256,
            status: 'AGENCY_REVIEW_REQUIRED',
          });
          imported += 1;
        }
      }
      if (questionnaire.status === 'PREQUALIFIED' && imported + refreshed > 0) {
        await tx.update(factFindingQuestionnaires).set({ status: 'IN_PROGRESS', updatedAt: now })
          .where(eq(factFindingQuestionnaires.id, questionnaire.id));
      }
    });

    await this.audit.write(actor, 'FACT_FINDING_BOOKING_FACTS_SYNCED', 'FACT_FINDING_QUESTIONNAIRE', questionnaireReference, {
      tenantId: questionnaire.tenantId,
      category: 'BOOKING',
      metadata: { imported, refreshed, skipped, source: 'BOOKING_SYSTEM' },
    });
    return {
      questionnaireReference,
      imported,
      refreshed,
      skipped,
      source: 'BOOKING_SYSTEM' as const,
      reviewRequired: imported + refreshed > 0,
    };
  }
}
