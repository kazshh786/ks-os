import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

// Opt in with a disposable PostgreSQL database. Never falls back to DATABASE_URL.
test('PostgreSQL serializes overlapping occupied ranges and preserves buffers on moves', { skip: !process.env.BOOKING_INTEGRITY_TEST_DATABASE_URL }, async () => {
  const pool = new Pool({ connectionString: process.env.BOOKING_INTEGRITY_TEST_DATABASE_URL });
  const schema = `integrity_${Date.now()}`;
  const admin = await pool.connect();
  try {
    await admin.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema},public;
      CREATE TABLE services(id uuid,tenant_id uuid,buffer_time int);
      CREATE TABLE appointment_services(appointment_id uuid,tenant_id uuid,service_id uuid);
      CREATE TABLE appointments(id uuid PRIMARY KEY,tenant_id uuid,user_id uuid,service_id uuid,resource_id uuid,start_time timestamptz,end_time timestamptz,status text);
      CREATE TABLE booking_holds(id uuid,tenant_id uuid,staff_user_id uuid,resource_id uuid,service_ids uuid[],start_time timestamptz,end_time timestamptz,status text,expires_at timestamptz);
    `);
    const migration = await readFile(new URL('../../../packages/database/migrations/20260906101000_booking_occupied_ranges.sql', import.meta.url), 'utf8');
    await admin.query(migration.split('CREATE OR REPLACE FUNCTION')[0].replace('SET search_path=public,pg_temp', `SET search_path=${schema},pg_temp`));
    const tenant='11111111-1111-4111-8111-111111111111', staff='22222222-2222-4222-8222-222222222222', service='33333333-3333-4333-8333-333333333333';
    await admin.query('INSERT INTO services VALUES ($1,$2,15)',[service,tenant]);
    const insert = `INSERT INTO ${schema}.appointments(id,tenant_id,user_id,service_id,start_time,end_time,status) VALUES ($1,$2,$3,$4,$5,$6,'CONFIRMED')`;
    const first=await pool.connect(), second=await pool.connect();
    try {
      await first.query(`SET search_path TO ${schema},public; BEGIN`);
      await second.query(`SET search_path TO ${schema},public; BEGIN`);
      await first.query(insert,['44444444-4444-4444-8444-444444444444',tenant,staff,service,'2027-01-12T10:00Z','2027-01-12T11:00Z']);
      const competing=second.query(insert,['55555555-5555-4555-8555-555555555555',tenant,staff,service,'2027-01-12T11:00Z','2027-01-12T12:00Z']);
      const rejected=assert.rejects(competing,/SLOT_UNAVAILABLE/);
      await first.query('COMMIT');
      await rejected;
      await second.query('ROLLBACK');
      await admin.query(`UPDATE appointments SET start_time='2027-01-12T14:00Z',end_time='2027-01-12T15:00Z'`);
      const { rows }=await admin.query('SELECT occupied_end,end_time FROM appointments');
      assert.equal(rows[0].occupied_end.getTime()-rows[0].end_time.getTime(),15*60_000);
    } finally { await first.query('ROLLBACK'); await second.query('ROLLBACK'); first.release(); second.release(); }
  } finally {
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    admin.release(); await pool.end();
  }
});
