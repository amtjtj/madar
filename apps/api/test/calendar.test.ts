import { createDb, schema as s } from '@madar/db';
import {
  addDays,
  calendarDateIn,
  DEFAULT_WORK_CALENDAR,
  persianWeekdayOfCalendarDate,
  zonedInstant,
  type CalendarRange,
} from '@madar/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadEnv } from '../src/config/env.js';
import { createTestApp, hasDatabase, memberSession, ownerSession, type Client } from './helpers.js';

interface Person {
  c: Client;
  memberId: string;
}

const tz = 'Asia/Tehran';
const today = () => calendarDateIn(new Date(), tz);
const at = (day: string, hhmm: string) => zonedInstant(day, hhmm, tz).toISOString();

describe.skipIf(!hasDatabase)('personal calendar', () => {
  let app: NestExpressApplication;
  let tenantId: string;
  let owner: Person;
  let ali: Person;
  let zahra: Person;
  let director: Person; // oversees meetings
  let boss: Person; // manages support, and in management (oversees meetings)
  let exec: Person; // reads every task, edits none
  let other: Client;
  let stranger: Person; // a member of the other company
  let range: { from: string; to: string };
  let env: Awaited<ReturnType<typeof createTestApp>>['env'];
  let supportId: string;

  const get = async (p: Person | { c: Client }, query = '') => {
    const res = await p.c.get(`/api/calendar?from=${range.from}&to=${range.to}${query}`);
    return res;
  };
  const itemsOn = (cal: CalendarRange, day: string) =>
    cal.days.find((d) => d.date === day)?.items ?? [];
  const allItems = (cal: CalendarRange) => cal.days.flatMap((d) => d.items);

  beforeAll(async () => {
    ({ app, env } = await createTestApp());
    const session = await ownerSession(app, env);
    tenantId = session.tenantId;
    owner = { c: session.c, memberId: (await session.c.get('/api/me')).body.member.id };
    const support = (await owner.c.post('/api/departments', { name: 'پشتیبانی' })).body;
    supportId = support.id;
    const management = (await owner.c.post('/api/departments', { name: 'مدیریت' })).body;
    await owner.c.put(`/api/departments/${management.id}/oversight`, {
      resources: ['meeting', 'task', 'project'],
    });
    const dept = (id: string, deptRole = 'member') => [
      { departmentId: id, deptRole, isPrimary: true },
    ];
    ali = await memberSession(app, env, owner.c, { departments: dept(support.id) });
    zahra = await memberSession(app, env, owner.c, { departments: dept(support.id) });
    director = await memberSession(app, env, owner.c, { departments: dept(management.id) });
    boss = await memberSession(app, env, owner.c, {
      displayName: 'مریم احمدی',
      departments: [
        { departmentId: support.id, deptRole: 'manager', isPrimary: true },
        { departmentId: management.id, deptRole: 'member', isPrimary: false },
      ],
    });
    exec = await memberSession(app, env, owner.c, { roles: ['executive'] });
    other = (await ownerSession(app, env)).c;
    const otherDept = (await other.post('/api/departments', { name: 'فروش' })).body;
    stranger = await memberSession(app, env, other, {
      departments: [{ departmentId: otherDept.id, deptRole: 'member', isPrimary: true }],
    });
    range = { from: addDays(today(), -10), to: addDays(today(), 20) };
  });
  afterAll(() => app?.close());

  it('shows my open tasks on their due day, past-due ones once above today', async () => {
    const due = addDays(today(), 3);
    const mine = (await ali.c.post('/api/tasks', { title: 'گزارش هفتگی', dueOn: due })).body;
    const late = (
      await ali.c.post('/api/tasks', { title: 'پیگیری عقب‌افتاده', dueOn: addDays(today(), -4) })
    ).body;
    const done = (await ali.c.post('/api/tasks', { title: 'تمام‌شده', dueOn: due })).body;
    await ali.c.patch(`/api/tasks/${done.id}`, { version: done.version, statusKey: 'done' });
    // Zahra's task in the same department: Ali sees it on the board, not in his calendar.
    await zahra.c.post('/api/tasks', { title: 'کار زهرا', dueOn: due });

    const cal: CalendarRange = (await get(ali)).body;
    expect(itemsOn(cal, due).map((i) => i.title)).toEqual(['گزارش هفتگی']);
    expect(itemsOn(cal, due)[0]?.task).toMatchObject({ due: true, planned: false, overdue: false });
    expect(cal.overdue.map((i) => i.id)).toEqual([late.id]);
    expect(allItems(cal).some((i) => i.id === late.id)).toBe(false);
    expect(allItems(cal).some((i) => i.id === mine.id)).toBe(true);

    // Out of range of today: no «overdue» list.
    const later: CalendarRange = (
      await ali.c.get(`/api/calendar?from=${addDays(today(), 30)}&to=${addDays(today(), 40)}`)
    ).body;
    expect(later.overdue).toEqual([]);
  });

  it('merges a planned task due the same day into one item', async () => {
    const task = (
      await ali.c.post('/api/tasks', { title: 'امروزی', dueOn: today(), addToToday: true })
    ).body;
    const cal: CalendarRange = (await get(ali)).body;
    const found = itemsOn(cal, today()).filter((i) => i.id === task.id);
    expect(found).toHaveLength(1);
    expect(found[0]?.task).toMatchObject({ due: true, planned: true });
  });

  it('shows my meetings only, with replies and cancelations; never what oversight lets me read', async () => {
    const day = addDays(today(), 5);
    const meeting = (
      await ali.c.post('/api/meetings', {
        type: 'regular',
        title: 'هماهنگی',
        startsAt: at(day, '10:00'),
        endsAt: at(day, '11:00'),
        participantIds: [zahra.memberId],
      })
    ).body;
    await zahra.c.put(`/api/meetings/${meeting.id}/response`, { response: 'declined' });
    const forZahra: CalendarRange = (await get(zahra)).body;
    expect(itemsOn(forZahra, day).find((i) => i.id === meeting.id)?.meeting).toMatchObject({
      type: 'regular',
      canceled: false,
      myResponse: 'declined',
    });
    // The director reads it through oversight but it is not in their calendar.
    expect((await director.c.get(`/api/meetings/${meeting.id}`)).status).toBe(200);
    const forDirector: CalendarRange = (await get(director)).body;
    expect(allItems(forDirector).some((i) => i.id === meeting.id)).toBe(false);

    await ali.c.post(`/api/meetings/${meeting.id}/cancel`);
    const afterCancel: CalendarRange = (await get(ali)).body;
    expect(itemsOn(afterCancel, day).find((i) => i.id === meeting.id)?.meeting?.canceled).toBe(
      true,
    );
  });

  it('shows the end of my projects and of the goal period', async () => {
    const dueOn = addDays(today(), 7);
    const project =
      // Projects come from managers and the leadership (plan phase-3-step-17a); Ali is on it.
      (
        await owner.c.post('/api/projects', {
          name: 'راه‌اندازی پشتیبانی شبانه',
          departmentId: supportId,
          dueOn,
          memberIds: [ali.memberId],
        })
      ).body;
    expect(
      (await get(ali)).body.days
        .find((d: { date: string }) => d.date === dueOn)
        .items.map((i: { id: string }) => i.id),
    ).toContain(project.id);
    // Zahra sees the project (same department) but is not on it.
    const forZahra: CalendarRange = (await get(zahra)).body;
    expect(allItems(forZahra).some((i) => i.id === project.id)).toBe(false);

    const periods = (await ali.c.get('/api/goal-periods')).body as Array<{
      endOn: string;
      current: boolean;
    }>;
    const current = periods.find((p) => p.current);
    const wide: CalendarRange = (
      await ali.c.get(
        `/api/calendar?from=${addDays(current?.endOn ?? today(), -3)}&to=${current?.endOn ?? today()}&layers=periods`,
      )
    ).body;
    expect(itemsOn(wide, current?.endOn ?? '').some((i) => i.kind === 'period')).toBe(true);
  });

  it('marks holidays and days off, and leaves out layers that are off', async () => {
    const holiday = addDays(today(), 2);
    await owner.c.put('/api/work-calendar', { ...DEFAULT_WORK_CALENDAR, holidays: [holiday] });
    const cal: CalendarRange = (await get(ali)).body;
    expect(cal.days.find((d) => d.date === holiday)?.holiday).toBe(true);
    const friday = cal.days.find((d) => persianWeekdayOfCalendarDate(d.date) === 6);
    expect(friday?.off).toBe(true);

    const onlyMeetings: CalendarRange = (await get(ali, '&layers=meetings')).body;
    expect(allItems(onlyMeetings).every((i) => i.kind === 'meeting')).toBe(true);
    expect(onlyMeetings.overdue).toEqual([]);
    expect(onlyMeetings.days.some((d) => d.holiday)).toBe(false);
  });

  it("shows a late task on today's plan once, and nothing deleted or out of sight", async () => {
    const late = (
      await ali.c.post('/api/tasks', {
        title: 'عقب‌افتاده در برنامه امروز',
        dueOn: addDays(today(), -2),
        addToToday: true,
      })
    ).body;
    const gone = (
      await ali.c.post('/api/tasks', {
        title: 'حذف‌شده',
        dueOn: addDays(today(), 1),
        addToToday: true,
      })
    ).body;
    expect((await ali.c.delete(`/api/tasks/${gone.id}`)).status).toBe(204);
    // A plan row for a task in Zahra's private project, which Ali cannot see.
    const project = (
      await owner.c.post('/api/projects', {
        name: 'پروژه خصوصی زهرا',
        visibility: 'private',
        memberIds: [zahra.memberId],
      })
    ).body;
    const hidden = (
      await zahra.c.post('/api/tasks', {
        title: 'کار پنهان',
        projectId: project.id,
        dueOn: today(),
      })
    ).body;
    loadEnv();
    const ownerDb = createDb(process.env.DATABASE_URL ?? '');
    try {
      await ownerDb.db
        .insert(s.dailyPlanItems)
        .values({ tenantId, memberId: ali.memberId, planDate: today(), taskId: hidden.id });
    } finally {
      await ownerDb.pool.end();
    }

    const cal: CalendarRange = (await get(ali)).body;
    const todays = itemsOn(cal, today()).filter((i) => i.id === late.id);
    expect(todays).toHaveLength(1);
    expect(todays[0]?.task).toMatchObject({ planned: true, overdue: true });
    expect(cal.overdue.some((i) => i.id === late.id)).toBe(false);
    const ids = [...allItems(cal), ...cal.overdue].map((i) => i.id);
    expect(ids).not.toContain(gone.id);
    expect(ids).not.toContain(hidden.id);
  });

  it("keeps a one-on-one between two others out of an overseer's calendar", async () => {
    const day = addDays(today(), 6);
    const meeting = (
      await ali.c.post('/api/meetings', {
        type: 'one_on_one',
        title: 'گفت‌وگوی ماهانه',
        startsAt: at(day, '09:00'),
        endsAt: at(day, '09:30'),
        participantIds: [zahra.memberId],
      })
    ).body;
    expect(itemsOn((await get(zahra)).body, day).some((i) => i.id === meeting.id)).toBe(true);
    expect(allItems((await get(director)).body).some((i) => i.id === meeting.id)).toBe(false);
  });

  it('lists whose calendar I may open: myself, my department as manager, everyone tenant-wide', async () => {
    const ids = async (p: Person) =>
      ((await p.c.get('/api/calendar/people')).body as Array<{ id: string }>).map((x) => x.id);
    expect(await ids(ali)).toEqual([ali.memberId]);
    const forBoss = await ids(boss);
    expect(forBoss[0]).toBe(boss.memberId);
    expect(forBoss).toEqual(expect.arrayContaining([ali.memberId, zahra.memberId]));
    // Management is not a department Maryam manages; oversight is not enough.
    expect(forBoss).not.toContain(director.memberId);
    const forExec = await ids(exec);
    expect(forExec).toEqual(
      expect.arrayContaining([ali.memberId, director.memberId, boss.memberId]),
    );
    expect(forExec).not.toContain(stranger.memberId);
  });

  it("shows a team member's calendar with my visibility, never their plan or private work", async () => {
    const day = addDays(today(), 9);
    const open = (
      await ali.c.post('/api/tasks', { title: 'کار علی برای مدیر', dueOn: day, addToToday: true })
    ).body;
    const secret = (
      await owner.c.post('/api/projects', {
        name: 'پروژه خصوصی علی',
        visibility: 'private',
        memberIds: [ali.memberId],
      })
    ).body;
    const hidden = (
      await ali.c.post('/api/tasks', { title: 'کار خصوصی علی', projectId: secret.id, dueOn: day })
    ).body;
    const oneOnOne = (
      await ali.c.post('/api/meetings', {
        type: 'one_on_one',
        title: 'یک‌به‌یک علی و زهرا',
        startsAt: at(day, '11:00'),
        endsAt: at(day, '11:30'),
        participantIds: [zahra.memberId],
      })
    ).body;
    const team = (
      await zahra.c.post('/api/meetings', {
        type: 'regular',
        title: 'جلسه تیم پشتیبانی',
        startsAt: at(day, '13:00'),
        endsAt: at(day, '14:00'),
        participantIds: [ali.memberId],
      })
    ).body;

    const res = await get(boss, `&member=${ali.memberId}`);
    expect(res.status).toBe(200);
    const cal: CalendarRange = res.body;
    expect(cal.member.id).toBe(ali.memberId);
    const ids = [...allItems(cal), ...cal.overdue].map((i) => i.id);
    expect(ids).toContain(open.id);
    expect(ids).not.toContain(hidden.id);
    expect(ids).not.toContain(oneOnOne.id);
    // Maryam oversees meetings, so she sees the team meeting, without Ali's reply.
    expect(itemsOn(cal, day).find((i) => i.id === team.id)?.meeting?.myResponse).toBeNull();
    // Ali's plan is his alone: today's plan items are not there unless due that day.
    expect(allItems(cal).every((i) => !i.task?.planned)).toBe(true);
    // Maryam manages support: she may move Ali's due date.
    expect(itemsOn(cal, day).find((i) => i.id === open.id)?.task).toMatchObject({
      editable: true,
      version: open.version,
    });
    // The executive reads it but may not change it.
    const forExec: CalendarRange = (await get(exec, `&member=${ali.memberId}`)).body;
    expect(itemsOn(forExec, day).find((i) => i.id === open.id)?.task?.editable).toBe(false);
    // Working hours come with each day.
    expect(cal.days.some((d) => d.hours !== null)).toBe(true);
  });

  it('moves a due date with the version it carries, and refuses a stale one', async () => {
    const day = addDays(today(), 11);
    const task = (await ali.c.post('/api/tasks', { title: 'جابه‌جایی از تقویم', dueOn: day })).body;
    const item = itemsOn((await get(boss, `&member=${ali.memberId}`)).body, day).find(
      (i) => i.id === task.id,
    );
    const version = item?.task?.version ?? -1;
    const moved = await boss.c.patch(`/api/tasks/${task.id}`, {
      version,
      dueOn: addDays(day, 1),
    });
    expect(moved.status).toBe(200);
    // The same, now stale, version: someone else moved it meanwhile.
    const stale = await ali.c.patch(`/api/tasks/${task.id}`, { version, dueOn: addDays(day, 2) });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('version_conflict');
  });

  it('leaves a suspended member out of the people and their calendar', async () => {
    const gone = await memberSession(app, env, owner.c, {
      displayName: 'عضو تعلیق‌شده',
      departments: [{ departmentId: supportId, deptRole: 'member', isPrimary: true }],
    });
    expect((await owner.c.post(`/api/members/${gone.memberId}/suspend`)).status).toBe(201);
    const ids = ((await boss.c.get('/api/calendar/people')).body as Array<{ id: string }>).map(
      (x) => x.id,
    );
    expect(ids).not.toContain(gone.memberId);
    expect((await get(boss, `&member=${gone.memberId}`)).status).toBe(404);
  });

  it('refuses someone outside my people, and anyone from another company', async () => {
    expect((await get(ali, `&member=${zahra.memberId}`)).status).toBe(404);
    expect((await get(boss, `&member=${director.memberId}`)).status).toBe(404);
    expect((await get(exec, `&member=${stranger.memberId}`)).status).toBe(404);
    expect((await get(stranger, `&member=${ali.memberId}`)).status).toBe(404);
  });

  it('refuses a range longer than six weeks or reversed', async () => {
    expect(
      (await ali.c.get(`/api/calendar?from=${today()}&to=${addDays(today(), 42)}`)).status,
    ).toBe(400);
    expect(
      (await ali.c.get(`/api/calendar?from=${today()}&to=${addDays(today(), -1)}`)).status,
    ).toBe(400);
  });

  it('another company sees none of it; a read-only company still reads', async () => {
    // The other company has its own task, meeting, project and holiday.
    const day = addDays(today(), 4);
    const otherTask = (await stranger.c.post('/api/tasks', { title: 'کار شرکت دیگر', dueOn: day }))
      .body;
    const otherMeeting = (
      await stranger.c.post('/api/meetings', {
        type: 'regular',
        title: 'جلسه شرکت دیگر',
        startsAt: at(day, '10:00'),
        endsAt: at(day, '11:00'),
        participantIds: [],
      })
    ).body;
    const otherProject = (
      await other.post('/api/projects', {
        name: 'پروژه دیگر',
        dueOn: day,
        memberIds: [stranger.memberId],
      })
    ).body;
    const otherHoliday = addDays(today(), 8);
    await other.put('/api/work-calendar', { ...DEFAULT_WORK_CALENDAR, holidays: [otherHoliday] });

    const theirs: CalendarRange = (await get(stranger)).body;
    const theirIds = allItems(theirs).map((i) => i.id);
    expect(theirIds).toEqual(
      expect.arrayContaining([otherTask.id, otherMeeting.id, otherProject.id]),
    );
    // Nothing of Ali's company reaches them…
    const aliIds = [...allItems((await get(ali)).body), ...(await get(ali)).body.overdue].map(
      (i: { id: string }) => i.id,
    );
    expect(theirIds.some((id) => aliIds.includes(id))).toBe(false);
    expect(theirs.overdue).toEqual([]);
    // …and nothing of theirs reaches Ali.
    const mine: CalendarRange = (await get(ali)).body;
    expect(aliIds).not.toContain(otherTask.id);
    expect(aliIds).not.toContain(otherMeeting.id);
    expect(aliIds).not.toContain(otherProject.id);
    expect(mine.days.find((d) => d.date === otherHoliday)?.holiday).toBe(false);
    loadEnv();
    const ownerDb = createDb(process.env.DATABASE_URL ?? '');
    try {
      await ownerDb.db
        .update(s.tenants)
        .set({ status: 'read_only' })
        .where(eq(s.tenants.id, tenantId));
      expect((await get(ali)).status).toBe(200);
    } finally {
      await ownerDb.db
        .update(s.tenants)
        .set({ status: 'active' })
        .where(eq(s.tenants.id, tenantId));
      await ownerDb.pool.end();
    }
  });
});
