import { randomBytes } from 'node:crypto';
import { and, eq, or } from 'drizzle-orm';
import { getDatabase, tenants, users } from '@ks-os/database';
import { deleteSupabaseUserIfCreated, provisionSupabaseUserWithoutEmail } from '../../lib/supabase-admin.js';
import { AgencyAuditService, type AgencyActor } from './agency.service.js';

const fail = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });
const normalizeEmail = (email: string) => email.trim().toLocaleLowerCase('en-US');
const temporaryPassword = () => `Ks!${randomBytes(12).toString('base64url')}9a`;

export interface ManualTenantUserInput {
  email: string;
  displayName: string;
  role: 'owner' | 'staff';
  bookingEnabled?: boolean;
}

export interface ManualTenantUserProfileInput {
  displayName: string;
  jobTitle: string;
  biography: string;
  bookingEnabled: boolean;
}

export class ManualTenantUserService {
  private db = getDatabase();
  private audit = new AgencyAuditService();

  async create(actor: AgencyActor, tenantReference: string, input: ManualTenantUserInput) {
    const [tenant] = await this.db.select().from(tenants).where(or(
      eq(tenants.id, tenantReference),
      eq(tenants.agencyReference, tenantReference),
      eq(tenants.subdomain, tenantReference),
    )).limit(1);
    if (!tenant) throw fail(404, 'TENANT_NOT_FOUND', 'Business workspace not found.');

    const emailNormalized = normalizeEmail(input.email);
    const [existingMembership] = await this.db.select().from(users).where(and(
      eq(users.tenantId, tenant.id),
      eq(users.emailNormalized, emailNormalized),
    )).limit(1);
    if (existingMembership && existingMembership.accountStatus !== 'DEACTIVATED') {
      throw fail(409, 'TENANT_USER_ALREADY_EXISTS', 'This email address already has access to the business workspace.');
    }

    const generatedPassword = temporaryPassword();
    const identity = await provisionSupabaseUserWithoutEmail({
      email: emailNormalized,
      displayName: input.displayName,
      temporaryPassword: generatedPassword,
    });

    try {
      const now = new Date();
      const bookingEnabled = input.role === 'staff' && input.bookingEnabled === true;
      const record = await this.db.transaction(async tx => {
        const [membership] = existingMembership
          ? await tx.update(users).set({
            authUserId: identity.authUserId,
            email: emailNormalized,
            emailNormalized,
            name: input.displayName.trim(),
            role: input.role,
            accountStatus: 'ACTIVE',
            bookingEnabled,
            invitedByAgencyUserId: actor.agencyUserId,
            invitedAt: now,
            acceptedAt: now,
            suspendedAt: null,
            deactivatedAt: null,
            sessionsValidAfter: now,
            updatedAt: now,
          }).where(eq(users.id, existingMembership.id)).returning()
          : await tx.insert(users).values({
            tenantId: tenant.id,
            authUserId: identity.authUserId,
            email: emailNormalized,
            emailNormalized,
            name: input.displayName.trim(),
            role: input.role,
            accountStatus: 'ACTIVE',
            bookingEnabled,
            invitedByAgencyUserId: actor.agencyUserId,
            invitedAt: now,
            acceptedAt: now,
          }).returning();

        await this.audit.write(actor, 'TENANT_USER_MANUALLY_PROVISIONED', 'TENANT_USER', membership.id, {
          tenantId: tenant.id,
          tx,
          metadata: {
            role: input.role,
            bookingEnabled,
            identityMode: identity.created ? 'NEW_IDENTITY' : 'EXISTING_IDENTITY',
          },
        });
        return membership;
      });

      return {
        id: record.publicReference,
        email: record.emailNormalized,
        displayName: record.name,
        role: record.role,
        status: record.accountStatus,
        bookingEnabled: record.bookingEnabled,
        identityMode: identity.created ? 'NEW_IDENTITY' : 'EXISTING_IDENTITY',
        temporaryPassword: identity.created ? generatedPassword : null,
      };
    } catch (error) {
      if (identity.created) await deleteSupabaseUserIfCreated(identity.authUserId);
      throw error;
    }
  }

  async updateProfile(
    actor: AgencyActor,
    tenantReference: string,
    userReference: string,
    input: ManualTenantUserProfileInput,
  ) {
    const [tenant] = await this.db.select({ id: tenants.id }).from(tenants).where(or(
      eq(tenants.id, tenantReference),
      eq(tenants.agencyReference, tenantReference),
      eq(tenants.subdomain, tenantReference),
    )).limit(1);
    if (!tenant) throw fail(404, 'TENANT_NOT_FOUND', 'Business workspace not found.');
    const [updated] = await this.db.update(users).set({
      name: input.displayName.trim(),
      jobTitle: input.jobTitle.trim(),
      bio: input.biography.trim(),
      bookingEnabled: input.bookingEnabled,
      updatedAt: new Date(),
    }).where(and(
      eq(users.tenantId, tenant.id),
      eq(users.publicReference, userReference),
      eq(users.accountStatus, 'ACTIVE'),
    )).returning();
    if (!updated) throw fail(404, 'TENANT_USER_NOT_FOUND', 'Active business user not found.');
    await this.audit.write(actor, 'TENANT_USER_PROFILE_UPDATED', 'TENANT_USER', updated.id, {
      tenantId: tenant.id,
      metadata: { bookingEnabled: updated.bookingEnabled },
    });
    return {
      id: updated.publicReference,
      displayName: updated.name,
      jobTitle: updated.jobTitle,
      bookingEnabled: updated.bookingEnabled,
    };
  }
}
