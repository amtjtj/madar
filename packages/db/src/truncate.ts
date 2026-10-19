import pg from 'pg';

export class NotADemoDatabaseError extends Error {
  constructor(count: number) {
    super(`Refusing to empty the database: it holds ${count} company(ies) besides the demo one`);
  }
}

/**
 * Empties every table in the public schema (data only; schema, roles and migration history stay).
 * Owner connection only. Used by the demo server's nightly reset (plan phase-1-step-9 §5), never
 * by the app. Checked inside the database too, not only by DEMO_MODE: if any company other than
 * the ones in `onlyIfTenantSlugs` exists, nothing is touched.
 */
export async function truncateAllData(
  ownerUrl: string,
  { onlyIfTenantSlugs }: { onlyIfTenantSlugs: string[] },
): Promise<number> {
  const pool = new pg.Pool({ connectionString: ownerUrl, max: 1 });
  const client = await pool.connect();
  const others = async () => {
    const { rows } = await client.query<{ count: number }>(
      'select count(*)::int as count from tenants where slug <> all($1::text[])',
      [onlyIfTenantSlugs],
    );
    return rows[0]?.count ?? 0;
  };
  try {
    // Refuse early without taking a lock; check again under the lock before emptying anything.
    const early = await others();
    if (early > 0) throw new NotADemoDatabaseError(early);
    await client.query('begin');
    await client.query('lock table tenants in access exclusive mode');
    const count = await others();
    if (count > 0) throw new NotADemoDatabaseError(count);
    const { rows } = await client.query<{ name: string }>(
      `select format('%I.%I', schemaname, tablename) as name
         from pg_tables where schemaname = 'public'`,
    );
    if (rows.length) {
      await client.query(`truncate ${rows.map((r) => r.name).join(', ')} restart identity cascade`);
    }
    await client.query('commit');
    return rows.length;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
