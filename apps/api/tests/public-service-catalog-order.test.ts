import assert from 'node:assert/strict';
import test from 'node:test';
import { sortCatalogServices } from '../src/plugins/public-service-catalog-order.js';

test('sortCatalogServices follows saved order and keeps unknown services stable', () => {
  const services = [
    { id: 'service-c', name: 'C' },
    { id: 'service-a', name: 'A' },
    { id: 'service-unknown', name: 'Unknown' },
    { id: 'service-b', name: 'B' },
  ];

  const sorted = sortCatalogServices(services, [
    { id: 'service-a', sort_order: 0 },
    { id: 'service-b', sort_order: 1 },
    { id: 'service-c', sort_order: 2 },
  ]);

  assert.deepEqual(sorted.map(service => service.id), [
    'service-a',
    'service-b',
    'service-c',
    'service-unknown',
  ]);
  assert.deepEqual(services.map(service => service.id), [
    'service-c',
    'service-a',
    'service-unknown',
    'service-b',
  ]);
});
