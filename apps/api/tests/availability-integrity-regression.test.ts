import test from 'node:test';
import assert from 'node:assert/strict';
import { getTableName } from 'drizzle-orm';
import { calculateAvailability } from '../src/modules/availability/availability.service.js';
import { UpdateBookingChannelScheduleRequestSchema, UpdateBookingScheduleOverridesRequestSchema } from '@ks-os/contracts';
import sinon from 'sinon';
import { getDatabase } from '@ks-os/database';
import { CustomerBookingManagementService } from '../src/modules/customer-portal/customer-booking-management.service.js';

const date = '2027-01-12';
const at = (time: string) => new Date(`${date}T${time}:00Z`);
function database(holds: any[] = [], appointments: any[] = []) {
  const tables: Record<string, any[]> = {
    tenants: [{ id: 'tenant', timezone: 'UTC', currency: 'GBP', slotIntervalMinutes: 20, allowAppointmentsPastClosingTime: false }],
    services: [{ id: 'service', duration: 40, bufferTime: 20, price: 1000, discount: 0 }, { id: 'second', duration: 20, bufferTime: 10, price: 500, discount: 0 }],
    users: [{ id: 'staff', publicReference: 'public-staff', userId: 'staff', userName: 'Sam', serviceId: 'service' }, { id: 'staff', publicReference: 'public-staff', userId: 'staff', userName: 'Sam', serviceId: 'second' }],
    appointment_services: [{serviceId:'service'},{serviceId:'second'}],
    booking_channel_schedules: [{ userId: 'staff', startTime: '09:00', endTime: '12:00' }, { userId: 'staff', startTime: '14:00', endTime: '18:00' }],
    booking_holds: holds, appointments,
  };
  return { select: () => ({ from: (table: any) => {
    const query: any = Promise.resolve(tables[getTableName(table)] || []);
    for (const key of ['where','limit','leftJoin','innerJoin','orderBy']) query[key] = () => query;
    return query;
  } }), execute: async () => ({ rows: [] }) };
}
const input = { tenantId: 'tenant', serviceId: 'service', serviceIds: ['service','second'], staffId: 'staff', date, bookingChannel: 'in_shop' as const };

test('composed duration and buffers preserve customer end separately from occupied end', async () => {
  const result = await calculateAvailability(input, { database: database() });
  const slot = result.slots[0];
  assert.equal(slot.start, at('09:00').toISOString());
  assert.equal(slot.end, at('10:00').toISOString());
  assert.equal(slot.occupiedEnd, at('10:30').toISOString());
  assert.equal(slot.price, 1500);
});
test('active holds subtract occupied inventory and split shifts do not offer the break', async () => {
  const result = await calculateAvailability(input, { database: database([{ staffUserId: 'staff', occupiedStart: at('09:00'), occupiedEnd: at('10:30') }]) });
  assert.equal(result.slots.some(slot => slot.start < at('10:30').toISOString()), false);
  assert.equal(result.slots.some(slot => slot.start >= at('12:00').toISOString() && slot.start < at('14:00').toISOString()), false);
});
test('persisted appointment buffer is respected without adding mutable service buffers again', async () => {
  const result = await calculateAvailability(input, { database: database([], [{ userId: 'staff', startTime: at('09:00'), endTime: at('10:00'), existingBufferTime: 99, status: 'CONFIRMED' }]) });
  assert.equal(result.slots[0].start, at('10:00').toISOString());
});
test('tenant slot interval and explicit page interval are used consistently', async () => {
  const tenant = await calculateAvailability(input, { database: database() });
  assert.equal(tenant.slots[1].start, at('09:20').toISOString());
  const page = await calculateAvailability(input, { database: database(), slotIntervalMinutes: 15 });
  assert.equal(page.slots[1].start, at('09:15').toISOString());
});
test('weekly schedule accepts split shifts and rejects overlaps', () => {
  const schedule = [{ dayOfWeek: 2, enabled: true, startTime: '09:00', endTime: '12:00' }, { dayOfWeek: 2, enabled: true, startTime: '14:00', endTime: '18:00' }];
  assert.equal(UpdateBookingChannelScheduleRequestSchema.safeParse({ channel: 'in_shop', schedule }).success, true);
  assert.equal(UpdateBookingChannelScheduleRequestSchema.safeParse({ channel: 'in_shop', schedule: [schedule[0], { ...schedule[1], startTime: '11:00' }] }).success, false);
});

test('date-specific split shifts accept separate windows and reject conflicting full-day closures', () => {
  const morning={date,channel:'in_shop',enabled:true,startTime:'09:00',endTime:'12:00'};
  const afternoon={...morning,startTime:'14:00',endTime:'18:00'};
  assert.equal(UpdateBookingScheduleOverridesRequestSchema.safeParse({overrides:[morning,afternoon]}).success,true);
  assert.equal(UpdateBookingScheduleOverridesRequestSchema.safeParse({overrides:[morning,{date,channel:'in_shop',enabled:false}]}).success,false);
});

test('multi-service customer rescheduling offers the complete appointment duration and price', async () => {
  process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:1/test';
  const db=getDatabase() as any, fixture=database();
  sinon.stub(db,'select').callsFake(fixture.select);
  sinon.stub(db,'execute').callsFake(fixture.execute);
  const service=new CustomerBookingManagementService();
  sinon.stub(service as any,'resolveAccess').resolves({tenantId:'tenant',appointmentId:'appointment',serviceId:'service',staffId:'staff',
    bookingChannel:'in_shop',startTime:at('09:00'),endTime:at('10:00'),quotedAmount:1500});
  sinon.stub(service as any,'evaluate').returns({canReschedule:true});
  sinon.stub(service as any,'paymentContext').resolves({});
  try {
    const result=await service.availability({} as any,{date});
    assert.ok(result.slots.length>0);
    assert.equal(new Date(result.slots[0].endTime).getTime()-new Date(result.slots[0].startTime).getTime(),60*60_000);
  } finally {sinon.restore();}
});
