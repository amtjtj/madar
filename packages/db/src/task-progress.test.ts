import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from './client.js';
import * as s from './schema/index.js';
import { withTenant } from './tenant.js';
import { appDb, createTenantFixture, hasDatabase, ownerDb } from './test/fixtures.js';

// The backfill of migration 0014 (ADR 0018): the last statement of the file.
const backfill =
  readFileSync(resolve(import.meta.dirname, '../drizzle/0014_progress_observer.sql'), 'utf8')
    .split('--> statement-breakpoint')
    .at(-1) ?? '';

describe.skipIf(!hasDatabase)('task progress (migration 0014)', () => {
  let app: DbHandle;
  let owner: DbHandle;

  beforeAll(() => {
    app = appDb();
    owner = ownerDb();
  });
  afterAll(async () => {
    await app.close();
    await owner.close();
  });

  it('accepts 0..100 in steps of 5 only', async () => {
    const f = await createTenantFixture(app, 'prg');
    await withTenant(app.db, { tenantId: f.tenantId }, async (tx) => {
      const [task] = await tx.select({ id: s.tasks.id }).from(s.tasks).limit(1);
      if (!task) throw new Error('fixture task missing');
      await tx.update(s.tasks).set({ progress: 55 }).where(eq(s.tasks.id, task.id));
    });
    for (const bad of [7, 105, -5]) {
      await expect(
        withTenant(app.db, { tenantId: f.tenantId }, (tx) =>
          tx.update(s.tasks).set({ progress: bad }),
        ),
      ).rejects.toThrow();
    }
  });

  it('starts parents from the weighted progress of their subtasks', async () => {
    const f = await createTenantFixture(app, 'prg');
    const parentId = await withTenant(app.db, { tenantId: f.tenantId }, async (tx) => {
      const base = { departmentId: f.departmentId, reporterId: f.memberId };
      const [parent] = await tx
        .insert(s.tasks)
        .values({ ...base, title: 'والد' })
        .returning({ id: s.tasks.id });
      if (!parent) throw new Error('insert failed');
      await tx.insert(s.tasks).values([
        { ...base, title: 'الف', parentId: parent.id, progress: 50, weight: 1 },
        {
          ...base,
          title: 'ب',
          parentId: parent.id,
          statusCategory: 'done',
          statusKey: 'done',
          weight: 3,
        },
        {
          ...base,
          title: 'ج',
          parentId: parent.id,
          statusCategory: 'canceled',
          statusKey: 'canceled',
          weight: 5,
        },
      ]);
      return parent.id;
    });
    await owner.db.execute(sql.raw(backfill));
    const [row] = await withTenant(app.db, { tenantId: f.tenantId }, (tx) =>
      tx.select({ progress: s.tasks.progress }).from(s.tasks).where(eq(s.tasks.id, parentId)),
    );
    // (50×1 + 100×3) / 4 = 87.5 → 90
    expect(row?.progress).toBe(90);
  });
});
