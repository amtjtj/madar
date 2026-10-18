/** Development only: drops all Madar schemas and re-applies migrations. */
import pg from 'pg';

import { loadRootEnv, requireEnv } from './env.js';
import { runMigrations } from './migrate.js';

loadRootEnv();
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to reset a production database.');
  process.exit(1);
}

const ownerUrl = requireEnv('DATABASE_URL');
const pool = new pg.Pool({ connectionString: ownerUrl, max: 1 });
try {
  await pool.query(`
    DROP SCHEMA IF EXISTS drizzle CASCADE;
    DROP SCHEMA IF EXISTS app CASCADE;
    DROP SCHEMA IF EXISTS public CASCADE;
    CREATE SCHEMA public;
  `);
} finally {
  await pool.end();
}
await runMigrations(
  ownerUrl,
  requireEnv('APP_DATABASE_URL'),
  process.env.WORKER_DATABASE_URL || undefined,
);
console.warn('Database reset and migrated.');
