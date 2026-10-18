import { schema as s, withTenant, type DbHandle } from '@madar/db';
import {
  addDays,
  calendarDateIn,
  type CompanyDashboard,
  type DepartmentDashboard,
} from '@madar/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_HANDLE } from '../src/database/tokens.js';
import { createTestApp, hasDatabase, memberSession, ownerSession, type Client } from './helpers.js';

interface Person {
  c: Client;
  memberId: string;
}

describe.skipIf(!hasDatabase)('dashboards', () => {
  let app: NestExpressApplication;
  let handle: DbHandle;
  let tenantId: string;
  let owner: Client;
  let ceo: Person;
  let head: Person; // support head
  let agent: Person; // support, overloaded with overdue work
  let calm: Person; // support, nothing to flag
  let marketingHead: Person;
  let director: Person; // oversight department on task and goal, no role
  let deputy: Person; // support manager, not in the private project
  let support: { id: string };
  let marketing: { id: string };
  let other: Client; // another company's owner
  const today = calendarDateIn(new Date(), 'Asia/Tehran');

  const task = (c: Client, body: object) =>
    c.post('/api/tasks', body).then((r) => r.body as { id: string; version: number });

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
    const dept = (departmentId: string, deptRole = 'member') => [
      { departmentId, deptRole, isPrimary: true },
    ];
    ceo = await memberSession(app, env, owner, {
      roles: ['executive'],
      departments: dept(management.id),
    });
    head = await memberSession(app, env, owner, { departments: dept(support.id, 'head') });
    agent = await memberSession(app, env, owner, {
      departments: dept(support.id),
      displayName: 'آرش',
    });
    calm = await memberSession(app, env, owner, {
      departments: dept(support.id),
      displayName: 'بهار',
    });
    marketingHead = await memberSession(app, env, owner, {
      departments: dept(marketing.id, 'head'),
    });
    const office = (await owner.post('/api/departments', { name: 'دفتر مدیرعامل' })).body;
    await owner.put(`/api/departments/${office.id}/oversight`, { resources: ['task', 'goal'] });
    director = await memberSession(app, env, owner, { departments: dept(office.id) });
    deputy = await memberSession(app, env, owner, { departments: dept(support.id, 'manager') });

    // Support: three overdue tasks for the agent, one idle in-progress task, one done today.
    for (const days of [3, 4, 5]) {
      await task(head.c, {
        title: `معوق ${days}`,
        assigneeId: agent.memberId,
        dueOn: addDays(today, -days),
      });
    }
    const idle = await task(head.c, {
      title: 'کار بی‌حرکت',
      assigneeId: calm.memberId,
      statusKey: 'in_progress',
    });
    await withTenant(handle.db, { tenantId }, (tx) =>
      tx
        .update(s.tasks)
        .set({ updatedAt: new Date(Date.now() - 20 * 24 * 60 * 60_000) })
        .where(eq(s.tasks.id, idle.id)),
    );
    await task(head.c, { title: 'انجام‌شده', assigneeId: calm.memberId, statusKey: 'done' });
    // A private project the CEO is not in: its overdue task must not be counted for the CEO.
    const secret = (
      await head.c.post('/api/projects', {
        name: 'پروژه محرمانه',
        departmentId: support.id,
        visibility: 'private',
      })
    ).body;
    await task(head.c, { title: 'کار محرمانه', projectId: secret.id, dueOn: addDays(today, -2) });
    // A tenant-wide project that is late: started long ago, nothing done, due soon.
    const late = (
      await marketingHead.c.post('/api/projects', {
        name: 'کمپین عقب‌افتاده',
        departmentId: marketing.id,
        visibility: 'tenant',
        startOn: addDays(today, -60),
        dueOn: addDays(today, 5),
      })
    ).body;
    for (const title of ['بنر', 'متن', 'ویدئو']) {
      await task(marketingHead.c, { title, projectId: late.id });
    }

    other = (await ownerSession(app, env)).c;
  });
  afterAll(() => app?.close());

  it('opens the company dashboard only to company-wide readers', async () => {
    expect((await agent.c.get('/api/dashboard/company')).status).toBe(403);
    expect((await head.c.get('/api/dashboard/company')).status).toBe(403);
    expect((await ceo.c.get('/api/dashboard/company')).status).toBe(200);
    expect((await owner.get('/api/dashboard/company')).status).toBe(200);
  });

  it('opens a department dashboard to its managers and company-wide readers only', async () => {
    expect((await head.c.get(`/api/dashboard/departments/${support.id}`)).status).toBe(200);
    expect((await marketingHead.c.get(`/api/dashboard/departments/${support.id}`)).status).toBe(
      403,
    );
    expect((await agent.c.get(`/api/dashboard/departments/${support.id}`)).status).toBe(403);
    expect((await ceo.c.get(`/api/dashboard/departments/${support.id}`)).status).toBe(200);
  });

  it('counts company numbers within what the viewer may see, and lists the same rows', async () => {
    const d: CompanyDashboard = (await ceo.c.get('/api/dashboard/company')).body;
    const row = d.departments.find((x) => x.id === support.id);
    // Three overdue for the agent; the private project's task is invisible to the CEO.
    expect(row?.overdueTasks).toBe(3);
    expect(row?.behind).toBe(true);
    expect(d.headline.overdueTasks).toBe(3);
    const list = (await ceo.c.get(`/api/tasks?view=visible&departmentId=${support.id}&due=overdue`))
      .body;
    expect(list).toHaveLength(3);
    // The head is in the private project and sees four in their own department.
    const own = (
      await head.c.get(`/api/tasks?view=department&departmentId=${support.id}&due=overdue`)
    ).body;
    expect(own).toHaveLength(4);
    // Done this week shows up in the last bar.
    expect(d.weeklyDone).toHaveLength(8);
    expect(d.weeklyDone.at(-1)?.count).toBeGreaterThanOrEqual(1);
  });

  it('flags the late project, and the risk filter lists it', async () => {
    const d: CompanyDashboard = (await ceo.c.get('/api/dashboard/company')).body;
    expect(d.atRiskProjects.map((p) => p.name)).toContain('کمپین عقب‌افتاده');
    expect(d.atRiskProjects.map((p) => p.name)).not.toContain('پروژه محرمانه');
    expect(d.headline.atRiskProjects).toBe(d.atRiskProjects.length);
    const listed = (await ceo.c.get('/api/projects?risk=true')).body as { name: string }[];
    expect(listed.map((p) => p.name).sort()).toEqual(d.atRiskProjects.map((p) => p.name).sort());
  });

  it('shows the team: alphabetical workload, stuck work and who might need help (managers only)', async () => {
    const d: DepartmentDashboard = (await head.c.get(`/api/dashboard/departments/${support.id}`))
      .body;
    const names = d.workload.map((w) => w.member.displayName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'fa')));
    expect(d.workload.find((w) => w.member.id === agent.memberId)).toMatchObject({
      todo: 3,
      overdue: 3,
    });
    expect(d.stuck.map((t) => t.title)).toEqual(expect.arrayContaining(['معوق 5', 'کار بی‌حرکت']));
    const stuckList = (
      await head.c.get(`/api/tasks?view=department&departmentId=${support.id}&stuck=true`)
    ).body;
    expect(stuckList).toHaveLength(d.headline.stuckTasks);
    // Reasons, not scores: three overdue; how many are «stuck» depends on the weekday (Fridays are off).
    const help = d.needsHelp?.find((h) => h.member.id === agent.memberId);
    expect(help?.member.displayName).toBe('آرش');
    expect(help?.reasons[0]).toEqual({ kind: 'overdue', count: 3 });
    expect(help?.reasons.some((r) => r.kind === 'stuck')).toBe(true);
    // A company-wide reader sees the team, but not the people list.
    const forCeo: DepartmentDashboard = (
      await ceo.c.get(`/api/dashboard/departments/${support.id}`)
    ).body;
    expect(forCeo.needsHelp).toBeNull();
  });

  it('opens both dashboards to an oversight department reader', async () => {
    expect((await director.c.get('/api/dashboard/company')).status).toBe(200);
    const team: DepartmentDashboard = (
      await director.c.get(`/api/dashboard/departments/${support.id}`)
    ).body;
    expect(team.needsHelp).toBeNull();
    expect(team.workload.every((w) => w.overdue === null)).toBe(true);
  });

  it('counts what each manager may see: the private project stays hidden from the deputy', async () => {
    const forHead: DepartmentDashboard = (
      await head.c.get(`/api/dashboard/departments/${support.id}`)
    ).body;
    const forDeputy: DepartmentDashboard = (
      await deputy.c.get(`/api/dashboard/departments/${support.id}`)
    ).body;
    expect(forHead.headline.overdueTasks - forDeputy.headline.overdueTasks).toBe(1);
    // The open tile and the list it opens (subtasks included) agree.
    const list = (
      await head.c.get(
        `/api/tasks?view=department&departmentId=${support.id}&subtasks=include&limit=500`,
      )
    ).body;
    expect(list).toHaveLength(forHead.headline.openTasks);
  });

  it('averages only department goals, never personal ones', async () => {
    const periods = (await head.c.get('/api/goal-periods')).body as Array<{
      id: string;
      current: boolean;
    }>;
    const periodId = periods.find((p) => p.current)?.id;
    const goal = (
      await head.c.post('/api/goals', {
        periodId,
        level: 'department',
        departmentId: support.id,
        title: 'هدف دپارتمان',
        keyResults: [{ title: 'نتیجه', kind: 'boolean' }],
      })
    ).body;
    await head.c.post(`/api/key-results/${goal.keyResults[0].id}/check-ins`, {
      value: 1,
      status: 'on_track',
    });
    await agent.c.post('/api/goals', {
      periodId,
      level: 'individual',
      departmentId: support.id,
      title: 'هدف شخصی',
      keyResults: [{ title: 'نتیجه', kind: 'boolean' }],
    });
    const team: DepartmentDashboard = (await head.c.get(`/api/dashboard/departments/${support.id}`))
      .body;
    expect(team.headline.goalProgress).toBe(1);
    expect(team.goals.map((g) => g.title)).toEqual(['هدف دپارتمان']);
    const company: CompanyDashboard = (await ceo.c.get('/api/dashboard/company')).body;
    expect(company.departments.find((d) => d.id === support.id)?.goalProgress).toBe(1);
  });

  it('keeps companies apart', async () => {
    const theirs: CompanyDashboard = (await other.get('/api/dashboard/company')).body;
    expect(theirs.departments.map((d) => d.id)).not.toContain(support.id);
    expect(theirs.headline.overdueTasks).toBe(0);
    expect(theirs.atRiskProjects).toHaveLength(0);
    expect((await other.get(`/api/dashboard/departments/${support.id}`)).status).toBe(404);
  });
});
