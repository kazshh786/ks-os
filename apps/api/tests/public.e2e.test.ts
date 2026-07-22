import test from 'node:test';
import assert from 'node:assert';
import sinon from 'sinon';
import { buildApp } from '../src/app.js';
import { BookingPageService } from '../src/modules/bookings/booking-page.service.js';

test('Public Catalogue endpoints', async (t) => {
  const app = buildApp();
  
  const catalog = {
    page: { title: 'Book Test Tenant', publicSlug: 'test-tenant' },
    tenant: { name: 'Test Tenant', timezone: 'Europe/London', currency: 'GBP', colors: { primary: '#111111', secondary: '#222222', accent: '#333333' } },
    services: [],
    staff: [],
    locations: [],
    intakeForms: [],
    bookingChannels: [{ id: 'in_shop', label: 'At the business' }],
  };
  sinon.stub(BookingPageService.prototype, 'publicCatalog').callsFake(async identifier => identifier === 'unknown-tenant' ? null : catalog as any);

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
    assert.strictEqual(body.tenant.id, undefined);
  });

  await t.test('GET /api/v1/public/:subdomain/catalog - returns 404 for missing tenant', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/public/unknown-tenant/catalog',
    });

    assert.strictEqual(response.statusCode, 404);
  });
});
