import { schema as s, withTenant, type DbHandle } from '@madar/db';
import {
  addDays,
  calendarDateIn,
  weekStartOf,
  zonedInstant,
  type WeeklyReport,
} from '@madar/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_HANDLE } from '../src/database/tokens.js';
import { Notifier } from '../src/notifications/notifier.js';
import { buildWeeklyReport } from '../src/reports/builder.js';
import { WeeklyReportsJob } from '../src/reports/weekly-job.js';
import { createTestApp, hasDatabase, memberSession, ownerSession, type Client } from './helpers.js';

interface Person {
  c: Client;
  memberId: string;
}

describe.skipIf(!hasDatabase)('weekly reports', () => {
  let app: NestExpressApplication;
  let handle: DbHandle;
  let tenantId: string;
  let owner: Client;
  let ownerMemberId: string;
  let ceo: Person;
  let director: Person; // oversight department, no executive role
  let head: Person;
  let agent: Person;
  let marketingHead: Person;
  let support: { id: string };
  let other: Client;
  let otherTenantId: string;
  let companyGoalId: string;
  const today = calendarDateIn(new Date(), 'Asia/Tehran');
  const thisWeek = weekStartOf(today);

  const task = (c: Client, body: object) =>
    c.post('/api/tasks', body).then((r) => r.body as { id: string; version: number });
  const report = (c: Client, query: string) => c.get(`/api/reports/weekly?${query}`);

  beforeAll(async () => {
    let env;
    ({ app, env } = await createTestApp());
    handle = app.get<DbHandle>(DB_HANDLE);
    const session = await ownerSession(app, env);
    owner = session.c;
    tenantId = session.tenantId;
    ownerMemberId = (await owner.get('/api/me')).body.member.id;
    support = (await owner.post('/api/departments', { name: 'پشتیبانی' })).body;
    const marketing = (await owner.post('/api/departments', { name: 'مارکتینگ' })).body;
    const management = (await owner.post('/api/departments', { name: 'مدیریت' })).body;
    const office = (await owner.post('/api/departments', { name: 'دفتر' })).body;
    await owner.put(`/api/departments/${office.id}/oversight`, { resources: ['task', 'goal'] });
    const dept = (id: string, deptRole = 'member') => [
      { departmentId: id, deptRole, isPrimary: true },
    ];
    ceo = await memberSession(app, env, owner, {
      roles: ['executive'],
      departments: dept(management.id),
    });
    director = await memberSession(app, env, owner, { departments: dept(office.id) });
    head = await memberSession(app, env, owner, { departments: dept(support.id, 'head') });
    agent = await memberSession(app, env, owner, {
      departments: dept(support.id),
      displayName: 'آرش',
    });
    marketingHead = await memberSession(app, env, owner, {
      departments: dept(marketing.id, 'head'),
    });

    // This week in support: two finished tasks (one heavy), one new open task.
    await task(head.c, {
      title: 'کار سنگین',
      assigneeId: agent.memberId,
      statusKey: 'done',
      weight: 5,
    });
    await task(head.c, { title: 'کار سبک', assigneeId: agent.memberId, statusKey: 'done' });
    await task(head.c, { title: 'کار باز', assigneeId: agent.memberId });
    // A private project's finished task never appears in a report.
    const secret = (
      await head.c.post('/api/projects', {
        name: 'محرمانه',
        departmentId: support.id,
        visibility: 'private',
      })
    ).body;
    await task(head.c, {
      title: 'کار محرمانه',
      projectId: secret.id,
      statusKey: 'done',
      weight: 5,
    });

    // Goals: a department goal moved this week under a company goal; a personal goal stays out.
    const periods = (await head.c.get('/api/goal-periods')).body as Array<{
      id: string;
      current: boolean;
    }>;
    const periodId = periods.find((p) => p.current)?.id;
    companyGoalId = (
      await ceo.c.post('/api/goals', { periodId, level: 'company', title: 'مشتری راضی‌تر' })
    ).body.id;
    const goal = (
      await head.c.post('/api/goals', {
        periodId,
        level: 'department',
        departmentId: support.id,
        parentId: companyGoalId,
        title: 'پاسخ سریع‌تر',
        keyResults: [{ title: 'زمان پاسخ', kind: 'number', startValue: 10, targetValue: 0 }],
      })
    ).body;
    await head.c.post(`/api/key-results/${goal.keyResults[0].id}/check-ins`, {
      value: 5,
      status: 'at_risk',
    });
    const personal = (
      await agent.c.post('/api/goals', {
        periodId,
        level: 'individual',
        departmentId: support.id,
        title: 'هدف شخصی',
        keyResults: [{ title: 'نتیجه شخصی', kind: 'number', startValue: 0, targetValue: 10 }],
      })
    ).body;
    await agent.c.post(`/api/key-results/${personal.keyResults[0].id}/check-ins`, {
      value: 4,
      status: 'on_track',
    });

    const otherSession = await ownerSession(app, env);
    other = otherSession.c;
    otherTenantId = otherSession.tenantId;
  });
  afterAll(() => app?.close());

  it('lets only the right people open a report', async () => {
    expect((await report(agent.c, 'scope=company')).status).toBe(403);
    expect((await report(head.c, 'scope=company')).status).toBe(403);
    expect(
      (await report(marketingHead.c, `scope=department&departmentId=${support.id}`)).status,
    ).toBe(403);
    expect((await report(head.c, `scope=department&departmentId=${support.id}`)).status).toBe(200);
    expect((await report(ceo.c, `scope=department&departmentId=${support.id}`)).status).toBe(200);
    expect((await report(director.c, 'scope=company')).status).toBe(200);
    expect((await report(director.c, `scope=department&departmentId=${support.id}`)).status).toBe(
      200,
    );
  });

  it('builds the running week live, without private work, personal goals or per-person counts', async () => {
    const r: WeeklyReport = (await report(ceo.c, 'scope=company')).body;
    expect(r).toMatchObject({ scope: 'company', weekStart: thisWeek, partial: true });
    expect(r.totals.done).toBe(2);
    expect(r.totals.created).toBe(3);
    expect(r.highlights[0]).toMatchObject({ title: 'کار سنگین', assignee: { displayName: 'آرش' } });
    expect(r.highlights.map((h) => h.title)).not.toContain('کار محرمانه');
    expect(r.goals.map((g) => g.title)).toEqual(['مشتری راضی‌تر', 'پاسخ سریع‌تر']);
    // The company goal moves with its child goal, as its stored progress does.
    expect(r.goals[0]?.change).toBeCloseTo(0.5);
    expect(r.goals[0]?.progress).toBeCloseTo(0.5);
    expect(r.goals[1]?.change).toBeCloseTo(0.5);
    expect(r.keyResults.map((kr) => kr.title)).toEqual(['زمان پاسخ']);
    expect(r.keyResults[0]).toMatchObject({
      title: 'زمان پاسخ',
      from: 10,
      to: 5,
      status: 'at_risk',
    });
    expect(r.departments.find((d) => d.id === support.id)).toMatchObject({ done: 2, created: 3 });
    // Nothing in the report counts people.
    expect(JSON.stringify(r)).not.toMatch(/"members?"|"workload"|"needsHelp"/);
    expect(JSON.stringify(r)).not.toContain('هدف شخصی');
    // Stuck work carries no names, even in the department report.
    const dept: WeeklyReport = (await report(head.c, `scope=department&departmentId=${support.id}`))
      .body;
    expect(dept.stuck.every((t) => !('assignee' in t))).toBe(true);
  });

  it('stores last week once on the first working morning and tells the right readers', async () => {
    // Next week's first working morning, 10:00 Tehran (Saturday is a working day by default).
    const morning = zonedInstant(addDays(thisWeek, 7), '10:00', 'Asia/Tehran');
    const job = new WeeklyReportsJob(handle, new Notifier());
    const first = await job.runForTenant(tenantId, morning);
    expect(first).toBeGreaterThanOrEqual(2); // company + each department
    expect(await job.runForTenant(tenantId, morning)).toBe(0);
    const before = await job.runForTenant(
      tenantId,
      zonedInstant(addDays(thisWeek, 7), '06:00', 'Asia/Tehran'),
    );
    expect(before).toBe(0);

    const rows = await withTenant(handle.db, { tenantId }, (tx) =>
      tx.select().from(s.weeklyReports).where(eq(s.weeklyReports.weekStart, thisWeek)),
    );
    const company = rows.find((r) => r.scope === 'company');
    expect((company?.data as unknown as WeeklyReport).totals.done).toBe(2);

    const notified = await withTenant(handle.db, { tenantId }, (tx) =>
      tx
        .select({ recipientId: s.notifications.recipientId, subjectId: s.notifications.subjectId })
        .from(s.notifications)
        .where(eq(s.notifications.kind, 'weekly_report_ready')),
    );
    const supportReport = rows.find((r) => r.departmentId === support.id);
    const to = (id: string) => notified.filter((n) => n.recipientId === id).map((n) => n.subjectId);
    expect(to(ceo.memberId)).toEqual([company?.id]);
    expect(to(ownerMemberId)).toContain(company?.id);
    expect(to(head.memberId)).toEqual([supportReport?.id]);
    expect(to(agent.memberId)).toEqual([]);
    expect(to(director.memberId)).toEqual([]); // may read, not notified (owner's decision)

    // The notifier itself refuses a report to someone who may not read it.
    const delivered = await withTenant(handle.db, { tenantId }, (tx) =>
      new Notifier().notify(tx, {
        tenantId,
        recipientId: marketingHead.memberId,
        actorId: null,
        kind: 'weekly_report_ready',
        subjectType: 'report',
        subjectId: supportReport?.id ?? '',
        payload: { title: 'پشتیبانی' },
        dedupeKey: 'test:denied',
        now: morning,
      }),
    );
    expect(delivered).toBe(false);
    // The report's link resolves only for its readers.
    expect((await head.c.get(`/api/reports/weekly/${supportReport?.id}/ref`)).body).toEqual({
      scope: 'department',
      departmentId: support.id,
      week: thisWeek,
    });
    expect((await marketingHead.c.get(`/api/reports/weekly/${supportReport?.id}/ref`)).status).toBe(
      403,
    );
  });

  it('serves a finished week from its snapshot and says when there is none', async () => {
    const lastWeek = addDays(thisWeek, -7);
    const snapshot = {
      ...(await report(ceo.c, 'scope=company')).body,
      weekStart: lastWeek,
      partial: false,
    };
    await withTenant(handle.db, { tenantId }, (tx) =>
      tx.insert(s.weeklyReports).values({ scope: 'company', weekStart: lastWeek, data: snapshot }),
    );
    const r = await report(ceo.c, `scope=company&week=${addDays(lastWeek, 3)}`);
    expect(r.body).toMatchObject({ weekStart: lastWeek, partial: false });
    expect((await report(ceo.c, `scope=company&week=${addDays(thisWeek, -21)}`)).status).toBe(404);
    expect((await report(ceo.c, `scope=company&week=${addDays(thisWeek, 7)}`)).status).toBe(400);
    const weeks = (await ceo.c.get('/api/reports/weekly/weeks?scope=company')).body as string[];
    expect(weeks[0]).toBe(thisWeek);
    expect(weeks).toContain(lastWeek);
  });

  it('counts a task finished at Friday 23:59 Tehran in the old week, 00:01 Saturday in the new', async () => {
    const build = (weekStart: string) =>
      withTenant(handle.db, { tenantId }, (tx) =>
        buildWeeklyReport(tx, { tenantId, scope: 'company', department: null, weekStart }),
      );
    const lastWeek = addDays(thisWeek, -7);
    const [beforeLast, beforeThis] = [
      (await build(lastWeek)).totals.done,
      (await build(thisWeek)).totals.done,
    ];
    for (const at of [
      zonedInstant(addDays(thisWeek, -1), '23:59', 'Asia/Tehran'),
      zonedInstant(thisWeek, '00:01', 'Asia/Tehran'),
    ]) {
      const t = await task(head.c, { title: 'مرز هفته', statusKey: 'done' });
      await withTenant(handle.db, { tenantId }, (tx) =>
        tx.update(s.tasks).set({ completedAt: at, createdAt: at }).where(eq(s.tasks.id, t.id)),
      );
    }
    expect((await build(lastWeek)).totals.done).toBe(beforeLast + 1);
    expect((await build(thisWeek)).totals.done).toBe(beforeThis + 1);
  });

  it('waits for the first working day when the week starts with a holiday', async () => {
    const calendar = (await other.get('/api/work-calendar')).body;
    const saturday = addDays(thisWeek, 7);
    expect(
      (await other.put('/api/work-calendar', { ...calendar, holidays: [saturday] })).status,
    ).toBe(200);
    const job = new WeeklyReportsJob(handle, new Notifier());
    expect(
      await job.runForTenant(otherTenantId, zonedInstant(saturday, '10:00', 'Asia/Tehran')),
    ).toBe(0);
    expect(
      await job.runForTenant(
        otherTenantId,
        zonedInstant(addDays(saturday, 1), '10:00', 'Asia/Tehran'),
      ),
    ).toBe(1);
  });

  it('keeps companies apart', async () => {
    expect((await report(other, `scope=department&departmentId=${support.id}`)).status).toBe(404);
    const theirs: WeeklyReport = (await report(other, 'scope=company')).body;
    expect(theirs.totals.done).toBe(0);
    expect(theirs.highlights).toHaveLength(0);
    // Both companies' jobs have run: each sees only its own reports and notifications.
    const ours = await withTenant(handle.db, { tenantId }, (tx) =>
      tx.select({ id: s.weeklyReports.id }).from(s.weeklyReports),
    );
    const seenByThem = await withTenant(handle.db, { tenantId: otherTenantId }, async (tx) => ({
      reports: await tx.select({ id: s.weeklyReports.id }).from(s.weeklyReports),
      notified: await tx
        .select({ subjectId: s.notifications.subjectId })
        .from(s.notifications)
        .where(eq(s.notifications.kind, 'weekly_report_ready')),
    }));
    expect(ours.length).toBeGreaterThan(1);
    expect(seenByThem.reports).toHaveLength(1);
    const ourIds = ours.map((r) => r.id);
    expect(seenByThem.reports.some((r) => ourIds.includes(r.id))).toBe(false);
    expect(seenByThem.notified.some((n) => ourIds.includes(n.subjectId))).toBe(false);
    expect((await other.get(`/api/reports/weekly/${ourIds[0]}/ref`)).status).toBe(404);
  });
});
