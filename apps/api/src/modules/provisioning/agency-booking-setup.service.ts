import { and, asc, eq, or, sql } from 'drizzle-orm';
import {
  bookingPages,
  getDatabase,
  locations,
  services,
  staffSchedules,
  staffServiceAssignments,
  tenants,
  users,
} from '@ks-os/database';
import type { AgencyActor } from '../agency/agency.service.js';
import { AgencyAuditService } from '../agency/agency.service.js';

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

type Database = ReturnType<typeof getDatabase>;

export class AgencyBookingSetupService {
  constructor(
    private readonly db: Database = getDatabase(),
    private readonly audit = new AgencyAuditService(),
  ) {}

  private async tenant(reference: string) {
    const [row] = await this.db.select({
      id: tenants.id,
      businessReference: tenants.businessReference,
      agencyReference: tenants.agencyReference,
      name: tenants.name,
      currency: tenants.currency,
    }).from(tenants).where(or(
      eq(tenants.id, reference),
      eq(tenants.businessReference, reference),
      eq(tenants.agencyReference, reference),
    )).limit(1);
    if (!row) throw fail(404, 'TENANT_NOT_FOUND', 'The client workspace could not be found.');
    return row;
  }

  async summary(tenantReference: string) {
    const tenant = await this.tenant(tenantReference);
    const [serviceRows, locationRows, staffRows, schedules, assignments, booking] = await Promise.all([
      this.db.select({
        reference: services.publicReference,
        name: services.name,
        description: services.description,
        durationMinutes: services.duration,
        priceMinor: services.price,
        discountMinor: services.discount,
        bufferMinutes: services.bufferTime,
        active: services.isActive,
        createdAt: services.createdAt,
        updatedAt: services.updatedAt,
      }).from(services).where(eq(services.tenantId, tenant.id)).orderBy(asc(services.name)),
      this.db.select({
        reference: locations.publicReference,
        name: locations.name,
        address: locations.address,
        postcode: locations.postcode,
        primary: locations.isPrimary,
        active: locations.isActive,
      }).from(locations).where(eq(locations.tenantId, tenant.id)).orderBy(asc(locations.name)),
      this.db.select({
        reference: users.publicReference,
        name: users.name,
        role: users.jobTitle,
        bookingEnabled: users.bookingEnabled,
        status: users.accountStatus,
      }).from(users).where(eq(users.tenantId, tenant.id)).orderBy(asc(users.name)),
      this.db.select({ id: staffSchedules.id }).from(staffSchedules)
        .where(eq(staffSchedules.tenantId, tenant.id)),
      this.db.select({ id: staffServiceAssignments.id }).from(staffServiceAssignments)
        .where(and(
          eq(staffServiceAssignments.tenantId, tenant.id),
          eq(staffServiceAssignments.isActive, true),
        )),
      this.db.select({ enabled: bookingPages.enabled, slug: bookingPages.publicSlug })
        .from(bookingPages).where(eq(bookingPages.tenantId, tenant.id)).limit(1),
    ]);

    const activeServices = serviceRows.filter(item => item.active);
    const activeLocations = locationRows.filter(item => item.active);
    const bookableStaff = staffRows.filter(item => item.status === 'ACTIVE' && item.bookingEnabled);
    return {
      tenant: {
        reference: tenant.agencyReference,
        businessReference: tenant.businessReference,
        name: tenant.name,
        currency: tenant.currency,
      },
      services: serviceRows.map(item => ({
        ...item,
        effectivePriceMinor: Math.max(0, item.priceMinor - item.discountMinor),
        ready: item.active && item.durationMinutes >= 5 && item.priceMinor >= 0,
      })),
      locations: locationRows,
      staff: staffRows,
      readiness: {
        activeServiceCount: activeServices.length,
        activeLocationCount: activeLocations.length,
        bookableStaffCount: bookableStaff.length,
        availabilityRuleCount: schedules.length,
        activeStaffServiceAssignmentCount: assignments.length,
        bookingConfigurationEnabled: booking[0]?.enabled === true,
        bookingSlug: booking[0]?.slug || tenant.businessReference,
        readyForBuild: activeServices.length > 0
          && activeLocations.length > 0
          && bookableStaff.length > 0
          && schedules.length > 0
          && assignments.length > 0,
      },
    };
  }

  async createService(actor: AgencyActor, tenantReference: string, input: {
    name: string;
    description: string;
    durationMinutes: number;
    priceMinor: number;
    bufferMinutes?: number;
  }) {
    const tenant = await this.tenant(tenantReference);
    const [duplicate] = await this.db.select({ reference: services.publicReference })
      .from(services).where(and(
        eq(services.tenantId, tenant.id),
        sql`lower(${services.name}) = lower(${input.name.trim()})`,
      )).limit(1);
    if (duplicate) {
      throw fail(409, 'SERVICE_ALREADY_EXISTS', 'A service with this name already exists in the client booking system.');
    }
    const [created] = await this.db.insert(services).values({
      tenantId: tenant.id,
      name: input.name.trim(),
      description: input.description.trim(),
      duration: input.durationMinutes,
      price: input.priceMinor,
      bufferTime: input.bufferMinutes || 0,
      isActive: true,
    }).returning({
      reference: services.publicReference,
      name: services.name,
      description: services.description,
      durationMinutes: services.duration,
      priceMinor: services.price,
      active: services.isActive,
    });
    await this.audit.write(actor, 'AGENCY_BOOKING_SERVICE_CREATED', 'SERVICE', created.reference, {
      tenantId: tenant.id,
      category: 'BOOKING',
      metadata: { durationMinutes: created.durationMinutes, priceMinor: created.priceMinor },
    });
    return created;
  }
}
