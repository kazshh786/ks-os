import {
  KsOsBookingActionSchema,
  resolveKsOsBookingUrl,
  type KsOsBookingAction,
} from '@ks-os/contracts';
import {
  getDatabase,
  locations,
  services,
  tenants,
  users,
} from '@ks-os/database';
import { and, eq } from 'drizzle-orm';
import { env } from '../../config/env.js';

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

export interface NativeBookingTenant {
  id: string;
  businessReference: string;
  subdomain: string;
}

export interface NativeBookingReferenceRepository {
  findTenant(tenantId: string, tenantReference: string): Promise<NativeBookingTenant | null>;
  serviceBelongsToTenant(tenantId: string, publicReference: string): Promise<boolean>;
  locationBelongsToTenant(tenantId: string, publicReference: string): Promise<boolean>;
  staffBelongsToTenant(tenantId: string, publicReference: string): Promise<boolean>;
}

export class DrizzleNativeBookingReferenceRepository
implements NativeBookingReferenceRepository {
  constructor(private readonly db = getDatabase()) {}

  async findTenant(tenantId: string, tenantReference: string) {
    const [tenant] = await this.db
      .select({
        id: tenants.id,
        businessReference: tenants.businessReference,
        subdomain: tenants.subdomain,
      })
      .from(tenants)
      .where(and(
        eq(tenants.id, tenantId),
        eq(tenants.businessReference, tenantReference),
      ))
      .limit(1);
    return tenant || null;
  }

  async serviceBelongsToTenant(tenantId: string, publicReference: string) {
    const [service] = await this.db
      .select({ id: services.id })
      .from(services)
      .where(and(
        eq(services.tenantId, tenantId),
        eq(services.publicReference, publicReference),
        eq(services.isActive, true),
      ))
      .limit(1);
    return Boolean(service);
  }

  async locationBelongsToTenant(tenantId: string, publicReference: string) {
    const [location] = await this.db
      .select({ id: locations.id })
      .from(locations)
      .where(and(
        eq(locations.tenantId, tenantId),
        eq(locations.publicReference, publicReference),
        eq(locations.isActive, true),
      ))
      .limit(1);
    return Boolean(location);
  }

  async staffBelongsToTenant(tenantId: string, publicReference: string) {
    const [staff] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(
        eq(users.tenantId, tenantId),
        eq(users.publicReference, publicReference),
        eq(users.accountStatus, 'ACTIVE'),
        eq(users.bookingEnabled, true),
      ))
      .limit(1);
    return Boolean(staff);
  }
}

export class NativeSiteBookingService {
  constructor(
    private readonly repository: NativeBookingReferenceRepository =
      new DrizzleNativeBookingReferenceRepository(),
    private readonly publicOrigin = env.PUBLIC_APP_ORIGIN,
  ) {}

  async resolveForTenant(input: {
    tenantId: string;
    tenantReference: string;
    action: KsOsBookingAction;
    routeMode?: 'FALLBACK' | 'CUSTOM_DOMAIN';
  }) {
    const action = KsOsBookingActionSchema.parse(input.action);
    const tenant = await this.repository.findTenant(
      input.tenantId,
      input.tenantReference,
    );
    if (!tenant) {
      throw fail(
        404,
        'BOOKING_TENANT_NOT_FOUND',
        'The website tenant could not be resolved.',
      );
    }

    if (
      action.serviceReference
      && !await this.repository.serviceBelongsToTenant(
        tenant.id,
        action.serviceReference,
      )
    ) {
      throw fail(
        400,
        'BOOKING_SERVICE_TENANT_MISMATCH',
        'The selected service does not belong to the website tenant.',
      );
    }
    if (
      action.locationReference
      && !await this.repository.locationBelongsToTenant(
        tenant.id,
        action.locationReference,
      )
    ) {
      throw fail(
        400,
        'BOOKING_LOCATION_TENANT_MISMATCH',
        'The selected location does not belong to the website tenant.',
      );
    }
    if (
      action.staffReference
      && !await this.repository.staffBelongsToTenant(
        tenant.id,
        action.staffReference,
      )
    ) {
      throw fail(
        400,
        'BOOKING_STAFF_TENANT_MISMATCH',
        'The selected team member does not belong to the website tenant.',
      );
    }

    if (!this.publicOrigin) {
      throw fail(
        503,
        'PUBLIC_BOOKING_ORIGIN_REQUIRED',
        'PUBLIC_APP_ORIGIN must be configured before website booking links are generated.',
      );
    }

    return resolveKsOsBookingUrl({
      publicOrigin: this.publicOrigin,
      tenantReference: tenant.businessReference,
      tenantSubdomain: tenant.subdomain,
      routeMode: input.routeMode || 'FALLBACK',
      serviceReference: action.serviceReference,
      locationReference: action.locationReference,
      staffReference: action.staffReference,
      campaignReference: action.campaignReference,
    });
  }
}
