import { createDb, schema as s, withTenant, type DbHandle } from '@madar/db';
import type { GoalPeriod, Meeting, MeetingList, MeetingSummary, Task, Upload } from '@madar/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import { and, count, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ENV } from '../src/config/config.module.js';
import { loadEnv, type Env } from '../src/config/env.js';
import { DB_HANDLE } from '../src/database/tokens.js';
import { ConsumerRunner } from '../src/events/consumer-runner.service.js';
import { RelayService } from '../src/events/relay.service.js';
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

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n');
const HOUR = 3_600_000;
const at = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * HOUR).toISOString();

describe.skipIf(!hasDatabase)('meetings', () => {
  let app: NestExpressApplication;
  let env: Env;
  let worker: TestingModule;
  let handle: DbHandle;
  let tenantId: string;
  let owner: Person;
  let maryam: Person; // support manager, the organizer
  let ali: Person; // support
  let zahra: Person; // support
  let reza: Person; // marketing, not invited
  let director: Person; // management, oversees meetings
  let other: Client; // another company
  let keyResultId: string;

  async function schedule(by: Person, input: Record<string, unknown> = {}): Promise<Meeting> {
    const res = await by.c.post('/api/meetings', {
      type: 'regular',
      title: 'بررسی صف برداشت',
      startsAt: at(2),
      endsAt: at(3),
      agenda: '- صف امروز\n- **تاخیرها**',
      participantIds: [ali.memberId, zahra.memberId],
      ...input,
    });
    if (res.status !== 201) throw new Error(`schedule failed: ${res.status} ${res.text}`);
    return res.body;
  }

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

  beforeAll(async () => {
    ({ app, env } = await createTestApp());
    const session = await ownerSession(app, env);
    tenantId = session.tenantId;
    owner = { c: session.c, memberId: (await session.c.get('/api/me')).body.member.id };
    const support = (await owner.c.post('/api/departments', { name: 'پشتیبانی' })).body;
    const marketing = (await owner.c.post('/api/departments', { name: 'مارکتینگ' })).body;
    const management = (await owner.c.post('/api/departments', { name: 'مدیریت' })).body;
    await owner.c.put(`/api/departments/${management.id}/oversight`, { resources: ['meeting'] });
    const dept = (id: string, deptRole = 'member') => [
      { departmentId: id, deptRole, isPrimary: true },
    ];
    maryam = await memberSession(app, env, owner.c, { departments: dept(support.id, 'manager') });
    ali = await memberSession(app, env, owner.c, { departments: dept(support.id) });
    zahra = await memberSession(app, env, owner.c, { departments: dept(support.id) });
    reza = await memberSession(app, env, owner.c, { departments: dept(marketing.id) });
    director = await memberSession(app, env, owner.c, { departments: dept(management.id) });
    other = (await ownerSession(app, env)).c;

    const periods: GoalPeriod[] = (await owner.c.get('/api/goal-periods')).body;
    const period = periods.find((p) => p.current) as GoalPeriod;
    const goal = (
      await owner.c.post('/api/goals', {
        periodId: period.id,
        level: 'company',
        title: 'تجربه بهتر برداشت',
        keyResults: [{ title: 'زمان پاسخ', kind: 'number', startValue: 0, targetValue: 10 }],
      })
    ).body;
    keyResultId = goal.keyResults[0].id;

    worker = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(ENV)
      .useValue({ ...loadEnv(), QUEUE_PREFIX: unique('test-m-'), RELAY_INTERVAL_MS: 100 })
      .compile();
    await worker.init();
    handle = worker.get<DbHandle>(DB_HANDLE);
    worker.get(ConsumerRunner).start();
    worker.get(RelayService).start([tenantId]);
  });
  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  it('schedules a meeting its people and oversight see, nobody else', async () => {
    const meeting = await schedule(maryam);
    expect(meeting).toMatchObject({
      type: 'regular',
      participantCount: 3,
      hasMinutes: false,
      canceledAt: null,
      can: { edit: true, record: true, convert: true },
    });
    expect(meeting.participants[0]?.id).toBe(maryam.memberId);
    expect(meeting.department.name).toBe('پشتیبانی');

    const seen = await ali.c.get(`/api/meetings/${meeting.id}`);
    expect(seen.status).toBe(200);
    expect(seen.body.can).toEqual({ edit: false, record: true, convert: true });
    expect((await reza.c.get(`/api/meetings/${meeting.id}`)).status).toBe(404);
    // No role is an exception: the owner is not in it and oversees nothing.
    expect((await owner.c.get(`/api/meetings/${meeting.id}`)).status).toBe(404);
    const watched = await director.c.get(`/api/meetings/${meeting.id}`);
    expect(watched.status).toBe(200);
    expect(watched.body.can).toEqual({ edit: false, record: false, convert: false });
    expect((await other.get(`/api/meetings/${meeting.id}`)).status).toBe(404);

    const upcoming: MeetingList = (await ali.c.get('/api/meetings?range=upcoming')).body;
    expect(upcoming.items.map((m) => m.id)).toContain(meeting.id);
    const forReza: MeetingList = (await reza.c.get('/api/meetings?range=upcoming')).body;
    expect(forReza.items.map((m) => m.id)).not.toContain(meeting.id);

    await settle();
    const invited = await notificationsOf(ali.memberId, 'meeting_invited');
    expect(invited.some((n) => n.subjectId === meeting.id)).toBe(true);
    expect(invited.find((n) => n.subjectId === meeting.id)?.payload).toMatchObject({
      title: 'بررسی صف برداشت',
      data: { startsAt: meeting.startsAt },
    });
    expect(await notificationsOf(maryam.memberId, 'meeting_invited')).toHaveLength(0);
  });

  it('keeps a one-on-one between its two people, even from oversight', async () => {
    const res = await maryam.c.post('/api/meetings', {
      type: 'one_on_one',
      title: 'گفت‌وگوی ماهانه',
      startsAt: at(5),
      endsAt: at(6),
      participantIds: [ali.memberId, zahra.memberId],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('one_on_one_needs_one');
    const oneOnOne = await schedule(maryam, { type: 'one_on_one', participantIds: [ali.memberId] });
    expect((await ali.c.get(`/api/meetings/${oneOnOne.id}`)).status).toBe(200);
    expect((await director.c.get(`/api/meetings/${oneOnOne.id}`)).status).toBe(404);
    const watched: MeetingList = (await director.c.get('/api/meetings')).body;
    expect(watched.items.map((m) => m.id)).not.toContain(oneOnOne.id);
    const more = await maryam.c.patch(`/api/meetings/${oneOnOne.id}`, {
      participantIds: [ali.memberId, zahra.memberId],
    });
    expect(more.body.error.code).toBe('one_on_one_needs_one');
  });

  it('checks times, links and people', async () => {
    const bad = (input: Record<string, unknown>) =>
      maryam.c.post('/api/meetings', {
        type: 'regular',
        title: 'x',
        startsAt: at(2),
        endsAt: at(3),
        participantIds: [],
        ...input,
      });
    expect((await bad({ endsAt: at(1) })).body.error.code).toBe('meeting_time_invalid');
    expect((await bad({ endsAt: at(30) })).body.error.code).toBe('meeting_time_invalid');
    expect((await bad({ link: 'javascript:alert(1)' })).body.error.code).toBe(
      'meeting_link_invalid',
    );
    const otherMember = (await other.get('/api/me')).body.member.id;
    expect((await bad({ participantIds: [otherMember] })).status).toBe(404);
    const ok = await bad({ link: 'https://meet.example.ir/room', location: ' اتاق ۲ ' });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ link: 'https://meet.example.ir/room', location: 'اتاق ۲' });
  });

  it('lets only the organizer change or cancel it; changes notify, a canceled one is frozen', async () => {
    const meeting = await schedule(maryam);
    expect((await ali.c.patch(`/api/meetings/${meeting.id}`, { title: 'دست‌کاری' })).status).toBe(
      403,
    );
    expect((await ali.c.post(`/api/meetings/${meeting.id}/cancel`)).status).toBe(403);

    // Agenda only: no notification. New time and a new person: both notified.
    await maryam.c.patch(`/api/meetings/${meeting.id}`, { agenda: 'دستور تازه' });
    const moved = await maryam.c.patch(`/api/meetings/${meeting.id}`, {
      startsAt: at(4),
      endsAt: at(5),
      participantIds: [ali.memberId, reza.memberId],
    });
    expect(moved.status).toBe(200);
    expect(moved.body.participants.map((p: { id: string }) => p.id).sort()).toEqual(
      [maryam.memberId, ali.memberId, reza.memberId].sort(),
    );
    expect((await zahra.c.get(`/api/meetings/${meeting.id}`)).status).toBe(404);
    expect((await reza.c.get(`/api/meetings/${meeting.id}`)).status).toBe(200);
    await settle();
    const changed = (await notificationsOf(ali.memberId, 'meeting_changed')).filter(
      (n) => n.subjectId === meeting.id,
    );
    expect(changed).toHaveLength(1);
    expect(
      (await notificationsOf(reza.memberId, 'meeting_invited')).some(
        (n) => n.subjectId === meeting.id,
      ),
    ).toBe(true);

    const done = await maryam.c.post(`/api/meetings/${meeting.id}/cancel`);
    expect(done.status).toBe(200);
    expect(done.body.canceledAt).not.toBeNull();
    expect(done.body.can).toEqual({ edit: false, record: false, convert: false });
    const again = await maryam.c.patch(`/api/meetings/${meeting.id}`, { title: 'دوباره' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('meeting_canceled');
    const minutes = await ali.c.put(`/api/meetings/${meeting.id}/minutes`, {
      body: 'x',
      version: 0,
    });
    expect(minutes.body.error.code).toBe('meeting_canceled');
    await settle();
    expect(
      (await notificationsOf(ali.memberId, 'meeting_canceled')).some(
        (n) => n.subjectId === meeting.id,
      ),
    ).toBe(true);
    // Still there, read-only.
    expect((await ali.c.get(`/api/meetings/${meeting.id}`)).status).toBe(200);
  });

  it('removes people only before the meeting starts', async () => {
    const meeting = await schedule(maryam, { startsAt: at(-0.5), endsAt: at(0.5) });
    const res = await maryam.c.patch(`/api/meetings/${meeting.id}`, {
      participantIds: [ali.memberId],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('meeting_started');
    const added = await maryam.c.patch(`/api/meetings/${meeting.id}`, {
      participantIds: [ali.memberId, zahra.memberId, reza.memberId],
    });
    expect(added.status).toBe(200);
    const today: MeetingSummary[] = (await ali.c.get('/api/meetings/today')).body;
    expect(today.map((m) => m.id)).toContain(meeting.id);
    // Seen through oversight, not taken part: not on the director's today card.
    const forDirector: MeetingSummary[] = (await director.c.get('/api/meetings/today')).body;
    expect(forDirector.map((m) => m.id)).not.toContain(meeting.id);
  });

  it('records minutes with files; a stale version is refused; only the first save notifies', async () => {
    const meeting = await schedule(maryam);
    const up: Upload = (await ali.c.upload('/api/uploads', PDF, 'صورت‌جلسه.pdf')).body;
    const first = await ali.c.put(`/api/meetings/${meeting.id}/minutes`, {
      body: '- صف امروز بررسی شد',
      version: 0,
      uploadIds: [up.id],
    });
    expect(first.status).toBe(200);
    expect(first.body.minutes).toMatchObject({
      body: '- صف امروز بررسی شد',
      version: 1,
      recordedBy: { id: ali.memberId },
    });
    expect(first.body.minutes.attachments).toHaveLength(1);
    expect(first.body.hasMinutes).toBe(true);

    const stale = await zahra.c.put(`/api/meetings/${meeting.id}/minutes`, {
      body: 'متن دیگر',
      version: 0,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('minutes_version_conflict');
    const second = await zahra.c.put(`/api/meetings/${meeting.id}/minutes`, {
      body: '- صف امروز بررسی شد\n- تاخیرها پیگیری شود',
      version: 1,
    });
    expect(second.body.minutes).toMatchObject({ version: 2, updatedBy: { id: zahra.memberId } });
    expect(
      (
        await director.c.put(`/api/meetings/${meeting.id}/minutes`, {
          body: 'x',
          version: 2,
        })
      ).status,
    ).toBe(403);

    // The file opens for whoever sees the meeting, nobody else.
    const fileUrl = `/api/attachments/${up.id}/file`;
    expect((await zahra.c.download(fileUrl)).status).toBe(200);
    expect((await director.c.download(fileUrl)).status).toBe(200);
    expect((await reza.c.download(fileUrl)).status).toBe(404);
    expect((await other.download(fileUrl)).status).toBe(404);
    // A participant may remove it; oversight may not.
    expect((await director.c.delete(`/api/attachments/${up.id}`)).status).toBe(403);
    expect((await zahra.c.delete(`/api/attachments/${up.id}`)).status).toBe(204);
    const [audit] = await withTenant(handle.db, { tenantId }, (tx) =>
      tx
        .select({ before: s.auditLogs.before })
        .from(s.auditLogs)
        .where(and(eq(s.auditLogs.subjectId, up.id), eq(s.auditLogs.action, 'attachment.deleted'))),
    );
    // A one-on-one's minutes can be private: the log keeps no file name.
    expect(JSON.stringify(audit?.before)).not.toContain('صورت‌جلسه.pdf');

    await settle();
    const told = (await notificationsOf(maryam.memberId, 'meeting_minutes')).filter(
      (n) => n.subjectId === meeting.id,
    );
    expect(told).toHaveLength(1);
    expect(
      (await notificationsOf(ali.memberId, 'meeting_minutes')).filter(
        (n) => n.subjectId === meeting.id,
      ),
    ).toHaveLength(0);
  });

  it('turns a decision into a task with source «meeting» and a link back', async () => {
    const meeting = await schedule(maryam);
    const withDecisions = (
      await ali.c.post(`/api/meetings/${meeting.id}/decisions`, {
        text: 'صف برداشت هر روز ساعت ۹ بررسی شود',
      })
    ).body as Meeting;
    const decision = withDecisions.decisions[0];
    expect(decision).toMatchObject({ task: null, keyResult: null });
    const second = (await ali.c.post(`/api/meetings/${meeting.id}/decisions`, { text: 'حذف شود' }))
      .body as Meeting;
    const removable = second.decisions[1];
    const removed = await ali.c.delete(
      `/api/meetings/${meeting.id}/decisions/${removable?.id ?? ''}`,
    );
    expect(removed.body.decisions).toHaveLength(1);

    const res = await maryam.c.post(
      `/api/meetings/${meeting.id}/decisions/${decision?.id ?? ''}/task`,
      { title: 'بررسی روزانه صف برداشت', assigneeId: ali.memberId, dueOn: '2026-12-01' },
    );
    expect(res.status).toBe(201);
    const task: Task = res.body;
    expect(task).toMatchObject({
      title: 'بررسی روزانه صف برداشت',
      assignee: { id: ali.memberId },
      dueOn: '2026-12-01',
      source: { kind: 'meeting' },
      department: { name: 'پشتیبانی' },
      meeting: { id: meeting.id, title: 'بررسی صف برداشت', visible: true },
    });
    const forAli: Task = (await ali.c.get(`/api/tasks/${task.id}`)).body;
    expect(forAli.meeting).toEqual({ id: meeting.id, title: 'بررسی صف برداشت', visible: true });

    const again = await maryam.c.post(
      `/api/meetings/${meeting.id}/decisions/${decision?.id ?? ''}/task`,
      { title: 'دوباره' },
    );
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('decision_has_task');
    expect(
      (await ali.c.delete(`/api/meetings/${meeting.id}/decisions/${decision?.id ?? ''}`)).body.error
        .code,
    ).toBe('decision_has_task');

    const after: Meeting = (await zahra.c.get(`/api/meetings/${meeting.id}`)).body;
    expect(after.decisions[0]?.task).toMatchObject({
      id: task.id,
      visible: true,
      title: 'بررسی روزانه صف برداشت',
      assignee: { id: ali.memberId },
    });
    // The director sees the meeting but not support's task: the decision says only that one exists.
    const watched: Meeting = (await director.c.get(`/api/meetings/${meeting.id}`)).body;
    expect(watched.decisions[0]?.task).toEqual({
      id: task.id,
      visible: false,
      title: null,
      assignee: null,
    });
    await settle();
    expect(
      (await notificationsOf(ali.memberId, 'task_assigned')).some((n) => n.subjectId === task.id),
    ).toBe(true);
  });

  it('links a decision of an OKR review to a key result', async () => {
    const regular = await schedule(maryam);
    const plain = (await maryam.c.post(`/api/meetings/${regular.id}/decisions`, { text: 'عادی' }))
      .body as Meeting;
    const refused = await maryam.c.post(
      `/api/meetings/${regular.id}/decisions/${plain.decisions[0]?.id ?? ''}/task`,
      { title: 'عادی', keyResultId },
    );
    expect(refused.status).toBe(400);

    const review = await schedule(maryam, { type: 'okr_review', title: 'بررسی OKR فصل' });
    const withDecision = (
      await maryam.c.post(`/api/meetings/${review.id}/decisions`, { text: 'کاهش زمان پاسخ' })
    ).body as Meeting;
    const decisionId = withDecision.decisions[0]?.id ?? '';
    const res = await maryam.c.post(`/api/meetings/${review.id}/decisions/${decisionId}/task`, {
      title: 'کاهش زمان پاسخ',
      keyResultId,
    });
    expect(res.status).toBe(201);
    expect(res.body.keyResult).toMatchObject({ id: keyResultId });
    // No assignee yet, still «from a meeting».
    expect(res.body.source).toMatchObject({ kind: 'meeting' });
    const after: Meeting = (await maryam.c.get(`/api/meetings/${review.id}`)).body;
    expect(after.decisions[0]?.keyResult).toMatchObject({ id: keyResultId });
  });

  it('never shows a one-on-one title to a task viewer outside it', async () => {
    const oneOnOne = await schedule(maryam, {
      type: 'one_on_one',
      title: 'گفت‌وگوی ماهانه',
      participantIds: [ali.memberId],
    });
    const withDecision = (
      await maryam.c.post(`/api/meetings/${oneOnOne.id}/decisions`, { text: 'دوره آموزشی' })
    ).body as Meeting;
    const task: Task = (
      await maryam.c.post(
        `/api/meetings/${oneOnOne.id}/decisions/${withDecision.decisions[0]?.id ?? ''}/task`,
        { title: 'دوره آموزشی', assigneeId: zahra.memberId },
      )
    ).body;
    const forZahra: Task = (await zahra.c.get(`/api/tasks/${task.id}`)).body;
    expect(forZahra.meeting).toEqual({ id: oneOnOne.id, title: null, visible: false });
  });

  it('keeps past meetings in pages, newest first', async () => {
    const ids: string[] = [];
    for (const h of [-30, -28, -26]) {
      ids.push((await schedule(maryam, { startsAt: at(h), endsAt: at(h + 1) })).id);
    }
    const first: MeetingList = (await ali.c.get('/api/meetings?range=past&limit=2')).body;
    expect(first.items.map((m) => m.id)).toEqual([ids[2], ids[1]]);
    expect(first.next).not.toBeNull();
    const next: MeetingList = (
      await ali.c.get(
        `/api/meetings?range=past&limit=2&cursor=${encodeURIComponent(first.next ?? '')}`,
      )
    ).body;
    expect(next.items.map((m) => m.id)).toContain(ids[0]);
  });

  it('pages upcoming meetings nearest first and refuses a malformed cursor', async () => {
    const ids: string[] = [];
    for (const h of [200, 201, 202]) {
      ids.push((await schedule(maryam, { startsAt: at(h), endsAt: at(h + 0.5) })).id);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const page: MeetingList = (await maryam.c.get(`/api/meetings?range=upcoming&limit=2${query}`))
        .body;
      seen.push(...page.items.map((m) => m.id));
      cursor = page.next;
    } while (cursor);
    expect(seen.filter((id) => ids.includes(id))).toEqual(ids);
    const bad = await maryam.c.get(
      `/api/meetings?cursor=${encodeURIComponent('2026-01-01T00:00:00.000000Z_' + '-'.repeat(36))}`,
    );
    expect(bad.status).toBe(400);
  });

  it('a read-only company opens meetings but changes nothing', async () => {
    const meeting = await schedule(maryam);
    loadEnv();
    const ownerDb = createDb(process.env.DATABASE_URL ?? '');
    const setStatus = (status: 'active' | 'read_only') =>
      ownerDb.db.update(s.tenants).set({ status }).where(eq(s.tenants.id, tenantId));
    try {
      await setStatus('read_only');
      expect((await ali.c.get(`/api/meetings/${meeting.id}`)).status).toBe(200);
      const res = await maryam.c.post('/api/meetings', {
        type: 'regular',
        title: 'x',
        startsAt: at(2),
        endsAt: at(3),
        participantIds: [],
      });
      expect(res.status).toBe(423);
      expect(
        (await ali.c.put(`/api/meetings/${meeting.id}/minutes`, { body: 'x', version: 0 })).status,
      ).toBe(423);
    } finally {
      await setStatus('active');
      await ownerDb.pool.end();
    }
  });
});
