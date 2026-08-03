import { BookingRepository } from './booking.repository.js';
import { appointments, bookingAuditEvents, clients, getDatabase, internalNotifications, services, tenants, users } from '@ks-os/database';
import { eq, and, or, gt, lt, notInArray, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import type { BookingOperationsItem, BookingOperationsQuery, BookingOperationsResponse, CreateBlockedTimeRequest } from '@ks-os/contracts';
import { 
  BookingAuthContext, 
  canCancelBooking, 
  canRescheduleBooking, 
  canUpdateBookingStatus,
  canCreateBooking
} from '@ks-os/auth';

import { EmailService } from '../email/email.service.js';
import { SmsService } from '../sms/sms.service.js';
import { BusinessEventsService, stableEventId } from '../automations/business-events.service.js';
import { FormsService } from '../forms/forms.service.js';
import { env } from '../../config/env.js';
import {
  EmailSettingsService,
  emailBrandingTemplateData,
  renderAutomatedEmailCopy,
} from '../email/email-settings.service.js';

type OperationalRow = Awaited<ReturnType<BookingRepository['listOperationalBookings']>>['rows'][number];

export function attentionReasonsFor(row: {
  status: string;
  paymentStatus: string;
  intakeStatus: string;
  attentionReason?: string | null;
  endTime: Date;
}, now = new Date()): string[] {
  const reasons = new Set<string>();
  if (row.status === 'PENDING') reasons.add('Booking is awaiting confirmation');
  if (row.paymentStatus === 'FAILED') reasons.add('Payment failed');
  if (row.paymentStatus === 'PENDING') reasons.add('Payment is pending');
  if (row.paymentStatus === 'PARTIALLY_PAID') reasons.add('Balance remains outstanding');
  if (row.intakeStatus === 'PENDING' || row.intakeStatus === 'IN_PROGRESS') reasons.add('Intake form is incomplete');
  if (row.intakeStatus === 'OVERDUE') reasons.add('Intake form is overdue');
  if (row.attentionReason) reasons.add(row.attentionReason);
  if (row.endTime < now && !['COMPLETED', 'CANCELLED', 'NO_SHOW', 'BLOCKED'].includes(row.status)) reasons.add('Booking is overdue');
  return [...reasons];
}

export function mapOperationalBooking(row: OperationalRow, timezone: string, now = new Date()): BookingOperationsItem {
  return {
    id: row.id,
    reference: row.reference,
    startTime: row.startTime.toISOString(),
    endTime: row.endTime.toISOString(),
    timezone,
    status: row.status,
    customer: { id: row.clientId, name: row.clientName || row.clientNameFallback || 'Walk-in', email: row.clientEmail, phone: row.clientPhone },
    service: { id: row.serviceId, name: row.serviceName || 'Service unavailable', durationMinutes: row.serviceDuration || Math.max(0, Math.round((row.endTime.getTime() - row.startTime.getTime()) / 60_000)) },
    staff: { id: row.staffId || '00000000-0000-0000-0000-000000000000', name: row.staffName || 'Unassigned' },
    location: { id: row.locationId, name: row.locationName },
    bookingChannel: row.bookingChannel,
    paymentStatus: row.paymentStatus,
    quotedAmount: row.quotedAmount,
    intakeStatus: row.intakeStatus as BookingOperationsItem['intakeStatus'],
    source: row.bookingSource as BookingOperationsItem['source'],
    notes: row.notes,
    customerNotes: row.customerNotes,
    attentionReasons: attentionReasonsFor(row, now),
    createdAt: row.createdAt.toISOString(),
  };
}

export class BookingService {
  private repository: BookingRepository;
  private emailService: EmailService;
  private smsService: SmsService;
  private emailSettings = new EmailSettingsService();
  private businessEvents = new BusinessEventsService();

  constructor() {
    this.repository = new BookingRepository();
    this.emailService = new EmailService();
    this.smsService = new SmsService();
  }

  private async enqueueEmailReminders(tx:any, tenant:any, booking:any, bookingId:string, startTime:Date, idSuffix:string) {
    if (!tenant?.appointmentRemindersEnabled || !booking.clientEmail) return;
    const settings = await this.emailSettings.get(booking.tenantId || tenant.id, tx);
    const hours = [
      ...(settings.automations.reminderThreeDaysEnabled ? [72] : []),
      ...(settings.automations.reminderOneDayEnabled ? [24] : []),
    ];
    const fmt = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: tenant.timezone });
    const parts = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: tenant.timezone }).format(startTime);
    const time = new Intl.DateTimeFormat('en-GB', { timeStyle: 'short', timeZone: tenant.timezone }).format(startTime);
    for (const h of hours) {
      const scheduledFor = new Date(startTime.getTime() - h * 3600000);
      const template = h === 72 ? settings.templates.reminderThreeDays : settings.templates.reminderOneDay;
      const replacements = {
        businessName: settings.branding.businessName,
        customerName: booking.clientName || booking.clientNameFallback || 'there',
        serviceName: booking.serviceName || 'your appointment',
        bookingDate: parts,
        bookingTime: time,
        staffName: booking.staffName || 'our team',
      };
      if (scheduledFor > new Date()) await this.emailService.enqueueEmail({
        tenantId: booking.tenantId || tenant.id,
        recipientEmail: booking.clientEmail,
        recipientName: booking.clientName || booking.clientNameFallback,
        replyToEmail: tenant.replyToEmail || undefined,
        templateKey: 'appointment-reminder',
        templateDataJson: {
          ...emailBrandingTemplateData(settings.branding),
          tenantPrimaryColor: tenant.primaryColor,
          customerName: replacements.customerName,
          bookingDate: parts,
          bookingTime: time,
          serviceName: replacements.serviceName,
          appointmentDateTime: fmt.format(startTime),
          reminderHours: h,
          ...renderAutomatedEmailCopy(template, replacements),
        },
        idempotencyKey: `appointment-reminder-email:${bookingId}:${idSuffix}:${h}`,
        relatedEntityType: 'appointment',
        relatedEntityId: bookingId,
        scheduledFor,
      }, tx);
    }
  }

  async getBookingsByDateRange(tenantId: string, from: Date, to: Date, limit: number) {
    const bookings = await this.repository.getBookingsByDateRange(tenantId, from, to, limit);
    return bookings.map(a => ({
      id: a.id,
      startTime: a.startTime.toISOString(),
      endTime: a.endTime.toISOString(),
      status: a.status,
      serviceName: a.serviceName || 'Unknown Service',
      staffName: a.staffName || 'Unknown Staff',
      clientName: a.crmClientName || a.clientNameFallback || 'Walk-in'
    }));
  }

  private bookingReadScope(auth: BookingAuthContext) {
    const permissions = auth.permissions;
    const canViewAll = auth.role === 'owner' || Boolean(permissions?.includes('BOOKINGS_VIEW_ALL'));
    const canViewOwn = canViewAll || !permissions || permissions.includes('BOOKINGS_VIEW_OWN');
    if (!canViewOwn) throw Object.assign(new Error('You do not have permission to view this calendar.'), { code: 'BOOKING_ACCESS_DENIED', statusCode: 403 });
    return { tenantId: auth.tenantId, ownStaffUserId: canViewAll ? undefined : (auth.tenantUserId || auth.authUserId) };
  }

  async getOperationalBookings(auth: BookingAuthContext, query: BookingOperationsQuery, now = new Date()): Promise<BookingOperationsResponse> {
    const db = getDatabase();
    const [tenant] = await db.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, auth.tenantId)).limit(1);
    if (!tenant) throw Object.assign(new Error('Business not found.'), { code: 'TENANT_NOT_FOUND', statusCode: 404 });
    const result = await this.repository.listOperationalBookings(this.bookingReadScope(auth), query);
    const items = result.rows.map((row: OperationalRow) => mapOperationalBooking(row, tenant.timezone, now));
    const summary = {
      total: Number(result.aggregate.total || 0),
      confirmed: Number(result.aggregate.confirmed || 0),
      completed: Number(result.aggregate.completed || 0),
      cancelled: Number(result.aggregate.cancelled || 0),
      noShow: Number(result.aggregate.noShow || 0),
      awaitingPayment: Number(result.aggregate.awaitingPayment || 0),
      incompleteForms: Number(result.aggregate.incompleteForms || 0),
      requiresAttention: Number(result.aggregate.requiresAttention || 0),
    };
    return { items, meta: { page: query.page, limit: query.limit, total: summary.total, hasMore: query.page * query.limit < summary.total }, summary };
  }

  async getOperationalBooking(auth: BookingAuthContext, bookingId: string, now = new Date()) {
    const db = getDatabase();
    const [tenant] = await db.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, auth.tenantId)).limit(1);
    const row = await this.repository.getOperationalBookingById(this.bookingReadScope(auth), bookingId);
    if (!row || !tenant) throw Object.assign(new Error('Booking not found.'), { code: 'BOOKING_NOT_FOUND', statusCode: 404 });
    return mapOperationalBooking(row, tenant.timezone, now);
  }

  async createManualBooking(
    auth: BookingAuthContext,
    serviceId: string,
    staffId: string,
    startTime: string,
    client: { name: string; email?: string; phone?: string },
    bookingChannel: string,
    options: { locationId?: string | null; internalNote?: string | null; intakeFormIds?: string[]; notifyCustomer?: boolean; confirmPastBooking?: boolean; walkIn?: boolean; requestId?: string } = {},
  ) {
    if (!canCreateBooking(auth)) {
      throw new Error('UNAUTHORIZED: Cannot create bookings');
    }

    const idempotencyKey = randomUUID();
    const requestedStart = new Date(startTime);
    const historical = requestedStart.getTime() < Date.now();
    if (historical && !options.confirmPastBooking) {
      throw Object.assign(new Error('Past bookings require confirmation.'), { code: 'PAST_BOOKING_CONFIRMATION_REQUIRED' });
    }
    
    // We utilize the same Postgres function as the public endpoint to maintain concurrency safety
    // For manual bookings, payment is defaulted to pay_later
    const db = getDatabase();
    const booking = await db.transaction(async tx => {
      let created: any;
      {
        const [[service], [staff]] = await Promise.all([
          tx.select({ id: services.id, duration: services.duration, price: services.price, discount: services.discount }).from(services).where(and(eq(services.id, serviceId), eq(services.tenantId, auth.tenantId), eq(services.isActive, true))).limit(1),
          tx.select({ id: users.id }).from(users).where(and(eq(users.id, staffId), eq(users.tenantId, auth.tenantId), eq(users.accountStatus, 'ACTIVE'))).limit(1),
        ]);
        if (!service) throw new Error('Tenant or service not found');
        if (!staff) throw new Error('Staff member not found');
        const requestedEnd = new Date(requestedStart.getTime() + service.duration * 60_000);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${staffId}::text || ${startTime}::timestamptz::date::text, 0))`);
        const conflict = await tx.select({ id: appointments.id }).from(appointments).where(and(
          eq(appointments.tenantId, auth.tenantId),
          eq(appointments.userId, staffId),
          notInArray(appointments.status, ['CANCELLED', 'NO_SHOW']),
          lt(appointments.startTime, requestedEnd),
          gt(appointments.endTime, requestedStart),
        )).limit(1);
        if (conflict.length) throw new Error('Slot is no longer available');
        const normalizedEmail = client.email?.trim().toLowerCase() || null;
        let [customer] = normalizedEmail ? await tx.select().from(clients).where(and(eq(clients.tenantId, auth.tenantId), eq(clients.email, normalizedEmail))).limit(1) : [];
        if (customer) {
          [customer] = await tx.update(clients).set({ name: client.name.trim(), phone: client.phone?.trim() || null, updatedAt: new Date() }).where(eq(clients.id, customer.id)).returning();
        } else {
          [customer] = await tx.insert(clients).values({ tenantId: auth.tenantId, name: client.name.trim(), email: normalizedEmail, phone: client.phone?.trim() || null }).returning();
        }
        const inserted = await tx.execute(sql`
          insert into appointments (
            tenant_id, user_id, client_id, client_name, service_id, start_time, end_time,
            status, idempotency_key, payment_mode, payment_status, quoted_amount,
            booking_channel, location_id, notes
          ) values (
            ${auth.tenantId}::uuid, ${staffId}::uuid, ${customer.id}::uuid, ${client.name.trim()},
            ${serviceId}::uuid, ${requestedStart}, ${requestedEnd}, ${historical ? 'COMPLETED' : options.walkIn ? 'CHECKED_IN' : 'CONFIRMED'},
            ${idempotencyKey}::uuid, 'pay_later', 'NOT_REQUIRED', ${Math.max(0, service.price - service.discount)},
            ${bookingChannel}, ${options.locationId || null}::uuid, ${options.internalNote || null}
          )
          returning id, public_reference, status
        `);
        const appointment = inserted.rows[0] as { id: string; public_reference: string; status: string };
        created = { appointment_id: appointment.id, booking_reference: appointment.public_reference, appointment_status: appointment.status };
      }
      if (!created) throw new Error('Booking could not be created');
      const appointmentId = created.appointment_id || created.id;
      const auditTable = await tx.execute(sql`select to_regclass('public.booking_audit_events') as table_name`);
      if ((auditTable.rows[0] as { table_name?: string | null } | undefined)?.table_name) {
        await tx.insert(bookingAuditEvents).values({
          tenantId: auth.tenantId,
          appointmentId,
          actingUserId: auth.tenantUserId,
          action: 'BOOKING_CREATED',
          newValues: { startTime, staffId, serviceId, locationId: options.locationId || null },
          requestId: options.requestId,
          bookingSource: auth.role === 'owner' ? 'ADMIN_CREATED' : 'STAFF_CREATED',
        });
      }
      return created;
    });

    if (!booking) {
      throw new Error('Booking could not be created');
    }

    const appointmentId = booking.appointment_id || booking.id;
    if (options.intakeFormIds?.length) {
      const [createdAppointment] = await db.select({ clientId: appointments.clientId }).from(appointments)
        .where(and(eq(appointments.id, appointmentId), eq(appointments.tenantId, auth.tenantId))).limit(1);
      if (createdAppointment?.clientId) {
        const formsService = new FormsService();
        for (const formId of options.intakeFormIds) {
          try {
            await formsService.createAssignment(
              { tenantId: auth.tenantId, userId: auth.tenantUserId || auth.authUserId, role: auth.role },
              { formId, clientId: createdAppointment.clientId, appointmentId, deliveryMethod: options.notifyCustomer === false ? 'COPY_LINK' : 'EMAIL' },
              env.FORM_ASSIGNMENT_EXPIRY_DAYS,
            );
          } catch {
            // Legacy deployments do not have appointment intake-status columns.
            // The booking remains valid and the form can be assigned again from its detail page.
          }
        }
      }
    }

    return booking;
  }

  async createBlockedTime(auth: BookingAuthContext, input: CreateBlockedTimeRequest, requestId?: string) {
    if (!canCreateBooking(auth)) throw new Error('UNAUTHORIZED: Cannot block calendar time');
    const db = getDatabase();
    return db.transaction(async tx => {
      const [staff] = await tx.select({ id: users.id }).from(users).where(and(
        eq(users.id, input.staffId), eq(users.tenantId, auth.tenantId), eq(users.accountStatus, 'ACTIVE'),
      )).limit(1);
      if (!staff) throw new Error('UNAUTHORIZED: Team member not found');
      const start = new Date(input.startTime);
      const end = new Date(start.getTime() + input.durationMinutes * 60_000);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.staffId}::text || ${input.startTime}::timestamptz::date::text, 0))`);
      const conflict = await tx.select({ id: appointments.id }).from(appointments).where(and(
        eq(appointments.tenantId, auth.tenantId), eq(appointments.userId, input.staffId),
        notInArray(appointments.status, ['CANCELLED', 'NO_SHOW']),
        lt(appointments.startTime, end), gt(appointments.endTime, start),
      )).limit(1);
      if (conflict.length) throw new Error('SLOT_UNAVAILABLE');
      const inserted = await tx.execute(sql`
        insert into appointments (
          tenant_id, user_id, client_name, start_time, end_time, status,
          idempotency_key, payment_mode, payment_status, quoted_amount,
          booking_channel, notes
        ) values (
          ${auth.tenantId}::uuid, ${input.staffId}::uuid, 'Blocked time', ${start}, ${end}, 'BLOCKED',
          ${randomUUID()}::uuid, 'pay_later', 'NOT_REQUIRED', 0,
          'in_shop', ${input.reason}
        ) returning id
      `);
      const block = inserted.rows[0] as { id: string };
      const auditTable = await tx.execute(sql`select to_regclass('public.booking_audit_events') as table_name`);
      if ((auditTable.rows[0] as any)?.table_name) await tx.insert(bookingAuditEvents).values({
        tenantId: auth.tenantId, appointmentId: block.id, actingUserId: auth.tenantUserId,
        action: 'BOOKING_CREATED', newValues: { type: 'BLOCKED_TIME', ...input }, requestId,
        bookingSource: auth.role === 'owner' ? 'ADMIN_CREATED' : 'STAFF_CREATED',
      });
      return block;
    });
  }

  async removeBlockedTime(auth: BookingAuthContext, bookingId: string, requestId?: string) {
    if (!canCreateBooking(auth)) throw new Error('UNAUTHORIZED: Cannot remove blocked time');
    const db = getDatabase();
    return db.transaction(async tx => {
      const result = await tx.execute(sql`
        update appointments set status = 'CANCELLED', updated_at = now()
        where id = ${bookingId}::uuid and tenant_id = ${auth.tenantId}::uuid and status = 'BLOCKED'
        returning id
      `);
      if (!result.rows.length) throw new Error('NOT_FOUND');
      const auditTable = await tx.execute(sql`select to_regclass('public.booking_audit_events') as table_name`);
      if ((auditTable.rows[0] as any)?.table_name) await tx.insert(bookingAuditEvents).values({
        tenantId: auth.tenantId, appointmentId: bookingId, actingUserId: auth.tenantUserId,
        action: 'STATUS_CHANGED', newValues: { fromStatus: 'BLOCKED', status: 'CANCELLED' },
        requestId, bookingSource: auth.role === 'owner' ? 'ADMIN_CREATED' : 'STAFF_CREATED',
      });
    });
  }

  async createPublicBooking(
    tenantId: string,
    serviceId: string,
    staffId: string,
    startTime: string,
    client: { name: string; email?: string; phone?: string },
    paymentMode: string,
    payNow: boolean,
    idempotencyKey: string,
    bookingChannel: string,
    mobileAddress?: any,
    resourceId?: string | null,
    tx?: any,
  ) {
    const booking = await this.repository.createBookingUsingDbFunction(
      tenantId,
      serviceId,
      staffId,
      startTime,
      client,
      paymentMode,
      payNow,
      idempotencyKey,
      bookingChannel,
      mobileAddress,
      resourceId,
      tx,
    );

    if (!booking) {
      throw new Error('Booking could not be created');
    }

    return booking;
  }

  async notifyPublicBookingConfirmed(tenantId: string, bookingId: string, eventKey: string, tx?: any) {
    const db = tx || getDatabase();
    const booking = await this.repository.getBookingById(tenantId, bookingId, db);
    if (!booking || booking.status !== 'CONFIRMED') return;
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) return;
    const settings = await this.emailSettings.get(tenantId, db);
    const tenantName = settings.branding.businessName;
    const localDateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: tenant.timezone }).format(booking.startTime);
    const bookingDate = new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeZone: tenant.timezone }).format(booking.startTime);
    const bookingTime = new Intl.DateTimeFormat('en-GB', { timeStyle: 'short', timeZone: tenant.timezone }).format(booking.startTime);
    const replacements = {
      businessName: tenantName,
      customerName: booking.clientName || booking.clientNameFallback || 'there',
      serviceName: booking.serviceName || 'Service',
      staffName: booking.staffName || 'our team',
      bookingDate,
      bookingTime,
    };

    if (settings.bookingConfirmationEnabled && booking.clientEmail) {
      await this.emailService.enqueueEmail({
        tenantId,
        recipientEmail: booking.clientEmail,
        recipientName: booking.clientName || booking.clientNameFallback,
        replyToEmail: tenant.replyToEmail || undefined,
        templateKey: 'booking-confirmed',
        templateDataJson: {
          ...emailBrandingTemplateData(settings.branding),
          tenantPrimaryColor: tenant.primaryColor,
          customerName: replacements.customerName,
          serviceName: replacements.serviceName,
          startTime: booking.startTime.toISOString(),
          timezone: tenant.timezone,
          ...renderAutomatedEmailCopy(settings.templates.customerBookingConfirmation, replacements),
        },
        idempotencyKey: `public-booking-confirmed:${bookingId}`,
        relatedEntityType: 'appointment',
        relatedEntityId: bookingId,
      }, db);
    }
    await this.enqueueEmailReminders(db, tenant, booking, bookingId, booking.startTime, 'public-confirmed');

    const recipients = await db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(and(
      eq(users.tenantId, tenantId),
      eq(users.accountStatus, 'ACTIVE'),
      or(eq(users.role, 'owner'), eq(users.id, booking.userId)),
    ));
    for (const recipient of recipients) {
      if (settings.automations.businessBookingConfirmationEnabled) await this.emailService.enqueueEmail({
        tenantId,
        recipientEmail: recipient.email,
        recipientName: recipient.name,
        replyToEmail: settings.replyToEmail || undefined,
        templateKey: 'business-booking-confirmed',
        templateDataJson: {
          ...emailBrandingTemplateData(settings.branding),
          tenantPrimaryColor: tenant.primaryColor,
          recipientName: recipient.name,
          customerName: replacements.customerName,
          customerEmail: booking.clientEmail,
          customerPhone: booking.clientPhone,
          serviceName: replacements.serviceName,
          staffName: booking.staffName,
          bookingDate,
          bookingTime,
          ...renderAutomatedEmailCopy(settings.templates.businessBookingConfirmation, replacements),
        },
        idempotencyKey: `business-booking-confirmed:${bookingId}:${recipient.id}`,
        relatedEntityType: 'appointment',
        relatedEntityId: bookingId,
      }, db);
      const [existing] = await db.select({ id: internalNotifications.id }).from(internalNotifications).where(and(
        eq(internalNotifications.tenantId, tenantId),
        eq(internalNotifications.recipientUserId, recipient.id),
        eq(internalNotifications.type, 'BOOKING_CONFIRMED'),
        eq(internalNotifications.sourceId, bookingId),
      )).limit(1);
      if (!existing) await db.insert(internalNotifications).values({
        tenantId,
        recipientUserId: recipient.id,
        type: 'BOOKING_CONFIRMED',
        title: 'New booking confirmed',
        message: `${booking.serviceName || 'Service'} · ${localDateTime}`,
        sourceType: 'appointment',
        sourceId: bookingId,
      });
    }
    await this.businessEvents.emit({
      id: stableEventId('BOOKING_CONFIRMED', bookingId, eventKey),
      tenantId,
      type: 'BOOKING_CONFIRMED',
      occurredAt: new Date().toISOString(),
      sourceType: 'appointment',
      sourceId: bookingId,
      payload: { appointmentId: bookingId, status: 'CONFIRMED' },
    }, db);
  }

  async updateBookingStatus(auth: BookingAuthContext, bookingId: string, newStatus: string, requestId?: string) {
    const db = getDatabase();
    await db.transaction(async (tx) => {
      const booking = await this.repository.getBookingById(auth.tenantId, bookingId, tx);
      if (!booking) {
        throw new Error('NOT_FOUND');
      }

      const resource = {
        tenantId: booking.tenantId!,
        staffId: booking.userId,
        status: booking.status
      };

      if (!canUpdateBookingStatus(auth, resource, newStatus)) {
        throw new Error(`INVALID_TRANSITION: Cannot transition from ${booking.status} to ${newStatus} or insufficient permissions`);
      }

      await this.repository.updateBookingStatus(auth.tenantId, bookingId, newStatus, tx);
      await tx.insert(bookingAuditEvents).values({
        tenantId: auth.tenantId,
        appointmentId: bookingId,
        actingUserId: auth.tenantUserId,
        action: 'STATUS_CHANGED',
        previousValues: { status: booking.status },
        newValues: { status: newStatus },
        requestId,
        bookingSource: booking.bookingSource,
      });

      if (booking.status !== newStatus) {
        const eventType = newStatus === 'CONFIRMED' ? 'BOOKING_CONFIRMED' : newStatus === 'CANCELLED' ? 'BOOKING_CANCELLED' : newStatus === 'CHECKED_IN' ? 'APPOINTMENT_CHECKED_IN' : newStatus === 'COMPLETED' ? 'APPOINTMENT_COMPLETED' : null;
        if (eventType) await this.businessEvents.emit({ id: stableEventId(eventType,bookingId,newStatus), tenantId:auth.tenantId, type:eventType, occurredAt:new Date().toISOString(), sourceType:'appointment', sourceId:bookingId, payload:{ appointmentId:bookingId, previousStatus:booking.status, status:newStatus } },tx);
        const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, auth.tenantId)).limit(1);

        if (newStatus === 'CONFIRMED') await this.notifyPublicBookingConfirmed(auth.tenantId, bookingId, newStatus, tx);
        if (newStatus === 'CONFIRMED' && tenant?.smsEnabled && tenant.smsBookingConfirmationEnabled && booking.clientPhone) {
          const localTime = new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:tenant.timezone}).format(booking.startTime);
          await this.smsService.enqueue({tenantId:auth.tenantId,clientId:booking.clientId!,appointmentId:bookingId,recipientPhone:booking.clientPhone,templateKey:'booking-confirmed',templateData:{appointmentDateTime:localTime},idempotencyKey:`sms-confirm-${bookingId}`},tx);
          if(tenant.smsAppointmentRemindersEnabled && ['24_hours_before','48_hours_before','24_and_48_hours_before'].includes(tenant.smsReminderTiming)) {
            const hours=tenant.smsReminderTiming==='24_and_48_hours_before'?[48,24]:[tenant.smsReminderTiming.startsWith('48')?48:24];
            for(const h of hours){const scheduled=new Date(booking.startTime.getTime()-h*3600000);if(scheduled>new Date()) await this.smsService.enqueue({tenantId:auth.tenantId,clientId:booking.clientId!,appointmentId:bookingId,recipientPhone:booking.clientPhone,templateKey:'appointment-reminder',templateData:{appointmentDateTime:localTime},idempotencyKey:`sms-reminder-${bookingId}-${h}`,scheduledFor:scheduled,validUntil:booking.startTime},tx);}
          }
        }
        if (newStatus === 'CANCELLED' && tenant?.bookingCancellationEnabled && booking.clientEmail) {
          await this.emailService.enqueueEmail({
            tenantId: auth.tenantId,
            recipientEmail: booking.clientEmail,
            recipientName: booking.clientName || booking.clientNameFallback,
            replyToEmail: tenant.replyToEmail || undefined,
            templateKey: 'booking-cancelled',
            templateDataJson: {
              tenantName: tenant.senderDisplayName || tenant.name,
              tenantPrimaryColor: tenant.primaryColor,
              timezone: tenant.timezone,
              clientName: booking.clientName || booking.clientNameFallback,
              serviceName: booking.serviceName,
              staffName: booking.staffName,
              startTime: booking.startTime.toISOString(),
              location: booking.bookingChannel === 'mobile' ? booking.mobileAddress : 'In-Shop',
            },
            idempotencyKey: `cancel-${bookingId}-${newStatus}`,
            relatedEntityType: 'appointment',
            relatedEntityId: bookingId
          }, tx);
        }
        if(newStatus==='CANCELLED') {
          await this.smsService.cancelAppointmentReminders(auth.tenantId,bookingId,tx);
          if(tenant?.smsEnabled&&tenant.smsBookingCancellationEnabled&&booking.clientPhone) await this.smsService.enqueue({tenantId:auth.tenantId,clientId:booking.clientId!,appointmentId:bookingId,recipientPhone:booking.clientPhone,templateKey:'booking-cancelled',templateData:{appointmentDateTime:new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:tenant.timezone}).format(booking.startTime)},idempotencyKey:`sms-cancel-${bookingId}`},tx);
        }
      }
    });
  }

  async rescheduleBooking(auth: BookingAuthContext, bookingId: string, staffId: string | undefined, startTimeStr: string, options: { locationId?: string | null; resourceId?: string | null; notifyCustomer?: boolean; reason?: string; requestId?: string } = {}) {
    const db = getDatabase();
    await db.transaction(async (tx) => {
      const booking = await this.repository.getBookingById(auth.tenantId, bookingId, tx);
      if (!booking) {
        throw new Error('NOT_FOUND');
      }

      const resource = {
        tenantId: booking.tenantId!,
        staffId: booking.userId,
        status: booking.status
      };

      if (!canRescheduleBooking(auth, resource)) {
        throw new Error('UNAUTHORIZED: Cannot reschedule this booking or invalid status');
      }

      const [service] = await tx.select({ duration: services.duration, bufferTime: sql<number>`0` })
        .from(services).where(and(eq(services.id, booking.serviceId!), eq(services.tenantId, auth.tenantId))).limit(1);
      
      if (!service) {
        throw new Error('INVALID_SERVICE: Service invalid');
      }

      const newStart = new Date(startTimeStr);
      const targetStaffId = staffId || booking.userId;
      const newEnd = new Date(newStart.getTime() + service.duration * 60000);
      const endWithBuffer = new Date(newStart.getTime() + (service.duration + service.bufferTime) * 60000);

      const overlaps = await this.repository.getOverlappingAppointments(
        auth.tenantId,
        targetStaffId,
        bookingId,
        newStart,
        endWithBuffer
      );

      if (overlaps.length > 0) {
        throw new Error('SLOT_UNAVAILABLE');
      }

      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, auth.tenantId)).limit(1);
      if (!tenant) throw new Error('NOT_FOUND');

      await this.repository.rescheduleBooking(auth.tenantId, bookingId, targetStaffId, newStart, newEnd, tx, { locationId: options.locationId, resourceId: options.resourceId });
      const auditTable = await tx.execute(sql`select to_regclass('public.booking_audit_events') as table_name`);
      if ((auditTable.rows[0] as { table_name?: string | null } | undefined)?.table_name) await tx.insert(bookingAuditEvents).values({
        tenantId: auth.tenantId,
        appointmentId: bookingId,
        actingUserId: auth.tenantUserId,
        action: 'BOOKING_RESCHEDULED',
        previousValues: { startTime: booking.startTime.toISOString(), endTime: booking.endTime.toISOString(), staffId: booking.userId, locationId: booking.locationId, resourceId: booking.resourceId },
        newValues: { startTime: newStart.toISOString(), endTime: newEnd.toISOString(), staffId: targetStaffId, locationId: options.locationId ?? booking.locationId, resourceId: options.resourceId ?? booking.resourceId },
        reason: options.reason,
        requestId: options.requestId,
        bookingSource: booking.bookingSource,
      });
      await this.businessEvents.emit({ id:stableEventId('BOOKING_RESCHEDULED',bookingId,newStart.toISOString()), tenantId:auth.tenantId, type:'BOOKING_RESCHEDULED', occurredAt:new Date().toISOString(), sourceType:'appointment', sourceId:bookingId, payload:{appointmentId:bookingId,previousStartTime:booking.startTime.toISOString(),startTime:newStart.toISOString()} },tx);
      await this.smsService.cancelAppointmentReminders(auth.tenantId,bookingId,tx);
      await this.emailService.cancelAppointmentReminders(auth.tenantId,bookingId,tx);

      if (options.notifyCustomer !== false && tenant?.bookingRescheduleEnabled && booking.clientEmail) {
        await this.emailService.enqueueEmail({
          tenantId: auth.tenantId,
          recipientEmail: booking.clientEmail,
          recipientName: booking.clientName || booking.clientNameFallback,
          replyToEmail: tenant.replyToEmail || undefined,
          templateKey: 'booking-rescheduled',
          templateDataJson: {
            tenantName: tenant.senderDisplayName || tenant.name,
            tenantPrimaryColor: tenant.primaryColor,
            timezone: tenant.timezone,
            clientName: booking.clientName || booking.clientNameFallback,
            serviceName: booking.serviceName,
            staffName: booking.staffName,
            startTime: newStart.toISOString(),
            location: booking.bookingChannel === 'mobile' ? booking.mobileAddress : 'In-Shop',
          },
          idempotencyKey: `reschedule-${bookingId}-${newStart.getTime()}`,
          relatedEntityType: 'appointment',
          relatedEntityId: bookingId
        }, tx);
      }
      if (tenant?.bookingRescheduleEnabled) {
        const businessRecipients = await tx.select({ id: users.id, email: users.email, name: users.name }).from(users).where(and(
          eq(users.tenantId, auth.tenantId),
          eq(users.accountStatus, 'ACTIVE'),
          or(eq(users.role, 'owner'), eq(users.id, targetStaffId)),
        ));
        const localDateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: tenant.timezone }).format(newStart);
        for (const recipient of businessRecipients) {
          await this.emailService.enqueueEmail({
            tenantId: auth.tenantId,
            recipientEmail: recipient.email,
            recipientName: recipient.name,
            replyToEmail: tenant.replyToEmail || undefined,
            templateKey: 'staff-operational-notification',
            templateDataJson: {
              tenantName: tenant.senderDisplayName || tenant.name,
              tenantPrimaryColor: tenant.primaryColor,
              staffName: recipient.name,
              message: `Booking rescheduled: ${booking.serviceName || 'Service'} for ${booking.clientName || booking.clientNameFallback || 'a customer'} is now on ${localDateTime}.`,
            },
            idempotencyKey: `business-booking-rescheduled:${bookingId}:${newStart.getTime()}:${recipient.id}`,
            relatedEntityType: 'appointment',
            relatedEntityId: bookingId,
          }, tx);
        }
      }
      if(options.notifyCustomer !== false&&tenant?.smsEnabled&&tenant.smsBookingRescheduleEnabled&&booking.clientPhone){const localTime=new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:tenant.timezone}).format(newStart);await this.smsService.enqueue({tenantId:auth.tenantId,clientId:booking.clientId!,appointmentId:bookingId,recipientPhone:booking.clientPhone,templateKey:'booking-rescheduled',templateData:{appointmentDateTime:localTime},idempotencyKey:`sms-reschedule-${bookingId}-${newStart.getTime()}`},tx);if(tenant.smsAppointmentRemindersEnabled){const hours=tenant.smsReminderTiming==='24_and_48_hours_before'?[48,24]:tenant.smsReminderTiming==='none'?[]:[tenant.smsReminderTiming.startsWith('48')?48:24];for(const h of hours){const scheduled=new Date(newStart.getTime()-h*3600000);if(scheduled>new Date())await this.smsService.enqueue({tenantId:auth.tenantId,clientId:booking.clientId!,appointmentId:bookingId,recipientPhone:booking.clientPhone,templateKey:'appointment-reminder',templateData:{appointmentDateTime:localTime},idempotencyKey:`sms-reminder-${bookingId}-${newStart.getTime()}-${h}`,scheduledFor:scheduled,validUntil:newStart},tx);}}}
      if(options.notifyCustomer !== false) await this.enqueueEmailReminders(tx, tenant, booking, bookingId, newStart, String(newStart.getTime()));
    });
  }

  async cancelBooking(auth: BookingAuthContext, bookingId: string, requestId?: string) {
    const db = getDatabase();
    await db.transaction(async (tx) => {
      const booking = await this.repository.getBookingById(auth.tenantId, bookingId, tx);
      if (!booking) {
        throw new Error('NOT_FOUND');
      }

      const resource = {
        tenantId: booking.tenantId!,
        staffId: booking.userId,
        status: booking.status
      };

      if (!canCancelBooking(auth, resource)) {
        throw new Error('UNAUTHORIZED: Cannot cancel this booking or invalid status');
      }

      await this.repository.updateBookingStatus(auth.tenantId, bookingId, 'CANCELLED', tx);
      await tx.insert(bookingAuditEvents).values({ tenantId: auth.tenantId, appointmentId: bookingId, actingUserId: auth.tenantUserId, action: 'BOOKING_CANCELLED', previousValues: { status: booking.status }, newValues: { status: 'CANCELLED' }, requestId, bookingSource: booking.bookingSource });
      if(booking.status!=='CANCELLED')await this.businessEvents.emit({ id:stableEventId('BOOKING_CANCELLED',bookingId,'CANCELLED'),tenantId:auth.tenantId,type:'BOOKING_CANCELLED',occurredAt:new Date().toISOString(),sourceType:'appointment',sourceId:bookingId,payload:{appointmentId:bookingId,previousStatus:booking.status,status:'CANCELLED'}},tx);
      await this.smsService.cancelAppointmentReminders(auth.tenantId,bookingId,tx);
      await this.emailService.cancelAppointmentReminders(auth.tenantId,bookingId,tx);

      if (booking.status !== 'CANCELLED') {
        const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, auth.tenantId)).limit(1);
        if (tenant?.bookingCancellationEnabled && booking.clientEmail) {
          await this.emailService.enqueueEmail({
            tenantId: auth.tenantId,
            recipientEmail: booking.clientEmail,
            recipientName: booking.clientName || booking.clientNameFallback,
            replyToEmail: tenant.replyToEmail || undefined,
            templateKey: 'booking-cancelled',
            templateDataJson: {
              tenantName: tenant.senderDisplayName || tenant.name,
              tenantPrimaryColor: tenant.primaryColor,
              timezone: tenant.timezone,
              clientName: booking.clientName || booking.clientNameFallback,
              serviceName: booking.serviceName,
              staffName: booking.staffName,
              startTime: booking.startTime.toISOString(),
              location: booking.bookingChannel === 'mobile' ? booking.mobileAddress : 'In-Shop',
            },
            idempotencyKey: `cancel-${bookingId}-${Date.now()}`,
            relatedEntityType: 'appointment',
            relatedEntityId: bookingId
          }, tx);
        }
        if (tenant?.bookingCancellationEnabled) {
          const businessRecipients = await tx.select({ id: users.id, email: users.email, name: users.name }).from(users).where(and(
            eq(users.tenantId, auth.tenantId),
            eq(users.accountStatus, 'ACTIVE'),
            or(eq(users.role, 'owner'), eq(users.id, booking.userId)),
          ));
          const localDateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: tenant.timezone }).format(booking.startTime);
          for (const recipient of businessRecipients) {
            await this.emailService.enqueueEmail({
              tenantId: auth.tenantId,
              recipientEmail: recipient.email,
              recipientName: recipient.name,
              replyToEmail: tenant.replyToEmail || undefined,
              templateKey: 'staff-operational-notification',
              templateDataJson: {
                tenantName: tenant.senderDisplayName || tenant.name,
                tenantPrimaryColor: tenant.primaryColor,
                staffName: recipient.name,
                message: `Booking cancelled: ${booking.serviceName || 'Service'} for ${booking.clientName || booking.clientNameFallback || 'a customer'} on ${localDateTime} has been cancelled.`,
              },
              idempotencyKey: `business-booking-cancelled:${bookingId}:${recipient.id}`,
              relatedEntityType: 'appointment',
              relatedEntityId: bookingId,
            }, tx);
          }
        }
        if(tenant?.smsEnabled&&tenant.smsBookingCancellationEnabled&&booking.clientPhone) await this.smsService.enqueue({tenantId:auth.tenantId,clientId:booking.clientId!,appointmentId:bookingId,recipientPhone:booking.clientPhone,templateKey:'booking-cancelled',templateData:{appointmentDateTime:new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:tenant.timezone}).format(booking.startTime)},idempotencyKey:`sms-cancel-${bookingId}`},tx);
      }
    });
  }
}
