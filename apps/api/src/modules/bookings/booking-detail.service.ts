import { sql } from 'drizzle-orm';
import { getDatabase } from '@ks-os/database';
import { type BookingAuthContext } from '@ks-os/auth';
import {
  BookingDetailSchema,
  FormSchemaJsonSchema,
  type BookingDetail,
  type BookingFormAnswer,
} from '@ks-os/contracts';
import { BookingService } from './booking.service.js';

const terminalDisplayTypes = new Set(['INFORMATION', 'HEADING', 'DIVIDER']);

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function answerDisplayValue(field: any, raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return 'Not answered';
  const optionLabel = (value: unknown) => {
    const option = field.options?.find((candidate: any) => candidate.id === value || candidate.value === value);
    return option?.label || String(value);
  };
  if (Array.isArray(raw)) return raw.map(optionLabel).join(', ');
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
  if (typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => `${key.replaceAll('_', ' ')}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
      .join(' · ') || 'Not answered';
  }
  return optionLabel(raw);
}

function mapFormAnswers(schemaValue: unknown, answersValue: unknown): BookingFormAnswer[] {
  const schema = FormSchemaJsonSchema.safeParse(schemaValue);
  if (!schema.success || !answersValue || typeof answersValue !== 'object') return [];
  const answers = answersValue as Record<string, unknown>;
  return schema.data.fields
    .filter(field => !terminalDisplayTypes.has(field.type))
    .flatMap(field => {
      const key = field.key || field.id;
      if (!(key in answers)) return [];
      return [{
        key,
        label: field.label,
        type: field.type,
        displayValue: answerDisplayValue(field, answers[key]),
        sensitiveClassification: field.sensitiveClassification || null,
      }];
    });
}

export class BookingDetailService {
  private readonly bookingService = new BookingService();

  async get(auth: BookingAuthContext, bookingId: string, now = new Date()): Promise<BookingDetail> {
    const booking = await this.bookingService.getOperationalBooking(auth, bookingId, now);
    const db = getDatabase();
    const detailResult = await db.execute(sql`
      select
        a.client_id "clientId",
        a.booking_source "bookingSource",
        a.source_medium "sourceMedium",
        a.source_campaign "sourceCampaign",
        a.source_referrer_host "sourceReferrerHost",
        a.booking_page_id "bookingPageId",
        a.intake_status "intakeStatus",
        a.customer_notes "customerNotes",
        a.mobile_address "mobileAddress",
        a.created_at "bookedAt",
        c.created_at "memberSince",
        c.loyalty_points "loyaltyPoints",
        c.patch_test_date "patchTestDate",
        c.medical_notes "medicalNotes"
      from appointments a
      left join clients c on c.id = a.client_id and c.tenant_id = a.tenant_id
      where a.id = ${bookingId}::uuid and a.tenant_id = ${auth.tenantId}::uuid
      limit 1
    `);
    const row = detailResult.rows[0] as any;
    if (!row) throw Object.assign(new Error('Booking not found.'), { code: 'BOOKING_NOT_FOUND', statusCode: 404 });

    let stats: any = {
      totalBookings: 0,
      completedVisits: 0,
      previousCompletedVisits: 0,
      upcomingBookings: 0,
      cancellations: 0,
      noShows: 0,
      firstVisitAt: null,
      lastVisitAt: null,
    };
    if (row.clientId) {
      const statsResult = await db.execute(sql`
        select
          count(*) filter (where status <> 'BLOCKED')::int "totalBookings",
          count(*) filter (where status = 'COMPLETED')::int "completedVisits",
          count(*) filter (where status = 'COMPLETED' and id <> ${bookingId}::uuid and start_time < ${new Date(booking.startTime)})::int "previousCompletedVisits",
          count(*) filter (where status not in ('COMPLETED','CANCELLED','NO_SHOW','BLOCKED') and start_time >= ${now})::int "upcomingBookings",
          count(*) filter (where status = 'CANCELLED')::int cancellations,
          count(*) filter (where status = 'NO_SHOW')::int "noShows",
          min(start_time) filter (where status = 'COMPLETED') "firstVisitAt",
          max(start_time) filter (where status = 'COMPLETED') "lastVisitAt"
        from appointments
        where tenant_id = ${auth.tenantId}::uuid and client_id = ${row.clientId}::uuid
      `);
      stats = { ...stats, ...(statsResult.rows[0] as any) };
    }

    const formsResult = await db.execute(sql`
      select
        fa.id "assignmentId",
        fa.status,
        fv.title_snapshot "formTitle",
        fv.schema_json "schemaJson",
        s.response_json "answers",
        coalesce(s.submitted_at, fa.submitted_at) "submittedAt",
        s.completion_percentage "completionPercentage"
      from form_assignments fa
      join form_versions fv on fv.id = fa.form_version_id and fv.tenant_id = fa.tenant_id
      left join client_form_submissions s on s.assignment_id = fa.id and s.tenant_id = fa.tenant_id
      where fa.tenant_id = ${auth.tenantId}::uuid and fa.appointment_id = ${bookingId}::uuid
      order by fa.created_at asc
    `);

    const source = (row.bookingSource || booking.source || 'OTHER') as BookingDetail['source'];
    return BookingDetailSchema.parse({
      ...booking,
      source,
      intakeStatus: row.intakeStatus || booking.intakeStatus,
      customerNotes: row.customerNotes ?? booking.customerNotes,
      mobileAddress: row.mobileAddress && typeof row.mobileAddress === 'object' ? row.mobileAddress : null,
      acquisition: {
        source,
        medium: row.sourceMedium || null,
        campaign: row.sourceCampaign || null,
        referrerHost: row.sourceReferrerHost || null,
        bookedAt: iso(row.bookedAt) || booking.createdAt,
        bookingPageId: row.bookingPageId || null,
      },
      customerBreakdown: {
        repeatCustomer: Number(stats.previousCompletedVisits || 0) > 0,
        previousCompletedVisits: Number(stats.previousCompletedVisits || 0),
        completedVisits: Number(stats.completedVisits || 0),
        totalBookings: Number(stats.totalBookings || 0),
        upcomingBookings: Number(stats.upcomingBookings || 0),
        cancellations: Number(stats.cancellations || 0),
        noShows: Number(stats.noShows || 0),
        firstVisitAt: iso(stats.firstVisitAt),
        lastVisitAt: iso(stats.lastVisitAt),
        memberSince: iso(row.memberSince),
        loyaltyPoints: Number(row.loyaltyPoints || 0),
        patchTestDate: iso(row.patchTestDate),
        medicalNotes: auth.role === 'owner' ? row.medicalNotes || null : null,
      },
      formResponses: formsResult.rows.map((formRow: any) => ({
        assignmentId: formRow.assignmentId,
        formTitle: formRow.formTitle,
        status: formRow.status,
        submittedAt: iso(formRow.submittedAt),
        completionPercentage: formRow.completionPercentage === null || formRow.completionPercentage === undefined
          ? null
          : Number(formRow.completionPercentage),
        answers: mapFormAnswers(formRow.schemaJson, formRow.answers),
      })),
    });
  }
}
