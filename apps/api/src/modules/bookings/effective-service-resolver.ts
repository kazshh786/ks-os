import { getDatabase, services, staffPricing, users } from '@ks-os/database';
import { eq, and } from 'drizzle-orm';

export interface EffectiveServiceValues {
  serviceId: string;
  staffId: string | null;
  tenantId: string;
  basePrice: number;
  baseDuration: number;
  bufferTime: number;
  discount: number;
  effectivePrice: number;
  effectiveDuration: number;
  totalDurationWithBuffer: number;
  hasOverride: boolean;
}

export async function resolveEffectiveServiceValues(
  tenantId: string,
  serviceId: string,
  staffId?: string | null,
  database?: any
): Promise<EffectiveServiceValues> {
  const db = database || getDatabase();

  const [service] = await db.select({
    id: services.id,
    price: services.price,
    duration: services.duration,
    bufferTime: services.bufferTime,
    discount: services.discount,
  })
  .from(services)
  .where(and(eq(services.id, serviceId), eq(services.tenantId, tenantId), eq(services.isActive, true)))
  .limit(1);

  if (!service) {
    throw Object.assign(new Error('Service is not active or available.'), {
      code: 'SERVICE_NOT_AVAILABLE',
      statusCode: 404,
    });
  }

  let effectivePrice = Math.max(0, service.price - (service.discount || 0));
  let effectiveDuration = service.duration;
  let hasOverride = false;

  if (staffId && staffId !== 'any') {
    const [override] = await db.select({
      customPriceInCents: staffPricing.customPriceInCents,
      customDurationMinutes: staffPricing.customDurationMinutes,
    })
    .from(staffPricing)
    .innerJoin(users, eq(users.id, staffPricing.userId))
    .where(and(
      eq(staffPricing.userId, staffId),
      eq(staffPricing.serviceId, serviceId),
      eq(users.tenantId, tenantId),
      eq(users.accountStatus, 'ACTIVE')
    ))
    .limit(1);

    if (override) {
      hasOverride = true;
      if (override.customPriceInCents != null) {
        effectivePrice = Math.max(0, override.customPriceInCents - (service.discount || 0));
      }
      if (override.customDurationMinutes != null) {
        effectiveDuration = override.customDurationMinutes;
      }
    }
  }

  const bufferTime = service.bufferTime || 0;

  return {
    serviceId: service.id,
    staffId: staffId || null,
    tenantId,
    basePrice: service.price,
    baseDuration: service.duration,
    bufferTime,
    discount: service.discount || 0,
    effectivePrice,
    effectiveDuration,
    totalDurationWithBuffer: effectiveDuration + bufferTime,
    hasOverride,
  };
}
