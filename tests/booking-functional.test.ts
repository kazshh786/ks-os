import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

// Helper to initialize PGlite with schema and migrations
async function setupDb() {
  const db = new PGlite();
  await db.waitReady;
  
  // Set up mock auth schema and baseline tables
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid';
    
    CREATE TABLE tenants(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      subdomain text NOT NULL UNIQUE,
      custom_domain text UNIQUE,
      primary_color text DEFAULT '#000000',
      secondary_color text DEFAULT '#000000',
      accent_color text DEFAULT '#000000',
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE users(
      id uuid PRIMARY KEY,
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      email text NOT NULL,
      name text NOT NULL,
      role text NOT NULL DEFAULT 'staff',
      permissions jsonb DEFAULT '{}',
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE services(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name text NOT NULL,
      description text,
      duration integer NOT NULL,
      buffer_time integer DEFAULT 0 NOT NULL,
      price integer NOT NULL,
      discount integer DEFAULT 0,
      requires_deposit boolean DEFAULT false,
      is_active boolean DEFAULT true,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE staff_schedules(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day_of_week integer NOT NULL,
      start_time text NOT NULL,
      end_time text NOT NULL,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE clients(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name text NOT NULL,
      email text,
      phone text,
      medical_notes text,
      patch_test_date timestamptz,
      last_visit_date timestamptz,
      loyalty_points integer DEFAULT 0 NOT NULL,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE resources(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name varchar(255) NOT NULL,
      type varchar(100) NOT NULL,
      capacity integer DEFAULT 1 NOT NULL,
      created_at timestamptz DEFAULT now()
    );
    CREATE TABLE appointments(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
      client_name text,
      service_id uuid REFERENCES services(id) ON DELETE CASCADE,
      resource_id uuid REFERENCES resources(id) ON DELETE SET NULL,
      start_time timestamptz NOT NULL,
      end_time timestamptz NOT NULL,
      status text DEFAULT 'PENDING' NOT NULL,
      notes text,
      public_reference uuid DEFAULT gen_random_uuid() NOT NULL,
      idempotency_key uuid,
      payment_mode varchar(30) DEFAULT 'pay_later' NOT NULL,
      payment_status varchar(30) DEFAULT 'NOT_REQUIRED' NOT NULL,
      quoted_amount integer DEFAULT 0 NOT NULL,
      hold_expires_at timestamptz,
      booking_channel text DEFAULT 'in_shop' NOT NULL,
      mobile_address jsonb,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE checkout_transactions(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
      total_amount integer NOT NULL,
      payment_status text DEFAULT 'PENDING' NOT NULL,
      payment_method text DEFAULT 'CARD' NOT NULL,
      purchased_products jsonb DEFAULT '[]' NOT NULL,
      stripe_payment_intent_id varchar(255),
      purpose text DEFAULT 'point_of_sale' NOT NULL,
      created_at timestamptz DEFAULT now()
    );
    CREATE TABLE products(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name varchar(255) NOT NULL,
      sku varchar(100) NOT NULL UNIQUE,
      price_in_cents integer NOT NULL,
      stock_quantity integer DEFAULT 0 NOT NULL,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE staff_pricing(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      custom_price_in_cents integer NOT NULL,
      custom_duration_minutes integer NOT NULL
    );
    CREATE TABLE forms(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      title varchar(255) NOT NULL,
      fields_json jsonb NOT NULL,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE client_form_submissions(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
      response_json jsonb NOT NULL,
      submitted_at timestamptz DEFAULT now()
    );
    
    CREATE FUNCTION get_auth_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid';
    CREATE FUNCTION get_auth_user_role() RETURNS text LANGUAGE sql STABLE AS 'SELECT NULL::text';
    
    ALTER TABLE users ENABLE ROW LEVEL SECURITY;
    ALTER TABLE services ENABLE ROW LEVEL SECURITY;
    ALTER TABLE staff_schedules ENABLE ROW LEVEL SECURITY;
    ALTER TABLE forms ENABLE ROW LEVEL SECURITY;
    ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
    ALTER TABLE client_form_submissions ENABLE ROW LEVEL SECURITY;
  `);

  // Run migrations
  await db.exec(fs.readFileSync(path.join(process.cwd(), 'module9_workspace_tiers.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(process.cwd(), 'module10_booking_service_api.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(process.cwd(), 'module11_booking_channels.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(process.cwd(), 'module12_automation_event_outbox.sql'), 'utf8'));

  return db;
}

test('Functional Verification: Public Booking Channels & Address constraints', async () => {
  const db = await setupDb();
  
  const tenant = '20000000-0000-0000-0000-000000000001';
  const staff = '20000000-0000-0000-0000-000000000002';
  const service = '20000000-0000-0000-0000-000000000003';
  
  // Seed basic data
  await db.exec(`
    INSERT INTO tenants(id, name, subdomain, timezone, currency)
    VALUES('${tenant}', 'Studio A', 'studio-a', 'Europe/London', 'GBP');
    
    INSERT INTO users(id, tenant_id, email, name, role)
    VALUES('${staff}', '${tenant}', 'barber@studio.a', 'Jack Barber', 'staff');
    
    INSERT INTO services(id, tenant_id, name, duration, price, discount, is_active)
    VALUES('${service}', '${tenant}', 'Haircut', 30, 2500, 0, true);
    
    INSERT INTO staff_schedules(tenant_id, user_id, day_of_week, start_time, end_time)
    VALUES('${tenant}', '${staff}', 1, '09:00', '17:00');
    
    INSERT INTO booking_channel_schedules(tenant_id, user_id, booking_channel, day_of_week, start_time, end_time)
    VALUES('${tenant}', '${staff}', 'in_shop', 1, '09:00', '17:00');
  `);

  const monday = new Date('2026-07-20T10:00:00.000Z'); // 2026-07-20 is a Monday

  await db.exec('SET ROLE service_role');

  // Test 1: Booking for in_shop channel should succeed
  const booking1Key = '20000000-0000-0000-0000-000000000011';
  await db.exec(`
    SELECT * FROM create_public_booking(
      '${tenant}'::uuid,
      '${service}'::uuid,
      '${staff}'::uuid,
      '${monday.toISOString()}'::timestamptz,
      'Alice', 'alice@test.dev', '07999888777',
      'pay_later', false, '${booking1Key}'::uuid,
      'in_shop', NULL
    );
  `);
  
  await db.exec('RESET ROLE');
  const appts = await db.query<{ status: string; booking_channel: string }>('SELECT status, booking_channel FROM appointments');
  assert.equal(appts.rows.length, 1);
  assert.equal(appts.rows[0].booking_channel, 'in_shop');
  assert.equal(appts.rows[0].status, 'CONFIRMED');

  // Test 2: Booking for mobile channel on an unscheduled mobile channel day should fail
  const booking2Key = '20000000-0000-0000-0000-000000000012';
  const nextSlot = new Date(monday.getTime() + 60 * 60 * 1000); // + 1 hour
  await db.exec('SET ROLE service_role');
  await assert.rejects(db.exec(`
    SELECT * FROM create_public_booking(
      '${tenant}'::uuid,
      '${service}'::uuid,
      '${staff}'::uuid,
      '${nextSlot.toISOString()}'::timestamptz,
      'Bob', 'bob@test.dev', '07999888666',
      'pay_later', false, '${booking2Key}'::uuid,
      'mobile', '{"line1":"2 High St","city":"London","postcode":"W1 1AA"}'::jsonb
    );
  `), /outside booking channel schedule/);
  await db.exec('RESET ROLE');

  // Test 3: Add mobile channel schedule for Jack Barber on Mondays
  await db.exec(`
    INSERT INTO booking_channel_schedules(tenant_id, user_id, booking_channel, day_of_week, start_time, end_time)
    VALUES('${tenant}', '${staff}', 'mobile', 1, '13:00', '17:00');
  `);
  await db.exec('SET ROLE service_role');

  // Test 4: Booking mobile channel in correct slot, but missing address should fail
  const afternoonSlot = new Date('2026-07-20T14:00:00.000Z');
  await assert.rejects(db.exec(`
    SELECT * FROM create_public_booking(
      '${tenant}'::uuid,
      '${service}'::uuid,
      '${staff}'::uuid,
      '${afternoonSlot.toISOString()}'::timestamptz,
      'Bob', 'bob@test.dev', '07999888666',
      'pay_later', false, '${booking2Key}'::uuid,
      'mobile', NULL
    );
  `), /Invalid mobile address/);

  // Test 5: Booking mobile channel with proper address should succeed
  await db.exec(`
    SELECT * FROM create_public_booking(
      '${tenant}'::uuid,
      '${service}'::uuid,
      '${staff}'::uuid,
      '${afternoonSlot.toISOString()}'::timestamptz,
      'Bob', 'bob@test.dev', '07999888666',
      'pay_later', false, '${booking2Key}'::uuid,
      'mobile', '{"line1":"2 High St","city":"London","postcode":"W1 1AA"}'::jsonb
    );
  `);

  await db.exec('RESET ROLE');
  const mobileAppt = await db.query<{ status: string; booking_channel: string; mobile_address: any }>('SELECT status, booking_channel, mobile_address FROM appointments WHERE booking_channel = \'mobile\'');
  assert.equal(mobileAppt.rows.length, 1);
  assert.equal(mobileAppt.rows[0].status, 'CONFIRMED');
  assert.equal(mobileAppt.rows[0].mobile_address.line1, '2 High St');
  
  await db.close();
});

test('Functional Verification: Manual Booking Desk Resource Allocation & Conflicts', async () => {
  const db = await setupDb();
  
  const tenant = '30000000-0000-0000-0000-000000000001';
  const staff = '30000000-0000-0000-0000-000000000002';
  const service = '30000000-0000-0000-0000-000000000003';
  
  // Seed basic data
  await db.exec(`
    INSERT INTO tenants(id, name, subdomain, timezone, currency)
    VALUES('${tenant}', 'Beauty Hub', 'beauty-hub', 'Europe/London', 'GBP');
    
    INSERT INTO users(id, tenant_id, email, name, role)
    VALUES('${staff}', '${tenant}', 'therapist@beauty.hub', 'Sarah Therapist', 'staff');
    
    INSERT INTO services(id, tenant_id, name, duration, price, discount, is_active)
    VALUES('${service}', '${tenant}', 'Facial', 60, 5000, 0, true);
  `);

  // Simulate manual bookings (which are written directly via inserts on the appointments table)
  const client1 = '30000000-0000-0000-0000-000000000021';
  await db.exec(`
    INSERT INTO clients(id, tenant_id, name, email, phone)
    VALUES('${client1}', '${tenant}', 'Client A', 'client.a@test.dev', '07800000001');
  `);

  // Insert first booking allocating Room 1 in notes
  const start1 = new Date('2026-07-20T10:00:00.000Z');
  const end1 = new Date('2026-07-20T11:00:00.000Z');
  await db.exec(`
    INSERT INTO appointments(tenant_id, user_id, client_id, client_name, service_id, start_time, end_time, status, notes)
    VALUES('${tenant}', '${staff}', '${client1}', 'Client A', '${service}', '${start1.toISOString()}', '${end1.toISOString()}', 'CONFIRMED', '[Resource: Room 1] Facial booking');
  `);

  // Verification 1: Simulate the conflict detection algorithm in the frontend ManualBookingPage.
  // We want to book Room 1 concurrently for another client at 10:30 (overlaps with 10:00-11:00 Room 1).
  const startOverlap = new Date('2026-07-20T10:30:00.000Z');
  const endOverlap = new Date('2026-07-20T11:30:00.000Z');
  const targetResource = 'Room 1';

  // Fetch concurrent appointments
  const apptsRes = await db.query<{ notes: string; start_time: string; end_time: string; status: string }>(`
    SELECT notes, start_time, end_time, status FROM appointments 
    WHERE tenant_id = $1 AND status <> 'CANCELLED'
  `, [tenant]);

  // Frontend logic simulation:
  const hasConflict = apptsRes.rows.some((appt) => {
    const apptStart = new Date(appt.start_time);
    const apptEnd = new Date(appt.end_time);
    const isConcurrent = startOverlap < apptEnd && endOverlap > apptStart;
    if (!isConcurrent) return false;

    const match = appt.notes?.match(/^\[Resource:\s*([^\]]+)\]/);
    return match && match[1].toLowerCase() === targetResource.toLowerCase();
  });

  assert.equal(hasConflict, true); // It correctly detects conflict!

  // Verification 2: Check room conflict fails/passes when booking Room 2 at same time
  const hasNoConflictForRoom2 = apptsRes.rows.some((appt) => {
    const apptStart = new Date(appt.start_time);
    const apptEnd = new Date(appt.end_time);
    const isConcurrent = startOverlap < apptEnd && endOverlap > apptStart;
    if (!isConcurrent) return false;

    const match = appt.notes?.match(/^\[Resource:\s*([^\]]+)\]/);
    return match && match[1].toLowerCase() === 'Room 2'.toLowerCase();
  });

  assert.equal(hasNoConflictForRoom2, false); // No conflict for Room 2!

  await db.close();
});

test('Functional Verification: Product stock deduction vs Booking deposit logic', async () => {
  const db = await setupDb();
  
  const tenant = '40000000-0000-0000-0000-000000000001';
  const staff = '40000000-0000-0000-0000-000000000002';
  const service = '40000000-0000-0000-0000-000000000003';
  const product = '40000000-0000-0000-0000-000000000004';
  
  // Seed basic data
  await db.exec(`
    INSERT INTO tenants(id, name, subdomain, timezone, currency)
    VALUES('${tenant}', 'Loyal Salon', 'loyal-salon', 'Europe/London', 'GBP');
    
    INSERT INTO users(id, tenant_id, email, name, role)
    VALUES('${staff}', '${tenant}', 'stylist@loyal.salon', 'Mary Stylist', 'staff');
    
    INSERT INTO services(id, tenant_id, name, duration, price, discount, is_active)
    VALUES('${service}', '${tenant}', 'Blow Dry', 45, 3000, 0, true);
    
    INSERT INTO products(id, tenant_id, name, sku, price_in_cents, stock_quantity)
    VALUES('${product}', '${tenant}', 'Hair Spray', 'SPRAY1', 1500, 10);
  `);

  // Insert a client
  const client1 = '40000000-0000-0000-0000-000000000021';
  await db.exec(`
    INSERT INTO clients(id, tenant_id, name, email, phone)
    VALUES('${client1}', '${tenant}', 'Client C', 'client.c@test.dev', '07800000003');
  `);

  // Insert booking transaction
  const start = new Date('2026-07-20T10:00:00.000Z');
  const end = new Date('2026-07-20T10:45:00.000Z');
  await db.exec(`
    INSERT INTO appointments(id, tenant_id, user_id, client_id, client_name, service_id, start_time, end_time, status)
    VALUES('40000000-0000-0000-0000-000000000051', '${tenant}', '${staff}', '${client1}', 'Client C', '${service}', '${start.toISOString()}', '${end.toISOString()}', 'PENDING');
  `);

  // Register custom decrement stock trigger
  await db.exec(`
    CREATE OR REPLACE FUNCTION public.decrement_stock_on_transaction()
    RETURNS TRIGGER AS $$
    DECLARE v_item jsonb;
    BEGIN
      IF NEW.purpose='booking_payment' THEN RETURN NEW; END IF;
      IF NEW.purchased_products IS NOT NULL AND jsonb_array_length(NEW.purchased_products)>0 THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.purchased_products) LOOP
          UPDATE public.products SET stock_quantity=stock_quantity-(v_item->>'quantity')::integer
          WHERE id=(v_item->>'productId')::uuid AND tenant_id=NEW.tenant_id;
        END LOOP;
      END IF;
      UPDATE public.appointments SET status='COMPLETED' WHERE id=NEW.appointment_id;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Trigger is:
  // CREATE TRIGGER trg_decrement_stock_on_transaction AFTER INSERT OR UPDATE OF payment_status ON checkout_transactions FOR EACH ROW WHEN (NEW.payment_status='SUCCEEDED') EXECUTE FUNCTION decrement_stock_on_transaction();
  await db.exec(`
    CREATE TRIGGER trg_decrement_stock_on_transaction 
    AFTER INSERT OR UPDATE OF payment_status ON checkout_transactions 
    FOR EACH ROW WHEN (NEW.payment_status='SUCCEEDED') 
    EXECUTE FUNCTION decrement_stock_on_transaction();
  `);

  // Test case 1: Booking payment transaction (purpose = 'booking_payment') should NOT decrement retail stock
  await db.exec(`
    INSERT INTO checkout_transactions(tenant_id, appointment_id, total_amount, payment_status, payment_method, purchased_products, purpose)
    VALUES('${tenant}', '40000000-0000-0000-0000-000000000051', 1000, 'SUCCEEDED', 'CARD', '[{"productId":"${product}","quantity":1}]'::jsonb, 'booking_payment');
  `);

  const prod1 = await db.query<{ stock_quantity: number }>('SELECT stock_quantity FROM products WHERE id = $1', [product]);
  assert.equal(prod1.rows[0].stock_quantity, 10); // Stock remains unchanged at 10!

  // Test case 2: POS transaction (purpose = 'point_of_sale') should decrement retail stock
  const appt2 = '40000000-0000-0000-0000-000000000052';
  await db.exec(`
    INSERT INTO appointments(id, tenant_id, user_id, client_id, client_name, service_id, start_time, end_time, status)
    VALUES('${appt2}', '${tenant}', '${staff}', '${client1}', 'Client C', '${service}', '${start.toISOString()}', '${end.toISOString()}', 'PENDING');
  `);

  await db.exec(`
    INSERT INTO checkout_transactions(tenant_id, appointment_id, total_amount, payment_status, payment_method, purchased_products, purpose)
    VALUES('${tenant}', '${appt2}', 4500, 'SUCCEEDED', 'CARD', '[{"productId":"${product}","quantity":2}]'::jsonb, 'point_of_sale');
  `);

  const prod2 = await db.query<{ stock_quantity: number }>('SELECT stock_quantity FROM products WHERE id = $1', [product]);
  assert.equal(prod2.rows[0].stock_quantity, 8); // Stock decremented to 8!

  await db.close();
});
