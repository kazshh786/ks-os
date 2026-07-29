import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CreateTeamInvitationRequestSchema,
  UpdateBookingChannelScheduleRequestSchema,
  UpdateBookingScheduleOverridesRequestSchema,
  UpdateStaffProfileRequestSchema,
  UpdateStaffScheduleRequestSchema,
  UpdateStaffServicesRequestSchema,
} from '@ks-os/contracts';

test('team invitation fixes role server-side and rejects tenant or role input', () => {
  assert.deepEqual(CreateTeamInvitationRequestSchema.parse({ email: ' STAFF@Example.com ', name: 'Test Staff' }), { email: 'STAFF@Example.com', name: 'Test Staff' });
  assert.throws(() => CreateTeamInvitationRequestSchema.parse({ email: 'staff@example.com', name: 'Test', role: 'owner' }));
  assert.throws(() => CreateTeamInvitationRequestSchema.parse({ email: 'staff@example.com', name: 'Test', tenantId: crypto.randomUUID() }));
});

test('profile contract cannot mutate role, tenant, id or email', () => {
  for (const key of ['role', 'tenantId', 'id', 'email']) assert.throws(() => UpdateStaffProfileRequestSchema.parse({ [key]: 'owner' }));
});

test('service and schedule contracts reject duplicates and invalid times', () => {
  const id = crypto.randomUUID();
  assert.throws(() => UpdateStaffServicesRequestSchema.parse({ serviceIds: [id, id] }));
  assert.throws(() => UpdateStaffScheduleRequestSchema.parse({ schedule: [{ dayOfWeek: 1, enabled: true, startTime: '18:00', endTime: '09:00' }] }));
  assert.throws(() => UpdateBookingChannelScheduleRequestSchema.parse({ channel: 'remote', schedule: [] }));
  assert.doesNotThrow(() => UpdateBookingChannelScheduleRequestSchema.parse({ channel: 'mobile', schedule: [{ dayOfWeek: 1, enabled: true, startTime: '18:00', endTime: '21:00' }] }));
});

test('date overrides support opening a normal day off and closing a normal workday', () => {
  assert.doesNotThrow(() => UpdateBookingScheduleOverridesRequestSchema.parse({ overrides: [
    { date: '2026-08-03', channel: 'in_shop', enabled: true, startTime: '09:00', endTime: '17:00', note: 'Working Monday instead' },
    { date: '2026-08-06', channel: 'in_shop', enabled: false, startTime: null, endTime: null, note: 'Taking Thursday off' },
    { date: '2026-08-03', channel: 'mobile', enabled: true, startTime: '18:00', endTime: '21:00', note: 'Mobile evening visits' },
  ] }));
  assert.throws(() => UpdateBookingScheduleOverridesRequestSchema.parse({ overrides: [
    { date: '2026-08-03', channel: 'mobile', enabled: false, startTime: '18:00', endTime: '21:00' },
  ] }));
  assert.throws(() => UpdateBookingScheduleOverridesRequestSchema.parse({ overrides: [
    { date: '2026-08-03', channel: 'mobile', enabled: true, startTime: '18:00', endTime: '21:00' },
    { date: '2026-08-03', channel: 'mobile', enabled: true, startTime: '19:00', endTime: '22:00' },
  ] }));
});
