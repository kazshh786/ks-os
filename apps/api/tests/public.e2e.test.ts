import test from 'node:test';
import assert from 'node:assert';
import sinon from 'sinon';
import { buildApp } from '../src/app.js';
import { getDatabase } from '@ks-os/database';

test('Public Catalogue endpoints', async (t) => {
  const app = buildApp();
  
  const mockTenant = { 
    id: 'test-tenant-id', 
    name: 'Test Tenant', 
    subdomain: 'test-tenant',
    isActive: true,
    bookingConfig: {
      timezone: 'Europe/London',
      currency: 'GBP',
      paymentPolicy: 'PayLater',
      visitOptions: ['Shop', 'Mobile']
    }
  };

  const queryBuilder = {
    from: sinon.stub().returnsThis(),
    where: sinon.stub().returnsThis(),
    limit: sinon.stub().returnsThis(),
    then: function(resolve: any) {
      resolve([mockTenant]);
    }
  };

  const dbStub = sinon.stub(getDatabase() as any, 'select').returns(queryBuilder as any);

  t.afterEach(() => {
    sinon.resetHistory();
  });

  t.after(() => {
    sinon.restore();
    app.close();
  });

  await t.test('GET /api/v1/public/:subdomain/catalog - returns catalog for valid subdomain', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/public/test-tenant/catalog',
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.tenant.name, 'Test Tenant');
    assert.strictEqual(body.tenant.id, 'test-tenant-id');
  });

  await t.test('GET /api/v1/public/:subdomain/catalog - returns 404 for missing tenant', async () => {
    // Override then to return empty
    queryBuilder.then = function(resolve: any) {
      resolve([]);
    };

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/public/unknown-tenant/catalog',
    });

    assert.strictEqual(response.statusCode, 404);
  });
});
