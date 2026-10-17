import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  pool: pg.Pool;
  close: () => Promise<void>;
}

/**
 * Creates a connection pool. Only this package creates connections; apps receive a handle.
 * Phase 1 adds `withTenant()` on top of this and lint-forbids raw access elsewhere.
 */
export function createDb(connectionString: string, options: { max?: number } = {}): DbHandle {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10 });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

/** Returns true when the database answers a trivial query within `timeoutMs`. */
export async function pingDb(pool: pg.Pool, timeoutMs = 2000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const query = pool
    .query('select 1')
    .then(() => true)
    .catch(() => false);
  try {
    return await Promise.race([query, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
