/**
 * Applies migrations as the owner role (DATABASE_URL) after making sure the application role from
 * APP_DATABASE_URL exists with its password. The app role is never the table owner and never
 * bypasses RLS (ADR 0002).
 */
import { resolve } from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import { loadRootEnv, requireEnv } from './env.js';

export const APP_ROLE = 'madar_app';

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function ensureAppRole(owner: pg.Pool, appUrl: string): Promise<void> {
  const url = new URL(appUrl);
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (user !== APP_ROLE) {
    throw new Error(`APP_DATABASE_URL must connect as "${APP_ROLE}" (got "${user}")`);
  }
  if (!password) throw new Error('APP_DATABASE_URL must include a password');
  const pw = quoteLiteral(password);
  await owner.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
        ALTER ROLE ${APP_ROLE} LOGIN NOBYPASSRLS NOSUPERUSER PASSWORD ${pw};
      ELSE
        CREATE ROLE ${APP_ROLE} LOGIN NOBYPASSRLS NOSUPERUSER PASSWORD ${pw};
      END IF;
    END
    $$;
  `);
  // Let the app role connect to this database (names cannot be parameterized).
  const { rows } = await owner.query<{ db: string }>('select current_database() as db');
  const db = rows[0]?.db ?? '';
  await owner.query(`GRANT CONNECT ON DATABASE "${db.replace(/"/g, '""')}" TO ${APP_ROLE}`);
}

export async function runMigrations(ownerUrl: string, appUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: ownerUrl, max: 1 });
  try {
    await ensureAppRole(pool, appUrl);
    await migrate(drizzle(pool), { migrationsFolder: resolve(import.meta.dirname, '../drizzle') });
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  loadRootEnv();
  runMigrations(requireEnv('DATABASE_URL'), requireEnv('APP_DATABASE_URL'))
    .then(() => console.warn('Migrations applied.'))
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
