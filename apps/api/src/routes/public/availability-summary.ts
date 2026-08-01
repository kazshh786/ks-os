import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BookingPageSlugSchema, ERROR_CODES } from '@ks-os/contracts';
import { calculateAvailability } from '../../modules/availability/availability.service.js';
import { BookingPageService } from '../../modules/bookings/booking-page.service.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)');
const availableDatesQuerySchema = z.object({
  serviceId: z.string().uuid(),
  staffId: z.string().min(1).max(64).default('any'),
  locationId: z.string().uuid().optional(),
  resourceId: z.string().uuid().optional(),
  bookingChannel: z.enum(['in_shop', 'mobile']),
  from: isoDate,
  to: isoDate,
}).superRefine((value, context) => {
  const from = new Date(`${value.from}T12:00:00Z`);
  const to = new Date(`${value.to}T12:00:00Z`);
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (to < from) context.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'The end date must be after the start date.' });
  if (days > 42) context.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'A maximum of 42 days can be checked at once.' });
});

function datesBetween(from: string, to: string) {
  const output: string[] = [];
  const cursor = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (cursor <= end) {
    output.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return output;
}

export default async function publicAvailabilitySummaryRoutes(fastify: FastifyInstance) {
  const bookingPageService = new BookingPageService();

  fastify.get('/:subdomain/available-dates', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { subdomain } = request.params as { subdomain: string };
    if (!BookingPageSlugSchema.safeParse(subdomain).success) {
      return reply.code(400).send({ error: { code: 'INVALID_SUBDOMAIN', message: 'Invalid booking-page address.' } });
    }

    const parsed = availableDatesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: ERROR_CODES.INVALID_BOOKING_REQUEST, message: parsed.error.issues[0]?.message || 'Invalid availability range.' } });
    }

    const resolved = await bookingPageService.resolvePublicPage(subdomain, request.headers.host);
    if (!resolved) {
      return reply.code(404).send({ error: { code: ERROR_CODES.BOOKING_SITE_NOT_FOUND, message: 'Booking site not found.' } });
    }

    const query = parsed.data;
    if (resolved.page.allowedServiceIds.length && !resolved.page.allowedServiceIds.includes(query.serviceId)) {
      return reply.code(404).send({ error: { code: 'SERVICE_NOT_AVAILABLE', message: 'This service is not available for online booking.' } });
    }
    if (query.staffId !== 'any' && resolved.page.allowedStaffIds.length && !resolved.page.allowedStaffIds.includes(query.staffId)) {
      return reply.code(404).send({ error: { code: 'STAFF_NOT_AVAILABLE', message: 'This team member is not available for online booking.' } });
    }
    if (query.locationId && resolved.page.allowedLocationIds.length && !resolved.page.allowedLocationIds.includes(query.locationId)) {
      return reply.code(404).send({ error: { code: 'LOCATION_NOT_AVAILABLE', message: 'This location is not available for online booking.' } });
    }

    const rules = resolved.page.bookingRules as { minimumNoticeMinutes?: number; maximumFutureDays?: number };
    const earliest = Date.now() + Math.max(0, rules.minimumNoticeMinutes || 0) * 60_000;
    const latest = Date.now() + Math.max(1, rules.maximumFutureDays || 90) * 86_400_000;
    const dates = datesBetween(query.from, query.to);
    const availableDates: string[] = [];

    try {
      for (let index = 0; index < dates.length; index += 6) {
        const batch = dates.slice(index, index + 6);
        const results = await Promise.all(batch.map(async date => {
          const availability = await calculateAvailability({
            tenantId: resolved.tenant.id,
            serviceId: query.serviceId,
            staffId: query.staffId,
            locationId: query.locationId,
            resourceId: query.resourceId,
            bookingChannel: query.bookingChannel,
            date,
          }, { locationId: query.locationId, resourceId: query.resourceId });
          const hasAvailableSlot = availability.slots.some(slot => {
            const start = new Date(slot.start).getTime();
            return start >= earliest && start <= latest;
          });
          return hasAvailableSlot ? date : null;
        }));
        availableDates.push(...results.filter((date): date is string => Boolean(date)));
      }

      return reply
        .header('cache-control', 'private, max-age=15')
        .send({ from: query.from, to: query.to, availableDates });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Unable to calculate available dates.' } });
    }
  });
}
