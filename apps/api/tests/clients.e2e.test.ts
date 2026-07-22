import { test } from 'node:test';
import assert from 'node:assert';
import sinon from 'sinon';

import { buildApp } from '../src/app.js';
import { supabase } from '../src/lib/supabase.js';
import { ClientRepository } from '../src/routes/client.repository.js';
import { getDatabase } from '@ks-os/database';
import { installTenantAuthFixture } from './helpers/tenant-auth.js';

test('Integration: Client Directory and Detail Endpoints', async (t) => {
  const app = buildApp();
  
  const getClaimsStub = sinon.stub(supabase.auth, 'getClaims');
  const mockUserId = '11111111-1111-1111-1111-111111111111';
  const mockTenantId = mockUserId; 
  const mockClientId = '22222222-2222-2222-2222-222222222222';
  installTenantAuthFixture(app, { authUserId: mockUserId, tenantId: mockTenantId });

  const dbStub = sinon.stub(getDatabase() as any, 'select').returns({
    from: sinon.stub().returns({
      where: sinon.stub().returns({
        limit: sinon.stub().resolves([{ 
          id: mockUserId, 
          tenantId: mockTenantId,
          name: 'Mock Staff / Mock Tenant', 
          subdomain: 'mock-tenant',
          role: 'owner', 
          permissions: []
        }])
      })
    })
  } as any);

  const getClientsDirectoryStub = sinon.stub(ClientRepository.prototype, 'getClientsDirectory');
  const getClientProfileStub = sinon.stub(ClientRepository.prototype, 'getClientProfile');

  t.afterEach(() => {
    sinon.resetHistory();
  });

  await t.test('GET /api/v1/clients returns 401 unauthenticated', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/clients'
    });
    assert.strictEqual(response.statusCode, 401);
  });

  await t.test('GET /api/v1/clients returns tenant-scoped clients', async () => {
    getClaimsStub.resolves({
      data: { claims: { sub: mockUserId, email: 'test@ks-os.com' } },
      error: null
    } as any);

    getClientsDirectoryStub.resolves({
      total: 1,
      tenantClients: [{ id: mockClientId, name: 'John Doe', email: 'john@example.com', phone: '12345' }],
      countsMap: { [mockClientId]: { upcoming: 0, total: 1 } }
    } as any);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/clients?page=1&limit=50',
      headers: { authorization: 'Bearer mock-token' }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.meta.total, 1);
    assert.strictEqual(body.data[0].name, 'John Doe');
    assert.strictEqual(getClientsDirectoryStub.calledOnce, true);
    assert.strictEqual(getClientsDirectoryStub.firstCall.args[0], mockTenantId);
  });

  await t.test('GET /api/v1/clients handles search', async () => {
    getClaimsStub.resolves({
      data: { claims: { sub: mockUserId, email: 'test@ks-os.com' } },
      error: null
    } as any);

    getClientsDirectoryStub.resolves({
      total: 0,
      tenantClients: [],
      countsMap: {}
    } as any);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/clients?page=1&limit=10&search=john',
      headers: { authorization: 'Bearer mock-token' }
    });

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(getClientsDirectoryStub.firstCall.args[3], 'john');
  });

  await t.test('GET /api/v1/clients rejects invalid fields/limits', async () => {
    getClaimsStub.resolves({
      data: { claims: { sub: mockUserId, email: 'test@ks-os.com' } },
      error: null
    } as any);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/clients?page=0&limit=999', // page<1, limit>100
      headers: { authorization: 'Bearer mock-token' }
    });

    assert.strictEqual(response.statusCode, 400); // Because zod schema will reject it
  });

  await t.test('GET /api/v1/clients/:id returns valid client profile with medical notes for owner', async () => {
    getClaimsStub.resolves({
      data: { claims: { sub: mockUserId, email: 'test@ks-os.com' } },
      error: null
    } as any); // the dbStub above returns role 'owner'

    getClientProfileStub.resolves({
      client: {
        id: mockClientId,
        name: 'John Doe',
        medicalNotes: 'Allergic to peanuts',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      historyRows: []
    } as any);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/clients/${mockClientId}`,
      headers: { authorization: 'Bearer mock-token' }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.profile.name, 'John Doe');
    assert.strictEqual(body.medicalNotes, 'Allergic to peanuts'); // Owner access
  });

  await t.test('GET /api/v1/clients/:id returns safe 404 for unknown client or wrong tenant', async () => {
    getClaimsStub.resolves({
      data: { claims: { sub: mockUserId, email: 'test@ks-os.com' } },
      error: null
    } as any);

    getClientProfileStub.resolves(null); // Repo returns null for wrong tenant or unknown

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/clients/unknown-id`,
      headers: { authorization: 'Bearer mock-token' }
    });

    assert.strictEqual(response.statusCode, 404);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.error.code, 'CLIENT_NOT_FOUND');
  });

  await t.test('GET /api/v1/clients/:id strips medical notes for staff', async () => {
    getClaimsStub.resolves({
      data: { claims: { sub: mockUserId, email: 'test@ks-os.com' } },
      error: null
    } as any);

    dbStub.returns({
      from: sinon.stub().returns({
        where: sinon.stub().returns({
          limit: sinon.stub().resolves([{ 
            id: mockUserId, 
            tenantId: mockTenantId,
            role: 'staff', // Not owner
            permissions: []
          }])
        })
      })
    } as any);

    getClientProfileStub.resolves({
      client: {
        id: mockClientId,
        name: 'John Doe',
        medicalNotes: 'Allergic to peanuts',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      historyRows: []
    } as any);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/clients/${mockClientId}`,
      headers: { authorization: 'Bearer mock-token', 'x-ks-test-role': 'staff' }
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.medicalNotes, null); // Staff should not see medical notes
  });
});
