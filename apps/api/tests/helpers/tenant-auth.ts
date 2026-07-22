import type { FastifyInstance } from 'fastify';
import { effectiveCapabilities, type Permission } from '@ks-os/auth';

/**
 * Route-level integration tests use this fixture so they can test their own
 * authorization and data behavior without replacing the production context
 * resolver. It is never imported by application code.
 */
export function installTenantAuthFixture(app: FastifyInstance, input: {
  authUserId: string;
  tenantId?: string;
  defaultRole?: 'owner' | 'staff';
  permissions?: Permission[];
}) {
  app.addHook('onRequest', async request => {
    if (!request.headers.authorization || request.auth) return;
    const requestedRole = request.headers['x-ks-test-role'];
    const role = requestedRole === 'staff' || requestedRole === 'owner'
      ? requestedRole
      : input.defaultRole || 'owner';
    const tenantId = input.tenantId || input.authUserId;
    request.applicationContext = 'TENANT';
    request.authIdentity = {
      authUserId: input.authUserId, email: 'test@ks-os.example', authSessionId: crypto.randomUUID(),
      assuranceLevel: 'aal1', expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      issuedAt: new Date().toISOString(),
    };
    request.auth = {
      authUserId: input.authUserId, tenantUserId: input.authUserId,
      membershipReference: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      email: 'test@ks-os.example', tenantId,
      businessReference: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      tenantName: 'Test business', tenantSubdomain: 'test-business', role,
      permissions: input.permissions || effectiveCapabilities(role) as Permission[],
    };
  });
}
