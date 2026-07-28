import type { FastifyPluginAsync } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDatabase, locations, tenants } from '@ks-os/database';
import { WorkspacePlanSummarySchema } from '@ks-os/contracts';
import { EntitlementService } from '../modules/agency/agency.service.js';
import {
  modeToPaymentPolicy,
  paymentPolicyToMode,
  splitBusinessAddress,
  type BusinessPaymentPolicy,
} from './workspace-profile.helpers.js';

const WorkspaceProfileUpdateSchema = z.object({
  name: z.string().trim().min(2).max(255),
  address: z.string().trim().max(1000).default(''),
  phone: z.string().trim().max(30).default(''),
  email: z.union([z.string().trim().email(), z.literal('')]).default(''),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  currency: z.enum(['GBP', 'USD', 'EUR']),
  paymentPolicy: z.enum(['NoPayment', 'PayLater', 'Deposit', 'FullPayment', 'CustomerChoice']),
}).strict();

const fail = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });
const planLabel = (key: string): 'Starter' | 'Plus' | 'Pro' => key === 'SCALE' ? 'Pro' : key === 'GROWTH' ? 'Plus' : 'Starter';

const workspaceRoutes: FastifyPluginAsync = async fastify => {
  const entitlements = new EntitlementService();
  const db = getDatabase();

  async function profileForTenant(tenantId: string, planKey: string) {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) throw fail(404, 'WORKSPACE_NOT_FOUND', 'Business workspace not found.');

    let [location] = await db.select().from(locations).where(and(
      eq(locations.tenantId, tenantId),
      eq(locations.isPrimary, true),
    )).limit(1);
    if (!location) {
      [location] = await db.select().from(locations).where(and(
        eq(locations.tenantId, tenantId),
        eq(locations.isActive, true),
      )).limit(1);
    }

    const locationAddress = location?.address?.trim() || '';
    const postcode = location?.postcode?.trim() || '';
    const address = postcode && !locationAddress.toUpperCase().endsWith(postcode.toUpperCase())
      ? [locationAddress, postcode].filter(Boolean).join(', ')
      : locationAddress;

    return {
      id: tenant.businessReference,
      name: tenant.name,
      subdomain: tenant.subdomain,
      customDomain: tenant.customDomain || undefined,
      primaryColor: tenant.primaryColor,
      secondaryColor: tenant.secondaryColor,
      timezone: tenant.timezone,
      currency: tenant.currency,
      plan: planLabel(planKey),
      paymentPolicy: modeToPaymentPolicy(tenant.defaultPaymentMode),
      depositPercentage: tenant.defaultPaymentMode === 'deposit' ? 30 : 0,
      address,
      phone: tenant.operationalPhone || location?.phone || '',
      email: tenant.primaryContactEmail || tenant.replyToEmail || '',
    };
  }

  fastify.get('/api/v1/workspace', async (request, reply) => {
    request.requireAuth();
    const plan = WorkspacePlanSummarySchema.parse(await entitlements.workspaceSummary(request.auth!.tenantId));
    const profile = await profileForTenant(request.auth!.tenantId, plan.plan.key);

    return reply.send({
      success: true,
      data: {
        id: request.auth!.businessReference,
        name: profile.name,
        subdomain: profile.subdomain,
        customDomain: profile.customDomain || null,
        packageTier: plan.plan.key.toLowerCase(),
        plan,
        profile,
      },
    });
  });

  fastify.patch('/api/v1/workspace', async (request, reply) => {
    request.requireAuth();
    if (request.auth!.role !== 'owner') throw fail(403, 'WORKSPACE_SETTINGS_FORBIDDEN', 'Only a business owner can update business settings.');

    const input = WorkspaceProfileUpdateSchema.parse(request.body);
    const tenantId = request.auth!.tenantId;
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) throw fail(404, 'WORKSPACE_NOT_FOUND', 'Business workspace not found.');

    await db.transaction(async tx => {
      await tx.update(tenants).set({
        name: input.name,
        primaryColor: input.primaryColor.toLowerCase(),
        currency: input.currency,
        defaultPaymentMode: paymentPolicyToMode(input.paymentPolicy as BusinessPaymentPolicy),
        primaryContactEmail: input.email || null,
        replyToEmail: input.email || null,
        operationalPhone: input.phone || null,
        senderDisplayName: input.name,
        updatedAt: new Date(),
      }).where(eq(tenants.id, tenantId));

      let [location] = await tx.select().from(locations).where(and(
        eq(locations.tenantId, tenantId),
        eq(locations.isPrimary, true),
      )).limit(1);
      if (!location) [location] = await tx.select().from(locations).where(eq(locations.tenantId, tenantId)).limit(1);

      const parsedAddress = splitBusinessAddress(input.address);
      if (location) {
        await tx.update(locations).set({
          address: parsedAddress.address || input.address || location.address,
          postcode: parsedAddress.postcode || location.postcode,
          phone: input.phone || null,
          timezone: tenant.timezone,
          isPrimary: true,
          isActive: parsedAddress.postcode ? true : location.isActive,
          updatedAt: new Date(),
        }).where(eq(locations.id, location.id));
      } else if (input.address) {
        await tx.insert(locations).values({
          tenantId,
          name: `${input.name} main location`,
          address: parsedAddress.address || input.address,
          postcode: parsedAddress.postcode,
          phone: input.phone || null,
          timezone: tenant.timezone,
          isPrimary: true,
          isActive: Boolean(parsedAddress.postcode),
        });
      }
    });

    const plan = WorkspacePlanSummarySchema.parse(await entitlements.workspaceSummary(tenantId));
    return reply.send({ success: true, data: { profile: await profileForTenant(tenantId, plan.plan.key) } });
  });
};

export default workspaceRoutes;
