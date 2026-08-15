import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AgencyCapability } from '@ks-os/contracts';
import { AssetEntityBindingSchema, FactFindingUploadSchema } from '@ks-os/fact-finding';
import {
  CreateProvisioningDraftSchema,
  ProvisioningActionReasonSchema,
  StartProvisioningRunSchema,
  UpdateProvisioningDraftSchema,
} from '@ks-os/workspace-provisioning';
import type { AgencyActor } from '../agency/agency.service.js';
import { AgencyBookingSetupService } from './agency-booking-setup.service.js';
import { AssetLibraryService } from './asset-library.service.js';
import { BookingAwareProvisioningService } from './booking-aware-provisioning.service.js';
import { DeliveryContextService } from './delivery-context.service.js';
import { TenantLifecycleService } from './tenant-lifecycle.service.js';
import { WorkspaceDataService } from './workspace-data.service.js';

const DraftParams = z.object({ draftReference: z.string().uuid() }).strict();
const RunParams = z.object({ runReference: z.string().uuid() }).strict();
const TenantParams = z.object({ tenantReference: z.string().uuid() }).strict();
const TenantUserParams = TenantParams.extend({ userReference: z.string().uuid() }).strict();
const TenantAssetParams = TenantParams.extend({ uploadReference: z.string().uuid() }).strict();
const AssetPermissionsBody = z.object({
  publicUsePermission: z.boolean(),
  aiUsePermission: z.boolean(),
  copyrightConfirmed: z.boolean(),
  consentStatus: z.enum(['NOT_APPLICABLE', 'CONFIRMED', 'REQUIRED']),
}).strict();
const CreateBookingServiceBody = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().min(10).max(4_000),
  durationMinutes: z.number().int().min(5).max(1_440),
  priceMinor: z.number().int().min(0).max(100_000_000),
  bufferMinutes: z.number().int().min(0).max(240).optional(),
}).strict();
const RemoveUserBody = z.object({
  reason: z.string().trim().min(20).max(500),
  confirmed: z.literal(true),
}).strict();
const DeleteWorkspaceBody = z.object({
  reason: z.string().trim().min(20).max(500),
  confirmationName: z.string().trim().min(2).max(255),
}).strict();
const ResetTestDataBody = z.object({
  reason: z.string().trim().min(20).max(500),
  confirmationPhrase: z.literal('RESET TEST DATA'),
}).strict();
const HardDeleteWorkspaceBody = z.object({
  reason: z.string().trim().min(20).max(500),
  confirmationName: z.string().trim().min(2).max(255),
  confirmationPhrase: z.literal('DELETE NOW'),
}).strict();

function actor(request: FastifyRequest, capability: AgencyCapability): AgencyActor {
  const auth = request.requireAgency(capability);
  return {
    agencyUserId: auth.agencyUserId,
    role: auth.role,
    requestId: request.id,
    ipHash: createHash('sha256')
      .update(`${process.env.AUDIT_IP_HASH_SECRET || 'local-development'}:${request.ip}`)
      .digest('hex'),
    sessionId: request.authIdentity?.authSessionId || undefined,
    userAgent: String(request.headers['user-agent'] || '').slice(0, 500) || undefined,
  };
}

