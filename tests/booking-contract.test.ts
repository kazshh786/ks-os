import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {isDateOnly,isPaymentMode,isUuid,requiresPayment,zonedDateTimeToUtc} from '../lib/booking-contract';
import {verifyStripeSignature} from '../lib/service-api';
import {PGlite} from '@electric-sql/pglite';

test('booking identifiers and dates use strict public formats',()=>{
  assert.equal(isUuid('123e4567-e89b-12d3-a456-426614174000'),true);
  assert.equal(isUuid('../../tenant'),false);
  assert.equal(isDateOnly('2026-07-14'),true);
  assert.equal(isDateOnly('2026-02-31'),false);
  assert.equal(isPaymentMode('customer_choice'),true);
  assert.equal(isPaymentMode('free_card'),false);
});

test('payment policy never invents a successful payment',()=>{
  assert.equal(requiresPayment('no_payment',true),false);
  assert.equal(requiresPayment('pay_later',true),false);
  assert.equal(requiresPayment('deposit',false),true);
  assert.equal(requiresPayment('full_payment',false),true);
  assert.equal(requiresPayment('customer_choice',false),false);
  assert.equal(requiresPayment('customer_choice',true),true);
});

test('business-local availability converts to UTC across daylight saving',()=>{
  assert.equal(zonedDateTimeToUtc('2026-01-15','09:00','Europe/London').toISOString(),'2026-01-15T09:00:00.000Z');
  assert.equal(zonedDateTimeToUtc('2026-07-15','09:00','Europe/London').toISOString(),'2026-07-15T08:00:00.000Z');
});

