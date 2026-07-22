import test from 'node:test';
import assert from 'node:assert';
import sinon from 'sinon';
import { buildApp } from '../src/app.js';
import * as availabilityService from '../src/modules/availability/availability.service.js';
import { getDatabase } from '@ks-os/database';

test('Availability endpoints', async (t) => {
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

  // We can't stub ES modules easily, so let's just test validation.
  // The DB mock will fail on calculateAvailability because of schedules.map, but that's fine if we only test 400s here.

  t.afterEach(() => {
    sinon.resetHistory();
    queryBuilder.then = function(resolve: any) {
      resolve([mockTenant]);
    };
  });

  t.after(() => {
    sinon.restore();
    app.close();
  });



  await t.test('GET /api/v1/public/:subdomain/availability - invalid date returns 400', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/public/test-tenant/availability',
      query: {
        date: 'invalid-date',
        serviceId: 'test-svc',
        bookingChannel: 'in_shop'
      }
    });

    assert.strictEqual(response.statusCode, 400);
  });

  await t.test('GET /api/v1/public/:subdomain/availability - missing serviceId returns 400', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/public/test-tenant/availability',
      query: {
        date: '2026-10-10',
        bookingChannel: 'in_shop'
      }
    });

    assert.strictEqual(response.statusCode, 400);
  });
});
