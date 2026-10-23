import { calendarDateIn, type Task, type Today } from '@madar/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, hasDatabase, memberSession, ownerSession, type Client } from './helpers.js';

interface Person {
  c: Client;
  memberId: string;
}

describe.skipIf(!hasDatabase)('task source, priority and personal order', () => {
  let app: NestExpressApplication;
  let owner: Client;
  let ceo: Person;
  let head: Person;
  let lead: Person;
  let ali: Person;
  let zahra: Person;
  let marketer: Person;
  let other: Client;
  let support: { id: string };
  let marketing: { id: string };
  const today = calendarDateIn(new Date(), 'Asia/Tehran');

  const create = async (c: Client, body: object): Promise<Task> => {
    const res = await c.post('/api/tasks', body);
    if (res.status !== 201) throw new Error(`create failed: ${res.status} ${res.text}`);
    return res.body;
  };
  const mine = async (c: Client, query = ''): Promise<Task[]> =>
    (await c.get(`/api/tasks?view=mine${query}`)).body;

  beforeAll(async () => {
    let env;
    ({ app, env } = await createTestApp());
    owner = (await ownerSession(app, env)).c;
    support = (await owner.post('/api/departments', { name: 'پشتیبانی' })).body;
    marketing = (await owner.post('/api/departments', { name: 'مارکتینگ' })).body;
    const management = (await owner.post('/api/departments', { name: 'مدیریت' })).body;
    const dept = (id: string, deptRole = 'member') => [
      { departmentId: id, deptRole, isPrimary: true },
    ];
    // A management chain: ali → lead → head → ceo (who has no manager above).
    ceo = await memberSession(app, env, owner, {
      roles: ['executive'],
      departments: dept(management.id),
      displayName: 'لیلا صادقی',
    });
    head = await memberSession(app, env, owner, {
      departments: dept(support.id, 'head'),
      managerId: ceo.memberId,
      displayName: 'مریم احمدی',
    });
    lead = await memberSession(app, env, owner, {
      departments: dept(support.id),
      managerId: head.memberId,
    });
    ali = await memberSession(app, env, owner, {
      departments: dept(support.id),
      managerId: lead.memberId,
      displayName: 'علی رضایی',
    });
    zahra = await memberSession(app, env, owner, {
      departments: dept(support.id),
      managerId: head.memberId,
      displayName: 'زهرا محمدی',
    });
    marketer = await memberSession(app, env, owner, { departments: dept(marketing.id) });
    other = (await ownerSession(app, env)).c;
  });
  afterAll(() => app?.close());

  it('decides the source once, from who set the first assignee', async () => {
    const own = await create(ali.c, { title: 'کار شخصی' });
    expect(own.source).toMatchObject({ kind: 'personal', ceo: false });

    const fromLead = await create(lead.c, { title: 'از سرپرست', assigneeId: ali.memberId });
    expect(fromLead.source).toMatchObject({
      kind: 'assigned',
      ceo: false,
      by: { id: lead.memberId },
    });

    // The department head is above everyone in the department, also without being the manager.
    const fromHead = await create(head.c, { title: 'از مدیر', assigneeId: zahra.memberId });
    expect(fromHead.source?.kind).toBe('assigned');

    const fromCeo = await create(ceo.c, { title: 'از مدیرعامل', assigneeId: ali.memberId });
    expect(fromCeo.source).toMatchObject({
      kind: 'assigned',
      ceo: true,
      by: { displayName: 'لیلا صادقی' },
    });

    // A colleague asks for help inside a shared project (outside one only managers assign, 17a).
    const shared = (
      await head.c.post('/api/projects', { name: 'پروژه مشترک', departmentId: support.id })
    ).body;
    const fromColleague = await create(zahra.c, {
      title: 'درخواست',
      assigneeId: ali.memberId,
      projectId: shared.id,
    });
    expect(fromColleague.source).toMatchObject({ kind: 'request', by: { id: zahra.memberId } });

    // No assignee: no source until the first one; reassigning later keeps it.
    const open = await create(lead.c, { title: 'بدون مسئول', assigneeId: null });
    expect(open.source).toBeNull();
    const assigned = (
      await lead.c.patch(`/api/tasks/${open.id}`, {
        assigneeId: ali.memberId,
        version: open.version,
      })
    ).body as Task;
    expect(assigned.source).toMatchObject({ kind: 'assigned', by: { id: lead.memberId } });
    const moved = (
      await head.c.patch(`/api/tasks/${open.id}`, {
        assigneeId: zahra.memberId,
        version: assigned.version,
      })
    ).body as Task;
    expect(moved.source).toMatchObject({ kind: 'assigned', by: { id: lead.memberId } });
  });

  it('ranks by priority with reasons, and filters by source', async () => {
    const urgent = await create(ceo.c, {
      title: 'ابلاغ امروز',
      assigneeId: ali.memberId,
      dueOn: today,
    });
    expect(urgent.rank.reasons).toEqual(['due.today', 'source.ceo']);

    const list = await mine(ali.c);
    expect(list[0]?.id).toBe(urgent.id);
    const scores = list.map((t) => t.rank.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));

    const requests = await mine(ali.c, '&source=request');
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((t) => t.source?.kind === 'request')).toBe(true);
  });

  it('keeps each member their own order of «my tasks», with new work slotted by priority', async () => {
    const before = await mine(ali.c);
    const reversed = [...before].reverse().map((t) => t.id);
    expect((await ali.c.put('/api/me/task-order', { taskIds: reversed })).status).toBe(200);
    expect((await mine(ali.c)).map((t) => t.id)).toEqual(reversed);

    // A new urgent task from the CEO goes before the first lower-priority task of the order.
    const fresh = await create(ceo.c, {
      title: 'ابلاغ فوری تازه',
      assigneeId: ali.memberId,
      dueOn: today,
      priority: 'urgent',
    });
    const after = await mine(ali.c);
    expect(after[0]?.id).toBe(fresh.id);
    expect(after.slice(1).map((t) => t.id)).toEqual(reversed);

    // Nobody else sees or changes it; tasks the member cannot see are refused.
    expect((await zahra.c.get('/api/me/task-order')).body.taskIds).toEqual([]);
    const hidden = await create(marketer.c, { title: 'کار مارکتینگ' });
    expect((await ali.c.put('/api/me/task-order', { taskIds: [hidden.id] })).status).toBe(404);

    expect((await ali.c.delete('/api/me/task-order')).status).toBe(204);
    expect((await ali.c.get('/api/me/task-order')).body.taskIds).toEqual([]);
    const auto = (await mine(ali.c)).map((t) => t.rank.score);
    expect(auto).toEqual([...auto].sort((a, b) => b - a));
  });

  it('orders today by priority until the member orders it by hand', async () => {
    const low = await create(ali.c, { title: 'کار کم‌اهمیت', priority: 'low' });
    const high = await create(ali.c, { title: 'کار مهم', priority: 'high', dueOn: today });
    await ali.c.post(`/api/today/items/${low.id}`);
    let plan: Today = (await ali.c.post(`/api/today/items/${high.id}`)).body;
    expect(plan.items.map((t) => t.id)).toEqual([high.id, low.id]);
    expect(plan.ordered).toBe(false);

    plan = (await ali.c.put('/api/today/items', { taskIds: [low.id, high.id] })).body;
    expect(plan.items.map((t) => t.id)).toEqual([low.id, high.id]);
    expect(plan.ordered).toBe(true);

    const urgent = await create(ali.c, { title: 'فوری امروز', priority: 'urgent', dueOn: today });
    plan = (await ali.c.post(`/api/today/items/${urgent.id}`)).body;
    expect(plan.items.map((t) => t.id)).toEqual([urgent.id, low.id, high.id]);

    plan = (await ali.c.post('/api/today/auto-order')).body;
    expect(plan.ordered).toBe(false);
    expect(plan.items.map((t) => t.id)).toEqual([urgent.id, high.id, low.id]);
  });

  it('lists open work by score and finished work after it, and keeps unseen order', async () => {
    const old = await create(ali.c, { title: 'کار قدیمی تمام‌شده', dueOn: '2026-01-01' });
    await ali.c.patch(`/api/tasks/${old.id}`, { statusKey: 'done', version: old.version });
    const all = await mine(ali.c, '&status=all');
    const firstDone = all.findIndex((t) => t.statusCategory === 'done');
    expect(firstDone).toBeGreaterThan(0);
    expect(all.slice(firstDone).every((t) => t.statusCategory === 'done')).toBe(true);
    expect(all[firstDone]?.id).toBe(old.id);

    // Saving the order of two tasks keeps the rest of the earlier order after them.
    const ids = (await mine(ali.c)).map((t) => t.id);
    await ali.c.put('/api/me/task-order', { taskIds: ids });
    const [a, b] = ids;
    const saved = (await ali.c.put('/api/me/task-order', { taskIds: [b, a] })).body.taskIds;
    expect(saved).toEqual([b, a, ...ids.slice(2)]);
    await ali.c.delete('/api/me/task-order');
  });

  it('lets only the owner change the weights, with an audit entry', async () => {
    const defaults = (await ali.c.get('/api/settings/priority')).body;
    expect(defaults).toEqual({ due: 40, priority: 25, source: 20, keyResult: 10, weight: 5 });
    const sourceFirst = { due: 0, priority: 0, source: 100, keyResult: 0, weight: 0 };
    expect((await ali.c.put('/api/settings/priority', sourceFirst)).status).toBe(403);
    expect((await owner.put('/api/settings/priority', { ...sourceFirst, due: 101 })).status).toBe(
      400,
    );
    expect((await owner.put('/api/settings/priority', sourceFirst)).status).toBe(200);
    expect((await ali.c.get('/api/settings/priority')).body).toEqual(sourceFirst);

    const list = await mine(ali.c);
    expect(list[0]?.source?.ceo).toBe(true);
    const audit = (await owner.get('/api/audit-logs')).body as Array<{ action: string }>;
    expect(audit.map((a) => a.action)).toContain('priority_weights.updated');
  });

  it('keeps companies apart', async () => {
    expect((await other.get('/api/settings/priority')).body.source).toBe(20);
    const theirs = (await mine(ali.c))[0];
    expect((await other.put('/api/me/task-order', { taskIds: [theirs?.id] })).status).toBe(404);
    expect((await other.get('/api/tasks?view=visible&source=assigned')).body).toEqual([]);
  });
});
