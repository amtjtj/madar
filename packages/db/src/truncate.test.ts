import { describe, expect, it } from 'vitest';

import { loadRootEnv } from './env.js';
import { uuidv7 } from './schema/columns.js';
import { NotADemoDatabaseError, truncateAllData } from './truncate.js';

loadRootEnv();
const ownerUrl = process.env.DATABASE_URL;

// Only the refusal is exercised: the test database always holds the test companies, so this
// proves the demo reset cannot empty a database with real companies in it.
describe.skipIf(!ownerUrl || !process.env.APP_DATABASE_URL)('truncateAllData', () => {
  it('refuses, and changes nothing, when a company other than the demo one exists', async () => {
    const pg = (await import('pg')).default;
    const pool = new pg.Pool({ connectionString: ownerUrl, max: 1 });
    const slug = `real-company-${Date.now()}`;
    await pool.query(`insert into tenants (id, name, slug) values ($1, 'شرکت واقعی', $2)`, [
      uuidv7(),
      slug,
    ]);
    // Other test files add companies in parallel, so compare ids, not counts.
    const ids = async () =>
      new Set((await pool.query('select id from tenants')).rows.map((r: { id: string }) => r.id));
    const before = await ids();
    await expect(
      truncateAllData(ownerUrl ?? '', { onlyIfTenantSlugs: ['zarrin-madar'] }),
    ).rejects.toBeInstanceOf(NotADemoDatabaseError);
    const after = await ids();
    expect([...before].filter((id) => !after.has(id))).toEqual([]);
    await pool.query('delete from tenants where slug = $1', [slug]);
    await pool.end();
  });
});
