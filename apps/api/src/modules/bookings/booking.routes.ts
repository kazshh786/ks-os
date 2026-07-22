import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { 
  StaffCreateBookingRequestSchema, 
  UpdateBookingStatusRequestSchema, 
  RescheduleBookingRequestSchema,
  ERROR_CODES
} from '@ks-os/contracts';
import { BookingService } from './booking.service.js';
import { EntitlementService } from '../agency/agency.service.js';

const bookingQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  limit: z.coerce.number().min(1).max(500).default(100)
}).refine(data => {
  const diffDays = (new Date(data.to).getTime() - new Date(data.from).getTime()) / (1000 * 60 * 60 * 24);
  return diffDays <= 62;
}, { message: "Date range cannot exceed 62 days" });

const bookingsRoutes: FastifyPluginAsync = async (fastify) => {
  const bookingService = new BookingService();
  const entitlements = new EntitlementService();

  fastify.get('/api/v1/bookings', async (request, reply) => {
    request.requireAuth();

    const parsed = bookingQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: { code: 'INVALID_QUERY', message: parsed.error.message }
      });
    }

    const { from, to, limit } = parsed.data;
    const tenantId = request.auth!.tenantId;

    try {
      const bookings = await bookingService.getBookingsByDateRange(tenantId, new Date(from), new Date(to), limit);
      return reply.send({ success: true, data: bookings });
    } catch (err: any) {
      fastify.log.error(err);
      return reply.code(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Could not fetch bookings' } });
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
        bookingChannel
      );
      
      return reply.code(201).send({ success: true, bookingId: booking.appointment_id });
    } catch (err: any) {
      fastify.log.error(err, 'Staff booking creation failed');
      if (err.code === 'ENTITLEMENT_USAGE_EXCEEDED') {
        return reply.code(409).send({ success: false, error: { code: err.code, message: err.message } });
      }
      const message = err.message || '';
      if (/no longer available|outside booking channel schedule/i.test(message)) {
        return reply.code(409).send({ success: false, error: { code: 'SLOT_UNAVAILABLE', message: 'Slot unavailable' } });
      }
      return reply.code(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Could not create booking' } });
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
      await bookingService.updateBookingStatus(request.auth!, id, parsed.data.status);
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
      await bookingService.rescheduleBooking(request.auth!, id, staffId!, startTime);
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
      await bookingService.cancelBooking(request.auth!, id);
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
