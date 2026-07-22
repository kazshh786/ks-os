import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import {
  accountInvitations, agencyUsers, closeDatabase, customerAccounts, getDatabase, tenants, users,
} from '@ks-os/database';
import { createDevelopmentAuthUser } from '../apps/api/src/lib/supabase-admin.js';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

if (process.env.NODE_ENV === 'production') throw new Error('Development auth seed is disabled in production.');
const password = process.env.KS_OS_DEV_AUTH_PASSWORD;
if (!password || password.length < 10) throw new Error('Set KS_OS_DEV_AUTH_PASSWORD to a local-only password of at least 10 characters.');

const db = getDatabase();

async function auth(email: string) { return createDevelopmentAuthUser(email, password!); }
async function tenant(subdomain: string, name: string) {
  const [row] = await db.insert(tenants).values({ name, subdomain, lifecycleStatus: 'ACTIVE', isActive: true })
    .onConflictDoUpdate({ target: tenants.subdomain, set: { name, lifecycleStatus: 'ACTIVE', isActive: true, updatedAt: new Date() } }).returning();
  return row;
}
async function membership(input: { tenantId: string; authUserId?: string | null; email: string; name: string; role: 'owner' | 'staff'; status?: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED' }) {
  const normalized = input.email.toLowerCase();
  const [existing] = await db.select().from(users).where(and(eq(users.tenantId, input.tenantId), eq(users.emailNormalized, normalized))).limit(1);
  const values = { authUserId: input.authUserId || null, email: normalized, emailNormalized: normalized, name: input.name, role: input.role, accountStatus: input.status || 'ACTIVE', acceptedAt: input.status === 'INVITED' ? null : new Date(), suspendedAt: input.status === 'SUSPENDED' ? new Date() : null, updatedAt: new Date() };
  if (existing) return (await db.update(users).set(values).where(eq(users.id, existing.id)).returning())[0];
  return (await db.insert(users).values({ tenantId: input.tenantId, ...values }).returning())[0];
}

async function main() {
  const [platformIdentity, supportIdentity, ownerAIdentity, staffAIdentity, ownerBIdentity, multiIdentity, customerIdentity, suspendedIdentity] = await Promise.all([
    auth('kasim@kasimshah.com'), auth('agency.support@ksos.local'), auth('owner@salon-a.ksos.local'),
    auth('staff@salon-a.ksos.local'), auth('owner@salon-b.ksos.local'), auth('multi-tenant-user@ksos.local'),
    auth('customer@ksos.local'), auth('suspended@salon-a.ksos.local'),
  ]);
  const [salonA, salonB] = await Promise.all([tenant('salon-a', 'Salon A'), tenant('salon-b', 'Salon B')]);

  const [platformOwner] = await db.insert(agencyUsers).values({ authUserId: platformIdentity.id, emailNormalized: 'kasim@kasimshah.com', displayName: 'Platform Owner', role: 'PLATFORM_OWNER', status: 'ACTIVE', mfaRequired: true, activatedAt: new Date() })
    .onConflictDoUpdate({ target: agencyUsers.emailNormalized, set: { authUserId: platformIdentity.id, status: 'ACTIVE', role: 'PLATFORM_OWNER', mfaRequired: true, updatedAt: new Date() } }).returning();
  await db.insert(agencyUsers).values({ authUserId: supportIdentity.id, emailNormalized: 'agency.support@ksos.local', displayName: 'Agency Support', role: 'SUPPORT_ADMINISTRATOR', status: 'ACTIVE', mfaRequired: true, activatedAt: new Date(), invitedByAgencyUserId: platformOwner.id })
    .onConflictDoUpdate({ target: agencyUsers.emailNormalized, set: { authUserId: supportIdentity.id, status: 'ACTIVE', role: 'SUPPORT_ADMINISTRATOR', mfaRequired: true, updatedAt: new Date() } });

  const ownerA = await membership({ tenantId: salonA.id, authUserId: ownerAIdentity.id, email: 'owner@salon-a.ksos.local', name: 'Salon A Owner', role: 'owner' });
  await membership({ tenantId: salonA.id, authUserId: staffAIdentity.id, email: 'staff@salon-a.ksos.local', name: 'Salon A Staff', role: 'staff' });
  await membership({ tenantId: salonB.id, authUserId: ownerBIdentity.id, email: 'owner@salon-b.ksos.local', name: 'Salon B Owner', role: 'owner' });
  await membership({ tenantId: salonA.id, authUserId: multiIdentity.id, email: 'multi-tenant-user@ksos.local', name: 'Multi-business User', role: 'staff' });
  await membership({ tenantId: salonB.id, authUserId: multiIdentity.id, email: 'multi-tenant-user@ksos.local', name: 'Multi-business User', role: 'staff' });
  await membership({ tenantId: salonA.id, authUserId: suspendedIdentity.id, email: 'suspended@salon-a.ksos.local', name: 'Suspended User', role: 'staff', status: 'SUSPENDED' });

  await db.insert(customerAccounts).values({ authUserId: customerIdentity.id, emailNormalized: 'customer@ksos.local', displayName: 'Test Customer', status: 'ACTIVE' })
    .onConflictDoUpdate({ target: customerAccounts.authUserId, set: { status: 'ACTIVE', updatedAt: new Date() } });

  const expiredMembership = await membership({ tenantId: salonA.id, email: 'expired-invite@ksos.local', name: 'Expired Invite', role: 'staff', status: 'INVITED' });
  const [existingExpired] = await db.select().from(accountInvitations).where(and(eq(accountInvitations.tenantId, salonA.id), eq(accountInvitations.emailNormalized, 'expired-invite@ksos.local'))).limit(1);
  if (!existingExpired) await db.insert(accountInvitations).values({ invitationType: 'TENANT_STAFF', emailNormalized: 'expired-invite@ksos.local', tenantId: salonA.id, tenantRole: 'staff', status: 'EXPIRED', invitedByAuthUserId: ownerAIdentity.id, invitedByTenantUserId: ownerA.id, expiresAt: new Date(Date.now() - 86_400_000) });
  await db.update(users).set({ invitedByUserId: ownerA.id, invitedAt: new Date(Date.now() - 8 * 86_400_000) }).where(eq(users.id, expiredMembership.id));

  console.info('Development authentication seed completed for KS OS development accounts.');
}

main()
  .finally(() => closeDatabase())
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
