export * from './schema.js';
export * from './sales-schema.js';
export * from './error-schema.js';
export * from './design-library-schema.js';
export * from './booking-schedule-overrides.js';
export * from './conversation-schema.js';
export * from './search-research-schema.js';
export * from './manifest.js';
export * from './pool-config.js';
export * from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as coreSchema from './schema.js';
import * as salesSchema from './sales-schema.js';
import * as errorSchema from './error-schema.js';
import * as designLibrarySchema from './design-library-schema.js';
import * as bookingScheduleOverrideSchema from './booking-schedule-overrides.js';
import * as conversationSchema from './conversation-schema.js';
import * as searchResearchSchema from './search-research-schema.js';
import { resolveDatabasePoolMax } from './pool-config.js';

const schema: typeof coreSchema & typeof salesSchema & typeof errorSchema & typeof designLibrarySchema & typeof bookingScheduleOverrideSchema & typeof conversationSchema & typeof searchResearchSchema = {
  ...coreSchema,
  ...salesSchema,
  ...errorSchema,
  ...designLibrarySchema,
  ...bookingScheduleOverrideSchema,
  ...conversationSchema,
  ...searchResearchSchema,
};
type Database = NodePgDatabase<typeof schema>;

let dbClient: pg.Pool | null = null;
let database: Database | null = null;

export function getDatabase(connectionString?: string): Database {
  if (database) return database;

  const url = connectionString || process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is missing.');
  }

  // Prevent multiple pools in dev hot-reloads. Supavisor can occasionally take
  // longer than two seconds to hand out/re-establish a connection during a brief
  // infrastructure or network stall, so give the pool enough time to recover
  // instead of turning a transient pause into platform-wide query failures.
  const globalRef = globalThis as any;
  if (!globalRef.pgPool) {
    globalRef.pgPool = new pg.Pool({
      connectionString: url,
      max: resolveDatabasePoolMax(),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    });
  }

  dbClient = globalRef.pgPool;
  database = drizzle(dbClient!, { schema });
  return database;
}

export async function closeDatabase() {
  const globalRef = globalThis as any;
  if (globalRef.pgPool) {
    await globalRef.pgPool.end();
    globalRef.pgPool = null;
    dbClient = null;
    database = null;
  }
}
