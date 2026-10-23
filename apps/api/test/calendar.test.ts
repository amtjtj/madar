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
  let other: Client;
  let stranger: Person; // a member of the other company
  let range: { from: string; to: string };

  const get = async (p: Person | { c: Client }, query = '') => {
    const res = await p.c.get(`/api/calendar?from=${range.from}&to=${range.to}${query}`);
    return res;
  };
  const itemsOn = (cal: CalendarRange, day: string) =>
    cal.days.find((d) => d.date === day)?.items ?? [];
  const allItems = (cal: CalendarRange) => cal.days.flatMap((d) => d.items);

  beforeAll(async () => {
    let env;
    ({ app, env } = await createTestApp());
    const session = await ownerSession(app, env);
    tenantId = session.tenantId;
    owner = { c: session.c, memberId: (await session.c.get('/api/me')).body.member.id };
    const support = (await owner.c.post('/api/departments', { name: 'پشتیبانی' })).body;
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
    const project = (
      await ali.c.post('/api/projects', { name: 'راه‌اندازی پشتیبانی شبانه', dueOn })
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
      await zahra.c.post('/api/projects', { name: 'پروژه خصوصی زهرا', visibility: 'private' })
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
      await stranger.c.post('/api/projects', { name: 'پروژه دیگر', dueOn: day })
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