test('Stripe signatures are timestamped and authenticated',()=>{
  process.env.STRIPE_WEBHOOK_SECRET='whsec_test';const timestamp=Math.floor(Date.now()/1000);const payload='{"type":"payment_intent.succeeded"}';
  const signature=crypto.createHmac('sha256','whsec_test').update(`${timestamp}.${payload}`).digest('hex');
  assert.equal(verifyStripeSignature(payload,`t=${timestamp},v1=${signature}`),true);
  assert.equal(verifyStripeSignature(payload,`t=${timestamp},v1=${'0'.repeat(64)}`),false);
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

test('migration revokes anonymous writes and serializes slot creation',()=>{
  const sql=fs.readFileSync(path.join(process.cwd(),'module10_booking_service_api.sql'),'utf8');
  const channels=fs.readFileSync(path.join(process.cwd(),'module11_booking_channels.sql'),'utf8');
  assert.match(sql,/DROP POLICY IF EXISTS insert_appointments_policy/);
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.create_public_booking[\s\S]*TO service_role/);
  assert.doesNotMatch(sql,/insert_appointments_policy[\s\S]{0,200}WITH CHECK \(true\)/);
  assert.match(channels,/booking_channel_schedules/);
  assert.match(channels,/booking_channel='mobile'/);
  assert.match(channels,/appointments_mobile_address_required/);
});

test('database creates one idempotent booking, rejects overlap, and confirms a real payment',async()=>{
  const db=new PGlite();await db.waitReady;
  await db.exec(`
    CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid';
    CREATE TABLE tenants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,subdomain text,custom_domain text,primary_color text DEFAULT '#000000',secondary_color text DEFAULT '#000000',accent_color text DEFAULT '#000000',created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE users(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,email text,name text,role text,permissions jsonb DEFAULT '{}',created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE services(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,name text,description text,duration integer NOT NULL,price integer NOT NULL,discount integer DEFAULT 0,requires_deposit boolean DEFAULT false,is_active boolean DEFAULT true,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE staff_schedules(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,user_id uuid NOT NULL,day_of_week integer,start_time text,end_time text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE clients(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,name text,email text,phone text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE appointments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,user_id uuid NOT NULL,client_id uuid,client_name text,service_id uuid,start_time timestamptz,end_time timestamptz,status text DEFAULT 'PENDING',created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE checkout_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,appointment_id uuid NOT NULL,total_amount integer,payment_status text,payment_method text,purchased_products jsonb DEFAULT '[]',stripe_payment_intent_id text,created_at timestamptz DEFAULT now());
    CREATE TABLE products(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,stock_quantity integer DEFAULT 0,updated_at timestamptz DEFAULT now());
    CREATE TABLE staff_pricing(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,service_id uuid,custom_price_in_cents integer,custom_duration_minutes integer);
    CREATE TABLE forms(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid); CREATE TABLE client_form_submissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid);
    CREATE FUNCTION get_auth_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid'; CREATE FUNCTION get_auth_user_role() RETURNS text LANGUAGE sql STABLE AS 'SELECT NULL::text';
    ALTER TABLE users ENABLE ROW LEVEL SECURITY; ALTER TABLE services ENABLE ROW LEVEL SECURITY; ALTER TABLE staff_schedules ENABLE ROW LEVEL SECURITY; ALTER TABLE forms ENABLE ROW LEVEL SECURITY; ALTER TABLE appointments ENABLE ROW LEVEL SECURITY; ALTER TABLE clients ENABLE ROW LEVEL SECURITY; ALTER TABLE client_form_submissions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY insert_appointments_policy ON appointments FOR INSERT WITH CHECK(true); CREATE POLICY insert_clients_policy ON clients FOR INSERT WITH CHECK(true); CREATE POLICY insert_submissions_policy ON client_form_submissions FOR INSERT WITH CHECK(true);
    CREATE POLICY select_services_policy ON services FOR SELECT USING(true); CREATE POLICY select_schedules_policy ON staff_schedules FOR SELECT USING(true); CREATE POLICY select_forms_policy ON forms FOR SELECT USING(true); CREATE POLICY select_users_policy ON users FOR SELECT USING(true);
    CREATE FUNCTION decrement_stock_on_transaction() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END';
    CREATE TRIGGER trg_decrement_stock_on_transaction AFTER INSERT OR UPDATE OF payment_status ON checkout_transactions FOR EACH ROW WHEN (NEW.payment_status='SUCCEEDED') EXECUTE FUNCTION decrement_stock_on_transaction();
  `);
  await db.exec(fs.readFileSync(path.join(process.cwd(),'module10_booking_service_api.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(process.cwd(),'module11_booking_channels.sql'),'utf8'));
  const tenant='10000000-0000-0000-0000-000000000001',staff='10000000-0000-0000-0000-000000000002',service='10000000-0000-0000-0000-000000000003',idem='10000000-0000-0000-0000-000000000004';
  const future=new Date(Date.now()+7*86400000);const day=future.getUTCDay();future.setUTCHours(10,0,0,0);
  await db.exec(`GRANT USAGE ON SCHEMA public TO service_role,authenticated;GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO service_role;GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;INSERT INTO tenants(id,name,subdomain,timezone,currency)VALUES('${tenant}','Test','test','UTC','GBP');INSERT INTO users(id,tenant_id,email,name,role)VALUES('${staff}','${tenant}','staff@test.dev','Staff','staff');INSERT INTO services(id,tenant_id,name,duration,price,discount,is_active)VALUES('${service}','${tenant}','Service',60,10000,0,true);INSERT INTO staff_schedules(tenant_id,user_id,day_of_week,start_time,end_time)VALUES('${tenant}','${staff}',${day},'09:00','17:00');INSERT INTO booking_channel_schedules(tenant_id,user_id,booking_channel,day_of_week,start_time,end_time)VALUES('${tenant}','${staff}','in_shop',${day},'09:00','17:00');`);
  const call=(key:string,start:Date,channel='in_shop',address='NULL')=>`SELECT * FROM create_public_booking('${tenant}'::uuid,'${service}'::uuid,'${staff}'::uuid,'${start.toISOString()}'::timestamptz,'Jane Client','jane@example.com','07123456789','full_payment',true,'${key}'::uuid,'${channel}',${address})`;
  await db.exec('SET ROLE service_role');await db.exec(call(idem,future));await db.exec(call(idem,future));
  await db.exec('RESET ROLE');assert.equal((await db.query('SELECT id FROM appointments')).rows.length,1);
  await db.exec('SET ROLE authenticated');await assert.rejects(db.exec(`INSERT INTO booking_channel_schedules(tenant_id,user_id,booking_channel,day_of_week,start_time,end_time)VALUES('${tenant}','${staff}','mobile',${day},'08:00','09:00')`));await db.exec('RESET ROLE');
  const overlap='10000000-0000-0000-0000-000000000005';await db.exec('SET ROLE service_role');await assert.rejects(db.exec(call(overlap,future)),/no longer available/);
  const mobileKey='10000000-0000-0000-0000-000000000006',mobileStart=new Date(future.getTime()+2*3600000);
  await assert.rejects(db.exec(call(mobileKey,mobileStart,'mobile',`'{"line1":"1 High Street","city":"London","postcode":"SW1A 1AA"}'::jsonb`)),/outside booking channel schedule/);
  await db.exec(`RESET ROLE;INSERT INTO booking_channel_schedules(tenant_id,user_id,booking_channel,day_of_week,start_time,end_time)VALUES('${tenant}','${staff}','mobile',${day},'12:00','17:00');SET ROLE service_role;`);
  await db.exec(call(mobileKey,mobileStart,'mobile',`'{"line1":"1 High Street","city":"London","postcode":"SW1A 1AA"}'::jsonb`));
  await db.exec('RESET ROLE');const reference=(await db.query<{public_reference:string}>('SELECT public_reference FROM appointments')).rows[0].public_reference;
  await db.exec('SET ROLE authenticated');await assert.rejects(db.exec(call(overlap,new Date(future.getTime()+7200000))));
  await db.exec('RESET ROLE;SET ROLE service_role');await db.exec(`SELECT confirm_public_booking_payment('${reference}'::uuid,'pi_test',10000)`);await db.exec('RESET ROLE');
  assert.deepEqual((await db.query("SELECT status,payment_status FROM appointments WHERE booking_channel='in_shop'")).rows[0],{status:'CONFIRMED',payment_status:'SUCCEEDED'});
  assert.equal((await db.query<{mobile_address:any}>("SELECT mobile_address FROM appointments WHERE booking_channel='mobile'")).rows[0].mobile_address.postcode,'SW1A 1AA');
  assert.equal((await db.query<{purpose:string}>('SELECT purpose FROM checkout_transactions')).rows[0].purpose,'booking_payment');
  const rateKey='b'.repeat(64);await db.exec('SET ROLE authenticated');await assert.rejects(db.exec(`SELECT consume_public_booking_rate_limit('${rateKey}',1,60)`));
  await db.exec('RESET ROLE;SET ROLE service_role');const allowed=await db.query<{allowed:boolean}>(`SELECT consume_public_booking_rate_limit('${rateKey}',1,60) AS allowed`);const blocked=await db.query<{allowed:boolean}>(`SELECT consume_public_booking_rate_limit('${rateKey}',1,60) AS allowed`);
  assert.equal(allowed.rows[0].allowed,true);assert.equal(blocked.rows[0].allowed,false);await db.close();
});
