import { schema as s, withTenant, type DbHandle } from '@madar/db';
import {
  addDays,
  calendarDateIn,
  persianWeekdayOfCalendarDate,
  zonedInstant,
  type GoalDetail,
  type GoalPeriod,
  type GoalSummary,
} from '@madar/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_HANDLE } from '../src/database/tokens.js';
import { RemindersService } from '../src/notifications/reminders.service.js';
import { Notifier } from '../src/notifications/notifier.js';
import { createTestApp, hasDatabase, memberSession, ownerSession, type Client } from './helpers.js';

interface Person {
  c: Client;
  memberId: string;
}

describe.skipIf(!hasDatabase)('goals', () => {
  let app: NestExpressApplication;
  let handle: DbHandle;
  let tenantId: string;
  let owner: Client;
  let ceo: Person; // executive role
  let head: Person; // support head
  let agent: Person; // support member
  let colleague: Person; // support member
  let marketer: Person; // marketing member
  let director: Person; // management (oversight on goals)
  let support: { id: string };
  let marketing: { id: string };
  let period: GoalPeriod;
  let other: { c: Client; period: GoalPeriod }; // another company

  const kr = (title: string, targetValue = 100, startValue = 0) => ({
    title,
    kind: 'number' as const,
    startValue,
    targetValue,
  });
  const create = (c: Client, body: object) =>
    c.post('/api/goals', { periodId: period.id, ...body });
  const ids = (goals: GoalSummary[]) => goals.map((g) => g.id);

  beforeAll(async () => {
    let env;
    ({ app, env } = await createTestApp());
    handle = app.get<DbHandle>(DB_HANDLE);
    const session = await ownerSession(app, env);
    owner = session.c;
    tenantId = session.tenantId;
    support = (await owner.post('/api/departments', { name: 'پشتیبانی' })).body;
    marketing = (await owner.post('/api/departments', { name: 'مارکتینگ' })).body;
    const management = (await owner.post('/api/departments', { name: 'مدیریت' })).body;
    await owner.put(`/api/departments/${management.id}/oversight`, { resources: ['goal'] });
    const dept = (departmentId: string, deptRole = 'member') => [
      { departmentId, deptRole, isPrimary: true },
    ];
    ceo = await memberSession(app, env, owner, {
      roles: ['executive'],
      departments: dept(management.id),
    });
    head = await memberSession(app, env, owner, { departments: dept(support.id, 'head') });
    agent = await memberSession(app, env, owner, { departments: dept(support.id) });
    colleague = await memberSession(app, env, owner, { departments: dept(support.id) });
    marketer = await memberSession(app, env, owner, { departments: dept(marketing.id) });
    director = await memberSession(app, env, owner, { departments: dept(management.id) });
    const periods: GoalPeriod[] = (await agent.c.get('/api/goal-periods')).body;
    period = periods.find((p) => p.current) as GoalPeriod;

    const second = await ownerSession(app, env);
    const otherPeriods: GoalPeriod[] = (await second.c.get('/api/goal-periods')).body;
    other = { c: second.c, period: otherPeriods.find((p) => p.current) as GoalPeriod };
  });
  afterAll(() => app?.close());

  it('creates the current and next Jalali season on demand', async () => {
    const periods: GoalPeriod[] = (await agent.c.get('/api/goal-periods')).body;
    expect(periods.length).toBeGreaterThanOrEqual(2);
    expect(periods.filter((p) => p.current)).toHaveLength(1);
  });

  let company: GoalDetail;
  let department: GoalDetail;
  let personal: GoalDetail;

  it('lets only goal.manage create company goals', async () => {
    expect((await create(head.c, { level: 'company', title: 'رشد' })).status).toBe(403);
    const res = await create(ceo.c, {
      level: 'company',
      title: 'رسیدن به ۵۰ هزار کاربر فعال',
      keyResults: [kr('کاربر فعال ماهانه', 50_000, 20_000)],
    });
    expect(res.status).toBe(201);
    company = res.body;
    expect(company.department).toBeNull();
    expect(company.keyResults[0]).toMatchObject({ currentValue: 20_000, progress: 0 });
  });

  it('lets the head create department goals aligned to a company goal', async () => {
    expect(
      (await create(agent.c, { level: 'department', departmentId: support.id, title: 'x' })).status,
    ).toBe(403);
    const res = await create(head.c, {
      level: 'department',
      departmentId: support.id,
      parentId: company.id,
      title: 'پاسخ سریع‌تر به تیکت‌ها',
      keyResults: [
        kr('میانگین زمان پاسخ (ساعت)', 4, 24),
        { title: 'راه‌اندازی چت', kind: 'boolean' },
      ],
    });
    expect(res.status).toBe(201);
    department = res.body;
    expect(department.parent).toEqual({ id: company.id, title: company.title });
  });

  it('lets a member create a personal goal in their department, aligned one level up', async () => {
    // A personal goal cannot hang under another personal goal or skip into another period.
    const res = await create(agent.c, {
      level: 'individual',
      departmentId: support.id,
      parentId: department.id,
      title: 'یادگیری ابزار جدید پشتیبانی',
      keyResults: [{ title: 'دوره آموزشی', kind: 'percent' }],
    });
    expect(res.status).toBe(201);
    personal = res.body;
    const bad = await create(agent.c, {
      level: 'individual',
      departmentId: support.id,
      parentId: personal.id,
      title: 'x',
    });
    expect(bad.status).toBe(400);
    // Not for someone else, and not in a department they are not in.
    expect(
      (
        await create(agent.c, {
          level: 'individual',
          departmentId: support.id,
          ownerId: colleague.memberId,
          title: 'x',
        })
      ).status,
    ).toBe(403);
    expect(
      (await create(agent.c, { level: 'individual', departmentId: marketing.id, title: 'x' }))
        .status,
    ).toBe(403);
  });

  it('shows each level only to the people the rules name', async () => {
    const view = async (p: Person, v = 'company') =>
      ids((await p.c.get(`/api/goals?view=${v}`)).body as GoalSummary[]);
    // Company goals: everyone.
    for (const p of [agent, colleague, marketer, director])
      expect(await view(p)).toContain(company.id);
    // Department goal: its department and oversight, not marketing.
    expect(await view(colleague)).toContain(department.id);
    expect(await view(director)).toContain(department.id);
    expect(await view(marketer)).not.toContain(department.id);
    expect((await marketer.c.get(`/api/goals/${department.id}`)).status).toBe(404);
    // Personal goal: owner, the head, oversight and the CEO; not a colleague.
    expect(await view(agent, 'mine')).toEqual([personal.id]);
    expect(await view(head, 'department')).toContain(personal.id);
    expect(await view(director)).toContain(personal.id);
    expect(await view(ceo)).toContain(personal.id);
    expect(await view(colleague)).not.toContain(personal.id);
    expect((await colleague.c.get(`/api/goals/${personal.id}`)).status).toBe(404);
  });

  it('never leaks a personal goal to a peer through other paths', async () => {
    // Department detail: child count, children and options hide the personal goal from a colleague.
    const forColleague: GoalDetail = (await colleague.c.get(`/api/goals/${department.id}`)).body;
    expect(forColleague.children.map((g) => g.id)).not.toContain(personal.id);
    expect(forColleague.childCount).toBe(0);
    const forHead: GoalDetail = (await head.c.get(`/api/goals/${department.id}`)).body;
    expect(forHead.childCount).toBe(1);
    const options = (await colleague.c.get('/api/key-results')).body as { id: string }[];
    expect(options.map((o) => o.id)).not.toContain(personal.keyResults[0]?.id);
    // A task the colleague can see, linked to the personal key result, shows no link to them.
    const task = (await agent.c.post('/api/tasks', { title: 'کار مشترک دپارتمان' })).body;
    const linked = await agent.c.patch(`/api/tasks/${task.id}`, {
      version: task.version,
      keyResultId: personal.keyResults[0]?.id,
    });
    expect(linked.body.keyResult?.id).toBe(personal.keyResults[0]?.id);
    const seen = (await colleague.c.get(`/api/tasks/${task.id}`)).body;
    expect(seen.keyResult).toBeNull();
    // And nobody but its editors archives it.
    expect((await colleague.c.post(`/api/goals/${personal.id}/archive`)).status).toBe(404);
    expect(
      (await marketer.c.post(`/api/key-results/${department.keyResults[0]?.id}/archive`)).status,
    ).toBe(404);
    expect((await colleague.c.post(`/api/goals/${department.id}/archive`)).status).toBe(403);
  });

  it('rolls check-ins up the chain to the company goal', async () => {
    const [time, chat] = department.keyResults;
    // 24 h → 14 h is half way on a decreasing target; the colleague may not check in.
    expect(
      (
        await colleague.c.post(`/api/key-results/${time?.id}/check-ins`, {
          value: 14,
          status: 'at_risk',
        })
      ).status,
    ).toBe(403);
    const res = await head.c.post(`/api/key-results/${time?.id}/check-ins`, {
      value: 14,
      status: 'at_risk',
      note: 'تیم شب اضافه شد',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ value: 14, status: 'at_risk', note: 'تیم شب اضافه شد' });
    const goal: GoalDetail = (await head.c.get(`/api/goals/${department.id}`)).body;
    // Two key results (0.5 and 0) and one personal child goal (0): (0.5 + 0 + 0) / 3.
    expect(goal.progress).toBeCloseTo(1 / 6);
    expect(goal.status).toBe('at_risk');
    // The company goal: its own key result (0) and one child (1/6).
    const top: GoalDetail = (await agent.c.get(`/api/goals/${company.id}`)).body;
    expect(top.progress).toBeCloseTo(1 / 12);
    expect(top.childCount).toBe(1);
    // Done/not done takes 0 or 1 only.
    expect(
      (
        await head.c.post(`/api/key-results/${chat?.id}/check-ins`, {
          value: 5,
          status: 'on_track',
        })
      ).status,
    ).toBe(400);
    const history = (await agent.c.get(`/api/key-results/${time?.id}/check-ins`)).body;
    expect(history).toHaveLength(1);
  });

  it('records goal.completed once, the first time a goal reaches 100 %', async () => {
    const goal = (
      await create(agent.c, {
        level: 'individual',
        departmentId: support.id,
        title: 'هدف کوچک',
        keyResults: [{ title: 'انجام شد', kind: 'boolean' }],
      })
    ).body as GoalDetail;
    const krId = goal.keyResults[0]?.id;
    for (const value of [1, 0, 1]) {
      await agent.c.post(`/api/key-results/${krId}/check-ins`, { value, status: 'on_track' });
    }
    const events = await withTenant(handle.db, { tenantId }, (tx) =>
      tx
        .select()
        .from(s.domainEvents)
        .where(and(eq(s.domainEvents.type, 'goal.completed'))),
    );
    expect(events.filter((e) => e.payload.goalId === goal.id)).toHaveLength(1);
    const checkins = await withTenant(handle.db, { tenantId }, (tx) =>
      tx.select().from(s.domainEvents).where(eq(s.domainEvents.type, 'key_result.checked_in')),
    );
    expect(checkins.filter((e) => e.payload.goalId === goal.id)).toHaveLength(3);
  });

  it('archiving a child takes it out of the parent’s progress', async () => {
    const child = (
      await create(head.c, {
        level: 'department',
        departmentId: support.id,
        parentId: company.id,
        title: 'هدف موقت',
        keyResults: [{ title: 'تمام', kind: 'boolean' }],
      })
    ).body as GoalDetail;
    await head.c.post(`/api/key-results/${child.keyResults[0]?.id}/check-ins`, {
      value: 1,
      status: 'on_track',
    });
    const before: GoalDetail = (await ceo.c.get(`/api/goals/${company.id}`)).body;
    expect((await head.c.post(`/api/goals/${child.id}/archive`)).status).toBe(204);
    const after: GoalDetail = (await ceo.c.get(`/api/goals/${company.id}`)).body;
    expect(after.progress).toBeLessThan(before.progress);
    expect(after.children.map((g) => g.id)).not.toContain(child.id);
  });

  it('keeps archived goals out of the tree and unchanged', async () => {
    const parent = (
      await create(head.c, { level: 'department', departmentId: support.id, title: 'والد موقت' })
    ).body as GoalDetail;
    const child = (
      await create(agent.c, {
        level: 'individual',
        departmentId: support.id,
        parentId: parent.id,
        title: 'فرزند',
        keyResults: [{ title: 'تمام', kind: 'boolean' }],
      })
    ).body as GoalDetail;
    // A goal with active children cannot be archived.
    const blocked = await head.c.post(`/api/goals/${parent.id}/archive`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('goal_has_children');
    expect((await agent.c.post(`/api/goals/${child.id}/archive`)).status).toBe(204);
    expect((await head.c.post(`/api/goals/${parent.id}/archive`)).status).toBe(204);
    // Archived: no edits, no key results, no check-ins.
    const edit = await head.c.patch(`/api/goals/${parent.id}`, { title: 'x' });
    expect(edit.body.error.code).toBe('goal_archived');
    expect(
      (
        await agent.c.post(`/api/key-results/${child.keyResults[0]?.id}/check-ins`, {
          value: 1,
          status: 'on_track',
        })
      ).status,
    ).toBe(409);
    const audit = await withTenant(handle.db, { tenantId }, (tx) =>
      tx.select().from(s.auditLogs).where(eq(s.auditLogs.subjectId, parent.id)),
    );
    expect(audit.map((a) => a.action)).toContain('goal.archived');
  });

  it('links tasks to key results the editor can see, and shows them under the goal', async () => {
    const krId = department.keyResults[0]?.id as string;
    const task = (await agent.c.post('/api/tasks', { title: 'مستندسازی پاسخ‌ها' })).body;
    const linked = await agent.c.patch(`/api/tasks/${task.id}`, {
      version: task.version,
      keyResultId: krId,
    });
    expect(linked.status).toBe(200);
    expect(linked.body.keyResult).toMatchObject({ id: krId, goal: { id: department.id } });
    const goal: GoalDetail = (await head.c.get(`/api/goals/${department.id}`)).body;
    expect(goal.tasks.map((t) => t.id)).toContain(task.id);
    expect(goal.keyResults[0]?.linked.tasks.total).toBe(1);
    // A marketer cannot link to a support key result they cannot see.
    const mine = (await marketer.c.post('/api/tasks', { title: 'کمپین' })).body;
    expect(
      (
        await marketer.c.patch(`/api/tasks/${mine.id}`, {
          version: mine.version,
          keyResultId: krId,
        })
      ).status,
    ).toBe(404);
    // The options list only offers visible key results.
    const options = (await marketer.c.get('/api/key-results')).body as { id: string }[];
    expect(options.map((o) => o.id)).not.toContain(krId);
  });

  it('reminds goal owners weekly when key results go a week without a check-in', async () => {
    // Make the personal goal weeks old; its key result has never been checked in.
    await withTenant(handle.db, { tenantId }, (tx) =>
      tx
        .update(s.goals)
        .set({ createdAt: new Date(Date.now() - 20 * 24 * 60 * 60_000) })
        .where(eq(s.goals.id, personal.id)),
    );
    const reminders = new RemindersService(handle, new Notifier());
    // 10:00 Tehran today, or tomorrow (Saturday) when today is a Friday: a working morning.
    let day = calendarDateIn(new Date(), 'Asia/Tehran');
    if (persianWeekdayOfCalendarDate(day) === 6) day = addDays(day, 1);
    const morning = zonedInstant(day, '10:00', 'Asia/Tehran');
    await reminders.runForTenant(tenantId, morning);
    await reminders.runForTenant(tenantId, new Date(morning.getTime() + 60 * 60_000));
    const rows = await withTenant(handle.db, { tenantId }, (tx) =>
      tx
        .select()
        .from(s.notifications)
        .where(
          and(
            eq(s.notifications.kind, 'key_result_checkin_due'),
            eq(s.notifications.subjectId, personal.id),
          ),
        ),
    );
    // Within the season: exactly one, for the owner. (Near a season's last days it may not apply.)
    if (day <= period.endOn) {
      expect(rows).toHaveLength(1);
      expect(rows[0]?.recipientId).toBe(agent.memberId);
      expect(rows[0]?.subjectType).toBe('goal');
    }
    // A goal checked in this week is not nagged.
    expect(
      rows.filter((r) => r.subjectId === department.id || r.subjectId === company.id),
    ).toHaveLength(0);
  });

  it('keeps companies apart', async () => {
    // Company B sees none of A's goals and cannot touch them.
    const theirs = (await other.c.get('/api/goals?view=company')).body as GoalSummary[];
    expect(ids(theirs)).not.toContain(company.id);
    expect((await other.c.get(`/api/goals/${company.id}`)).status).toBe(404);
    expect(
      (
        await other.c.post(`/api/key-results/${company.keyResults[0]?.id}/check-ins`, {
          value: 1,
          status: 'on_track',
        })
      ).status,
    ).toBe(404);
    // B cannot hang a goal under A's goal or use A's period.
    expect(
      (
        await other.c.post('/api/goals', {
          periodId: other.period.id,
          level: 'company',
          title: 'x',
          parentId: company.id,
        })
      ).status,
    ).toBe(404);
    expect(
      (await other.c.post('/api/goals', { periodId: period.id, level: 'company', title: 'x' }))
        .status,
    ).toBe(404);
    // B cannot link its task to A's key result.
    const dept = (await other.c.post('/api/departments', { name: 'فروش' })).body;
    const task = (await other.c.post('/api/tasks', { title: 'x', departmentId: dept.id })).body;
    expect(
      (
        await other.c.patch(`/api/tasks/${task.id}`, {
          version: task.version,
          keyResultId: company.keyResults[0]?.id,
        })
      ).status,
    ).toBe(404);
  });
});
