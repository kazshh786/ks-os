export * from './schema.js';
export * from './error-schema.js';
export * from './manifest.js';
export * from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as coreSchema from './schema.js';
import * as errorSchema from './error-schema.js';

const schema = { ...coreSchema, ...errorSchema };

let dbClient: pg.Pool | null = null;
let database: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDatabase(connectionString?: string) {
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
