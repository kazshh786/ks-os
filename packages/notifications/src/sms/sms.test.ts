import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseSms, renderSms } from './index.js';

test('renders an identified, opt-out-aware transactional message', () => {
  const result = renderSms('booking-confirmed', { salonName: 'Glow Salon', appointmentDateTime: '20 July at 14:30' });
  assert.match(result.body, /^Glow Salon via KS OS:/);
  assert.match(result.body, /Reply STOP/);
  assert.equal(result.segmentCount, 1);
});

test('counts GSM and Unicode segments', () => {
  assert.equal(analyseSms('a'.repeat(161)).segmentCount, 2);
  assert.equal(analyseSms('🙂'.repeat(71)).segmentCount, 2);
});
