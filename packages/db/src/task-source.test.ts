import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from './client.js';
import * as s from './schema/index.js';
import { uuidv7 } from './schema/columns.js';
import { withTenant } from './tenant.js';
import { appDb, createTenantFixture, hasDatabase, ownerDb } from './test/fixtures.js';

// The backfill of migration 0013 (ADR 0017): the last statement of the file.
const backfill =
  readFileSync(resolve(import.meta.dirname, '../drizzle/0013_task_source.sql'), 'utf8')
    .split('--> statement-breakpoint')
    .at(-1) ?? '';

describe.skipIf(!hasDatabase)('task source backfill (migration 0013)', () => {
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

  it('applies the shared rule to existing tasks', async () => {
    const f = await createTenantFixture(app, 'src');
    const ids = await withTenant(app.db, { tenantId: f.tenantId }, async (tx) => {
      const person = async (name: string, managerId?: string) => {
        const [user] = await tx
          .insert(s.users)
          .values({ name, email: `${uuidv7()}@users.madar.invalid`, username: `u.${uuidv7()}` })
          .returning({ id: s.users.id });
        const [member] = await tx
          .insert(s.members)
          .values({ userId: user?.id ?? '', displayName: name, managerId })
          .returning({ id: s.members.id });
        return member?.id ?? '';
      };
      const ceo = await person('ceo');
      const [executive] = await tx
        .insert(s.roles)
        .values({ key: 'executive', name: 'Executive', isSystem: true })
        .returning({ id: s.roles.id });
      await tx.insert(s.memberRoles).values({ memberId: ceo, roleId: executive?.id ?? '' });
      const worker = await person('worker', ceo);
      const colleague = await person('colleague');
      const task = async (reporterId: string, assigneeId: string | null) => {
        const [row] = await tx
          .insert(s.tasks)
          .values({ title: 't', departmentId: f.departmentId, reporterId, assigneeId })
          .returning({ id: s.tasks.id });
        return row?.id ?? '';
      };
      return {
        personal: await task(worker, worker),
        ceo: await task(ceo, worker),
        // The fixture member heads the task's department.
        head: await task(f.memberId, worker),
        request: await task(colleague, worker),
        unassigned: await task(worker, null),
      };
    });

    await owner.db.execute(sql.raw(backfill));
    const rows = await withTenant(app.db, { tenantId: f.tenantId }, (tx) =>
      tx
        .select({ id: s.tasks.id, source: s.tasks.source, ceo: s.tasks.sourceCeo })
        .from(s.tasks)
        .where(inArray(s.tasks.id, Object.values(ids))),
    );
    const of = (id: string) => rows.find((r) => r.id === id);
    expect(of(ids.personal)).toMatchObject({ source: 'personal', ceo: false });
    expect(of(ids.ceo)).toMatchObject({ source: 'assigned', ceo: true });
    expect(of(ids.head)).toMatchObject({ source: 'assigned', ceo: false });
    expect(of(ids.request)).toMatchObject({ source: 'request', ceo: false });
    expect(of(ids.unassigned)).toMatchObject({ source: null });
  });
});
