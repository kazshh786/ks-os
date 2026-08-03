import { test } from 'node:test';
import assert from 'node:assert';
import sinon from 'sinon';
import { buildApp } from '../src/app.js';
import { InventoryService } from '../src/modules/pos/inventory.service.js';
import { installTenantAuthFixture } from './helpers/tenant-auth.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const product = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Shampoo',
  sku: 'SHP-001',
  priceInCents: 1250,
  stockQuantity: 8,
};

test('inventory product management routes', async t => {
  const createProduct = sinon.stub(InventoryService.prototype, 'createProduct').resolves(product);
  const adjustStock = sinon.stub(InventoryService.prototype, 'adjustStock').resolves({ ...product, stockQuantity: 10 });
  const importProducts = sinon.stub(InventoryService.prototype, 'importProducts').resolves({ created: 1, updated: 0, products: [product] });
  const app = buildApp();
  installTenantAuthFixture(app, { authUserId: tenantId, tenantId, defaultRole: 'owner' });

  t.after(async () => {
    sinon.restore();
    await app.close();
  });

  await t.test('owner can create a product', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: { authorization: 'Bearer test' },
      payload: { name: 'Shampoo', sku: 'SHP-001', priceInCents: 1250, stockQuantity: 8 },
    });
    assert.strictEqual(response.statusCode, 201);
    assert.deepStrictEqual(response.json().data, product);
    assert.strictEqual(createProduct.calledOnce, true);
  });

  await t.test('invalid stock is rejected before the service runs', async () => {
    const before = createProduct.callCount;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: { authorization: 'Bearer test' },
      payload: { name: 'Broken', sku: 'BAD SKU', priceInCents: -1, stockQuantity: -2 },
    });
    assert.strictEqual(response.statusCode, 400);
    assert.strictEqual(response.json().error.code, 'VALIDATION_ERROR');
    assert.strictEqual(createProduct.callCount, before);
  });

  await t.test('staff cannot manage inventory', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: { authorization: 'Bearer test', 'x-ks-test-role': 'staff' },
      payload: { name: 'Shampoo', sku: 'SHP-002', priceInCents: 1250, stockQuantity: 8 },
    });
    assert.strictEqual(response.statusCode, 403);
    assert.strictEqual(response.json().error.code, 'INVENTORY_ACCESS_DENIED');
  });

  await t.test('owner can adjust stock and import products', async () => {
    const adjustment = await app.inject({
      method: 'POST',
      url: `/api/v1/products/${product.id}/stock-adjustments`,
      headers: { authorization: 'Bearer test' },
      payload: { adjustment: 2, reason: 'Delivery' },
    });
    assert.strictEqual(adjustment.statusCode, 200);
    assert.strictEqual(adjustment.json().data.stockQuantity, 10);
    assert.strictEqual(adjustStock.calledOnce, true);

    const imported = await app.inject({
      method: 'POST',
      url: '/api/v1/products/import',
      headers: { authorization: 'Bearer test' },
      payload: { products: [{ name: 'Shampoo', sku: 'SHP-001', priceInCents: 1250, stockQuantity: 8 }] },
    });
    assert.strictEqual(imported.statusCode, 200);
    assert.deepStrictEqual(imported.json().data, { created: 1, updated: 0, products: [product] });
    assert.strictEqual(importProducts.calledOnce, true);
  });
});
