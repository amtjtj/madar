import { schema as s, withTenant, type DbHandle } from '@madar/db';
import { addDays, calendarDateIn } from '@madar/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Env } from '../src/config/env.js';
import { DB_HANDLE } from '../src/database/tokens.js';
import { createTestApp, hasDatabase, memberSession, ownerSession, type Client } from './helpers.js';

describe.skipIf(!hasDatabase)('today: daily plan and suggestions', () => {
  let app: NestExpressApplication;
  let env: Env;
  let tenantId: string;
  let me: { c: Client; memberId: string };
  let other: { c: Client; memberId: string };
  // The tenant's default time zone is Asia/Tehran.
  const today = calendarDateIn(new Date(), 'Asia/Tehran');

  const create = async (body: object) => (await me.c.post('/api/tasks', body)).body;

  beforeAll(async () => {
    ({ app, env } = await createTestApp());
    const owner = await ownerSession(app, env);
    tenantId = owner.tenantId;
    const support = (await owner.c.post('/api/departments', { name: 'پشتیبانی' })).body;
    const marketing = (await owner.c.post('/api/departments', { name: 'بازاریابی' })).body;
    me = await memberSession(app, env, owner.c, {
      departments: [{ departmentId: support.id, deptRole: 'member', isPrimary: true }],
    });
    other = await memberSession(app, env, owner.c, {
      departments: [{ departmentId: marketing.id, deptRole: 'member', isPrimary: true }],
    });
  });
  afterAll(() => app?.close());

  it('starts empty, in the tenant-local day', async () => {
    const res = await me.c.get('/api/today');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ date: today, items: [], progress: { done: 0, total: 0 } });
  });

  it('suggests overdue, due-today and in-progress work, and yesterday’s unfinished plan', async () => {
    const overdue = await create({ title: 'عقب‌افتاده', dueOn: addDays(today, -2) });
    const dueToday = await create({ title: 'سررسید امروز', dueOn: today });
    const doing = await create({ title: 'در حال انجام', statusKey: 'in_progress' });
    const later = await create({ title: 'هفته بعد', dueOn: addDays(today, 7) });
    const leftover = await create({ title: 'مانده از دیروز', dueOn: addDays(today, 3) });

    const handle = app.get<DbHandle>(DB_HANDLE);
    await withTenant(handle.db, { tenantId }, (tx) =>
      tx.insert(s.dailyPlanItems).values({
        memberId: me.memberId,
        planDate: addDays(today, -1),
        taskId: leftover.id,
        sortKey: 'a0',
      }),
    );

    const res = await me.c.get('/api/today');
    const reasons = Object.fromEntries(
      res.body.suggestions.map((s: { reason: string; task: { id: string } }) => [
        s.task.id,
        s.reason,
      ]),
    );
    expect(reasons).toEqual({
      [leftover.id]: 'from_yesterday',
      [overdue.id]: 'overdue',
      [dueToday.id]: 'due_today',
      [doing.id]: 'in_progress',
    });
    expect(reasons[later.id]).toBeUndefined();
    // Never moved automatically.
    expect(res.body.items).toEqual([]);
  });

  it('adds, completes, reorders and removes items with live progress', async () => {
    const a = await create({ title: 'کار الف' });
    const b = await create({ title: 'کار ب' });

    await me.c.post(`/api/today/items/${a.id}`);
    const added = await me.c.post(`/api/today/items/${b.id}`);
    expect(added.status).toBe(201);
    expect(added.body.items.map((t: { id: string }) => t.id)).toEqual([a.id, b.id]);
    expect(added.body.progress).toEqual({ done: 0, total: 2 });
    // A planned task is no longer suggested.
    expect(added.body.suggestions.map((s: { task: { id: string } }) => s.task.id)).not.toContain(
      a.id,
    );

    await me.c.post(`/api/tasks/${a.id}/move`, { statusKey: 'done' });
    expect((await me.c.get('/api/today')).body.progress).toEqual({ done: 1, total: 2 });

    const reordered = await me.c.put('/api/today/items', { taskIds: [b.id, a.id] });
    expect(reordered.body.items.map((t: { id: string }) => t.id)).toEqual([b.id, a.id]);

    const removed = await me.c.delete(`/api/today/items/${b.id}`);
    expect(removed.body.items.map((t: { id: string }) => t.id)).toEqual([a.id]);
  });

  it('adds tasks created with addToToday and drops deleted ones', async () => {
    const task = await create({ title: 'فوری', addToToday: true });
    expect((await me.c.get('/api/today')).body.items.map((t: { id: string }) => t.id)).toContain(
      task.id,
    );
    await me.c.delete(`/api/tasks/${task.id}`);
    expect(
      (await me.c.get('/api/today')).body.items.map((t: { id: string }) => t.id),
    ).not.toContain(task.id);
  });

  it('refuses tasks the member cannot see', async () => {
    const hidden = (await other.c.post('/api/tasks', { title: 'کار بازاریابی' })).body;
    expect((await me.c.post(`/api/today/items/${hidden.id}`)).status).toBe(404);
    expect((await me.c.put('/api/today/items', { taskIds: [hidden.id] })).status).toBe(404);
  });
});
