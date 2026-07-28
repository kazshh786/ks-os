import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { and, eq, sql } from 'drizzle-orm';
import {
  agencyUsers,
  bookingPages,
  closeDatabase,
  getDatabase,
  locations,
  platformPlans,
  platformPlanVersions,
  services,
  staffSchedules,
  tenants,
  users,
} from '@ks-os/database';
import { AgencyService, type AgencyActor } from '../apps/api/src/modules/agency/agency.service.js';
import { ManualTenantUserService } from '../apps/api/src/modules/agency/manual-tenant-user.service.js';
import { BookingPageService } from '../apps/api/src/modules/bookings/booking-page.service.js';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const WORKSPACE_SLUG = 'barebeautykieghley';
const WORKSPACE_NAME = 'Bare Beauty Keighley';
const OWNER_EMAIL = 'sidra@barebeautykieghley.co.uk';
const OWNER_NAME = 'Sidra';

if (process.env.CONFIRM_PRODUCTION_CLIENT_PROVISIONING !== WORKSPACE_SLUG) {
  throw new Error(`Set CONFIRM_PRODUCTION_CLIENT_PROVISIONING=${WORKSPACE_SLUG} before running this production client provisioner.`);
}

const db = getDatabase();

async function main() {
  const [platformOwner] = await db.select().from(agencyUsers).where(and(
    eq(agencyUsers.role, 'PLATFORM_OWNER'),
    eq(agencyUsers.status, 'ACTIVE'),
  )).limit(1);
  if (!platformOwner?.authUserId) throw new Error('An active platform owner with a Supabase identity is required.');

  const actor: AgencyActor = {
    agencyUserId: platformOwner.id,
    role: 'PLATFORM_OWNER',
    requestId: `bootstrap:${WORKSPACE_SLUG}`,
  };

  const [corePlan] = await db.select({ id: platformPlanVersions.id })
    .from(platformPlanVersions)
    .innerJoin(platformPlans, eq(platformPlanVersions.planId, platformPlans.id))
    .where(and(eq(platformPlans.key, 'CORE'), eq(platformPlanVersions.status, 'ACTIVE')))
    .orderBy(sql`${platformPlanVersions.version} desc`)
    .limit(1);
  if (!corePlan) throw new Error('An active Core plan version is required.');

  const agency = new AgencyService();
  let [tenant] = await db.select().from(tenants).where(eq(tenants.subdomain, WORKSPACE_SLUG)).limit(1);
  let createdTenant = false;
  if (!tenant) {
    tenant = await agency.createTenant(actor, {
      name: WORKSPACE_NAME,
      legalBusinessName: WORKSPACE_NAME,
      subdomain: WORKSPACE_SLUG,
      businessType: 'Beauty salon',
      timezone: 'Europe/London',
      currency: 'GBP',
      planVersionId: corePlan.id,
      primaryContactName: OWNER_NAME,
      primaryContactEmail: OWNER_EMAIL,
      foundingClient: true,
      commercialNotes: 'First KS OS client. Booking-first launch; managed website follows.',
    });
    createdTenant = true;
  }

  if (!tenant.isActive || tenant.lifecycleStatus !== 'ACTIVE') {
    tenant = await agency.changeLifecycle(actor, tenant.id, 'REACTIVATE', 'Booking-first founding client activation');
  }

  const manualUsers = new ManualTenantUserService();
  let [sidra] = await db.select().from(users).where(and(
    eq(users.tenantId, tenant.id),
    eq(users.emailNormalized, OWNER_EMAIL),
  )).limit(1);
  let temporaryPassword: string | null = null;
  let createdUser = false;

  if (!sidra) {
    const result = await manualUsers.create(actor, tenant.id, {
      email: OWNER_EMAIL,
      displayName: OWNER_NAME,
      role: 'owner',
      bookingEnabled: true,
    });
    temporaryPassword = result.temporaryPassword;
    createdUser = true;
    [sidra] = await db.select().from(users).where(and(
      eq(users.tenantId, tenant.id),
      eq(users.emailNormalized, OWNER_EMAIL),
    )).limit(1);
  }
  if (!sidra?.authUserId) throw new Error('Sidra was not connected to a Supabase login identity.');

  [sidra] = await db.update(users).set({
    name: OWNER_NAME,
    role: 'owner',
    accountStatus: 'ACTIVE',
    bookingEnabled: true,
    acceptedAt: sidra.acceptedAt || new Date(),
    updatedAt: new Date(),
  }).where(eq(users.id, sidra.id)).returning();

  const bookingService = new BookingPageService();
  const page = await bookingService.ensureForTenant(tenant.id);
  await db.update(bookingPages).set({
    title: `Book with ${WORKSPACE_NAME}`,
    publicSlug: WORKSPACE_SLUG,
    updatedAt: new Date(),
  }).where(eq(bookingPages.id, page.id));

  const [readiness] = await db.select({
    services: sql<number>`(select count(*)::int from services where tenant_id=${tenant.id}::uuid and is_active=true)`,
    schedules: sql<number>`(select count(*)::int from staff_schedules where tenant_id=${tenant.id}::uuid and user_id=${sidra.id}::uuid)`,
    locations: sql<number>`(select count(*)::int from locations where tenant_id=${tenant.id}::uuid and is_active=true)`,
  }).from(tenants).where(eq(tenants.id, tenant.id)).limit(1);

  const readyToPublish = Number(readiness?.services || 0) > 0
    && Number(readiness?.schedules || 0) > 0
    && Number(readiness?.locations || 0) > 0;
  let published = page.published;
  if (readyToPublish && !page.published) {
    const publishedPage = await bookingService.setPublished(tenant.id, true);
    published = publishedPage.published;
  }

  const blockers = [
    Number(readiness?.services || 0) === 0 ? 'Add at least one real service with duration and price.' : null,
    Number(readiness?.schedules || 0) === 0 ? 'Add Sidra’s actual working hours.' : null,
    Number(readiness?.locations || 0) === 0 ? 'Add the salon’s real location and address.' : null,
  ].filter(Boolean);

  console.info(JSON.stringify({
    workspace: {
      id: tenant.id,
      name: tenant.name,
      subdomain: tenant.subdomain,
      created: createdTenant,
      active: tenant.isActive,
    },
    owner: {
      email: sidra.emailNormalized,
      role: sidra.role,
      bookingEnabled: sidra.bookingEnabled,
      created: createdUser,
      temporaryPassword,
    },
    publicUrls: {
      booking: `https://${WORKSPACE_SLUG}.kasimshah.com/book`,
      forms: `https://${WORKSPACE_SLUG}.kasimshah.com/form/<form-name>`,
    },
    booking: {
      published,
      readyToPublish,
      services: Number(readiness?.services || 0),
      schedules: Number(readiness?.schedules || 0),
      locations: Number(readiness?.locations || 0),
      blockers,
    },
  }, null, 2));
}

main()
  .finally(() => closeDatabase())
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
