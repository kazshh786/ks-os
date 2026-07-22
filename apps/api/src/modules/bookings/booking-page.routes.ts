import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { BookingCustomDomainSchema, BookingPageUpdateSchema } from '@ks-os/contracts';
import { BookingPageService } from './booking-page.service.js';

function requirePageManager(request: any) {
  request.requireAuth();
  if (request.auth.role !== 'owner' && !request.auth.permissions?.includes('BUSINESS_SETTINGS_MANAGE')) {
    throw Object.assign(new Error('Booking-page settings require business settings permission.'), { statusCode: 403, code: 'BOOKING_PAGE_ACCESS_DENIED' });
  }
}

export const bookingPageSettingsRoutes: FastifyPluginAsync = async fastify => {
  const service = new BookingPageService();

  fastify.get('/api/v1/booking-page', async request => {
    request.requireAuth();
    return { success: true, data: await service.getSettings(request.auth!.tenantId) };
  });

  fastify.patch('/api/v1/booking-page', async request => {
    requirePageManager(request);
    const input = BookingPageUpdateSchema.parse(request.body);
    const data = await service.updateSettings(request.auth!.tenantId, request.auth!.tenantUserId, input);
    return { success: true, data };
  });

  fastify.post('/api/v1/booking-page/publish', async request => {
    requirePageManager(request);
    return { success: true, data: await service.setPublished(request.auth!.tenantId, true) };
  });

  fastify.post('/api/v1/booking-page/unpublish', async request => {
    requirePageManager(request);
    return { success: true, data: await service.setPublished(request.auth!.tenantId, false) };
  });

  fastify.put('/api/v1/booking-page/custom-domain', async request => {
    requirePageManager(request);
    const input = BookingCustomDomainSchema.parse(request.body);
    return { success: true, data: await service.configureCustomDomain(request.auth!.tenantId, input.domain) };
  });

  fastify.get('/api/v1/booking-page/analytics', async request => {
    request.requireAuth();
    if (request.auth!.role !== 'owner' && !request.auth!.permissions.includes('ANALYTICS_ADVANCED_VIEW')) {
      throw Object.assign(new Error('Booking analytics permission is required.'), { statusCode: 403, code: 'BOOKING_ANALYTICS_ACCESS_DENIED' });
    }
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(366).default(30) }).parse(request.query);
    return { success: true, data: await service.analyticsSummary(request.auth!.tenantId, days) };
  });
};
