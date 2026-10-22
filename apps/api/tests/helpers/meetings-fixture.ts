import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from '@ks-os/database';
import type { CommunicationsActor } from '../../src/modules/communications/communications.authorization.js';
import type { CommunicationsDatabase } from '../../src/modules/communications/communications.database.js';
import { CommunicationsService } from '../../src/modules/communications/communications.service.js';

/** Real Postgres semantics in an isolated in-memory database; no production connection. */
export async function createMeetingFixture(t: TestContext) {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA storage; CREATE TABLE storage.objects(bucket_id text);
    CREATE TABLE tenants(id uuid PRIMARY KEY,is_active boolean DEFAULT true,lifecycle_status text DEFAULT 'ACTIVE');
    CREATE TABLE users(id uuid PRIMARY KEY,tenant_id uuid REFERENCES tenants,auth_user_id uuid,name text,role text DEFAULT 'owner',account_status text DEFAULT 'ACTIVE',sessions_valid_after timestamptz,security_version integer DEFAULT 1);
    CREATE TABLE clients(id uuid PRIMARY KEY); CREATE TABLE appointments(id uuid PRIMARY KEY);
    CREATE TABLE customer_client_links(id uuid PRIMARY KEY,tenant_id uuid REFERENCES tenants);
    CREATE TABLE internal_notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid REFERENCES tenants,recipient_user_id uuid REFERENCES users,type text,title text,message text,source_type text,source_id uuid,read_at timestamptz,created_at timestamptz DEFAULT now());
    CREATE TABLE integration_connections(id uuid PRIMARY KEY,kind text);
    CREATE TABLE application_sessions(auth_session_id uuid,auth_user_id uuid,application_context text,selected_tenant_user_id uuid,security_version integer,revoked_at timestamptz,expires_at timestamptz);
    CREATE TABLE account_access_audit_events(id uuid DEFAULT gen_random_uuid(),auth_user_id uuid,tenant_id uuid,tenant_user_id uuid,application_context text,action text,outcome text,metadata jsonb);
  `);
  for (const migration of [
    '20260730223000_omnichannel_conversations.sql',
    '20260929120000_communications_foundation.sql',
    '20261011040000_communications_channels.sql',
    '20261011060000_communications_direct.sql',
    '20261011100000_communications_files_search_notifications.sql',
    '20261022100000_communications_meetings.sql',
  ]) await pg.exec(readFileSync(new URL(`../../../../packages/database/migrations/${migration}`, import.meta.url), 'utf8'));
  const dialect = new PgDialect();
  const wrap = (connection: PGlite | Transaction): CommunicationsDatabase => ({
    async query<T extends Record<string, unknown>>(statement: SQL) {
      const query = dialect.sqlToQuery(statement);
      return (await connection.query<T>(query.sql, query.params)).rows;
    },
    transaction: work => connection instanceof PGlite
      ? connection.transaction(tx => work(wrap(tx))) : work(wrap(connection)),
  });
  const db = wrap(pg);
  async function seed(tenantId = randomUUID(), name = 'Test participant'): Promise<CommunicationsActor> {
    const current = { tenantId, userId: randomUUID(), authUserId: randomUUID(), sessionId: randomUUID(),
      issuedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString() };
    await pg.query('INSERT INTO tenants(id) VALUES ($1) ON CONFLICT DO NOTHING', [tenantId]);
    await pg.query('INSERT INTO users(id,tenant_id,auth_user_id,name) VALUES ($1,$2,$3,$4)', [current.userId, tenantId, current.authUserId, name]);
    await pg.query("INSERT INTO application_sessions(auth_session_id,auth_user_id,application_context,selected_tenant_user_id,security_version,expires_at) VALUES ($1,$2,'TENANT',$3,1,$4)", [current.sessionId, current.authUserId, current.userId, current.expiresAt]);
    return current;
  }
  const owner = await seed(undefined, 'Ada Lovelace');
  const member = await seed(owner.tenantId, 'Grace Hopper');
  const outsider = await seed(owner.tenantId, 'Lin Chen');
  const other = await seed(undefined, 'Other tenant');
  return { pg, db, owner, member, outsider, other, seed, service: new CommunicationsService(db) };
}
