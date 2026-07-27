import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  applicationSessions,
  appointments,
  bookingChannelSchedules,
  bookingPages,
  checkoutTransactions,
  clients,
  getDatabase,
  locations,
  managedDeliverables,
  provisioningRuns,
  services,
  sites,
  staffSchedules,
  staffServiceAssignments,
  stripeConnections,
  tenantBillingAccounts,
  tenantOnboarding,
  tenantOnboardingStages,
  tenantPlanAssignments,
  tenantSetupPayments,
  tenantSubscriptions,
  tenants,
  users,
} from '@ks-os/database';
import { AgencyAuditService, type AgencyActor } from '../agency/agency.service.js';

const fail = (statusCode: number, code: string, message: string, details?: unknown) =>
  Object.assign(new Error(message), { statusCode, code, ...(details ? { details } : {}) });

const count = (row: { count?: number } | undefined) => Number(row?.count || 0);

export class TenantLifecycleService {
  private readonly audit = new AgencyAuditService();

  constructor(private readonly db = getDatabase()) {}

  private async tenant(tenantReference: string) {
    const [tenant] = await this.db.select().from(tenants).where(or(
      eq(tenants.id, tenantReference),
      eq(tenants.agencyReference, tenantReference),
      eq(tenants.businessReference, tenantReference),
    )).limit(1);
    if (!tenant || tenant.lifecycleStatus === 'DELETED') {
      throw fail(404, 'TENANT_NOT_FOUND', 'The client workspace was not found.');
    }
    return tenant;
  }

