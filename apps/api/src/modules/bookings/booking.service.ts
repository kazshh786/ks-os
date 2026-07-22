import { BookingRepository } from './booking.repository.js';
import { getDatabase, services, tenants } from '@ks-os/database';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
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

export class BookingService {
  private repository: BookingRepository;
  private emailService: EmailService;
  private smsService: SmsService;
  private businessEvents = new BusinessEventsService();

  constructor() {
    this.repository = new BookingRepository();
    this.emailService = new EmailService();
    this.smsService = new SmsService();
  }

  private async enqueueEmailReminders(tx:any, tenant:any, booking:any, bookingId:string, startTime:Date, idSuffix:string) {
    if (!tenant?.appointmentRemindersEnabled || !booking.clientEmail) return;
    const hours = tenant.smsReminderTiming === '24_and_48_hours_before' ? [48, 24] : tenant.smsReminderTiming === 'none' ? [] : [tenant.smsReminderTiming?.startsWith('48') ? 48 : 24];
    const fmt = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: tenant.timezone });
    const parts = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: tenant.timezone }).format(startTime);
    const time = new Intl.DateTimeFormat('en-GB', { timeStyle: 'short', timeZone: tenant.timezone }).format(startTime);
    for (const h of hours) {
      const scheduledFor = new Date(startTime.getTime() - h * 3600000);
      if (scheduledFor > new Date()) await this.emailService.enqueueEmail({
        tenantId: booking.tenantId || tenant.id,
        recipientEmail: booking.clientEmail,
        recipientName: booking.clientName || booking.clientNameFallback,
        replyToEmail: tenant.replyToEmail || undefined,
        templateKey: 'appointment-reminder',
        templateDataJson: { tenantName: tenant.senderDisplayName || tenant.name, tenantPrimaryColor: tenant.primaryColor, customerName: booking.clientName || booking.clientNameFallback || 'there', bookingDate: parts, bookingTime: time, serviceName: booking.serviceName || 'your appointment', appointmentDateTime: fmt.format(startTime) },
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

  async createManualBooking(
    auth: BookingAuthContext,
    serviceId: string,
    staffId: string,
    startTime: string,
    client: { name: string; email?: string; phone?: string },
    bookingChannel: string
  ) {
    if (!canCreateBooking(auth)) {
      throw new Error('UNAUTHORIZED: Cannot create bookings');
    }

    const idempotencyKey = randomUUID();
    
    // We utilize the same Postgres function as the public endpoint to maintain concurrency safety
    // For manual bookings, payment is defaulted to pay_later
    const booking = await this.repository.createBookingUsingDbFunction(
      auth.tenantId,
      serviceId,
      staffId,
      startTime,
      client,
      'pay_later',
      false,
      idempotencyKey,
      bookingChannel
    );

    if (!booking) {
      throw new Error('Booking could not be created');
    }

    return booking;
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
    resourceId?: string | null
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
      resourceId
    );

    if (!booking) {
      throw new Error('Booking could not be created');
    }

    return booking;
  }

  async updateBookingStatus(auth: BookingAuthContext, bookingId: string, newStatus: string) {
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

      if (booking.status !== newStatus) {
        const eventType = newStatus === 'CONFIRMED' ? 'BOOKING_CONFIRMED' : newStatus === 'CANCELLED' ? 'BOOKING_CANCELLED' : newStatus === 'CHECKED_IN' ? 'APPOINTMENT_CHECKED_IN' : newStatus === 'COMPLETED' ? 'APPOINTMENT_COMPLETED' : null;
        if (eventType) await this.businessEvents.emit({ id: stableEventId(eventType,bookingId,newStatus), tenantId:auth.tenantId, type:eventType, occurredAt:new Date().toISOString(), sourceType:'appointment', sourceId:bookingId, payload:{ appointmentId:bookingId, previousStatus:booking.status, status:newStatus } },tx);
        const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, auth.tenantId)).limit(1);
        
        if (newStatus === 'CONFIRMED' && tenant?.bookingConfirmationEnabled && booking.clientEmail) {
          await this.emailService.enqueueEmail({
            tenantId: auth.tenantId,
            recipientEmail: booking.clientEmail,
            recipientName: booking.clientName || booking.clientNameFallback,
            replyToEmail: tenant.replyToEmail || undefined,
            templateKey: 'booking-confirmed',
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
            idempotencyKey: `confirm-${bookingId}-${newStatus}`,
            relatedEntityType: 'appointment',
            relatedEntityId: bookingId
          }, tx);
        }
        if (newStatus === 'CONFIRMED' && tenant?.smsEnabled && tenant.smsBookingConfirmationEnabled && booking.clientPhone) {
          const localTime = new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:tenant.timezone}).format(booking.startTime);
          await this.smsService.enqueue({tenantId:auth.tenantId,clientId:booking.clientId!,appointmentId:bookingId,recipientPhone:booking.clientPhone,templateKey:'booking-confirmed',templateData:{appointmentDateTime:localTime},idempotencyKey:`sms-confirm-${bookingId}`},tx);
          if(tenant.smsAppointmentRemindersEnabled && ['24_hours_before','48_hours_before','24_and_48_hours_before'].includes(tenant.smsReminderTiming)) {
            const hours=tenant.smsReminderTiming==='24_and_48_hours_before'?[48,24]:[tenant.smsReminderTiming.startsWith('48')?48:24];
            for(const h of hours){const scheduled=new Date(booking.startTime.getTime()-h*3600000);if(scheduled>new Date()) await this.smsService.enqueue({tenantId:auth.tenantId,clientId:booking.clientId!,appointmentId:bookingId,recipientPhone:booking.clientPhone,templateKey:'appointment-reminder',templateData:{appointmentDateTime:localTime},idempotencyKey:`sms-reminder-${bookingId}-${h}`,scheduledFor:scheduled,validUntil:booking.startTime},tx);}
          }
        }
        if (newStatus === 'CONFIRMED') await this.enqueueEmailReminders(tx, tenant, booking, bookingId, booking.startTime, 'confirmed');
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

  async rescheduleBooking(auth: BookingAuthContext, bookingId: string, staffId: string, startTimeStr: string) {
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

      const [service] = await tx.select({ duration: services.duration, bufferTime: services.bufferTime })
        .from(services).where(and(eq(services.id, booking.serviceId!), eq(services.tenantId, auth.tenantId))).limit(1);
      
      if (!service) {
        throw new Error('INVALID_SERVICE: Service invalid');
      }

      const newStart = new Date(startTimeStr);
      const newEnd = new Date(newStart.getTime() + service.duration * 60000);
      const endWithBuffer = new Date(newStart.getTime() + (service.duration + service.bufferTime) * 60000);

      const overlaps = await this.repository.getOverlappingAppointments(
        auth.tenantId,
        staffId,
        bookingId,
        newStart,
        endWithBuffer
      );

      if (overlaps.length > 0) {
        throw new Error('SLOT_UNAVAILABLE');
      }

      await this.repository.rescheduleBooking(auth.tenantId, bookingId, staffId, newStart, newEnd, tx);
      await this.businessEvents.emit({ id:stableEventId('BOOKING_RESCHEDULED',bookingId,newStart.toISOString()), tenantId:auth.tenantId, type:'BOOKING_RESCHEDULED', occurredAt:new Date().toISOString(), sourceType:'appointment', sourceId:bookingId, payload:{appointmentId:bookingId,previousStartTime:booking.startTime.toISOString(),startTime:newStart.toISOString()} },tx);
      await this.smsService.cancelAppointmentReminders(auth.tenantId,bookingId,tx);
      await this.emailService.cancelAppointmentReminders(auth.tenantId,bookingId,tx);

      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, auth.tenantId)).limit(1);
      if (tenant?.bookingRescheduleEnabled && booking.clientEmail) {
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
      if(tenant?.smsEnabled&&tenant.smsBookingRescheduleEnabled&&booking.clientPhone){const localTime=new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:tenant.timezone}).format(newStart);await this.smsService.enqueue({tenantId:auth.tenantId,clientId:booking.clientId!,appointmentId:bookingId,recipientPhone:booking.clientPhone,templateKey:'booking-rescheduled',templateData:{appointmentDateTime:localTime},idempotencyKey:`sms-reschedule-${bookingId}-${newStart.getTime()}`},tx);if(tenant.smsAppointmentRemindersEnabled){const hours=tenant.smsReminderTiming==='24_and_48_hours_before'?[48,24]:tenant.smsReminderTiming==='none'?[]:[tenant.smsReminderTiming.startsWith('48')?48:24];for(const h of hours){const scheduled=new Date(newStart.getTime()-h*3600000);if(scheduled>new Date())await this.smsService.enqueue({tenantId:auth.tenantId,clientId:booking.clientId!,appointmentId:bookingId,recipientPhone:booking.clientPhone,templateKey:'appointment-reminder',templateData:{appointmentDateTime:localTime},idempotencyKey:`sms-reminder-${bookingId}-${newStart.getTime()}-${h}`,scheduledFor:scheduled,validUntil:newStart},tx);}}}
      await this.enqueueEmailReminders(tx, tenant, booking, bookingId, newStart, String(newStart.getTime()));
    });
  }

  async cancelBooking(auth: BookingAuthContext, bookingId: string) {
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
        if(tenant?.smsEnabled&&tenant.smsBookingCancellationEnabled&&booking.clientPhone) await this.smsService.enqueue({tenantId:auth.tenantId,clientId:booking.clientId!,appointmentId:bookingId,recipientPhone:booking.clientPhone,templateKey:'booking-cancelled',templateData:{appointmentDateTime:new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:tenant.timezone}).format(booking.startTime)},idempotencyKey:`sms-cancel-${bookingId}`},tx);
      }
    });
  }
}
