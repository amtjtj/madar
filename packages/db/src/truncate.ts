import pg from 'pg';

/**
 * Empties every table in the public schema (data only; schema, roles and migration history stay).
 * Owner connection only. Used by the demo server's nightly reset (plan phase-1-step-9 §5), never
 * by the app.
 */
export async function truncateAllData(ownerUrl: string): Promise<number> {
  const pool = new pg.Pool({ connectionString: ownerUrl, max: 1 });
  try {
    const { rows } = await pool.query<{ name: string }>(
      `select format('%I.%I', schemaname, tablename) as name
         from pg_tables where schemaname = 'public'`,
    );
    if (rows.length) {
      await pool.query(`truncate ${rows.map((r) => r.name).join(', ')} restart identity cascade`);
    }
    return rows.length;
  } finally {
    await pool.end();
  }
}
