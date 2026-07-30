export * from './schema.js';
export * from './error-schema.js';
export * from './design-library-schema.js';
export * from './booking-schedule-overrides.js';
export * from './conversation-schema.js';
export * from './manifest.js';
export * from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as coreSchema from './schema.js';
import * as errorSchema from './error-schema.js';
import * as designLibrarySchema from './design-library-schema.js';
import * as bookingScheduleOverrideSchema from './booking-schedule-overrides.js';
import * as conversationSchema from './conversation-schema.js';

const schema: typeof coreSchema & typeof errorSchema & typeof designLibrarySchema & typeof bookingScheduleOverrideSchema & typeof conversationSchema = {
  ...coreSchema,
  ...errorSchema,
  ...designLibrarySchema,
  ...bookingScheduleOverrideSchema,
  ...conversationSchema,
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

  // Prevent multiple pools in dev hot-reloads
  const globalRef = globalThis as any;
  if (!globalRef.pgPool) {
    globalRef.pgPool = new pg.Pool({
      connectionString: url,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
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
