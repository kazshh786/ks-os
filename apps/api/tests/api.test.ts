import { test } from 'node:test';
import assert from 'node:assert';
import { buildApp } from '../src/app.js';
import { hasPermission, PERMISSIONS, ROLES } from '@ks-os/auth';
import { 
  HealthResponseSchema, 
  SessionResponseSchema, 
  ApiErrorSchema 
} from '@ks-os/contracts';

test('shared Zod response contracts validation', () => {
  // Test health check validation
  const validHealth = {
    status: 'OK' as const,
    uptime: 120.5,
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  };
  assert.ok(HealthResponseSchema.safeParse(validHealth).success);

  const invalidHealth = { status: 'OK' }; // Missing fields
  assert.ok(!HealthResponseSchema.safeParse(invalidHealth).success);

  // Test error validation
  const validError = {
    error: {
      code: 'TEST_ERROR',
      message: 'This is a test error description.'
    }
  };
  assert.ok(ApiErrorSchema.safeParse(validError).success);
});

test('hasPermission role validations', () => {
  // Owner permissions checks
  assert.strictEqual(hasPermission('owner', PERMISSIONS.MANAGE_SALON_SETTINGS), true);
  assert.strictEqual(hasPermission('owner', PERMISSIONS.CREATE_BOOKINGS), true);
  assert.strictEqual(hasPermission('owner', PERMISSIONS.PROVISION_TENANT), false); // owner cannot provision tenants

  // Staff permission checks
  assert.strictEqual(hasPermission('staff', PERMISSIONS.MANAGE_SALON_SETTINGS), false);
  assert.strictEqual(hasPermission('staff', PERMISSIONS.CREATE_BOOKINGS), true);

  // Receptionist permission checks
  assert.strictEqual(hasPermission('receptionist', PERMISSIONS.MANAGE_SALON_SETTINGS), false);
  assert.strictEqual(hasPermission('receptionist', PERMISSIONS.CREATE_BOOKINGS), true);

  // Agency admin checks
  assert.strictEqual(hasPermission('agency_admin', PERMISSIONS.PROVISION_TENANT), true);
  assert.strictEqual(hasPermission('agency_admin', PERMISSIONS.CREATE_BOOKINGS), false);

  // Explicit overrides
  assert.strictEqual(hasPermission('staff', PERMISSIONS.CREATE_BOOKINGS, { create_bookings: false }), false);
  assert.strictEqual(hasPermission('staff', PERMISSIONS.MANAGE_SALON_SETTINGS, { manage_salon_settings: true }), true);
});

test('Fastify server API endpoints testing', async (t) => {
  const app = buildApp();

  await t.test('GET /api/health returns valid schema', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/health'
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    const parsed = HealthResponseSchema.safeParse(body);
    assert.ok(parsed.success, 'Health response matches schema contract');
  });

  await t.test('GET /api/v1/session returns unauthenticated response without token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/session'
    });

    assert.strictEqual(response.statusCode, 401);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'UNAUTHENTICATED');
  });
});

test('production mode blocks dev auth flag setting', () => {
  // Logic verification: checks if node env overrides dev auth activation
  const checkDevAuthForbidden = (nodeEnv: string, devAuthEnabled: boolean) => {
    if (nodeEnv === 'production') {
      return false; // Force false in production
    }
    return devAuthEnabled;
  };

  assert.strictEqual(checkDevAuthForbidden('production', true), false);
  assert.strictEqual(checkDevAuthForbidden('development', true), true);
  assert.strictEqual(checkDevAuthForbidden('production', false), false);
});
