import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertServiceSelectionAllowed,
  normaliseSelectedServiceIds,
} from '../src/modules/bookings/service-selection.js';

const fade = '11111111-1111-4111-8111-111111111111';
const beard = '22222222-2222-4222-8222-222222222222';
const packageService = '33333333-3333-4333-8333-333333333333';

test('single-service mode rejects a combined booking', () => {
  assert.throws(
    () => assertServiceSelectionAllowed({ serviceSelectionMode: 'SINGLE' }, [fade, beard]),
    (error: any) => error.code === 'MULTIPLE_SERVICES_DISABLED' && error.statusCode === 409,
  );
});

test('multiple-service mode accepts a combined booking', () => {
  assert.doesNotThrow(() => assertServiceSelectionAllowed({ serviceSelectionMode: 'MULTIPLE' }, [fade, beard]));
});

test('custom mode keeps package services exclusive', () => {
  assert.throws(
    () => assertServiceSelectionAllowed({
      serviceSelectionMode: 'CUSTOM',
      exclusiveServiceIds: [packageService],
    }, [packageService, beard]),
    (error: any) => error.code === 'SERVICE_COMBINATION_NOT_ALLOWED' && error.statusCode === 409,
  );
  assert.doesNotThrow(() => assertServiceSelectionAllowed({
    serviceSelectionMode: 'CUSTOM',
    exclusiveServiceIds: [packageService],
  }, [fade, beard]));
});

test('service normalisation preserves the primary service and removes duplicates', () => {
  assert.deepEqual(normaliseSelectedServiceIds(fade, [fade, beard, fade]), [fade, beard]);
  assert.deepEqual(normaliseSelectedServiceIds(fade), [fade]);
});
