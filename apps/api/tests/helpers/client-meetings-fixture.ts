import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type { TestContext } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from '@ks-os/database';
import type { CommunicationsActor } from '../../src/modules/communications/communications.authorization.js';
import type { CommunicationsDatabase } from '../../src/modules/communications/communications.database.js';
import { collaborationIdentityFixtureSql } from './collaboration-schema-fixture.js';

interface QueryConnection {
  query<T extends Record<string, unknown> = Record<string, unknown>>(statement: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
interface FixtureConnection extends QueryConnection { exec(statement: string): Promise<unknown> }

/** Uses disposable PGlite normally, or a separate database on the GitHub CI PostgreSQL service. */
export async function createClientMeetingFixture(t: TestContext, options: { postgresUrl?: string } = {}) {
  const dialect = new PgDialect();
  let pg: FixtureConnection;
  let transaction: CommunicationsDatabase['transaction'];
  const wrap = (connection: QueryConnection, nested = false): CommunicationsDatabase => ({
    async query<T extends Record<string, unknown>>(statement: SQL) {
      const query = dialect.sqlToQuery(statement);
      return (await connection.query<T>(query.sql, query.params)).rows;
    },
    transaction: work => nested ? work(wrap(connection, true)) : transaction(work),
  });
  if (options.postgresUrl) {
    const url = new URL(options.postgresUrl);
    assert.equal(process.env.CI, 'true', 'Real race tests run only in isolated GitHub CI');
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
    assert.equal(url.pathname, '/ks_os_ci', 'Never connect race tests to an application database');
    const require = createRequire(new URL('../../../../packages/database/package.json', import.meta.url));
    const { Pool } = require('pg') as typeof import('pg');
    const admin = new Pool({ connectionString: options.postgresUrl, max: 1 });
    // Roles are cluster-wide even though each test suite owns a separate database.
    // Serialize their creation in the shared CI administration database.
    await admin.query(`BEGIN; SELECT pg_advisory_xact_lock(8241095);
      DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      COMMIT;`).catch(async error => { await admin.end(); throw error; });
    const database = `ksos_client_meetings_test_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE DATABASE ${database}`);
    url.pathname = `/${database}`;
    const pool = new Pool({ connectionString: url.toString(), max: 10 });
    const connectionsClosed: Promise<void>[] = [];
    pool.on('connect', client => {
      connectionsClosed.push(new Promise<void>(resolve => client.once('end', resolve)));
    });
    t.after(async () => {
      try {
        // Pool shutdown removes idle clients before their socket end events arrive.
        // Wait for those events before dropping the disposable database.
        await pool.end();
        await Promise.all(connectionsClosed);
        await admin.query(`DROP DATABASE ${database}`);
      } finally { await admin.end(); }
    });
    pg = { query: (statement, params) => pool.query(statement, params), exec: statement => pool.query(statement) };
    transaction = async work => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work(wrap(client, true));
        await client.query('COMMIT');
        return result;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    };
  } else {
    const memory = new PGlite();
    t.after(() => memory.close());
    pg = memory;
    transaction = work => memory.transaction(tx => work(wrap(tx, true)));
  }
  await pg.exec(`
    DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE SCHEMA storage; CREATE TABLE storage.objects(bucket_id text);
    CREATE TABLE tenants(id uuid PRIMARY KEY,name text NOT NULL DEFAULT 'Test business',subdomain text NOT NULL DEFAULT 'test',timezone text NOT NULL DEFAULT 'Europe/London',primary_color text NOT NULL DEFAULT '#0f172a',secondary_color text NOT NULL DEFAULT '#475569',business_profile jsonb,package_tier text DEFAULT 'core',is_active boolean DEFAULT true,lifecycle_status text DEFAULT 'ACTIVE');
    CREATE TABLE users(id uuid PRIMARY KEY,tenant_id uuid REFERENCES tenants,auth_user_id uuid,name text,role text DEFAULT 'owner',access_profile text DEFAULT 'PRACTITIONER',permissions jsonb DEFAULT '{}',account_status text DEFAULT 'ACTIVE',sessions_valid_after timestamptz,security_version integer DEFAULT 1);
    CREATE TABLE clients(id uuid PRIMARY KEY,public_reference uuid NOT NULL DEFAULT gen_random_uuid(),tenant_id uuid REFERENCES tenants,name text,email text,phone text,medical_notes text);
    CREATE TABLE appointments(id uuid PRIMARY KEY,public_reference uuid NOT NULL DEFAULT gen_random_uuid(),tenant_id uuid REFERENCES tenants,user_id uuid REFERENCES users,client_id uuid REFERENCES clients,client_name text,start_time timestamptz,end_time timestamptz,status text DEFAULT 'CONFIRMED',version int DEFAULT 1,updated_at timestamptz DEFAULT now());
    CREATE TABLE booking_pages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid REFERENCES tenants,public_slug text,title text,logo_url text,theme_json jsonb DEFAULT '{}',enabled boolean DEFAULT true,published boolean DEFAULT true,created_at timestamptz DEFAULT now());
    CREATE TABLE tenant_email_automation_settings(tenant_id uuid PRIMARY KEY REFERENCES tenants,settings_json jsonb DEFAULT '{}');
    CREATE TABLE tenant_plan_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,plan_version_id uuid,status text,starts_at timestamptz,ends_at timestamptz);
    CREATE TABLE platform_plan_entitlements(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),plan_version_id uuid,entitlement_key text,value_json jsonb,created_at timestamptz DEFAULT now());
    CREATE TABLE tenant_entitlement_overrides(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,entitlement_key text,value_json jsonb,starts_at timestamptz,expires_at timestamptz,revoked_at timestamptz,created_at timestamptz DEFAULT now());
    CREATE TABLE customer_client_links(id uuid PRIMARY KEY,tenant_id uuid REFERENCES tenants);
    CREATE TABLE internal_notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid REFERENCES tenants,recipient_user_id uuid REFERENCES users,type text,title text,message text,source_type text,source_id uuid,read_at timestamptz,created_at timestamptz DEFAULT now());
    CREATE TABLE integration_connections(id uuid PRIMARY KEY,kind text);
    CREATE TABLE application_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),auth_session_id uuid,auth_user_id uuid,application_context text,selected_tenant_user_id uuid,security_version integer,revoked_at timestamptz,expires_at timestamptz);
    CREATE TABLE account_access_audit_events(id uuid DEFAULT gen_random_uuid(),auth_user_id uuid,tenant_id uuid,tenant_user_id uuid,application_context text,action text,outcome text,metadata jsonb);
    CREATE TABLE email_suppressions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),recipient_email_normalized text);
    CREATE TABLE email_outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,recipient_email text,recipient_name text,reply_to_email text,template_key text,template_version text,template_data_json jsonb,idempotency_key text UNIQUE,status text,scheduled_for timestamptz,next_attempt_at timestamptz,related_entity_type text,related_entity_id uuid,created_at timestamptz DEFAULT now());
  `);
  await pg.exec(collaborationIdentityFixtureSql);
  for (const migration of [
    '20260730223000_omnichannel_conversations.sql',
    '20260929120000_communications_foundation.sql',
    '20261011040000_communications_channels.sql',
    '20261011060000_communications_direct.sql',
    '20261011100000_communications_files_search_notifications.sql',
    '20261022100000_communications_meetings.sql',
    '20261022220000_communications_client_meetings.sql',
    '20261023010000_communications_client_channels.sql',
  ]) await pg.exec(readFileSync(new URL(`../../../../packages/database/migrations/${migration}`, import.meta.url), 'utf8'));
  const db = wrap(pg);
  async function seed(tenantId = randomUUID(), name = 'Test staff', role = 'staff'): Promise<CommunicationsActor> {
    const current = { tenantId, userId: randomUUID(), authUserId: randomUUID(), sessionId: randomUUID(),
      issuedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString() };
    await pg.query('INSERT INTO tenants(id) VALUES ($1) ON CONFLICT DO NOTHING', [tenantId]);
    await pg.query('INSERT INTO users(id,tenant_id,auth_user_id,name,role) VALUES ($1,$2,$3,$4,$5)', [current.userId, tenantId, current.authUserId, name, role]);
    await pg.query("INSERT INTO application_sessions(auth_session_id,auth_user_id,application_context,selected_tenant_user_id,security_version,expires_at) VALUES ($1,$2,'TENANT',$3,1,$4)", [current.sessionId, current.authUserId, current.userId, current.expiresAt]);
    return current;
  }
  async function seedCustomer(email = `contact-${randomUUID()}@example.test`, displayName = 'Customer contact') {
    const accountId = randomUUID(), identity = { authUserId: randomUUID(), email, sessionId: randomUUID(), issuedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString() };
    await pg.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [identity.authUserId, email]);
    await pg.query('INSERT INTO auth.sessions(id,user_id,not_after) VALUES($1,$2,$3)', [identity.sessionId, identity.authUserId, identity.expiresAt]);
    await pg.query('INSERT INTO customer_accounts(id,auth_user_id,email_normalized,display_name) VALUES($1,$2,$3,$4)', [accountId, identity.authUserId, email.toLowerCase().trim(), displayName]);
    await pg.query("INSERT INTO application_sessions(auth_session_id,auth_user_id,application_context,expires_at) VALUES($1,$2,'CUSTOMER',$3)", [identity.sessionId, identity.authUserId, identity.expiresAt]);
    return { accountId, identity };
  }
  const owner = await seed(undefined, 'Ari Host', 'owner');
  const host = await seed(owner.tenantId, 'Alex Host');
  const attendee = await seed(owner.tenantId, 'Ash Attendee');
  const outsider = await seed(owner.tenantId, 'Uninvited staff');
  const other = await seed(undefined, 'Bea Host', 'owner');
  const otherStaff = await seed(other.tenantId, 'Blair Staff');
  const central = await seed(undefined, 'Platform operator', 'owner');
  await pg.query("UPDATE application_sessions SET application_context='AGENCY' WHERE auth_session_id=$1", [central.sessionId]);
  await pg.query("UPDATE tenants SET name='Business Alpha',subdomain='business-alpha',primary_color='#123456' WHERE id=$1", [owner.tenantId]);
  await pg.query("UPDATE tenants SET name='Business Beta',subdomain='business-beta',primary_color='#654321' WHERE id=$1", [other.tenantId]);
  const customer = { id: randomUUID(), reference: randomUUID(), tenantId: owner.tenantId };
  const otherCustomer = { id: randomUUID(), reference: randomUUID(), tenantId: other.tenantId };
  for (const item of [customer, otherCustomer]) await pg.query('INSERT INTO clients(id,public_reference,tenant_id,name,email,phone,medical_notes) VALUES($1,$2,$3,$4,$5,$6,$7)', [item.id,item.reference,item.tenantId,'Private customer','private@example.test','07000000000','Never expose this CRM note to guests']);
  const startsAt = new Date(Date.now() + 60000).toISOString(), endsAt = new Date(Date.now() + 3600000).toISOString();
  const appointment = { id: randomUUID(), reference: randomUUID(), tenantId: owner.tenantId };
  const otherAppointment = { id: randomUUID(), reference: randomUUID(), tenantId: other.tenantId };
  for (const [item, staff, client] of [[appointment, host, customer], [otherAppointment, other, otherCustomer]] as const) await pg.query('INSERT INTO appointments(id,public_reference,tenant_id,user_id,client_id,start_time,end_time) VALUES($1,$2,$3,$4,$5,$6,$7)', [item.id,item.reference,item.tenantId,staff.userId,client.id,startsAt,endsAt]);
  return { pg, db, owner, host, attendee, outsider, other, otherStaff, central, customer, otherCustomer, appointment, otherAppointment, startsAt, endsAt, seed, seedCustomer };
}
