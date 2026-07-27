import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AgencyCapability } from '@ks-os/contracts';
import {
  CreateProvisioningDraftSchema,
  ProvisioningActionReasonSchema,
  StartProvisioningRunSchema,
  UpdateProvisioningDraftSchema,
} from '@ks-os/workspace-provisioning';
import type { AgencyActor } from '../agency/agency.service.js';
import { DeliveryContextService } from './delivery-context.service.js';
import { ProvisioningService } from './provisioning.service.js';
import { TenantLifecycleService } from './tenant-lifecycle.service.js';

const DraftParams = z.object({ draftReference: z.string().uuid() }).strict();
const RunParams = z.object({ runReference: z.string().uuid() }).strict();
const TenantParams = z.object({ tenantReference: z.string().uuid() }).strict();
const TenantUserParams = TenantParams.extend({ userReference: z.string().uuid() }).strict();
const RemoveUserBody = z.object({
  reason: z.string().trim().min(20).max(500),
  confirmed: z.literal(true),
}).strict();
const DeleteWorkspaceBody = z.object({
  reason: z.string().trim().min(20).max(500),
  confirmationName: z.string().trim().min(2).max(255),
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
  let instance: ProvisioningService | undefined;
  let deliveryInstance: DeliveryContextService | undefined;
  let lifecycleInstance: TenantLifecycleService | undefined;
  const service = () => (instance ||= new ProvisioningService());
  const delivery = () => (deliveryInstance ||= new DeliveryContextService());
  const lifecycle = () => (lifecycleInstance ||= new TenantLifecycleService());

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
}
