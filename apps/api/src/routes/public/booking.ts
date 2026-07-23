import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDatabase, tenants, services, users, appointments, tenantActivationMilestones, clientFormSubmissions } from '@ks-os/database';
import { EntitlementService } from '../../modules/agency/agency.service.js';
import { eq, and, inArray } from 'drizzle-orm';
import { calculateAvailability } from '../../modules/availability/availability.service.js';
import { BookingService } from '../../modules/bookings/booking.service.js';
import { CustomerClaimsService } from '../../modules/customer-portal/customer-claims.service.js';
import { CustomerClaimEmailService } from '../../modules/customer-portal/customer-claim-email.service.js';
import { CustomerBookingManagementService } from '../../modules/customer-portal/customer-booking-management.service.js';
import { env } from '../../config/env.js';
import { BookingPageService } from '../../modules/bookings/booking-page.service.js';
import { safeReferrerHost } from '../../modules/bookings/booking-page.utils.js';

import { 
  CreateBookingRequestSchema, 
  AvailabilityQuerySchema,
  BookingPageSlugSchema,
  CreateBookingHoldSchema,
  PublicBookingAnalyticsEventSchema,
  ERROR_CODES 
} from '@ks-os/contracts';

const statusSchema = z.object({
  reference: z.string().uuid()
});

