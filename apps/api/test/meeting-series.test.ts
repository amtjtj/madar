import { schema as s, withTenant, type DbHandle } from '@madar/db';
import {
  addDays,
  calendarDateIn,
  DEFAULT_WORK_CALENDAR,
  persianWeekdayOfCalendarDate,
  zonedInstant,
  type EvidenceDetail,
  type Meeting,
  type MeetingList,
  type Task,
  type Upload,
} from '@madar/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ENV } from '../src/config/config.module.js';
import { loadEnv, type Env } from '../src/config/env.js';
import { DB_HANDLE } from '../src/database/tokens.js';
import { ConsumerRunner } from '../src/events/consumer-runner.service.js';
import { RelayService } from '../src/events/relay.service.js';
import { MeetingJobs } from '../src/meetings/meeting-jobs.js';
import { WorkerModule } from '../src/worker.module.js';
import {
  createTestApp,
  hasDatabase,
  memberSession,
  ownerSession,
  unique,
  type Client,
} from './helpers.js';

interface Person {
  c: Client;
  memberId: string;
}

const tz = 'Asia/Tehran';
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n');

/** The next Saturday at least `weeks` weeks from today (company time). */
function saturdayIn(weeks: number): string {
  const today = calendarDateIn(new Date(), tz);
  const first = addDays(today, (7 - persianWeekdayOfCalendarDate(today)) % 7 || 7);
  return addDays(first, 7 * weeks);
}
const at = (day: string, hhmm: string) => zonedInstant(day, hhmm, tz).toISOString();

