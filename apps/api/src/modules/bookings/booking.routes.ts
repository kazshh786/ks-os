import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  StaffCreateBookingRequestSchema,
  CreateBlockedTimeRequestSchema,
  UpdateBookingStatusRequestSchema,
  RescheduleBookingRequestSchema,
  BookingOperationsQuerySchema,
  BookingOperationsResponseSchema,
  ERROR_CODES
} from '@ks-os/contracts';
import { BookingService } from './booking.service.js';
import { BookingDetailService } from './booking-detail.service.js';
import { EntitlementService } from '../agency/agency.service.js';

const bookingIdSchema = z.string().uuid();

function validationReason(error: z.ZodError) {
  const issue = error.issues[0];
  if (!issue) return 'Check the information provided and try again.';
  const field = issue.path.length ? issue.path.join('.') : 'request';
  return `${field}: ${issue.message}`;
}

const bookingsRoutes: FastifyPluginAsync = async (fastify) => {
  const bookingService = new BookingService();
  const bookingDetailService = new BookingDetailService();
  const entitlements = new EntitlementService();

  fastify.get('/api/v1/bookings', async (request, reply) => {
    request.requireAuth();

    const parsed = BookingOperationsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { code: 'INVALID_QUERY', message: validationReason(parsed.error) }
      });
    }

    try {
      const bookings = BookingOperationsResponseSchema.parse(await bookingService.getOperationalBookings(request.auth!, parsed.data));
      return reply.send({ success: true, data: bookings.items, meta: bookings.meta, summary: bookings.summary });
    } catch (err: any) {
      fastify.log.error(err);
      if (err.statusCode) return reply.code(err.statusCode).send({ success: false, error: { code: err.code || 'BOOKING_ACCESS_DENIED', message: err.message } });
      return reply.code(500).send({ success: false, error: { code: 'BOOKING_LIST_FAILED', message: 'The booking calendar could not be loaded because the server hit an unexpected error.' } });
    }
  });

  fastify.get('/api/v1/bookings/export.csv', async (request, reply) => {
    request.requireAuth();
    if (request.auth!.role !== 'owner' && !request.auth!.permissions.includes('REPORT_EXPORT')) {
      return reply.code(403).send({ success: false, error: { code: 'BOOKING_EXPORT_ACCESS_DENIED', message: 'Booking export permission is required.' } });
    }
    const parsed = BookingOperationsQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ success: false, error: { code: 'INVALID_QUERY', message: validationReason(parsed.error) } });
    const result = await bookingService.getOperationalBookings(request.auth!, { ...parsed.data, page: 1, limit: 250 });
    const csvValue = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = [
      ['Reference','Start','End','Customer','Service','Staff','Location','Status','Payment','Intake','Source'],
      ...result.items.map(item => [item.reference,item.startTime,item.endTime,item.customer.name,item.service.name,item.staff.name,item.location.name || '',item.status,item.paymentStatus,item.intakeStatus,item.source]),
    ];
    const lines = rows.map(row => row.map(csvValue).join(','));
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="bookings.csv"').send(lines.join('\r\n'));
  });

  fastify.get('/api/v1/bookings/:id', async (request, reply) => {
    request.requireAuth();
    const parsed = bookingIdSchema.safeParse((request.params as { id: string }).id);
    if (!parsed.success) return reply.code(400).send({ success: false, error: { code: 'INVALID_BOOKING_ID', message: 'The booking ID is not valid.' } });
    try {
      return reply.send({ success: true, data: await bookingDetailService.get(request.auth!, parsed.data) });
    } catch (error: any) {
      if (error.statusCode === 404) return reply.code(404).send({ success: false, error: { code: error.code, message: error.message } });
      throw error;
    }
  });

  fastify.post('/api/v1/bookings', async (request, reply) => {
    request.requireAuth();

    const parsed = StaffCreateBookingRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { code: ERROR_CODES.INVALID_BOOKING_REQUEST, message: validationReason(parsed.error) } });
    }

    const tenantId = request.auth!.tenantId;
    const { serviceId, staffId, startTime, client, bookingChannel } = parsed.data;

    try {
      await entitlements.assertUsageAvailable(tenantId, 'bookings.monthly');
      const booking = await bookingService.createManualBooking(
        request.auth!,
        serviceId,
        staffId,
        startTime,
        client,
        bookingChannel,
        {
          locationId: parsed.data.locationId,
          internalNote: parsed.data.internalNote,
          intakeFormIds: parsed.data.intakeFormIds,
          notifyCustomer: parsed.data.notifyCustomer,
          confirmPastBooking: parsed.data.confirmPastBooking,
          walkIn: parsed.data.walkIn,
          requestId: request.id,
        },
      );
      const appointmentId = booking.appointment_id || booking.id;
      try {
        await entitlements.recordUsageOverage(tenantId, 'bookings.monthly', appointmentId, parsed.data.walkIn ? 'WALK_IN' : 'STAFF_CREATED', request.id);
      } catch (auditError) {
        request.log.error(auditError, 'Booking was created but its usage-overage audit could not be recorded');
      }

      return reply.code(201).send({ success: true, bookingId: appointmentId });
    } catch (err: any) {
      fastify.log.error(err, 'Staff booking creation failed');
      if (err.code === 'ENTITLEMENT_USAGE_EXCEEDED') {
        return reply.code(409).send({ success: false, error: { code: err.code, message: err.message } });
      }
      const message = String(err?.message || '');
      if (/past bookings require confirmation/i.test(message)) {
        return reply.code(400).send({ success: false, error: { code: ERROR_CODES.PAST_BOOKING_CONFIRMATION_REQUIRED, message: 'This appointment is in the past. Confirm that it should be saved as a historical booking.' } });
      }
      if (/^UNAUTHORIZED:/i.test(message)) {
        return reply.code(403).send({ success: false, error: { code: ERROR_CODES.BOOKING_ACCESS_DENIED, message: message.replace(/^UNAUTHORIZED:\s*/i, '') || 'You do not have permission to create bookings.' } });
      }
      if (/tenant or service not found|service_not_available/i.test(message)) {
        return reply.code(400).send({ success: false, error: { code: ERROR_CODES.SERVICE_NOT_AVAILABLE, message: 'The selected service is no longer active or does not belong to this business.' } });
      }
      if (/staff member not found|staff_not_available/i.test(message)) {
        return reply.code(400).send({ success: false, error: { code: ERROR_CODES.STAFF_NOT_AVAILABLE, message: 'The selected team member is no longer active or available for this business.' } });
      }
      if (/invalid booking time/i.test(message)) {
        return reply.code(400).send({ success: false, error: { code: ERROR_CODES.INVALID_BOOKING_TIME, message: 'Choose a booking time at least five minutes from now and no more than 180 days ahead.' } });
      }
      if (/no longer available|outside booking channel schedule|slot_unavailable/i.test(message)) {
        return reply.code(409).send({ success: false, error: { code: ERROR_CODES.SLOT_UNAVAILABLE, message: 'That time is no longer available. Choose another time and try again.' } });
      }
      return reply.code(500).send({ success: false, error: { code: ERROR_CODES.BOOKING_CREATION_FAILED, message: 'The booking could not be saved because the server hit an unexpected error. Try again; if it repeats, use the reference shown with this error.' } });
    }
  });

  fastify.post('/api/v1/bookings/blocked-time', async (request, reply) => {
    request.requireAuth();
    const parsed = CreateBlockedTimeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { code: 'INVALID_BLOCKED_TIME', message: validationReason(parsed.error) } });
    }
    try {
      const block = await bookingService.createBlockedTime(request.auth!, parsed.data, request.id);
      return reply.code(201).send({ success: true, bookingId: block.id });
    } catch (err: any) {
      if (err.message === 'SLOT_UNAVAILABLE') return reply.code(409).send({ success: false, error: { code: 'SLOT_UNAVAILABLE', message: 'That time overlaps an existing booking or block.' } });
      if (err.message?.startsWith('UNAUTHORIZED')) return reply.code(403).send({ success: false, error: { code: 'BOOKING_ACCESS_DENIED', message: err.message.replace(/^UNAUTHORIZED:\s*/i, '') } });
      fastify.log.error(err, 'Blocked time creation failed');
      return reply.code(500).send({ success: false, error: { code: 'BLOCKED_TIME_CREATION_FAILED', message: 'The blocked time could not be saved because the server hit an unexpected error.' } });
    }
  });

  fastify.delete('/api/v1/bookings/:id/blocked-time', async (request, reply) => {
    request.requireAuth();
    const { id } = request.params as { id: string };
    try {
      await bookingService.removeBlockedTime(request.auth!, id, request.id);
      return reply.send({ success: true });
    } catch (err: any) {
      if (err.message === 'NOT_FOUND') return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'The blocked time no longer exists.' } });
      if (err.message?.startsWith('UNAUTHORIZED')) return reply.code(403).send({ success: false, error: { code: 'BOOKING_ACCESS_DENIED', message: err.message.replace(/^UNAUTHORIZED:\s*/i, '') } });
      fastify.log.error(err, 'Blocked time removal failed');
      return reply.code(500).send({ success: false, error: { code: 'BLOCKED_TIME_REMOVAL_FAILED', message: 'The blocked time could not be removed because the server hit an unexpected error.' } });
    }
  });

  fastify.patch('/api/v1/bookings/:id/status', async (request, reply) => {
    request.requireAuth();

    const { id } = request.params as { id: string };
    const parsed = UpdateBookingStatusRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { code: ERROR_CODES.INVALID_BOOKING_STATUS, message: validationReason(parsed.error) } });
    }

    try {
      await bookingService.updateBookingStatus(request.auth!, id, parsed.data.status, request.id);
      return reply.send({ success: true });
    } catch (err: any) {
      if (err.message === 'NOT_FOUND') {
        return reply.code(404).send({ success: false, error: { code: ERROR_CODES.BOOKING_NOT_FOUND, message: 'The booking no longer exists.' } });
      }
      if (err.message.startsWith('INVALID_TRANSITION')) {
        return reply.code(400).send({ success: false, error: { code: 'INVALID_BOOKING_TRANSITION', message: err.message.replace(/^INVALID_TRANSITION:?\s*/i, '') || 'That status change is not allowed from the booking’s current state.' } });
      }
      if (err.message.startsWith('UNAUTHORIZED')) {
        return reply.code(403).send({ success: false, error: { code: ERROR_CODES.BOOKING_ACCESS_DENIED, message: err.message.replace(/^UNAUTHORIZED:?\s*/i, '') || 'You do not have permission to change this booking.' } });
      }
      fastify.log.error(err);
      return reply.code(500).send({ success: false, error: { code: ERROR_CODES.BOOKING_UPDATE_FAILED, message: 'The booking status could not be updated because the server hit an unexpected error.' } });
    }
  });

  fastify.patch('/api/v1/bookings/:id/reschedule', async (request, reply) => {
    request.requireAuth();

    const { id } = request.params as { id: string };
    const parsed = RescheduleBookingRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { code: ERROR_CODES.INVALID_BOOKING_REQUEST, message: validationReason(parsed.error) } });
    }

    const { startTime, staffId } = parsed.data;

    try {
      await bookingService.rescheduleBooking(request.auth!, id, staffId, startTime, {
        locationId: parsed.data.locationId,
        resourceId: parsed.data.resourceId,
        notifyCustomer: parsed.data.notifyCustomer,
        reason: parsed.data.reason,
        requestId: request.id,
      });
      return reply.send({ success: true });
    } catch (err: any) {
      if (err.message === 'NOT_FOUND') {
        return reply.code(404).send({ success: false, error: { code: ERROR_CODES.BOOKING_NOT_FOUND, message: 'The booking no longer exists.' } });
      }
      if (err.message.startsWith('INVALID_STATUS')) {
        return reply.code(400).send({ success: false, error: { code: ERROR_CODES.INVALID_BOOKING_STATUS, message: err.message.replace(/^INVALID_STATUS:?\s*/i, '') || 'This booking cannot be rescheduled in its current status.' } });
      }
      if (err.message.startsWith('UNAUTHORIZED')) {
        return reply.code(403).send({ success: false, error: { code: ERROR_CODES.BOOKING_ACCESS_DENIED, message: err.message.replace(/^UNAUTHORIZED:?\s*/i, '') || 'You do not have permission to reschedule this booking.' } });
      }
      if (err.message.startsWith('INVALID_SERVICE')) {
        return reply.code(400).send({ success: false, error: { code: ERROR_CODES.SERVICE_NOT_AVAILABLE, message: err.message.replace(/^INVALID_SERVICE:?\s*/i, '') || 'The service is not available for this booking.' } });
      }
      if (err.message === 'SLOT_UNAVAILABLE') {
        return reply.code(409).send({ success: false, error: { code: ERROR_CODES.SLOT_UNAVAILABLE, message: 'That time is no longer available. Choose another time.' } });
      }
      fastify.log.error(err);
      return reply.code(500).send({ success: false, error: { code: ERROR_CODES.BOOKING_UPDATE_FAILED, message: 'The booking could not be rescheduled because the server hit an unexpected error.' } });
    }
  });

  fastify.post('/api/v1/bookings/:id/cancel', async (request, reply) => {
    request.requireAuth();
    const { id } = request.params as { id: string };
    try {
      await bookingService.cancelBooking(request.auth!, id, request.id);
      return reply.send({ success: true });
    } catch (err: any) {
      if (err.message === 'NOT_FOUND') {
        return reply.code(404).send({ success: false, error: { code: ERROR_CODES.BOOKING_NOT_FOUND, message: 'The booking no longer exists.' } });
      }
      if (err.message.startsWith('INVALID_STATUS')) {
        return reply.code(400).send({ success: false, error: { code: ERROR_CODES.INVALID_BOOKING_STATUS, message: err.message.replace(/^INVALID_STATUS:?\s*/i, '') || 'This booking cannot be cancelled in its current status.' } });
      }
      if (err.message.startsWith('UNAUTHORIZED')) {
        return reply.code(403).send({ success: false, error: { code: ERROR_CODES.BOOKING_ACCESS_DENIED, message: err.message.replace(/^UNAUTHORIZED:?\s*/i, '') || 'You do not have permission to cancel this booking.' } });
      }
      fastify.log.error(err);
      return reply.code(500).send({ success: false, error: { code: ERROR_CODES.BOOKING_UPDATE_FAILED, message: 'The booking could not be cancelled because the server hit an unexpected error.' } });
    }
  });
};

export default bookingsRoutes;
