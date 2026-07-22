import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CustomerAppointmentQuerySchema, CustomerAssignmentParamsSchema, CustomerClaimParamsSchema,
  CustomerBookingManagementPolicySchema, CustomerBookingManagementTokenParamsSchema,
  CustomerCancellationRequestSchema, CustomerCancellationResponseSchema,
  CustomerFormSubmissionSchema, CustomerProfileUpdateSchema,
  CustomerRescheduleAvailabilityQuerySchema, CustomerRescheduleAvailabilityResponseSchema,
  CustomerRescheduleRequestSchema, CustomerRescheduleResponseSchema,
} from '@ks-os/contracts';
import { CustomerAuthService } from './customer-auth.service.js';
import { CustomerClaimsService } from './customer-claims.service.js';
import { CustomerPortalService } from './customer-portal.service.js';
import { CustomerBookingManagementService, hashCustomerBookingManagementToken } from './customer-booking-management.service.js';

const bookingReferenceSchema = z.object({ bookingReference: z.string().uuid() }).strict();
const customerManagementRateKey = (request: FastifyRequest) => {
  const params = (request.params ?? {}) as { bookingReference?: string; token?: string };
  const subject = params.token
    ? `guest:${hashCustomerBookingManagementToken(params.token)}`
    : `customer:${request.authIdentity?.authUserId ?? 'anonymous'}:${params.bookingReference ?? 'unknown'}`;
  return `${request.ip}:${subject}`;
};
const managementRateLimit = (max: number) => ({ max, timeWindow: '1 minute', keyGenerator: customerManagementRateKey });

