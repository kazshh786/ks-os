import { and, desc, eq, sql } from 'drizzle-orm';
import {
  bookingChannelSchedules,
  getDatabase,
  platformPlans,
  platformPlanVersions,
  services,
  staffSchedules,
  staffServiceAssignments,
  tenantPlanAssignments,
  tenants,
  users,
} from '@ks-os/database';
import type { AgencyAuthContext } from '../../plugins/auth.js';

const agencySubdomain = 'ks-agency';

export class AgencyBookingService {
  private db = getDatabase();

  async ensureWorkspace(auth: AgencyAuthContext) {
    return this.db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('ks-os-agency-booking-workspace'))`);
      let [tenant] = await tx.select().from(tenants).where(eq(tenants.subdomain, agencySubdomain)).limit(1);
      if (!tenant) {
        [tenant] = await tx.insert(tenants).values({
          name: 'KS OS Agency',
          legalBusinessName: 'Kasim Shah LTD',
          subdomain: agencySubdomain,
          businessType: 'INTERNAL_AGENCY',
          primaryContactName: auth.displayName,
          primaryContactEmail: auth.email,
          timezone: 'Europe/London',
          currency: 'GBP',
          packageTier: 'scale',
          lifecycleStatus: 'ACTIVE',
          isActive: true,
          senderDisplayName: 'KS OS Agency',
          replyToEmail: auth.email,
          defaultPaymentMode: 'customer_choice',
        }).returning();
      } else if (!tenant.isActive || tenant.lifecycleStatus !== 'ACTIVE') {
        [tenant] = await tx.update(tenants).set({
          isActive: true,
          lifecycleStatus: 'ACTIVE',
          updatedAt: new Date(),
        }).where(eq(tenants.id, tenant.id)).returning();
      }

      let [membership] = await tx.select().from(users).where(and(
        eq(users.tenantId, tenant.id),
        eq(users.authUserId, auth.authUserId),
      )).limit(1);
      if (!membership) {
        [membership] = await tx.insert(users).values({
          tenantId: tenant.id,
          authUserId: auth.authUserId,
          email: auth.email,
          emailNormalized: auth.email.trim().toLowerCase(),
          name: auth.displayName,
          role: 'owner',
          accountStatus: 'ACTIVE',
          bookingEnabled: true,
          accessProfile: 'MANAGER',
          invitedByAgencyUserId: auth.agencyUserId,
          acceptedAt: new Date(),
        }).returning();
      } else {
        [membership] = await tx.update(users).set({
          name: auth.displayName,
          email: auth.email,
          emailNormalized: auth.email.trim().toLowerCase(),
          role: 'owner',
          accountStatus: 'ACTIVE',
          bookingEnabled: true,
          accessProfile: 'MANAGER',
          updatedAt: new Date(),
        }).where(eq(users.id, membership.id)).returning();
      }

      const existingServices = await tx.select({ id: services.id }).from(services).where(eq(services.tenantId, tenant.id));
      if (!existingServices.length) {
        await tx.execute(sql`
          insert into services (tenant_id, name, description, duration, price, discount, requires_deposit, is_active)
          values
            (${tenant.id}::uuid, 'Platform Demo & Product Tour', 'A guided tour of the KS OS booking, client, payment and operations platform.', 30, 0, 0, false, true),
            (${tenant.id}::uuid, 'Client Onboarding Session', 'Business setup, service catalogue, staff availability and launch preparation.', 60, 0, 0, false, true),
            (${tenant.id}::uuid, 'Growth Strategy Consultation', 'A focused strategy session covering acquisition, retention and automation.', 60, 9900, 0, true, true),
            (${tenant.id}::uuid, 'Technical Support Session', 'Dedicated technical support for integrations, booking flows and operational issues.', 45, 0, 0, false, true)
        `);
      }
      const agencyServices = await tx.select({ id: services.id }).from(services).where(and(eq(services.tenantId, tenant.id), eq(services.isActive, true)));

      const existingAssignments = await tx.select({ serviceId: staffServiceAssignments.serviceId })
        .from(staffServiceAssignments).where(eq(staffServiceAssignments.staffUserId, membership.id));
      const assignedIds = new Set(existingAssignments.map(item => item.serviceId));
      const missingAssignments = agencyServices.filter(item => !assignedIds.has(item.id));
      if (missingAssignments.length) {
        await tx.insert(staffServiceAssignments).values(missingAssignments.map(service => ({
          tenantId: tenant.id,
          staffUserId: membership.id,
          serviceId: service.id,
          isActive: true,
        }))).onConflictDoNothing();
      }

      const existingSchedule = await tx.select({ id: staffSchedules.id }).from(staffSchedules)
        .where(and(eq(staffSchedules.tenantId, tenant.id), eq(staffSchedules.userId, membership.id))).limit(1);
      if (!existingSchedule.length) {
        await tx.insert(staffSchedules).values([1, 2, 3, 4, 5].map(dayOfWeek => ({
          tenantId: tenant.id,
          userId: membership.id,
          dayOfWeek,
          startTime: '09:00',
          endTime: '18:00',
        })));
      }

      const existingChannelSchedule = await tx.select({ id: bookingChannelSchedules.id }).from(bookingChannelSchedules)
        .where(and(eq(bookingChannelSchedules.tenantId, tenant.id), eq(bookingChannelSchedules.userId, membership.id))).limit(1);
      if (!existingChannelSchedule.length) {
        await tx.insert(bookingChannelSchedules).values([1, 2, 3, 4, 5].map(dayOfWeek => ({
          tenantId: tenant.id,
          userId: membership.id,
          bookingChannel: 'in_shop' as const,
          dayOfWeek,
          startTime: '09:00',
          endTime: '18:00',
        })));
      }

      const [activePlan] = await tx.select({ id: tenantPlanAssignments.id, key: platformPlans.key }).from(tenantPlanAssignments)
        .innerJoin(platformPlanVersions, eq(tenantPlanAssignments.planVersionId, platformPlanVersions.id))
        .innerJoin(platformPlans, eq(platformPlanVersions.planId, platformPlans.id))
        .where(and(eq(tenantPlanAssignments.tenantId, tenant.id), eq(tenantPlanAssignments.status, 'ACTIVE'))).limit(1);
      if (activePlan?.key !== 'SCALE') {
        const [scale] = await tx.select({ id: platformPlanVersions.id }).from(platformPlanVersions)
          .innerJoin(platformPlans, eq(platformPlanVersions.planId, platformPlans.id))
          .where(and(eq(platformPlans.key, 'SCALE'), eq(platformPlanVersions.status, 'ACTIVE')))
          .orderBy(desc(platformPlanVersions.version)).limit(1);
        if (scale) {
          if (activePlan) await tx.update(tenantPlanAssignments).set({
            status: 'ENDED',
            endsAt: new Date(),
            reason: 'Replaced by full internal agency workspace access',
          }).where(eq(tenantPlanAssignments.id, activePlan.id));
          await tx.insert(tenantPlanAssignments).values({
            tenantId: tenant.id,
            planVersionId: scale.id,
            status: 'ACTIVE',
            startsAt: new Date(),
            assignedByAgencyUserId: auth.agencyUserId,
            reason: 'Dedicated internal agency booking workspace with full feature access',
          });
        }
      }

      return {
        tenant: {
          id: tenant.businessReference,
          internalTenantId: tenant.id,
          name: tenant.name,
          subdomain: tenant.subdomain,
          timezone: tenant.timezone,
          currency: tenant.currency,
          primaryColor: tenant.primaryColor,
          secondaryColor: tenant.secondaryColor,
        },
        membershipReference: membership.publicReference,
        publicBookingPath: `/book/${tenant.subdomain}`,
      };
    });
  }
}