export async function agencyProvisioningRoutes(app: FastifyInstance) {
  let instance: BookingAwareProvisioningService | undefined;
  let deliveryInstance: DeliveryContextService | undefined;
  let lifecycleInstance: TenantLifecycleService | undefined;
  let workspaceDataInstance: WorkspaceDataService | undefined;
  let bookingSetupInstance: AgencyBookingSetupService | undefined;
  let assetLibraryInstance: AssetLibraryService | undefined;
  const service = () => (instance ||= new BookingAwareProvisioningService());
  const delivery = () => (deliveryInstance ||= new DeliveryContextService());
  const lifecycle = () => (lifecycleInstance ||= new TenantLifecycleService());
  const workspaceData = () => (workspaceDataInstance ||= new WorkspaceDataService());
  const bookingSetup = () => (bookingSetupInstance ||= new AgencyBookingSetupService());
  const assetLibrary = () => (assetLibraryInstance ||= new AssetLibraryService());

  app.post('/provisioning-drafts', async (request, reply) => reply.code(201).send({
    data: await service().createDraft(
      actor(request, 'provisioning.create'),
      CreateProvisioningDraftSchema.parse(request.body),
    ),
  }));
  app.get('/provisioning-drafts/:draftReference', async request => {
    const { draftReference } = DraftParams.parse(request.params);
    actor(request, 'provisioning.read');
    return { data: await service().getDraft(draftReference) };
  });
  app.patch('/provisioning-drafts/:draftReference', async request => {
    const { draftReference } = DraftParams.parse(request.params);
    return { data: await service().updateDraft(
      actor(request, 'provisioning.update'),
      draftReference,
      UpdateProvisioningDraftSchema.parse(request.body),
    ) };
  });
  app.post('/provisioning-drafts/:draftReference/validate', async request => {
    const { draftReference } = DraftParams.parse(request.params);
    return { data: await service().validateDraft(actor(request, 'provisioning.update'), draftReference) };
  });
  app.post('/provisioning-runs', async (request, reply) => reply.code(202).send({
    data: await service().start(
      actor(request, 'provisioning.execute'),
      StartProvisioningRunSchema.parse(request.body),
    ),
  }));
  app.get('/provisioning-runs/:runReference', async request => {
    const { runReference } = RunParams.parse(request.params);
    actor(request, 'provisioning.read');
    return { data: await service().getRun(runReference) };
  });
  app.post('/provisioning-runs/:runReference/retry', async request => {
    const { runReference } = RunParams.parse(request.params);
    return { data: await service().retry(
      actor(request, 'provisioning.retry'),
      runReference,
      ProvisioningActionReasonSchema.parse(request.body),
    ) };
  });
  app.post('/provisioning-runs/:runReference/cancel', async request => {
    const { runReference } = RunParams.parse(request.params);
    return { data: await service().cancel(
      actor(request, 'provisioning.cancel'),
      runReference,
      ProvisioningActionReasonSchema.parse(request.body),
    ) };
  });
  app.get('/tenants/:tenantReference/readiness', async request => {
    const { tenantReference } = TenantParams.parse(request.params);
    actor(request, 'provisioning.read');
    return { data: await service().readiness(tenantReference) };
  });
  app.get('/tenants/:tenantReference/delivery-context', async request => {
    const { tenantReference } = TenantParams.parse(request.params);
    actor(request, 'provisioning.read');
    return { data: await delivery().get(tenantReference) };
  });
  app.get('/tenants/:tenantReference/onboarding-booking', async request => {
    const { tenantReference } = TenantParams.parse(request.params);
    actor(request, 'provisioning.read');
    return { data: await bookingSetup().summary(tenantReference) };
  });
  app.post('/tenants/:tenantReference/onboarding-booking/services', async (request, reply) => {
    const { tenantReference } = TenantParams.parse(request.params);
    return reply.code(201).send({
      data: await bookingSetup().createService(
        actor(request, 'provisioning.update'),
        tenantReference,
        CreateBookingServiceBody.parse(request.body),
      ),
    });
  });

  app.get('/tenants/:tenantReference/assets', async request => {
    const { tenantReference } = TenantParams.parse(request.params);
    actor(request, 'fact_finding.read');
    return { data: await assetLibrary().list(tenantReference) };
  });
  app.post('/tenants/:tenantReference/assets', async (request, reply) => {
    const { tenantReference } = TenantParams.parse(request.params);
    const upload = FactFindingUploadSchema.parse(request.body);
    return reply.code(201).send({ data: await assetLibrary().initiate(actor(request, 'fact_finding.manage'), tenantReference, upload) });
  });
  app.post('/tenants/:tenantReference/assets/:uploadReference/complete', async request => {
    const { tenantReference, uploadReference } = TenantAssetParams.parse(request.params);
    z.object({}).strict().parse(request.body ?? {});
    return { data: await assetLibrary().complete(actor(request, 'fact_finding.manage'), tenantReference, uploadReference) };
  });
  app.patch('/tenants/:tenantReference/assets/:uploadReference/permissions', async request => {
    const { tenantReference, uploadReference } = TenantAssetParams.parse(request.params);
    return { data: await assetLibrary().updatePermissions(
      actor(request, 'fact_finding.manage'),
      tenantReference,
      uploadReference,
      AssetPermissionsBody.parse(request.body),
    ) };
  });
  app.patch('/tenants/:tenantReference/assets/:uploadReference/entity-binding', async request => {
    const { tenantReference, uploadReference } = TenantAssetParams.parse(request.params);
    return { data: await assetLibrary().updateEntityBinding(
      actor(request, 'fact_finding.manage'),
      tenantReference,
      uploadReference,
      AssetEntityBindingSchema.parse(request.body),
    ) };
  });

  app.get('/tenants/:tenantReference/users/:userReference/removal-preview', async request => {
    const { tenantReference, userReference } = TenantUserParams.parse(request.params);
    actor(request, 'tenants.read');
    return { data: await lifecycle().previewUserRemoval(tenantReference, userReference) };
  });
  app.post('/tenants/:tenantReference/users/:userReference/remove', async request => {
    const { tenantReference, userReference } = TenantUserParams.parse(request.params);
    const input = RemoveUserBody.parse(request.body);
    return { data: await lifecycle().removeUser(
      actor(request, 'tenants.manage'),
      tenantReference,
      userReference,
      input.reason,
    ) };
  });

  // Retained for older clients. New agency screens use reset-test-data and hard-delete.
  app.get('/tenants/:tenantReference/deletion-preview', async request => {
    const { tenantReference } = TenantParams.parse(request.params);
    actor(request, 'tenants.read');
    return { data: await lifecycle().previewWorkspaceDeletion(tenantReference) };
  });
  app.post('/tenants/:tenantReference/delete-unused', async request => {
    const { tenantReference } = TenantParams.parse(request.params);
    const input = DeleteWorkspaceBody.parse(request.body);
    return { data: await lifecycle().deleteUnusedWorkspace(
      actor(request, 'tenants.manage'),
      tenantReference,
      input.confirmationName,
      input.reason,
    ) };
  });

  app.get('/tenants/:tenantReference/test-data-preview', async request => {
    const { tenantReference } = TenantParams.parse(request.params);
    actor(request, 'tenants.read');
    return { data: await workspaceData().previewReset(tenantReference) };
  });
  app.post('/tenants/:tenantReference/reset-test-data', async request => {
    const { tenantReference } = TenantParams.parse(request.params);
    const input = ResetTestDataBody.parse(request.body);
    return { data: await workspaceData().resetTestData(
      actor(request, 'tenants.manage'),
      tenantReference,
      input.confirmationPhrase,
      input.reason,
    ) };
  });
  app.get('/tenants/:tenantReference/hard-delete-preview', async request => {
    const { tenantReference } = TenantParams.parse(request.params);
    actor(request, 'tenants.read');
    return { data: await workspaceData().previewHardDelete(tenantReference) };
  });
  app.post('/tenants/:tenantReference/hard-delete', async request => {
    const { tenantReference } = TenantParams.parse(request.params);
    const input = HardDeleteWorkspaceBody.parse(request.body);
    return { data: await workspaceData().hardDelete(
      actor(request, 'tenants.manage'),
      tenantReference,
      input.confirmationName,
      input.confirmationPhrase,
      input.reason,
    ) };
  });
}
