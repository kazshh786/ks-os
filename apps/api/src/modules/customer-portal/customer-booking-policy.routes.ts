import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import {
  CustomerBookingPolicySettingsSchema,
  CustomerBookingPolicySettingsUpdateSchema,
} from '@ks-os/contracts';
import { getDatabase, tenants } from '@ks-os/database';
import { eq, sql } from 'drizzle-orm';

const selection = {
  customerCancellationEnabled: tenants.customerCancellationEnabled,
  customerReschedulingEnabled: tenants.customerReschedulingEnabled,
  allowAppointmentsPastClosingTime: sql<boolean>`coalesce(${tenants}.allow_appointments_past_closing_time, false)`,
  minimumCancellationNoticeMinutes: tenants.minimumCancellationNoticeMinutes,
  minimumRescheduleNoticeMinutes: tenants.minimumRescheduleNoticeMinutes,
  maximumCustomerReschedules: tenants.maximumCustomerReschedules,
  requireCancellationReason: tenants.requireCancellationReason,
  lateCancellationMessage: tenants.lateCancellationMessage,
  depositPolicyMessage: tenants.depositPolicyMessage,
};

function owner(request: FastifyRequest) {
  request.requireAuth();
  if (request.auth?.role !== 'owner') {
    const error = new Error('Owner access is required.');
    Object.assign(error, { statusCode: 403, code: 'CUSTOMER_BOOKING_POLICY_ACCESS_DENIED' });
    throw error;
  }
  return request.auth;
}

export const customerBookingPolicyRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request) => {
    const auth = owner(request);
    const [settings] = await getDatabase().select(selection).from(tenants)
      .where(eq(tenants.id, auth.tenantId)).limit(1);
    if (!settings) {
      const error = new Error('Booking policy settings are unavailable.');
      Object.assign(error, { statusCode: 404, code: 'CUSTOMER_BOOKING_POLICY_NOT_FOUND' });
      throw error;
    }
    return { data: CustomerBookingPolicySettingsSchema.parse(settings) };
  });

  fastify.patch('/', async (request) => {
    const auth = owner(request);
    const input = CustomerBookingPolicySettingsUpdateSchema.parse(request.body);
    const database = getDatabase();
    const settings = await database.transaction(async (tx) => {
      const { allowAppointmentsPastClosingTime, ...tenantPolicyInput } = input;
      if (Object.keys(tenantPolicyInput).length > 0) {
        await tx.update(tenants).set({ ...tenantPolicyInput, updatedAt: new Date() })
          .where(eq(tenants.id, auth.tenantId));
      }
      if (allowAppointmentsPastClosingTime !== undefined) {
        await tx.execute(sql`
          update tenants
          set allow_appointments_past_closing_time = ${allowAppointmentsPastClosingTime},
              updated_at = now()
          where id = ${auth.tenantId}::uuid
        `);
      }
      const [updated] = await tx.select(selection).from(tenants)
        .where(eq(tenants.id, auth.tenantId)).limit(1);
      return updated;
    });
    if (!settings) {
      const error = new Error('Booking policy settings are unavailable.');
      Object.assign(error, { statusCode: 404, code: 'CUSTOMER_BOOKING_POLICY_NOT_FOUND' });
      throw error;
    }
    return { data: CustomerBookingPolicySettingsSchema.parse(settings) };
  });
};