describe.skipIf(!hasDatabase)('weekly meetings, replies, reminders and minutes as evidence', () => {
  let app: NestExpressApplication;
  let env: Env;
  let worker: TestingModule;
  let handle: DbHandle;
  let jobs: MeetingJobs;
  let tenantId: string;
  let owner: Person;
  let maryam: Person; // support manager, organizer
  let ali: Person;
  let zahra: Person;
  let reza: Person; // marketing
  let other: Client;

  const meetingsOf = (seriesId: string) =>
    withTenant(handle.db, { tenantId }, (tx) =>
      tx
        .select()
        .from(s.meetings)
        .where(eq(s.meetings.seriesId, seriesId))
        .orderBy(asc(s.meetings.startsAt)),
    );
  const notificationsOf = (memberId: string, kind: string) =>
    withTenant(handle.db, { tenantId }, (tx) =>
      tx
        .select()
        .from(s.notifications)
        .where(and(eq(s.notifications.recipientId, memberId), eq(s.notifications.kind, kind))),
    );
  async function settle() {
    const until = Date.now() + 10_000;
    for (;;) {
      const [pending] = await withTenant(handle.db, { tenantId }, (tx) =>
        tx.select({ n: count() }).from(s.domainEvents).where(isNull(s.domainEvents.publishedAt)),
      );
      if ((pending?.n ?? 0) === 0 || Date.now() > until) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
  }

  async function weekly(input: Record<string, unknown> = {}): Promise<Meeting> {
    const day = saturdayIn(1);
    const res = await maryam.c.post('/api/meetings', {
      type: 'regular',
      title: 'هماهنگی هفتگی پشتیبانی',
      startsAt: at(day, '09:00'),
      endsAt: at(day, '09:30'),
      participantIds: [ali.memberId, zahra.memberId],
      repeat: {},
      ...input,
    });
    if (res.status !== 201) throw new Error(`weekly failed: ${res.status} ${res.text}`);
    return res.body;
  }

  beforeAll(async () => {
    ({ app, env } = await createTestApp());
    const session = await ownerSession(app, env);
    tenantId = session.tenantId;
    owner = { c: session.c, memberId: (await session.c.get('/api/me')).body.member.id };
    const support = (await owner.c.post('/api/departments', { name: 'پشتیبانی' })).body;
    const marketing = (await owner.c.post('/api/departments', { name: 'مارکتینگ' })).body;
    const dept = (id: string, deptRole = 'member') => [
      { departmentId: id, deptRole, isPrimary: true },
    ];
    maryam = await memberSession(app, env, owner.c, { departments: dept(support.id, 'manager') });
    ali = await memberSession(app, env, owner.c, { departments: dept(support.id) });
    zahra = await memberSession(app, env, owner.c, { departments: dept(support.id) });
    reza = await memberSession(app, env, owner.c, { departments: dept(marketing.id) });
    other = (await ownerSession(app, env)).c;
    // A holiday on the third Saturday: no meeting that week.
    await owner.c.put('/api/work-calendar', {
      ...DEFAULT_WORK_CALENDAR,
      holidays: [saturdayIn(3)],
    });

    worker = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(ENV)
      .useValue({ ...loadEnv(), QUEUE_PREFIX: unique('test-ms-'), RELAY_INTERVAL_MS: 100 })
      .compile();
    await worker.init();
    handle = worker.get<DbHandle>(DB_HANDLE);
    jobs = worker.get(MeetingJobs);
    worker.get(ConsumerRunner).start();
    worker.get(RelayService).start([tenantId]);
  });
  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  it('makes eight weeks of meetings, skips the holiday and never twice', async () => {
    const first = await weekly();
    expect(first.series).toMatchObject({ weekday: 0, startTime: '09:00', endTime: '09:30' });
    expect(first.seriesId).toBe(first.series?.id);
    const made = await meetingsOf(first.series?.id ?? '');
    const days = made.map((m) => m.occursOn);
    expect(days[0]).toBe(saturdayIn(1));
    expect(days).not.toContain(saturdayIn(3));
    expect(days.every((d) => persianWeekdayOfCalendarDate(d ?? '') === 0)).toBe(true);
    expect(days.length).toBeGreaterThanOrEqual(6);
    expect(days.length).toBeLessThanOrEqual(8);
    // The worker running again (or in parallel) adds nothing.
    expect(await jobs.generateForTenant(tenantId)).toBe(0);
    expect((await meetingsOf(first.series?.id ?? '')).length).toBe(made.length);

    // Every meeting has the series' people; the organizer is coming.
    const next: Meeting = (await ali.c.get(`/api/meetings/${made[1]?.id ?? ''}`)).body;
    expect(next.participants.map((p) => [p.id, p.response])).toEqual(
      expect.arrayContaining([
        [maryam.memberId, 'accepted'],
        [ali.memberId, 'pending'],
      ]),
    );
    expect((await reza.c.get(`/api/meetings/${made[1]?.id ?? ''}`)).status).toBe(404);

    // One invitation for the whole series.
    const seriesInvites = async () =>
      (await notificationsOf(ali.memberId, 'meeting_invited')).filter(
        (n) => (n.payload as { data?: { series?: number } }).data?.series,
      ).length;
    await expect.poll(seriesInvites, { timeout: 15_000 }).toBe(1);
    await settle();
    expect(await seriesInvites()).toBe(1);
  });

  it('stops at its last day', async () => {
    const first = await weekly({ repeat: { untilOn: saturdayIn(2) } });
    const made = await meetingsOf(first.series?.id ?? '');
    expect(made.map((m) => m.occursOn)).toEqual([saturdayIn(1), saturdayIn(2)]);
    expect(await jobs.generateForTenant(tenantId)).toBe(0);
  });

  it('changes one meeting alone, or this and the following ones', async () => {
    const first = await weekly();
    const seriesId = first.series?.id ?? '';
    const made = await meetingsOf(seriesId);
    // One meeting moved on its own is left alone by later series changes.
    const alone = made[1];
    await maryam.c.patch(`/api/meetings/${alone?.id ?? ''}`, {
      startsAt: at(alone?.occursOn ?? '', '11:00'),
      endsAt: at(alone?.occursOn ?? '', '11:30'),
    });
    expect(
      (await ali.c.patch(`/api/meeting-series/${seriesId}`, { startTime: '10:00' })).status,
    ).toBe(403);
    expect(
      (await reza.c.patch(`/api/meeting-series/${seriesId}`, { startTime: '10:00' })).status,
    ).toBe(404);
    expect(
      (await other.patch(`/api/meeting-series/${seriesId}`, { startTime: '10:00' })).status,
    ).toBe(404);

    const res = await maryam.c.patch(`/api/meeting-series/${seriesId}`, {
      weekday: 1,
      startTime: '10:00',
      endTime: '10:45',
      participantIds: [ali.memberId, reza.memberId],
    });
    expect(res.status).toBe(200);
    const after = await meetingsOf(seriesId);
    const moved = after.filter((m) => m.id !== alone?.id && !m.canceledAt);
    expect(moved.every((m) => persianWeekdayOfCalendarDate(m.occursOn ?? '') === 1)).toBe(true);
    expect(moved.every((m) => m.startsAt.toISOString() === at(m.occursOn ?? '', '10:00'))).toBe(
      true,
    );
    const kept = after.find((m) => m.id === alone?.id);
    expect(kept?.startsAt.toISOString()).toBe(at(alone?.occursOn ?? '', '11:00'));
    // People: Zahra leaves the meetings to come, Reza joins them, not the one edited alone.
    const nextId = moved[0]?.id ?? '';
    expect((await zahra.c.get(`/api/meetings/${nextId}`)).status).toBe(404);
    expect((await reza.c.get(`/api/meetings/${nextId}`)).status).toBe(200);
    expect((await reza.c.get(`/api/meetings/${alone?.id ?? ''}`)).status).toBe(404);

    // One «changed» per person, not one per week; Reza is invited once.
    const changed = async () =>
      (await notificationsOf(ali.memberId, 'meeting_changed')).filter((n) => n.subjectId === nextId)
        .length;
    await expect.poll(changed, { timeout: 15_000 }).toBe(1);
    await expect
      .poll(async () => (await notificationsOf(reza.memberId, 'meeting_invited')).length, {
        timeout: 15_000,
      })
      .toBe(1);
    await settle();
    expect(await changed()).toBe(1);
  });

  it('cancels the series from now on and makes no more', async () => {
    const first = await weekly();
    const seriesId = first.series?.id ?? '';
    expect((await maryam.c.post(`/api/meeting-series/${seriesId}/cancel`)).status).toBe(204);
    const after = await meetingsOf(seriesId);
    expect(after.every((m) => m.canceledAt !== null)).toBe(true);
    await withTenant(handle.db, { tenantId }, (tx) =>
      tx
        .update(s.meetingSeries)
        .set({ generatedUntil: saturdayIn(1) })
        .where(eq(s.meetingSeries.id, seriesId)),
    );
    expect(await jobs.generateForTenant(tenantId)).toBe(0);
    expect((await maryam.c.patch(`/api/meeting-series/${seriesId}`, { title: 'x' })).status).toBe(
      409,
    );
  });

  it('takes replies from the people themselves, before the start', async () => {
    const day = saturdayIn(1);
    const meeting: Meeting = (
      await maryam.c.post('/api/meetings', {
        type: 'regular',
        title: 'بررسی صف',
        startsAt: at(day, '14:00'),
        endsAt: at(day, '15:00'),
        participantIds: [ali.memberId, zahra.memberId],
      })
    ).body;
    expect(meeting.responses).toEqual({ accepted: 1, declined: 0, pending: 2 });
    const declined = await ali.c.put(`/api/meetings/${meeting.id}/response`, {
      response: 'declined',
    });
    expect(declined.status).toBe(200);
    expect(declined.body.myResponse).toBe('declined');
    await zahra.c.put(`/api/meetings/${meeting.id}/response`, { response: 'accepted' });
    const seen: Meeting = (await maryam.c.get(`/api/meetings/${meeting.id}`)).body;
    expect(seen.responses).toEqual({ accepted: 2, declined: 1, pending: 0 });
    expect(seen.participants.find((p) => p.id === ali.memberId)?.response).toBe('declined');
    // Declining keeps the meeting and its minutes open.
    expect((await ali.c.get(`/api/meetings/${meeting.id}`)).status).toBe(200);
    expect(
      (await maryam.c.put(`/api/meetings/${meeting.id}/response`, { response: 'declined' })).status,
    ).toBe(403);
    expect(
      (await reza.c.put(`/api/meetings/${meeting.id}/response`, { response: 'accepted' })).status,
    ).toBe(404);

    const started: Meeting = (
      await maryam.c.post('/api/meetings', {
        type: 'regular',
        title: 'شروع‌شده',
        startsAt: new Date(Date.now() - 600_000).toISOString(),
        endsAt: new Date(Date.now() + 600_000).toISOString(),
        participantIds: [ali.memberId],
      })
    ).body;
    const late = await ali.c.put(`/api/meetings/${started.id}/response`, { response: 'accepted' });
    expect(late.body.error.code).toBe('meeting_started');
  });

  it('reminds people coming ten minutes before, once, only in working hours', async () => {
    const day = saturdayIn(2);
    const meeting: Meeting = (
      await maryam.c.post('/api/meetings', {
        type: 'regular',
        title: 'یادآوری',
        startsAt: at(day, '10:05'),
        endsAt: at(day, '10:35'),
        participantIds: [ali.memberId, zahra.memberId],
      })
    ).body;
    await zahra.c.put(`/api/meetings/${meeting.id}/response`, { response: 'declined' });
    const now = zonedInstant(day, '09:56', tz);
    // Too early: starts in more than ten minutes.
    expect(await jobs.remindForTenant(tenantId, zonedInstant(day, '09:50', tz))).toBe(0);
    expect(await jobs.remindForTenant(tenantId, now)).toBe(2); // Ali and Maryam
    expect(await jobs.remindForTenant(tenantId, zonedInstant(day, '09:58', tz))).toBe(0);
    expect(
      (await notificationsOf(ali.memberId, 'meeting_reminder')).map((n) => n.subjectId),
    ).toContain(meeting.id);
    expect(await notificationsOf(zahra.memberId, 'meeting_reminder')).toHaveLength(0);

    // Before the working day: quiet hours would hold it past the start, so nothing.
    const early: Meeting = (
      await maryam.c.post('/api/meetings', {
        type: 'regular',
        title: 'زود',
        startsAt: at(day, '07:05'),
        endsAt: at(day, '07:35'),
        participantIds: [ali.memberId],
      })
    ).body;
    expect(await jobs.remindForTenant(tenantId, zonedInstant(day, '06:58', tz))).toBe(0);
    expect(
      (await notificationsOf(ali.memberId, 'meeting_reminder')).map((n) => n.subjectId),
    ).not.toContain(early.id);
  });

  it('pins minutes to a task: the card and text, never the people; never a one-on-one', async () => {
    const day = saturdayIn(1);
    const meeting: Meeting = (
      await maryam.c.post('/api/meetings', {
        type: 'regular',
        title: 'بررسی هفتگی',
        startsAt: at(day, '12:00'),
        endsAt: at(day, '12:30'),
        participantIds: [ali.memberId],
      })
    ).body;
    const up: Upload = (await ali.c.upload('/api/uploads', PDF, 'صورت‌جلسه.pdf')).body;
    await ali.c.put(`/api/meetings/${meeting.id}/minutes`, {
      body: 'صف بررسی شد؛ **دو مورد** ماند.',
      version: 0,
      uploadIds: [up.id],
    });
    const task: Task = (await ali.c.post('/api/tasks', { title: 'پیگیری صف' })).body;
    // Zahra sees the task (same department) but not the meeting.
    expect((await zahra.c.get(`/api/meetings/${meeting.id}`)).status).toBe(404);
    expect((await zahra.c.download(`/api/attachments/${up.id}/file`)).status).toBe(404);

    const pin = await ali.c.post(`/api/tasks/${task.id}/evidence`, {
      kind: 'minutes',
      subjectId: meeting.id,
    });
    expect(pin.status).toBe(201);
    expect(pin.body.minutes).toMatchObject({
      meeting: { title: 'بررسی هفتگی', type: 'regular' },
      excerpt: 'صف بررسی شد؛ دو مورد ماند.',
      attachmentCount: 1,
    });
    const detail: EvidenceDetail = (
      await zahra.c.get(`/api/tasks/${task.id}/evidence/${pin.body.id}`)
    ).body;
    expect(detail.minutesText).toBe('صف بررسی شد؛ **دو مورد** ماند.');
    expect(JSON.stringify(detail)).not.toContain(maryam.memberId);
    expect((await zahra.c.download(`/api/attachments/${up.id}/file`)).status).toBe(200);
    const pinned: Meeting = (await ali.c.get(`/api/meetings/${meeting.id}`)).body;
    expect(pinned.minutes?.pinnedCount).toBe(1);
    expect((await ali.c.get(`/api/meetings/${meeting.id}/pin-tasks`)).body).toEqual({
      visible: [{ id: task.id, title: 'پیگیری صف' }],
      hidden: 0,
    });
    // Unpinned: the file closes again.
    await ali.c.delete(`/api/tasks/${task.id}/evidence/${pin.body.id}`);
    expect((await zahra.c.download(`/api/attachments/${up.id}/file`)).status).toBe(404);

    // Someone who cannot see the meeting cannot pin it; a one-on-one never.
    const zahraTask: Task = (await zahra.c.post('/api/tasks', { title: 'کار زهرا' })).body;
    expect(
      (
        await zahra.c.post(`/api/tasks/${zahraTask.id}/evidence`, {
          kind: 'minutes',
          subjectId: meeting.id,
        })
      ).status,
    ).toBe(404);
    const oneOnOne: Meeting = (
      await maryam.c.post('/api/meetings', {
        type: 'one_on_one',
        title: 'یک‌به‌یک',
        startsAt: at(day, '13:00'),
        endsAt: at(day, '13:30'),
        participantIds: [ali.memberId],
      })
    ).body;
    await ali.c.put(`/api/meetings/${oneOnOne.id}/minutes`, { body: 'خصوصی', version: 0 });
    expect(oneOnOne.can.pin).toBe(false);
    const refused = await ali.c.post(`/api/tasks/${task.id}/evidence`, {
      kind: 'minutes',
      subjectId: oneOnOne.id,
    });
    expect(refused.body.error.code).toBe('evidence_not_allowed');
  });

  it('another company reaches none of it', async () => {
    const first = await weekly();
    expect((await other.get(`/api/meetings/${first.id}`)).status).toBe(404);
    expect(
      (await other.put(`/api/meetings/${first.id}/response`, { response: 'accepted' })).status,
    ).toBe(404);
    expect((await other.post(`/api/meeting-series/${first.series?.id ?? ''}/cancel`)).status).toBe(
      404,
    );
    const list: MeetingList = (await other.get('/api/meetings')).body;
    expect(list.items).toHaveLength(0);
  });
});
