import type { FastifyPluginAsync } from 'fastify';
import { AdvancedAnalyticsQuerySchema, AdvancedAnalyticsResponseSchema } from '@ks-os/contracts';
import { AdvancedAnalyticsService } from './advanced-analytics.service.js';
import { EntitlementService } from '../agency/agency.service.js';

const hasCode = (error: any, code: string) => {
  let current = error;
  for (let index = 0; current && index < 5; index += 1, current = current.cause) {
    if (current.code === code) return true;
  }
  return false;
};

const advancedAnalyticsRoutes: FastifyPluginAsync = async app => {
  const service = new AdvancedAnalyticsService();
  const entitlements = new EntitlementService();

  app.get('/api/v1/analytics/advanced/overview', async (request, reply) => {
    request.requireAuth();
    if (request.auth!.role !== 'owner') {
      return reply.code(403).send({ success: false, error: { code: 'ANALYTICS_ACCESS_DENIED', message: 'Owner access is required.' } });
    }

    const resolvedEntitlements = await entitlements.resolve(request.auth!.tenantId);
    const advancedEntitlement = resolvedEntitlements.entitlements['analytics.advanced'];
    // Tenants created before plan assignments were introduced have no resolved plan.
    // Preserve their existing feature access, while continuing to enforce explicit plan limits.
    if (resolvedEntitlements.plan && advancedEntitlement?.enabled !== true) {
      return reply.code(403).send({
        success: false,
        error: {
          code: 'ENTITLEMENT_REQUIRED',
          message: 'Advanced analytics is not included in the current plan.',
        },
      });
    }

    const parsed = AdvancedAnalyticsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { code: 'ANALYTICS_INVALID_PERIOD', message: 'The advanced analytics period is invalid.' } });
    }

    const started = Date.now();
    try {
      const data = AdvancedAnalyticsResponseSchema.parse(await service.overview(request.auth!.tenantId, parsed.data));
      request.log.info({
        tenantId: request.auth!.tenantId,
        preset: parsed.data.preset,
        durationMs: Date.now() - started,
        queryCategory: 'advanced_analytics',
      }, 'Advanced analytics completed');
      return reply.send({ success: true, data });
    } catch (error: any) {
      const missing = hasCode(error, '42P01');
      const invalid = error?.code === 'ANALYTICS_INVALID_PERIOD';
      const range = error?.code === 'ANALYTICS_RANGE_TOO_LARGE';
      const status = invalid ? 400 : range ? 422 : missing || error?.code === 'ANALYTICS_DATA_UNAVAILABLE' ? 404 : 500;
      const code = invalid ? 'ANALYTICS_INVALID_PERIOD' : missing ? 'ANALYTICS_DATA_UNAVAILABLE' : status === 500 ? 'ANALYTICS_QUERY_FAILED' : error.code;
      request.log.error({
        tenantId: request.auth!.tenantId,
        preset: parsed.data.preset,
        durationMs: Date.now() - started,
        code,
      }, 'Advanced analytics failed');
      return reply.code(status).send({
        success: false,
        error: {
          code,
          message: status >= 500
            ? 'Advanced analytics are temporarily unavailable.'
            : missing
              ? 'Required analytics data sources are not installed.'
              : error.message,
        },
      });
    }
  });
};

export default advancedAnalyticsRoutes;