export const customerPortalRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = new CustomerAuthService();
  const portal = new CustomerPortalService();
  const claims = new CustomerClaimsService();
  const management = new CustomerBookingManagementService();

  fastify.get('/session', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) => {
    const customer = await auth.requireCustomer(request, true);
    return { data: await portal.getSession(customer) };
  });

  fastify.post('/claims/:token/complete', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request) => {
    const { token } = CustomerClaimParamsSchema.parse(request.params);
    const identity = auth.requireIdentity(request);
    return { data: await claims.complete(token, identity) };
  });

  fastify.get('/businesses', async (request) => {
    const customer = await auth.requireCustomer(request);
    return { data: await portal.listBusinesses(customer) };
  });

  fastify.get('/appointments', async (request) => {
    const customer = await auth.requireCustomer(request);
    const query = CustomerAppointmentQuerySchema.parse(request.query);
    return { data: await portal.listAppointments(customer, query) };
  });

  fastify.get('/appointments/:bookingReference', async (request) => {
    const customer = await auth.requireCustomer(request);
    const { bookingReference } = bookingReferenceSchema.parse(request.params);
    return { data: await portal.getAppointment(customer, bookingReference) };
  });

  fastify.get('/appointments/:bookingReference/policy', {
    config: { rateLimit: managementRateLimit(60) },
  }, async (request) => {
    const customer = await auth.requireCustomer(request);
    const { bookingReference } = bookingReferenceSchema.parse(request.params);
    return { data: CustomerBookingManagementPolicySchema.parse(await management.getPolicy({ kind: 'CUSTOMER', customer, bookingReference })) };
  });

  fastify.get('/appointments/:bookingReference/reschedule-availability', {
    config: { rateLimit: managementRateLimit(30) },
  }, async (request) => {
    const customer = await auth.requireCustomer(request);
    const { bookingReference } = bookingReferenceSchema.parse(request.params);
    const query = CustomerRescheduleAvailabilityQuerySchema.parse(request.query);
    return { data: CustomerRescheduleAvailabilityResponseSchema.parse(await management.availability({ kind: 'CUSTOMER', customer, bookingReference }, query)) };
  });

  fastify.post('/appointments/:bookingReference/reschedule', {
    config: { rateLimit: managementRateLimit(10) },
  }, async (request) => {
    const customer = await auth.requireCustomer(request);
    const { bookingReference } = bookingReferenceSchema.parse(request.params);
    const input = CustomerRescheduleRequestSchema.parse(request.body);
    return { data: CustomerRescheduleResponseSchema.parse(await management.reschedule({ kind: 'CUSTOMER', customer, bookingReference }, input)) };
  });

  fastify.post('/appointments/:bookingReference/cancel', {
    config: { rateLimit: managementRateLimit(10) },
  }, async (request) => {
    const customer = await auth.requireCustomer(request);
    const { bookingReference } = bookingReferenceSchema.parse(request.params);
    const input = CustomerCancellationRequestSchema.parse(request.body);
    return { data: CustomerCancellationResponseSchema.parse(await management.cancel({ kind: 'CUSTOMER', customer, bookingReference }, input)) };
  });

  fastify.get('/manage/:token', {
    config: { rateLimit: managementRateLimit(30) },
  }, async (request) => {
    const { token } = CustomerBookingManagementTokenParamsSchema.parse(request.params);
    return { data: await management.getAppointment({ kind: 'GUEST', token }) };
  });

  fastify.get('/manage/:token/policy', {
    config: { rateLimit: managementRateLimit(30) },
  }, async (request) => {
    const { token } = CustomerBookingManagementTokenParamsSchema.parse(request.params);
    return { data: CustomerBookingManagementPolicySchema.parse(await management.getPolicy({ kind: 'GUEST', token })) };
  });

  fastify.get('/manage/:token/reschedule-availability', {
    config: { rateLimit: managementRateLimit(20) },
  }, async (request) => {
    const { token } = CustomerBookingManagementTokenParamsSchema.parse(request.params);
    const query = CustomerRescheduleAvailabilityQuerySchema.parse(request.query);
    return { data: CustomerRescheduleAvailabilityResponseSchema.parse(await management.availability({ kind: 'GUEST', token }, query)) };
  });

  fastify.post('/manage/:token/reschedule', {
    config: { rateLimit: managementRateLimit(8) },
  }, async (request) => {
    const { token } = CustomerBookingManagementTokenParamsSchema.parse(request.params);
    const input = CustomerRescheduleRequestSchema.parse(request.body);
    return { data: CustomerRescheduleResponseSchema.parse(await management.reschedule({ kind: 'GUEST', token }, input)) };
  });

  fastify.post('/manage/:token/cancel', {
    config: { rateLimit: managementRateLimit(8) },
  }, async (request) => {
    const { token } = CustomerBookingManagementTokenParamsSchema.parse(request.params);
    const input = CustomerCancellationRequestSchema.parse(request.body);
    return { data: CustomerCancellationResponseSchema.parse(await management.cancel({ kind: 'GUEST', token }, input)) };
  });

  fastify.get('/forms', async (request) => {
    const customer = await auth.requireCustomer(request);
    return { data: await portal.listForms(customer) };
  });

  fastify.get('/forms/:assignmentReference', async (request) => {
    const customer = await auth.requireCustomer(request);
    const { assignmentReference } = CustomerAssignmentParamsSchema.parse(request.params);
    return { data: await portal.getForm(customer, assignmentReference) };
  });

  fastify.post('/forms/:assignmentReference/submissions', {
    bodyLimit: 262144,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const customer = await auth.requireCustomer(request);
    const { assignmentReference } = CustomerAssignmentParamsSchema.parse(request.params);
    const input = CustomerFormSubmissionSchema.parse(request.body);
    return reply.code(201).send({ data: await portal.submitForm(customer, assignmentReference, input) });
  });

  fastify.get('/payments', async (request) => {
    const customer = await auth.requireCustomer(request);
    return { data: await portal.listPayments(customer) };
  });

  fastify.get('/profile', async (request) => {
    const customer = await auth.requireCustomer(request);
    return { data: await portal.getProfile(customer) };
  });

  fastify.patch('/profile', async (request) => {
    const customer = await auth.requireCustomer(request);
    const input = CustomerProfileUpdateSchema.parse(request.body);
    return { data: await portal.updateProfile(customer, input) };
  });
};
