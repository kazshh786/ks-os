import { getDatabase, type SQL } from '@ks-os/database';

// A small SQL boundary lets the same domain service run against PostgreSQL in
// production and an isolated PostgreSQL engine in security/integration tests.
export interface CommunicationsDatabase {
  query<T extends Record<string, unknown>>(statement: SQL): Promise<T[]>;
  transaction<T>(work: (database: CommunicationsDatabase) => Promise<T>): Promise<T>;
}

export function communicationsDatabase(): CommunicationsDatabase {
  const wrap = (db: Pick<ReturnType<typeof getDatabase>, 'execute' | 'transaction'>): CommunicationsDatabase => ({
    async query<T extends Record<string, unknown>>(statement: SQL) {
      return (await db.execute(statement)).rows as T[];
    },
    transaction: work => db.transaction(tx => work(wrap(tx))),
  });
  return wrap(getDatabase());
}
