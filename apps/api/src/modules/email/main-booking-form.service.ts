import { createHash, randomBytes } from 'node:crypto';
import {
  appointments,
  formAssignments,
  forms,
  formVersions,
  getDatabase,
} from '@ks-os/database';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { env } from '../../config/env.js';
import { BusinessEventsService, stableEventId } from '../automations/business-events.service.js';

const hashToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');
const secureToken = () => randomBytes(32).toString('base64url');

type MainBookingFormResult = {
  assignmentId: string;
  formName: string;
  formLink: string;
  reminderScheduledFor: Date | null;
};

function reminderTime(
  timing: string,
  assignedAt: Date,
  appointmentStart: Date,
  expiresAt: Date,
): Date | null {
  if (timing === 'none' || timing === 'no_reminder') return null;
  const scheduled = timing === '24_hours_after_assignment'
    ? new Date(assignedAt.getTime() + 24 * 60 * 60 * 1000)
    : timing === '48_hours_before_appointment'
      ? new Date(appointmentStart.getTime() - 48 * 60 * 60 * 1000)
      : timing === '24_hours_before_appointment'
        ? new Date(appointmentStart.getTime() - 24 * 60 * 60 * 1000)
        : null;
  if (!scheduled || scheduled <= assignedAt || scheduled >= expiresAt || scheduled >= appointmentStart) return null;
  return scheduled;
}

export class MainBookingFormService {
  private events = new BusinessEventsService();

  async prepare(
    input: {
      tenantId: string;
      appointmentId: string;
      formId: string;
      formReminderTiming: string;
      formRemindersEnabled: boolean;
    },
    query: any = getDatabase(),
  ): Promise<MainBookingFormResult | null> {
    if (!env.PUBLIC_APP_ORIGIN) return null;

    const [[appointment], [version], [existing]] = await Promise.all([
      query.select({
        clientId: appointments.clientId,
        assignedUserId: appointments.userId,
        startTime: appointments.startTime,
        status: appointments.status,
      }).from(appointments).where(and(
        eq(appointments.id, input.appointmentId),
        eq(appointments.tenantId, input.tenantId),
      )).limit(1),
      query.select({
        id: formVersions.id,
        title: formVersions.titleSnapshot,
      }).from(formVersions)
        .innerJoin(forms, and(eq(forms.id, formVersions.formId), eq(forms.tenantId, input.tenantId)))
        .where(and(
          eq(formVersions.tenantId, input.tenantId),
          eq(formVersions.formId, input.formId),
          eq(forms.status, 'PUBLISHED'),
        ))
        .orderBy(desc(formVersions.versionNumber))
        .limit(1),
      query.select({ id: formAssignments.id }).from(formAssignments).where(and(
        eq(formAssignments.tenantId, input.tenantId),
        eq(formAssignments.appointmentId, input.appointmentId),
        eq(formAssignments.formId, input.formId),
        inArray(formAssignments.status, ['PENDING', 'OPENED']),
      )).limit(1),
    ]);

    if (
      !appointment?.clientId
      || !appointment.assignedUserId
      || !version
      || existing
      || ['CANCELLED', 'NO_SHOW', 'BLOCKED'].includes(appointment.status)
    ) return null;

    const assignedAt = new Date();
    const expiresAt = new Date(assignedAt.getTime() + env.FORM_ASSIGNMENT_EXPIRY_DAYS * 86_400_000);
    const token = secureToken();
    const [assignment] = await query.insert(formAssignments).values({
      tenantId: input.tenantId,
      formId: input.formId,
      formVersionId: version.id,
      clientId: appointment.clientId,
      appointmentId: input.appointmentId,
      publicTokenHash: hashToken(token),
      expiresAt,
      assignedByUserId: appointment.assignedUserId,
    }).returning({ id: formAssignments.id });
    if (!assignment) return null;

    await this.events.emit({
      id: stableEventId('FORM_ASSIGNED', assignment.id, 'main-booking-email'),
      tenantId: input.tenantId,
      type: 'FORM_ASSIGNED',
      occurredAt: assignedAt.toISOString(),
      sourceType: 'form_assignment',
      sourceId: assignment.id,
      payload: {
        assignmentId: assignment.id,
        formId: input.formId,
        appointmentId: input.appointmentId,
        status: 'PENDING',
        deliveryContext: 'MAIN_BOOKING_EMAIL',
      },
    }, query);

    return {
      assignmentId: assignment.id,
      formName: version.title,
      formLink: `${env.PUBLIC_APP_ORIGIN.replace(/\/$/, '')}/forms/complete/${token}`,
      reminderScheduledFor: input.formRemindersEnabled
        ? reminderTime(input.formReminderTiming, assignedAt, appointment.startTime, expiresAt)
        : null,
    };
  }
}
