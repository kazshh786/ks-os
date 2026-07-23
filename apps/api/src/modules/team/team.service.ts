import { and, count, desc, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import {
  accountAccessAuditEvents, accountInvitations, appointments, applicationSessions, bookingChannelSchedules, getDatabase, services,
  staffSchedules, staffServiceAssignments, users,
} from '@ks-os/database';
import type {
  CreateTeamInvitationRequest, StaffLifecycleAction, UpdateBookingChannelScheduleRequest,
  UpdateStaffProfileRequest, UpdateStaffScheduleRequest, UpdateStaffServicesRequest,
} from '@ks-os/contracts';
import { AccountInvitationService } from '../authentication/account-invitation.service.js';
import { EntitlementService } from '../agency/agency.service.js';
import { teamError } from './team.errors.js';

type Actor = { tenantId: string; userId: string; authUserId: string };
const notCancelled = () => sql`${appointments.status} not in ('CANCELLED','NO_SHOW')`;

export class TeamService {
  private db = getDatabase();
  private entitlements = new EntitlementService();
  private invitations = new AccountInvitationService();

  async list(actor: Actor) {
    const members = await this.db.select({
      userId: users.publicReference, name: users.name, email: users.emailNormalized, role: users.role,
      accountStatus: users.accountStatus, bookingEnabled: users.bookingEnabled, lastActiveAt: users.lastActiveAt,
      assignedServiceCount: sql<number>`count(distinct ${staffServiceAssignments.id})::int`,
      futureAppointmentCount: sql<number>`count(distinct ${appointments.id}) filter(where ${appointments.startTime}>now() and ${appointments.status} not in ('CANCELLED','NO_SHOW'))::int`,
    }).from(users)
      .leftJoin(staffServiceAssignments, and(eq(staffServiceAssignments.staffUserId, users.id), eq(staffServiceAssignments.tenantId, actor.tenantId), eq(staffServiceAssignments.isActive, true)))
      .leftJoin(appointments, and(eq(appointments.userId, users.id), eq(appointments.tenantId, actor.tenantId)))
      .where(and(eq(users.tenantId, actor.tenantId), inArray(users.role, ['owner','staff']), ne(users.accountStatus, 'INVITED')))
      .groupBy(users.id).orderBy(users.name);
    const invitations = await this.db.select({
      id: accountInvitations.publicReference, email: accountInvitations.emailNormalized, name: users.name,
      status: accountInvitations.status, expiresAt: accountInvitations.expiresAt,
      lastSentAt: accountInvitations.lastSentAt, sendCount: accountInvitations.sendCount,
    }).from(accountInvitations).leftJoin(users, and(eq(users.tenantId, accountInvitations.tenantId), eq(users.emailNormalized, accountInvitations.emailNormalized))).where(and(
      eq(accountInvitations.tenantId, actor.tenantId), eq(accountInvitations.invitationType, 'TENANT_STAFF'),
    )).orderBy(desc(accountInvitations.createdAt));
    return { members, invitations };
  }

  private async resolveMember(actor: Actor, publicReference: string) {
    const [member] = await this.db.select().from(users).where(and(
      eq(users.publicReference, publicReference), eq(users.tenantId, actor.tenantId), inArray(users.role, ['owner', 'staff']),
    )).limit(1);
    if (!member) throw teamError(404, 'TEAM_MEMBER_NOT_FOUND', 'Team member not found.');
    return member;
  }

  async get(actor: Actor, id: string) {
    const member = await this.resolveMember(actor, id);
    const [assignedServices, schedule, channels] = await Promise.all([
      this.db.select({ serviceId: staffServiceAssignments.serviceId, name: services.name }).from(staffServiceAssignments)
        .innerJoin(services, and(eq(services.id, staffServiceAssignments.serviceId), eq(services.tenantId, actor.tenantId)))
        .where(and(eq(staffServiceAssignments.tenantId, actor.tenantId), eq(staffServiceAssignments.staffUserId, member.id), eq(staffServiceAssignments.isActive, true))),
      this.db.select().from(staffSchedules).where(and(eq(staffSchedules.tenantId, actor.tenantId), eq(staffSchedules.userId, member.id))),
      this.db.select().from(bookingChannelSchedules).where(and(eq(bookingChannelSchedules.tenantId, actor.tenantId), eq(bookingChannelSchedules.userId, member.id))),
    ]);
    return { ...member, id: member.publicReference, assignedServices, schedule, bookingChannels: channels };
  }

  async invite(actor: Actor, input: CreateTeamInvitationRequest) {
    const email = input.email.trim().toLowerCase();
    const [member] = await this.db.select({ id: users.id }).from(users).where(and(eq(users.tenantId, actor.tenantId), eq(users.emailNormalized, email))).limit(1);
    if (member) throw teamError(409, 'TEAM_EMAIL_ALREADY_MEMBER', 'An invitation cannot be created for this address.');
    const [active, pending] = await Promise.all([
      this.db.select({ value: count() }).from(users).where(and(eq(users.tenantId, actor.tenantId), eq(users.role, 'staff'), eq(users.accountStatus, 'ACTIVE'))),
      this.db.select({ value: count() }).from(accountInvitations).where(and(eq(accountInvitations.tenantId, actor.tenantId), eq(accountInvitations.invitationType, 'TENANT_STAFF'), eq(accountInvitations.status, 'PENDING'))),
    ]);
    await this.entitlements.assertQuantity(actor.tenantId,'staff.limit', Number(active[0]?.value || 0) + Number(pending[0]?.value || 0));
    return this.invitations.createTenantInvitation({
      tenantId: actor.tenantId, invitedByAuthUserId: actor.authUserId, invitedByTenantUserId: actor.userId,
      email, displayName: input.name, role: 'staff',
    });
  }

  resend(actor: Actor, id: string) { return this.invitations.resend(id, { authUserId: actor.authUserId, tenantId: actor.tenantId }); }
  cancelInvitation(actor: Actor, id: string) { return this.invitations.cancel(id, { authUserId: actor.authUserId, tenantId: actor.tenantId }); }

  async accept(authUserId: string, email: string) {
    const normalized = email.trim().toLowerCase();
    const [invitation] = await this.db.select().from(accountInvitations).where(and(
      eq(accountInvitations.emailNormalized, normalized), eq(accountInvitations.supabaseAuthUserId, authUserId),
      eq(accountInvitations.invitationType, 'TENANT_STAFF'), eq(accountInvitations.status, 'PENDING'),
    )).orderBy(desc(accountInvitations.createdAt)).limit(1);
    if (!invitation) throw teamError(404, 'TEAM_INVITATION_NOT_FOUND', 'Invitation not found.');
    return this.invitations.accept(invitation.publicReference, { authUserId, email: normalized }, 'TENANT');
  }

  async updateProfile(actor: Actor, id: string, input: UpdateStaffProfileRequest) {
    const member = await this.resolveMember(actor, id);
    const [row] = await this.db.update(users).set({ ...input, updatedAt: new Date() }).where(eq(users.id, member.id)).returning();
    return { ...row, id: row.publicReference };
  }

  async updateServices(actor: Actor, id: string, input: UpdateStaffServicesRequest) {
    const member = await this.resolveMember(actor, id);
    const found = input.serviceIds.length ? await this.db.select({ id: services.id }).from(services).where(and(eq(services.tenantId, actor.tenantId), inArray(services.id, input.serviceIds))) : [];
    if (found.length !== input.serviceIds.length) throw teamError(404, 'TEAM_SERVICE_NOT_FOUND', 'Service not found.');
    await this.db.transaction(async tx => {
      await tx.delete(staffServiceAssignments).where(and(eq(staffServiceAssignments.tenantId, actor.tenantId), eq(staffServiceAssignments.staffUserId, member.id)));
      if (input.serviceIds.length) await tx.insert(staffServiceAssignments).values(input.serviceIds.map(serviceId => ({ tenantId: actor.tenantId, staffUserId: member.id, serviceId })));
    });
    return this.get(actor, id);
  }

  async updateSchedule(actor: Actor, id: string, input: UpdateStaffScheduleRequest) {
    const member = await this.resolveMember(actor, id);
    await this.db.transaction(async tx => {
      await tx.delete(staffSchedules).where(and(eq(staffSchedules.tenantId, actor.tenantId), eq(staffSchedules.userId, member.id)));
      const rows = input.schedule.filter(item => item.enabled).map(item => ({ tenantId: actor.tenantId, userId: member.id, dayOfWeek: item.dayOfWeek, startTime: item.startTime, endTime: item.endTime }));
      if (rows.length) await tx.insert(staffSchedules).values(rows);
    });
    return this.get(actor, id);
  }

  async updateChannels(actor: Actor, id: string, input: UpdateBookingChannelScheduleRequest) {
    const member = await this.resolveMember(actor, id);
    await this.db.transaction(async tx => {
      await tx.delete(bookingChannelSchedules).where(and(eq(bookingChannelSchedules.tenantId, actor.tenantId), eq(bookingChannelSchedules.userId, member.id), eq(bookingChannelSchedules.bookingChannel, input.channel)));
      const rows = input.schedule.filter(item => item.enabled).map(item => ({ tenantId: actor.tenantId, userId: member.id, bookingChannel: input.channel, dayOfWeek: item.dayOfWeek, startTime: item.startTime, endTime: item.endTime }));
      if (rows.length) await tx.insert(bookingChannelSchedules).values(rows);
    });
    return this.get(actor, id);
  }

  async preview(actor: Actor, id: string, action: StaffLifecycleAction) {
    const member = await this.resolveMember(actor, id);
    const [future] = await this.db.select({ value: count() }).from(appointments).where(and(eq(appointments.tenantId, actor.tenantId), eq(appointments.userId, member.id), gte(appointments.startTime, new Date()), notCancelled()));
    const assignedServices = await this.db.select({ id: staffServiceAssignments.id }).from(staffServiceAssignments).where(and(eq(staffServiceAssignments.tenantId, actor.tenantId), eq(staffServiceAssignments.staffUserId, member.id), eq(staffServiceAssignments.isActive, true)));
    return { action, currentStatus: member.accountStatus, futureAppointments: future.value, affectedServices: assignedServices.length, canApply: true, requiresConfirmation: true };
  }

  async apply(actor: Actor, id: string, action: StaffLifecycleAction) {
    const member = await this.resolveMember(actor, id);
    const status = action === 'suspend' ? 'SUSPENDED' : action === 'deactivate' ? 'DEACTIVATED' : 'ACTIVE';
    if (member.role === 'owner' || member.id === actor.userId) throw teamError(409, 'TEAM_OWNER_PROTECTED', 'Owners are protected from staff lifecycle actions.');
    const now = new Date();
    await this.db.transaction(async tx => {
      await tx.update(users).set({
        accountStatus: status, bookingEnabled: status === 'ACTIVE' ? member.bookingEnabled : false,
        suspendedAt: status === 'SUSPENDED' ? now : null, deactivatedAt: status === 'DEACTIVATED' ? now : null,
        ...(status === 'ACTIVE' ? {} : { sessionsValidAfter: now }),
        securityVersion: sql`${users.securityVersion} + 1`, updatedAt: now,
      }).where(eq(users.id, member.id));
      await tx.update(applicationSessions).set({ selectedTenantUserId: null, securityVersion: 1, lastSeenAt: now }).where(and(eq(applicationSessions.selectedTenantUserId, member.id), eq(applicationSessions.applicationContext, 'TENANT'), sql`${applicationSessions.revokedAt} is null`));
      await tx.insert(accountAccessAuditEvents).values({ authUserId: actor.authUserId, tenantId: actor.tenantId, tenantUserId: member.id, applicationContext: 'TENANT', action: `TENANT_MEMBERSHIP_${status}` });
    });
    return { ...(await this.preview(actor, id, action)), accountStatus: status };
  }
}
