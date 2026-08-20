import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('public booking pages expose and render the primary business address separately from selectable locations', () => {
  const bookingPage = source('src/modules/bookings/booking-page.service.ts');
  const bookingFlow = source('../web/src/features/bookings/PublicBookingFlow.tsx');

  assert.match(bookingPage, /eq\(locations\.isPrimary, true\)/);
  assert.match(bookingPage, /businessAddress: primaryLocation \?/);
  assert.match(bookingFlow, /businessAddress\?: \{ name: string; address: string; postcode: string \} \| null/);
  assert.match(bookingFlow, /const inShopLocationLabel = location/);
  assert.match(bookingFlow, /tenant\.businessAddress\?\.name \|\| tenant\.name/);
  assert.match(bookingFlow, /businessAddress \|\| 'Secure online booking'/);
  assert.match(bookingFlow, /LOCATION:\$\{calendarText\(bookingChannel === 'mobile'.*: inShopAddress\)\}/);
});

test('customer booking confirmation emails include a full location with primary-address fallback', () => {
  const payments = source('src/modules/payments/payments.service.ts');
  const bookings = source('src/modules/bookings/booking.service.ts');

  assert.match(payments, /locationAddress: locations\.address/);
  assert.match(payments, /locationPostcode: locations\.postcode/);
  assert.match(payments, /const locationSummary = \[locationName, locationAddress\]/);
  assert.match(payments, /locationName: locationSummary/);
  assert.match(payments, /eq\(locations\.isPrimary, true\)/);

  assert.match(bookings, /booking\.locationId \? eq\(locations\.id, booking\.locationId\) : eq\(locations\.isPrimary, true\)/);
  assert.match(bookings, /locationName: locationSummary/);
  assert.match(bookings, /bookingReference: booking\.publicReference/);
});
