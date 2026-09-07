import test from 'node:test';
import assert from 'node:assert/strict';
import sinon from 'sinon';
import { PgDialect } from 'drizzle-orm/pg-core';
import { appointments, getDatabase } from '@ks-os/database';
import { BookingRepository } from '../src/modules/bookings/booking.repository.js';

test('operational query projects real source, notes, form progress and all service names', async () => {
  process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:1/test';
  const projections:any[]=[];
  const query:any=Promise.resolve([]);
  for(const key of ['from','where','leftJoin','orderBy','limit','offset'])query[key]=()=>query;
  sinon.stub(getDatabase() as any,'select').callsFake((projection:any)=>{projections.push(projection);return query;});
  try {
    await new BookingRepository().listOperationalBookings({tenantId:'11111111-1111-4111-8111-111111111111'},
      {from:'2027-01-01T00:00:00Z',to:'2027-02-01T00:00:00Z',page:1,limit:250,sort:'START_ASC'});
    assert.equal(projections[0].bookingSource,appointments.bookingSource);
    assert.equal(projections[0].customerNotes,appointments.customerNotes);
    const compile=(value:any)=>new PgDialect().sqlToQuery(value).sql;
    assert.match(compile(projections[0].intakeStatus),/form_assignments/);
    assert.match(compile(projections[0].serviceName),/string_agg.*service_name/s);
    assert.match(compile(projections[1].incompleteForms),/form_assignments/);
    assert.match(compile(projections[1].rowCount),/count\(\*\)/);
  } finally {sinon.restore();}
});
