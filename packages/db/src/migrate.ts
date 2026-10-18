/**
 * Applies migrations as the owner role (DATABASE_URL) after making sure the application role from
 * APP_DATABASE_URL (and the worker role from WORKER_DATABASE_URL, when set) exists with its password.
 * Neither is ever the table owner or bypasses RLS (ADR 0002, ADR 0011).
 */
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import { loadRootEnv, requireEnv } from './env.js';

export const APP_ROLE = 'madar_app';
export const WORKER_ROLE = 'madar_worker';

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function ensureLoginRole(
  owner: pg.Pool,
  roleUrl: string,
  role: string,
): Promise<void> {
  const url = new URL(roleUrl);
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (user !== role)
    throw new Error(`The URL for ${role} must connect as "${role}" (got "${user}")`);
  if (!password) throw new Error(`The URL for ${role} must include a password`);
  const pw = quoteLiteral(password);
  await owner.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
        ALTER ROLE ${role} LOGIN NOBYPASSRLS NOSUPERUSER PASSWORD ${pw};
      ELSE
        CREATE ROLE ${role} LOGIN NOBYPASSRLS NOSUPERUSER PASSWORD ${pw};
      END IF;
    END
    $$;
  `);
  // Let the app role connect to this database (names cannot be parameterized).
  const { rows } = await owner.query<{ db: string }>('select current_database() as db');
  const db = rows[0]?.db ?? '';
  await owner.query(`GRANT CONNECT ON DATABASE "${db.replace(/"/g, '""')}" TO ${role}`);
}

export async function runMigrations(
  ownerUrl: string,
  appUrl: string,
  workerUrl?: string,
): Promise<void> {
  const pool = new pg.Pool({ connectionString: ownerUrl, max: 1 });
  try {
    await ensureLoginRole(pool, appUrl, APP_ROLE);
    if (workerUrl) await ensureLoginRole(pool, workerUrl, WORKER_ROLE);
    await migrate(drizzle(pool), { migrationsFolder: resolve(import.meta.dirname, '../drizzle') });
  } finally {
    await pool.end();
  }
}

// Run when executed directly (also through a relative or symlinked path, as in the image).
const entry = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : '';
if (import.meta.url === entry) {
  loadRootEnv();
  runMigrations(
    requireEnv('DATABASE_URL'),
    requireEnv('APP_DATABASE_URL'),
    process.env.WORKER_DATABASE_URL || undefined,
  )
    .then(() => console.warn('Migrations applied.'))
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
