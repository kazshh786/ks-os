import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDatabase, tenants, services, users, bookingChannelSchedules, appointments, tenantActivationMilestones } from '@ks-os/database';
import { EntitlementService } from '../../modules/agency/agency.service.js';
import { eq, and } from 'drizzle-orm';
import { calculateAvailability } from '../../modules/availability/availability.service.js';
import { BookingService } from '../../modules/bookings/booking.service.js';
import { CustomerClaimsService } from '../../modules/customer-portal/customer-claims.service.js';
import { CustomerClaimEmailService } from '../../modules/customer-portal/customer-claim-email.service.js';
import { CustomerBookingManagementService } from '../../modules/customer-portal/customer-booking-management.service.js';
import { env } from '../../config/env.js';

import { 
  CreateBookingRequestSchema, 
  AvailabilityQuerySchema,
  ERROR_CODES 
} from '@ks-os/contracts';

const statusSchema = z.object({
  reference: z.string().uuid()
});

export default async function publicBookingRoutes(fastify: FastifyInstance) {
  
  // ============================================================================
  // 1. PUBLIC CATALOGUE
  // ============================================================================
  fastify.get('/:subdomain/catalog', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { subdomain } = request.params as { subdomain: string };
    
    if (!subdomain || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(subdomain)) {
      return reply.code(400).send({ error: { code: 'INVALID_SUBDOMAIN', message: 'Invalid subdomain' } });
    }

    const db = getDatabase();
    const [tenant] = await db.select({
      id: tenants.id,
      name: tenants.name,
      timezone: tenants.timezone,
      currency: tenants.currency,
      primaryColor: tenants.primaryColor,
      secondaryColor: tenants.secondaryColor,
      accentColor: tenants.accentColor,
      defaultPaymentMode: tenants.defaultPaymentMode
    }).from(tenants).where(and(eq(tenants.subdomain, subdomain),eq(tenants.isActive,true),eq(tenants.lifecycleStatus,'ACTIVE'))).limit(1);

    if (!tenant) {
      return reply.code(404).send({ error: { code: ERROR_CODES.BOOKING_SITE_NOT_FOUND, message: 'Booking site not found' } });
    }

    const activeServices = await db.select({
      id: services.id,
      name: services.name,
      description: services.description,
      duration: services.duration,
      price: services.price,
      discount: services.discount,
      requiresDeposit: services.requiresDeposit
    }).from(services)
      .where(and(eq(services.tenantId, tenant.id), eq(services.isActive, true)));

    const activeStaff = await db.select({
      id: users.id,
      name: users.name
    }).from(users).where(and(eq(users.tenantId, tenant.id),eq(users.accountStatus,'ACTIVE'),eq(users.bookingEnabled,true),eq(users.role,'staff')));

    const schedules = await db.select({
      bookingChannel: bookingChannelSchedules.bookingChannel
    }).from(bookingChannelSchedules).where(eq(bookingChannelSchedules.tenantId, tenant.id));

    const enabledChannels = new Set(schedules.map(s => s.bookingChannel));
    const bookingChannels = [
      ...(enabledChannels.has('in_shop') ? [{ id: 'in_shop', label: 'Visit the shop' }] : []),
      ...(enabledChannels.has('mobile') ? [{ id: 'mobile', label: 'Mobile appointment' }] : []),
    ];

    return reply.send({
      tenant: {
        id: tenant.id, // ID returned as per Phase 3 contract support
        name: tenant.name,
        timezone: tenant.timezone,
        currency: tenant.currency,
        colors: {
          primary: tenant.primaryColor,
          secondary: tenant.secondaryColor,
          accent: tenant.accentColor
        }
      },
      paymentMode: tenant.defaultPaymentMode,
      bookingChannels,
      services: activeServices,
      staff: activeStaff
    });
  });

  // ============================================================================
  // 2. PUBLIC AVAILABILITY
  // ============================================================================
  fastify.get('/:subdomain/availability', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { subdomain } = request.params as { subdomain: string };
    
    if (!subdomain || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(subdomain)) {
      return reply.code(400).send({ error: { code: 'INVALID_SUBDOMAIN', message: 'Invalid subdomain' } });
    }

    const db = getDatabase();
    const [tenant] = await db.select({ id: tenants.id }).from(tenants).where(and(eq(tenants.subdomain, subdomain),eq(tenants.isActive,true),eq(tenants.lifecycleStatus,'ACTIVE'))).limit(1);

    if (!tenant) {
      return reply.code(404).send({ error: { code: ERROR_CODES.BOOKING_SITE_NOT_FOUND, message: 'Booking site not found' } });
    }

    const parseResult = AvailabilityQuerySchema.safeParse({
      ...request.query as object,
      tenantId: tenant.id // forcefully inject resolved tenant
    });

    if (!parseResult.success) {
      return reply.code(400).send({ error: { code: ERROR_CODES.INVALID_BOOKING_REQUEST, message: parseResult.error.message } });
    }

    try {
      const slots = await calculateAvailability(parseResult.data);
      return reply.send(slots);
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
    
    if (!subdomain || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(subdomain)) {
      return reply.code(400).send({ error: { code: 'INVALID_SUBDOMAIN', message: 'Invalid subdomain' } });
    }

    const parseResult = statusSchema.safeParse({ reference });
    if (!parseResult.success) {
      return reply.code(400).send({ error: { code: ERROR_CODES.INVALID_BOOKING_REQUEST, message: 'Invalid reference' } });
    }

    const db = getDatabase();
    const [tenant] = await db.select({ id: tenants.id, currency: tenants.currency, name: tenants.name, primaryColor: tenants.primaryColor, senderDisplayName: tenants.senderDisplayName, replyToEmail: tenants.replyToEmail }).from(tenants).where(and(eq(tenants.subdomain, subdomain),eq(tenants.isActive,true),eq(tenants.lifecycleStatus,'ACTIVE'))).limit(1);

    if (!tenant) {
      return reply.code(404).send({ error: { code: ERROR_CODES.BOOKING_SITE_NOT_FOUND, message: 'Booking site not found' } });
    }
    
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

    if (!subdomain || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(subdomain)) {
      return reply.code(400).send({ error: { code: 'INVALID_SUBDOMAIN', message: 'Invalid subdomain' } });
    }

    const db = getDatabase();
    const [tenant] = await db.select({ id: tenants.id, currency: tenants.currency, name: tenants.name, primaryColor: tenants.primaryColor, senderDisplayName: tenants.senderDisplayName, replyToEmail: tenants.replyToEmail }).from(tenants).where(and(eq(tenants.subdomain, subdomain),eq(tenants.isActive,true),eq(tenants.lifecycleStatus,'ACTIVE'))).limit(1);

    if (!tenant) {
      return reply.code(404).send({ error: { code: ERROR_CODES.BOOKING_SITE_NOT_FOUND, message: 'Booking site not found' } });
    }

    const parseResult = CreateBookingRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      console.error('ZOD ERROR:', parseResult.error.format());
      return reply.code(400).send({ error: { code: ERROR_CODES.INVALID_BOOKING_REQUEST, message: 'Invalid booking fields' } });
    }

    const data = parseResult.data;

    try {
      const bookingService = new BookingService();
      await new EntitlementService().assertUsageAvailable(tenant.id, 'bookings.monthly');
      const booking = await bookingService.createPublicBooking(
        tenant.id,
        data.serviceId,
        data.staffId,
        data.startTime,
        data.client,
        data.paymentMode,
        data.payNow,
        data.idempotencyKey,
        data.bookingChannel,
        data.mobileAddress,
        data.resourceId
      );
      await db.insert(tenantActivationMilestones).values({ tenantId: tenant.id, milestoneKey: 'FIRST_REAL_BOOKING', sourceType: 'APPOINTMENT', sourceId: booking.appointment_id || booking.id }).onConflictDoNothing({ target: [tenantActivationMilestones.tenantId, tenantActivationMilestones.milestoneKey] });

      // The claim token is generated after the booking transaction commits and is
      // sent directly to email. It is never put in the email outbox or another
      // KS OS database field, where a raw token could be retained.
      if (data.client.email && env.PUBLIC_APP_ORIGIN) {
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
              claimUrl: claim ? `${env.PUBLIC_APP_ORIGIN}/customer/claim/${claim.token}` : undefined,
              bookingManagementUrl: `${env.PUBLIC_APP_ORIGIN}/manage/${management.token}`,
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
      
      if (amountDue > 0 && data.paymentMode !== 'pay_later') {
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

    const db = getDatabase();
    const [tenant] = await db.select({ id: tenants.id }).from(tenants).where(and(eq(tenants.subdomain, subdomain),eq(tenants.isActive,true),eq(tenants.lifecycleStatus,'ACTIVE'))).limit(1);

    if (!tenant) {
      return reply.code(404).send({ error: { code: ERROR_CODES.BOOKING_SITE_NOT_FOUND, message: 'Booking site not found' } });
    }

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
    
    const db = getDatabase();
    const [tenant] = await db.select({ id: tenants.id, currency: tenants.currency }).from(tenants).where(and(eq(tenants.subdomain, subdomain),eq(tenants.isActive,true),eq(tenants.lifecycleStatus,'ACTIVE'))).limit(1);
    if (!tenant) {
      return reply.code(404).send({ error: { code: ERROR_CODES.BOOKING_SITE_NOT_FOUND, message: 'Booking site not found' } });
    }

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
