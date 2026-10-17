import { afterAll, describe, expect, it } from 'vitest';

import { createDb, pingDb } from './client.js';

describe('pingDb', () => {
  it('returns false when the database is unreachable', async () => {
    const handle = createDb('postgres://nobody:nothing@127.0.0.1:1/none', { max: 1 });
    try {
      expect(await pingDb(handle.pool, 1000)).toBe(false);
    } finally {
      await handle.close();
    }
  });

  describe.skipIf(!process.env.DATABASE_URL)('with DATABASE_URL', () => {
    const handle = createDb(process.env.DATABASE_URL ?? '', { max: 1 });
    afterAll(() => handle.close());

    it('returns true for a reachable database', async () => {
      expect(await pingDb(handle.pool)).toBe(true);
    });
  });
});
