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
import { EntitlementService } from '../agency/agency.service.js';

const bookingIdSchema = z.string().uuid();

const bookingsRoutes: FastifyPluginAsync = async (fastify) => {
  const bookingService = new BookingService();
  const entitlements = new EntitlementService();

  fastify.get('/api/v1/bookings', async (request, reply) => {
    request.requireAuth();

    const parsed = BookingOperationsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { code: 'INVALID_QUERY', message: parsed.error.message }
      });
    }

    try {
      const bookings = BookingOperationsResponseSchema.parse(await bookingService.getOperationalBookings(request.auth!, parsed.data));
      return reply.send({ success: true, data: bookings.items, meta: bookings.meta, summary: bookings.summary });
    } catch (err: any) {
      fastify.log.error(err);
      if (err.statusCode) return reply.code(err.statusCode).send({ success: false, error: { code: err.code || 'BOOKING_ACCESS_DENIED', message: err.message } });
      return reply.code(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Could not fetch bookings' } });
    }
  });

  fastify.get('/api/v1/bookings/export.csv', async (request, reply) => {
    request.requireAuth();
    if (request.auth!.role !== 'owner' && !request.auth!.permissions.includes('REPORT_EXPORT')) {
      return reply.code(403).send({ success: false, error: { code: 'BOOKING_EXPORT_ACCESS_DENIED', message: 'Booking export permission is required.' } });
    }
    const parsed = BookingOperationsQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ success: false, error: { code: 'INVALID_QUERY', message: parsed.error.message } });
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
    if (!parsed.success) return reply.code(400).send({ success: false, error: { code: 'INVALID_BOOKING_ID', message: 'Invalid booking ID.' } });
    try {
      return reply.send({ success: true, data: await bookingService.getOperationalBooking(request.auth!, parsed.data) });
    } catch (error: any) {
      if (error.statusCode === 404) return reply.code(404).send({ success: false, error: { code: error.code, message: error.message } });
      throw error;
    }
  });

  fastify.post('/api/v1/bookings', async (request, reply) => {
    request.requireAuth();
    
    const parsed = StaffCreateBookingRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { code: ERROR_CODES.INVALID_BOOKING_REQUEST, message: 'Invalid booking data' } });
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
      
      return reply.code(201).send({ success: true, bookingId: booking.appointment_id });
    } catch (err: any) {
      fastify.log.error(err, 'Staff booking creation failed');
      if (err.code === 'ENTITLEMENT_USAGE_EXCEEDED') {
        return reply.code(409).send({ success: false, error: { code: err.code, message: err.message } });
      }
      const message = err.message || '';
      if (/invalid booking time/i.test(message)) {
        return reply.code(400).send({ success: false, error: { code: 'INVALID_BOOKING_TIME', message: 'Choose a booking time at least five minutes from now and no more than 180 days ahead.' } });
      }
      if (/no longer available|outside booking channel schedule/i.test(message)) {
        return reply.code(409).send({ success: false, error: { code: 'SLOT_UNAVAILABLE', message: 'Slot unavailable' } });
      }
      return reply.code(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Could not create booking' } });
    }
  });

  fastify.post('/api/v1/bookings/blocked-time', async (request, reply) => {
    request.requireAuth();
    const parsed = CreateBlockedTimeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { code: 'INVALID_BLOCKED_TIME', message: 'Check the team member, time, duration and reason.' } });
    }
    try {
      const block = await bookingService.createBlockedTime(request.auth!, parsed.data, request.id);
      return reply.code(201).send({ success: true, bookingId: block.id });
    } catch (err: any) {
      if (err.message === 'SLOT_UNAVAILABLE') return reply.code(409).send({ success: false, error: { code: 'SLOT_UNAVAILABLE', message: 'That time overlaps an existing booking or block.' } });
      if (err.message?.startsWith('UNAUTHORIZED')) return reply.code(403).send({ success: false, error: { code: 'UNAUTHORIZED', message: err.message } });
      fastify.log.error(err, 'Blocked time creation failed');
      return reply.code(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Could not block this time.' } });
    }
  });

  fastify.delete('/api/v1/bookings/:id/blocked-time', async (request, reply) => {
    request.requireAuth();
    const { id } = request.params as { id: string };
    try {
      await bookingService.removeBlockedTime(request.auth!, id, request.id);
      return reply.send({ success: true });
    } catch (err: any) {
      if (err.message === 'NOT_FOUND') return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Blocked time not found.' } });
      if (err.message?.startsWith('UNAUTHORIZED')) return reply.code(403).send({ success: false, error: { code: 'UNAUTHORIZED', message: err.message } });
      fastify.log.error(err, 'Blocked time removal failed');
      return reply.code(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Could not remove this blocked time.' } });
    }
  });

  fastify.patch('/api/v1/bookings/:id/status', async (request, reply) => {
    request.requireAuth();
    
    const { id } = request.params as { id: string };
    const parsed = UpdateBookingStatusRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { code: ERROR_CODES.INVALID_BOOKING_STATUS, message: 'Invalid status' } });
    }

    try {
      await bookingService.updateBookingStatus(request.auth!, id, parsed.data.status, request.id);
      return reply.send({ success: true });
    } catch (err: any) {
      if (err.message === 'NOT_FOUND') {
        return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Booking not found' } });
      }
      if (err.message.startsWith('INVALID_TRANSITION') || err.message.startsWith('UNAUTHORIZED')) {
        return reply.code(400).send({ success: false, error: { code: 'INVALID_TRANSITION', message: err.message } });
      }
      fastify.log.error(err);
      return reply.code(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Update failed' } });
    }
  });

  fastify.patch('/api/v1/bookings/:id/reschedule', async (request, reply) => {
    request.requireAuth();
    
    const { id } = request.params as { id: string };
    const parsed = RescheduleBookingRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { code: ERROR_CODES.INVALID_BOOKING_REQUEST, message: 'Invalid parameters' } });
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
        return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Booking not found' } });
      }
      if (err.message.startsWith('INVALID_STATUS') || err.message.startsWith('UNAUTHORIZED')) {
        return reply.code(400).send({ success: false, error: { code: 'INVALID_STATUS', message: err.message } });
      }
      if (err.message.startsWith('INVALID_SERVICE')) {
        return reply.code(400).send({ success: false, error: { code: 'INVALID_SERVICE', message: err.message } });
      }
      if (err.message === 'SLOT_UNAVAILABLE') {
        return reply.code(409).send({ success: false, error: { code: 'SLOT_UNAVAILABLE', message: 'Slot unavailable' } });
      }
      fastify.log.error(err);
      return reply.code(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Reschedule failed' } });
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
        return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Booking not found' } });
      }
      if (err.message.startsWith('INVALID_STATUS') || err.message.startsWith('UNAUTHORIZED')) {
        return reply.code(400).send({ success: false, error: { code: 'INVALID_STATUS', message: err.message } });
      }
      fastify.log.error(err);
      return reply.code(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Cancellation failed' } });
    }
  });
};

export default bookingsRoutes;