  async previewUserRemoval(tenantReference: string, userReference: string) {
    const tenant = await this.tenant(tenantReference);
    const [user] = await this.db.select().from(users).where(and(
      eq(users.tenantId, tenant.id),
      eq(users.publicReference, userReference),
    )).limit(1);
    if (!user) throw fail(404, 'TENANT_USER_NOT_FOUND', 'The business user was not found.');

    const now = new Date();
    const [futureRows, historyRows, ownerRows] = await Promise.all([
      this.db.select({ count: sql<number>`count(*)::int` }).from(appointments).where(and(
        eq(appointments.tenantId, tenant.id),
        eq(appointments.userId, user.id),
        gt(appointments.startTime, now),
        inArray(appointments.status, ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_SERVICE', 'AWAITING_PAYMENT']),
      )),
      this.db.select({ count: sql<number>`count(*)::int` }).from(appointments).where(and(
        eq(appointments.tenantId, tenant.id),
        eq(appointments.userId, user.id),
      )),
      this.db.select({ count: sql<number>`count(*)::int` }).from(users).where(and(
        eq(users.tenantId, tenant.id),
        eq(users.role, 'owner'),
        eq(users.accountStatus, 'ACTIVE'),
      )),
    ]);

    const blockers: Array<{ code: string; message: string }> = [];
    if (count(futureRows[0]) > 0) blockers.push({
      code: 'FUTURE_APPOINTMENTS_ASSIGNED',
      message: 'Reassign or cancel every future appointment before removing this user.',
    });
    if (user.role === 'owner' && user.accountStatus === 'ACTIVE' && count(ownerRows[0]) <= 1) blockers.push({
      code: 'LAST_OWNER_PROTECTION',
      message: 'Add another active owner before removing the final owner.',
    });

    return {
      user: {
        reference: user.publicReference,
        displayName: user.name,
        email: user.emailNormalized,
        role: user.role,
        status: user.accountStatus,
      },
      canRemove: blockers.length === 0,
      blockers,
      impact: {
        futureAppointments: count(futureRows[0]),
        historicalAppointmentsRetained: count(historyRows[0]),
        sessionsRevoked: true,
        bookingEligibilityRemoved: true,
        schedulesRemoved: true,
        auditHistoryRetained: true,
      },
    };
  }

  async removeUser(actor: AgencyActor, tenantReference: string, userReference: string, reason: string) {
    const tenant = await this.tenant(tenantReference);
    const preview = await this.previewUserRemoval(tenant.id, userReference);
    if (!preview.canRemove) {
      throw fail(409, 'TENANT_USER_REMOVAL_BLOCKED', 'Resolve the user-removal blockers before continuing.', preview);
    }
    const [user] = await this.db.select().from(users).where(and(
      eq(users.tenantId, tenant.id),
      eq(users.publicReference, userReference),
    )).limit(1);
    if (!user) throw fail(404, 'TENANT_USER_NOT_FOUND', 'The business user was not found.');

    const now = new Date();
    await this.db.transaction(async tx => {
      await tx.update(users).set({
        accountStatus: 'DEACTIVATED',
        bookingEnabled: false,
        deactivatedAt: now,
        suspendedAt: null,
        sessionsValidAfter: now,
        securityVersion: sql`${users.securityVersion} + 1`,
        updatedAt: now,
      }).where(eq(users.id, user.id));
      await tx.delete(staffSchedules).where(and(eq(staffSchedules.tenantId, tenant.id), eq(staffSchedules.userId, user.id)));
      await tx.delete(bookingChannelSchedules).where(and(eq(bookingChannelSchedules.tenantId, tenant.id), eq(bookingChannelSchedules.userId, user.id)));
      await tx.update(staffServiceAssignments).set({ isActive: false, updatedAt: now })
        .where(and(eq(staffServiceAssignments.tenantId, tenant.id), eq(staffServiceAssignments.staffUserId, user.id)));
      await tx.update(applicationSessions).set({
        selectedTenantUserId: null,
        securityVersion: 1,
        lastSeenAt: now,
      }).where(and(
        eq(applicationSessions.selectedTenantUserId, user.id),
        eq(applicationSessions.applicationContext, 'TENANT'),
        isNull(applicationSessions.revokedAt),
      ));
    });

    await this.audit.write(actor, 'TENANT_USER_REMOVED', 'TENANT_USER', user.id, {
      tenantId: tenant.id,
      reason,
      description: 'Business access was removed while historical operational attribution was retained.',
      metadata: { userReference: user.publicReference, historicalAppointmentsRetained: preview.impact.historicalAppointmentsRetained },
    });
    return { ...preview, canRemove: false, removed: true, status: 'DEACTIVATED' };
  }

  async previewWorkspaceDeletion(tenantReference: string) {
    const tenant = await this.tenant(tenantReference);
    const [
      appointmentRows,
      clientRows,
      paymentRows,
      subscriptionRows,
      setupPaymentRows,
      billingRows,
      stripeRows,
      deliverableRows,
      activeRunRows,
    ] = await Promise.all([
      this.db.select({ count: sql<number>`count(*)::int` }).from(appointments).where(eq(appointments.tenantId, tenant.id)),
      this.db.select({ count: sql<number>`count(*)::int` }).from(clients).where(eq(clients.tenantId, tenant.id)),
      this.db.select({ count: sql<number>`count(*)::int` }).from(checkoutTransactions).where(eq(checkoutTransactions.tenantId, tenant.id)),
      this.db.select({ count: sql<number>`count(*)::int` }).from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, tenant.id)),
      this.db.select({ count: sql<number>`count(*)::int` }).from(tenantSetupPayments).where(eq(tenantSetupPayments.tenantId, tenant.id)),
      this.db.select().from(tenantBillingAccounts).where(eq(tenantBillingAccounts.tenantId, tenant.id)).limit(1),
      this.db.select({ count: sql<number>`count(*)::int` }).from(stripeConnections).where(eq(stripeConnections.tenantId, tenant.id)),
      this.db.select({ count: sql<number>`count(*)::int` }).from(managedDeliverables).where(eq(managedDeliverables.tenantId, tenant.id)),
      this.db.select({ count: sql<number>`count(*)::int` }).from(provisioningRuns).where(and(
        eq(provisioningRuns.tenantId, tenant.id),
        inArray(provisioningRuns.status, [
          'QUEUED', 'PROVISIONING_TENANT', 'PROVISIONING_BUSINESS', 'PROVISIONING_SERVICES',
          'PROVISIONING_STAFF', 'PROVISIONING_AVAILABILITY', 'PROVISIONING_BOOKING',
          'PROVISIONING_FORMS', 'PROVISIONING_PAYMENTS', 'PLANNING_SITE', 'GENERATING_SITE',
          'VALIDATING_SITE', 'CREATING_REVIEW', 'CANCEL_REQUESTED',
        ]),
      )),
    ]);