export default async function publicBookingRoutes(fastify: FastifyInstance) {
  const bookingPageService = new BookingPageService();
  
  // ============================================================================
  // 1. PUBLIC CATALOGUE
  // ============================================================================
  fastify.get('/:subdomain/catalog', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { subdomain } = request.params as { subdomain: string };
    
    if (!BookingPageSlugSchema.safeParse(subdomain).success) {
      return reply.code(400).send({ error: { code: 'INVALID_SUBDOMAIN', message: 'Invalid subdomain' } });
    }
    const catalog = await bookingPageService.publicCatalog(subdomain, request.headers.host);
    if (!catalog) {
      return reply.code(404).send({ error: { code: ERROR_CODES.BOOKING_SITE_NOT_FOUND, message: 'Booking site not found' } });
    }
    return reply.header('cache-control', 'public, max-age=60, stale-while-revalidate=300').send(catalog);
  });

  // ============================================================================
  // 2A. TEMPORARY SLOT HOLDS AND PRIVACY-SAFE CONVERSION EVENTS
  // ============================================================================
  fastify.post('/:subdomain/holds', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { subdomain } = request.params as { subdomain: string };
    if (!BookingPageSlugSchema.safeParse(subdomain).success) return reply.code(400).send({ error: { code: 'INVALID_SUBDOMAIN', message: 'Invalid booking-page address.' } });
    const parsed = CreateBookingHoldSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: 'INVALID_HOLD_REQUEST', message: 'Choose a valid service, team member, date and time.' } });
    try {
      return reply.code(201).send({ hold: await bookingPageService.createHold(subdomain, parsed.data, request.headers.host) });
    } catch (error: any) {
      if (error.statusCode) return reply.code(error.statusCode).send({ error: { code: error.code || 'HOLD_FAILED', message: error.message } });
      throw error;
    }
  });

  fastify.delete('/:subdomain/holds/:holdId', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { subdomain, holdId } = request.params as { subdomain: string; holdId: string };
    const parsed = z.object({ token: z.string().min(32).max(200) }).safeParse(request.body);
    if (!parsed.success || !z.string().uuid().safeParse(holdId).success) return reply.code(400).send({ error: { code: 'INVALID_HOLD_REQUEST', message: 'Invalid slot reservation.' } });
    const released = await bookingPageService.releaseHold(subdomain, holdId, parsed.data.token, request.headers.host);
    return released ? reply.code(204).send() : reply.code(404).send({ error: { code: 'HOLD_NOT_FOUND', message: 'The slot reservation was not found.' } });
  });

  fastify.post('/:subdomain/analytics-events', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { subdomain } = request.params as { subdomain: string };
    const parsed = PublicBookingAnalyticsEventSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: 'INVALID_ANALYTICS_EVENT', message: 'Invalid event.' } });
    await bookingPageService.recordAnalytics(subdomain, parsed.data, request.headers.host);
    return reply.code(202).send({ accepted: true });
  });

  // ============================================================================
  // 2. PUBLIC AVAILABILITY
  // ============================================================================
  fastify.get('/:subdomain/availability', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { subdomain } = request.params as { subdomain: string };
    
    if (!BookingPageSlugSchema.safeParse(subdomain).success) {
      return reply.code(400).send({ error: { code: 'INVALID_SUBDOMAIN', message: 'Invalid subdomain' } });
    }
    const queryResult = AvailabilityQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.code(400).send({ error: { code: ERROR_CODES.INVALID_BOOKING_REQUEST, message: queryResult.error.message } });
    }
    const resolved = await bookingPageService.resolvePublicPage(subdomain, request.headers.host);
    if (!resolved) {
      return reply.code(404).send({ error: { code: ERROR_CODES.BOOKING_SITE_NOT_FOUND, message: 'Booking site not found' } });
    }
    const parseResult = { success: true as const, data: { ...queryResult.data, tenantId: resolved.tenant.id } };

    if (resolved.page.allowedServiceIds.length && !resolved.page.allowedServiceIds.includes(parseResult.data.serviceId)) {
      return reply.code(404).send({ error: { code: 'SERVICE_NOT_AVAILABLE', message: 'This service is not available for online booking.' } });
    }
    if (parseResult.data.staffId && parseResult.data.staffId !== 'any' && resolved.page.allowedStaffIds.length && !resolved.page.allowedStaffIds.includes(parseResult.data.staffId)) {
      return reply.code(404).send({ error: { code: 'STAFF_NOT_AVAILABLE', message: 'This team member is not available for online booking.' } });
    }
    if (parseResult.data.locationId && resolved.page.allowedLocationIds.length && !resolved.page.allowedLocationIds.includes(parseResult.data.locationId)) {
      return reply.code(404).send({ error: { code: 'LOCATION_NOT_AVAILABLE', message: 'This location is not available for online booking.' } });
    }

    try {
      const availability = await calculateAvailability(parseResult.data, { locationId: parseResult.data.locationId, resourceId: parseResult.data.resourceId });
      const rules = resolved.page.bookingRules as { minimumNoticeMinutes?: number; maximumFutureDays?: number };
      const earliest = Date.now() + Math.max(0, rules.minimumNoticeMinutes || 0) * 60_000;
      const latest = Date.now() + Math.max(1, rules.maximumFutureDays || 90) * 86_400_000;
      return reply.header('cache-control', 'private, max-age=15').send({ ...availability, slots: availability.slots.filter(slot => {
        const start = new Date(slot.start).getTime();
        return start >= earliest && start <= latest;
      }) });
    } catch (err: any) {
      fastify.log.error(err);
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Unable to calculate availability' } });
    }
  });

  // ============================================================================
  // 3. PUBLIC BOOKING STATUS
  // ============================================================================
  fastify.get('/:subdomain/bookings/:reference', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { subdomain, reference } = request.params as { subdomain: string, reference: string };
    
    if (!BookingPageSlugSchema.safeParse(subdomain).success) {
      return reply.code(400).send({ error: { code: 'INVALID_SUBDOMAIN', message: 'Invalid subdomain' } });
    }

    const parseResult = statusSchema.safeParse({ reference });
    if (!parseResult.success) {
      return reply.code(400).send({ error: { code: ERROR_CODES.INVALID_BOOKING_REQUEST, message: 'Invalid reference' } });
    }

    const resolved = await bookingPageService.resolvePublicPage(subdomain, request.headers.host);
    if (!resolved) {
      return reply.code(404).send({ error: { code: ERROR_CODES.BOOKING_SITE_NOT_FOUND, message: 'Booking site not found' } });
    }
    const tenant = resolved.tenant;
    const db = getDatabase();
    
    // Look up the booking by reference and tenant ID
    const [booking] = await db.select({
      reference: appointments.publicReference,
      status: appointments.status,
      startTime: appointments.startTime,
      endTime: appointments.endTime,
      bookingChannel: appointments.bookingChannel,
      serviceName: services.name,
      staffName: users.name,
      quotedAmount: appointments.quotedAmount
    })
    .from(appointments)
    .leftJoin(services, eq(appointments.serviceId, services.id))
    .leftJoin(users, eq(appointments.userId, users.id))
    .where(and(
      eq(appointments.tenantId, tenant.id),
      eq(appointments.publicReference, reference)
    )).limit(1);

    if (!booking) {
      return reply.code(404).send({ error: { code: ERROR_CODES.BOOKING_NOT_FOUND, message: 'Booking not found' } });
    }

    return reply.send({
      booking: {
        reference: booking.reference,
        status: booking.status,
        startTime: booking.startTime,
        endTime: booking.endTime,
        bookingChannel: booking.bookingChannel,
        serviceName: booking.serviceName,
        staffName: booking.staffName
      },
      payment: {
        amount: booking.quotedAmount,
        currency: tenant.currency
      }
    });
  });

  // ============================================================================
  // 4. PUBLIC BOOKING CREATION
  // ============================================================================
  fastify.post('/:subdomain/bookings', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { subdomain } = request.params as { subdomain: string };

    if (!BookingPageSlugSchema.safeParse(subdomain).success) {
      return reply.code(400).send({ error: { code: 'INVALID_SUBDOMAIN', message: 'Invalid subdomain' } });
    }

    const parseResult = CreateBookingRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ error: { code: ERROR_CODES.INVALID_BOOKING_REQUEST, message: 'Invalid booking fields' } });
    }
    const resolved = await bookingPageService.resolvePublicPage(subdomain, request.headers.host);
    if (!resolved) {
      return reply.code(404).send({ error: { code: ERROR_CODES.BOOKING_SITE_NOT_FOUND, message: 'Booking site not found' } });
    }
    const { tenant, page } = resolved;
    const db = getDatabase();

    const data = parseResult.data;

    if (page.allowedServiceIds.length && !page.allowedServiceIds.includes(data.serviceId)) return reply.code(404).send({ error: { code: 'SERVICE_NOT_AVAILABLE', message: 'This service is not available for online booking.' } });
    if (page.allowedStaffIds.length && !page.allowedStaffIds.includes(data.staffId)) return reply.code(404).send({ error: { code: 'STAFF_NOT_AVAILABLE', message: 'This team member is not available for online booking.' } });
    if (data.locationId && page.allowedLocationIds.length && !page.allowedLocationIds.includes(data.locationId)) return reply.code(404).send({ error: { code: 'LOCATION_NOT_AVAILABLE', message: 'This location is not available for online booking.' } });

    try {
      const bookingService = new BookingService();
      await new EntitlementService().assertUsageAvailable(tenant.id, 'bookings.monthly');
      const paymentSettings = page.paymentSettings as { mode?: string };
      const verifiedPaymentMode = paymentSettings.mode === 'FULL' ? 'pay_now'
        : paymentSettings.mode === 'DEPOSIT' ? 'deposit_required'
          : paymentSettings.mode === 'CUSTOMER_CHOICE' ? data.paymentMode
            : 'pay_later';
      const booking = await db.transaction(async tx => {
        const hold = await bookingPageService.validateHoldForBooking(tx, page.id, data);
        const created = await bookingService.createPublicBooking(
          tenant.id,
          data.serviceId,
          data.staffId,
          data.startTime,
          data.client,
          verifiedPaymentMode,
          verifiedPaymentMode !== 'pay_later',
          data.idempotencyKey,
          data.bookingChannel,
          data.mobileAddress,
          data.resourceId,
          tx,
        );
        const appointmentId = created.appointment_id || created.id;
        if (data.intakeSubmissionIds.length) {
          const submissions = await tx.select({ id: clientFormSubmissions.id }).from(clientFormSubmissions).where(and(eq(clientFormSubmissions.tenantId, tenant.id), inArray(clientFormSubmissions.id, data.intakeSubmissionIds)));
          if (submissions.length !== new Set(data.intakeSubmissionIds).size) throw Object.assign(new Error('One or more intake submissions are invalid.'), { code: 'INVALID_INTAKE_SUBMISSION', statusCode: 400 });
          await tx.update(clientFormSubmissions).set({ appointmentId }).where(and(eq(clientFormSubmissions.tenantId, tenant.id), inArray(clientFormSubmissions.id, data.intakeSubmissionIds)));
        }
        const intakeRequired = Boolean((page.intakeFormSettings as { requiredBeforeConfirmation?: boolean }).requiredBeforeConfirmation);
        await tx.update(appointments).set({
          locationId: data.locationId || null,
          bookingSource: data.source,
          sourceMedium: data.sourceMedium,
          sourceCampaign: data.sourceCampaign,
          sourceReferrerHost: safeReferrerHost(request.headers.referer),
          bookingPageId: page.id,
          bookingHoldId: hold?.id || null,
          intakeStatus: data.intakeSubmissionIds.length ? 'COMPLETED' : intakeRequired ? 'PENDING' : 'NOT_REQUIRED',
          customerNotes: data.customerNotes || null,
          updatedAt: new Date(),
        }).where(and(eq(appointments.id, appointmentId), eq(appointments.tenantId, tenant.id)));
        if (hold) await bookingPageService.consumeHold(tx, hold.id, appointmentId);
        return created;
      });
      await db.insert(tenantActivationMilestones).values({ tenantId: tenant.id, milestoneKey: 'FIRST_REAL_BOOKING', sourceType: 'APPOINTMENT', sourceId: booking.appointment_id || booking.id }).onConflictDoNothing({ target: [tenantActivationMilestones.tenantId, tenantActivationMilestones.milestoneKey] });
      if (data.analyticsSessionId) await bookingPageService.recordAnalytics(subdomain, { event: 'BOOKING_COMPLETED', sessionId: data.analyticsSessionId, serviceId: data.serviceId, staffId: data.staffId, locationId: data.locationId || undefined, source: data.source, medium: data.sourceMedium, campaign: data.sourceCampaign }, request.headers.host, booking.appointment_id || booking.id);
      if ((booking.appointment_status || booking.status) === 'CONFIRMED') {
        try {
          await bookingService.notifyPublicBookingConfirmed(tenant.id, booking.appointment_id || booking.id, `public:${booking.booking_reference}`);
        } catch (notificationError) {
          fastify.log.error(notificationError, 'Booking was created but confirmation notifications could not be queued');
        }
      }

      // The claim token is generated after the booking transaction commits and is
      // sent directly to email. It is never put in the email outbox or another
      // KS OS database field, where a raw token could be retained.
      const customerAppOrigin = env.PUBLIC_APP_ORIGIN || env.FRONTEND_ORIGIN;
      if (data.client.email && customerAppOrigin) {
        try {
          const appointmentId = booking.appointment_id || booking.id;
          const claim = await new CustomerClaimsService().createForAppointment(tenant.id, appointmentId);
          const appointmentEnd = new Date(booking.end_time).getTime();
          const guestExpiry = new Date(Math.max(
            Number.isFinite(appointmentEnd) ? appointmentEnd + 24 * 60 * 60 * 1000 : 0,
            Date.now() + 7 * 24 * 60 * 60 * 1000,
          ));
          const management = await new CustomerBookingManagementService().createGuestToken(tenant.id, appointmentId, guestExpiry);
          if (claim || management) {
            await new CustomerClaimEmailService().send({
              recipientEmail: data.client.email,
              recipientName: data.client.name,
              replyToEmail: tenant.replyToEmail,
              tenantName: tenant.senderDisplayName || tenant.name,
              tenantPrimaryColor: tenant.primaryColor,
              claimUrl: claim ? `${customerAppOrigin}/customer/claim/${claim.token}` : undefined,
              bookingManagementUrl: `${customerAppOrigin}/manage/${management.token}`,
              idempotencyKey: `customer-portal-claim:${appointmentId}`,
              tenantId: tenant.id,
              relatedEntityId: appointmentId,
            });
          }
        } catch {
          fastify.log.warn('Customer portal claim email was not sent after booking creation');
        }
      }

      let paymentRequired = false;
      let paymentStatus = 'NOT_REQUIRED';
      let checkoutUrl = undefined;
      const amountDue = booking.quoted_amount || 0;
      
      if (amountDue > 0 && verifiedPaymentMode !== 'pay_later') {
        const { StripeService } = await import('../../modules/integrations/stripe/stripe.service.js');
        const stripeService = new StripeService();
        const paymentResult = await stripeService.createBookingPaymentSession(
          tenant.id,
          booking.appointment_id || booking.id,
          booking.booking_reference,
          data.idempotencyKey || crypto.randomUUID(),
          amountDue,
          tenant.currency || 'GBP'
        );
        paymentRequired = true;
        paymentStatus = 'OPEN';
        checkoutUrl = paymentResult.url;
      }

      return reply.code(201).send({
        booking: {
          reference: booking.booking_reference,
          status: booking.appointment_status || booking.status || 'CONFIRMED',
          startTime: booking.start_time,
          endTime: booking.end_time,
          bookingChannel: booking.booking_channel
        },
        payment: {
          required: paymentRequired,
          status: paymentStatus,
          amount: amountDue,
          currency: tenant.currency || 'GBP',
          checkoutUrl
        }
      });
    } catch (err: any) {
      fastify.log.error(err, 'Booking creation failed');
      if (err.code === 'ENTITLEMENT_USAGE_EXCEEDED') {
        return reply.code(409).send({ error: { code: err.code, message: err.message } });
      }
      if (err.statusCode && err.statusCode < 500) {
        return reply.code(err.statusCode).send({ error: { code: err.code || 'BOOKING_CONFLICT', message: err.message } });
      }
      const message = err.message || '';
      if (message === 'STRIPE_ACCOUNT_NOT_READY') {
        return reply.code(402).send({ error: { code: 'PAYMENTS_NOT_AVAILABLE', message: 'Payments are not currently available for this shop.' } });
      }
      if (/no longer available|outside booking channel schedule/i.test(message)) {
        return reply.code(409).send({ error: { code: ERROR_CODES.SLOT_UNAVAILABLE, message: 'The selected slot is no longer available' } });
      }
      return reply.code(500).send({ error: { code: ERROR_CODES.BOOKING_CREATION_FAILED, message: 'The booking could not be created' } });
    }
  });

  // ============================================================================
  // 5. PUBLIC PAYMENT STATUS
  // ============================================================================
  fastify.get('/:subdomain/bookings/:reference/payment-status', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { subdomain, reference } = request.params as { subdomain: string, reference: string };

    const resolved = await bookingPageService.resolvePublicPage(subdomain, request.headers.host);
    if (!resolved) {
      return reply.code(404).send({ error: { code: ERROR_CODES.BOOKING_SITE_NOT_FOUND, message: 'Booking site not found' } });
    }
    const tenant = resolved.tenant;

    const { StripeRepository } = await import('../../modules/integrations/stripe/stripe.repository.js');
    const repo = new StripeRepository();
    const attempt = await repo.getLatestPaymentAttemptByReference(tenant.id, reference);

    if (!attempt) {
      return reply.code(404).send({ error: { code: 'PAYMENT_NOT_FOUND', message: 'No payment session found' } });
    }

    return reply.send({
      paymentStatus: attempt.status,
    });
  });

  // ============================================================================
  // 6. PUBLIC PAYMENT RETRY
  // ============================================================================
  fastify.post('/:subdomain/bookings/:reference/payment-session', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { subdomain, reference } = request.params as { subdomain: string, reference: string };
    
    const resolved = await bookingPageService.resolvePublicPage(subdomain, request.headers.host);
    if (!resolved) {
      return reply.code(404).send({ error: { code: ERROR_CODES.BOOKING_SITE_NOT_FOUND, message: 'Booking site not found' } });
    }
    const tenant = resolved.tenant;
    const db = getDatabase();

    const [booking] = await db.select({
      id: appointments.id,
      status: appointments.status,
      quotedAmount: appointments.quotedAmount
    })
    .from(appointments)
    .where(and(eq(appointments.tenantId, tenant.id), eq(appointments.publicReference, reference)))
    .limit(1);

    if (!booking) {
      return reply.code(404).send({ error: { code: ERROR_CODES.BOOKING_NOT_FOUND, message: 'Booking not found' } });
    }

    if (['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(booking.status)) {
      return reply.code(400).send({ error: { code: 'INVALID_BOOKING_STATUS', message: 'Cannot initiate payment for completed or cancelled bookings' } });
    }

    if (booking.quotedAmount <= 0) {
      return reply.code(400).send({ error: { code: 'NO_PAYMENT_REQUIRED', message: 'No payment required for this booking' } });
    }

    try {
      const { StripeService } = await import('../../modules/integrations/stripe/stripe.service.js');
      const stripeService = new StripeService();
      
      const idempotencyKey = crypto.randomUUID();
      const paymentResult = await stripeService.createBookingPaymentSession(
        tenant.id,
        booking.id,
        reference,
        idempotencyKey,
        booking.quotedAmount,
        tenant.currency || 'GBP'
      );

      return reply.send({
        payment: {
          required: true,
          status: paymentResult.attempt.status,
          amount: booking.quotedAmount,
          currency: tenant.currency || 'GBP',
          checkoutUrl: paymentResult.url
        }
      });
    } catch (err: any) {
      fastify.log.error(err, 'Retry payment session failed');
      const message = err.message || '';
      if (message === 'STRIPE_ACCOUNT_NOT_READY') {
        return reply.code(402).send({ error: { code: 'PAYMENTS_NOT_AVAILABLE', message: 'Payments are not currently available for this shop.' } });
      }
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create payment session' } });
    }
  });
}