    const billing = billingRows[0];
    const blockers: Array<{ code: string; message: string }> = [];
    if (tenant.launchedAt || tenant.lifecycleStatus === 'ACTIVE') blockers.push({ code: 'WORKSPACE_WAS_LAUNCHED', message: 'Launched workspaces must use the offboarding lifecycle.' });
    if (count(appointmentRows[0])) blockers.push({ code: 'APPOINTMENT_HISTORY_EXISTS', message: 'Appointment history must be retained; use offboarding instead.' });
    if (count(clientRows[0])) blockers.push({ code: 'CLIENT_HISTORY_EXISTS', message: 'Client records exist; use offboarding instead.' });
    if (count(paymentRows[0])) blockers.push({ code: 'PAYMENT_HISTORY_EXISTS', message: 'Payment records exist; use offboarding instead.' });
    if (count(subscriptionRows[0]) || count(setupPaymentRows[0])) blockers.push({ code: 'COMMERCIAL_HISTORY_EXISTS', message: 'Subscription or setup-fee history exists; use offboarding instead.' });
    if (billing && !['NOT_CREATED', 'PENDING', 'FAILED'].includes(String(billing.mandateStatus || 'NOT_CREATED'))) blockers.push({ code: 'DIRECT_DEBIT_HISTORY_EXISTS', message: 'A GoCardless mandate exists; use offboarding instead.' });
    if (count(stripeRows[0])) blockers.push({ code: 'PAYMENT_PROVIDER_CONNECTED', message: 'Disconnect and offboard the payment provider instead of deleting the workspace.' });
    if (count(deliverableRows[0])) blockers.push({ code: 'DELIVERABLE_HISTORY_EXISTS', message: 'Managed-service deliverables exist; use offboarding instead.' });
    if (count(activeRunRows[0])) blockers.push({ code: 'PROVISIONING_IN_PROGRESS', message: 'Cancel or finish the active provisioning run first.' });

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        subdomain: tenant.subdomain,
        lifecycleStatus: tenant.lifecycleStatus,
      },
      canDeleteUnused: blockers.length === 0,
      blockers,
      impact: {
        accessRevoked: true,
        bookingDisabled: true,
        websiteArchived: true,
        identifyingWorkspaceDataRemoved: true,
        auditTombstoneRetained: true,
        databaseRowRetainedForAuditIntegrity: true,
      },
    };
  }

  async deleteUnusedWorkspace(actor: AgencyActor, tenantReference: string, confirmationName: string, reason: string) {
    if (actor.role !== 'PLATFORM_OWNER') {
      throw fail(403, 'PLATFORM_OWNER_REQUIRED', 'Only the platform owner can permanently remove an unused workspace.');
    }
    const tenant = await this.tenant(tenantReference);
    if (confirmationName.trim() !== tenant.name) {
      throw fail(400, 'WORKSPACE_CONFIRMATION_MISMATCH', 'Type the current workspace name exactly to confirm removal.');
    }
    const preview = await this.previewWorkspaceDeletion(tenant.id);
    if (!preview.canDeleteUnused) {
      throw fail(409, 'WORKSPACE_DELETION_BLOCKED', 'This workspace contains retained operational or commercial history.', preview);
    }

    const members = await this.db.select({ id: users.id, reference: users.publicReference })
      .from(users).where(eq(users.tenantId, tenant.id));
    const now = new Date();
    const deletedSubdomain = `deleted-${tenant.id.replaceAll('-', '').slice(0, 24)}`;

    await this.db.transaction(async tx => {
      if (members.length) {
        await tx.update(applicationSessions).set({ selectedTenantUserId: null, securityVersion: 1, lastSeenAt: now })
          .where(inArray(applicationSessions.selectedTenantUserId, members.map(member => member.id)));
        await tx.delete(staffSchedules).where(eq(staffSchedules.tenantId, tenant.id));
        await tx.delete(bookingChannelSchedules).where(eq(bookingChannelSchedules.tenantId, tenant.id));
        await tx.update(staffServiceAssignments).set({ isActive: false, updatedAt: now })
          .where(eq(staffServiceAssignments.tenantId, tenant.id));
        for (const member of members) {
          const removedEmail = `removed+${member.reference}@invalid.ks-os.local`;
          await tx.update(users).set({
            email: removedEmail,
            emailNormalized: removedEmail,
            name: 'Removed user',
            accountStatus: 'DEACTIVATED',
            bookingEnabled: false,
            jobTitle: null,
            phone: null,
            profileImageUrl: null,
            bio: null,
            deactivatedAt: now,
            sessionsValidAfter: now,
            securityVersion: sql`${users.securityVersion} + 1`,
            updatedAt: now,
          }).where(eq(users.id, member.id));
        }
      }
      await tx.update(bookingPages).set({
        enabled: false,
        published: false,
        customDomain: null,
        canonicalDomain: null,
        allowedServiceIds: [],
        allowedLocationIds: [],
        allowedStaffIds: [],
        updatedAt: now,
      }).where(eq(bookingPages.tenantId, tenant.id));
      await tx.update(services).set({ isActive: false, updatedAt: now }).where(eq(services.tenantId, tenant.id));
      await tx.update(locations).set({ isActive: false, updatedAt: now }).where(eq(locations.tenantId, tenant.id));
      await tx.update(sites).set({ status: 'ARCHIVED', updatedAt: now }).where(eq(sites.tenantId, tenant.id));
      await tx.update(tenantPlanAssignments).set({ status: 'ENDED', endsAt: now, reason: 'UNUSED_WORKSPACE_REMOVED' })
        .where(and(eq(tenantPlanAssignments.tenantId, tenant.id), eq(tenantPlanAssignments.status, 'ACTIVE')));
      await tx.update(tenantOnboarding).set({ status: 'CANCELLED', updatedAt: now }).where(eq(tenantOnboarding.tenantId, tenant.id));
      await tx.update(tenantOnboardingStages).set({ status: 'SKIPPED', blockerNote: 'Workspace removed before launch.', updatedAt: now })
        .where(eq(tenantOnboardingStages.tenantId, tenant.id));
      await tx.update(tenants).set({
        name: 'Deleted workspace',
        legalBusinessName: null,
        businessType: null,
        subdomain: deletedSubdomain,
        customDomain: null,
        primaryContactName: null,
        primaryContactEmail: null,
        commercialNotes: null,
        replyToEmail: null,
        senderDisplayName: null,
        operationalPhone: null,
        lifecycleStatus: 'DELETED',
        isActive: false,
        suspendedAt: now,
        offboardedAt: now,
        updatedAt: now,
      }).where(eq(tenants.id, tenant.id));
    });

    await this.audit.write(actor, 'UNUSED_WORKSPACE_REMOVED', 'TENANT', tenant.id, {
      tenantId: tenant.id,
      reason,
      description: 'An unused workspace was removed from operational use and scrubbed while a non-identifying audit tombstone was retained.',
      metadata: { previousLifecycleStatus: tenant.lifecycleStatus, auditTombstoneRetained: true },
    });
    return { removed: true, lifecycleStatus: 'DELETED', auditTombstoneRetained: true };
  }
}
