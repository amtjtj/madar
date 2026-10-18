import { schema as s, withTenant, type DbHandle } from '@madar/db';
import { zonedInstant } from '@madar/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import { and, count, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ENV } from '../src/config/config.module.js';
import { loadEnv, type Env } from '../src/config/env.js';
import { DB_HANDLE } from '../src/database/tokens.js';
import { ConsumerRunner } from '../src/events/consumer-runner.service.js';
import { RelayService } from '../src/events/relay.service.js';
import { Notifier } from '../src/notifications/notifier.js';
import { RemindersService } from '../src/notifications/reminders.service.js';
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

const tehran = (date: string, time: string) => zonedInstant(date, time, 'Asia/Tehran');

describe.skipIf(!hasDatabase)('notifications', () => {
  let app: NestExpressApplication;
  let env: Env;
  let worker: TestingModule;
  let handle: DbHandle;
  let tenantId: string;
  let owner: Client;
  let lead: Person; // support manager
  let agent: Person; // support member
  let colleague: Person; // support member
  let director: Person; // oversight department, not in projects
  let support: { id: string };

  const notificationsOf = (memberId: string, kind?: string) =>
    withTenant(handle.db, { tenantId }, (tx) =>
      tx
        .select()
        .from(s.notifications)
        .where(
          and(
            eq(s.notifications.recipientId, memberId),
            kind ? eq(s.notifications.kind, kind) : undefined,
          ),
        ),
    );

  async function eventually<T>(check: () => Promise<T[]>, count = 1): Promise<T[]> {
    const until = Date.now() + 10_000;
    for (;;) {
      const rows = await check();
      if (rows.length >= count) return rows;
      if (Date.now() > until) return rows;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /** Waits until the worker has drained this tenant's outbox. */
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
    owner = session.c;
    tenantId = session.tenantId;
    support = (await owner.post('/api/departments', { name: 'پشتیبانی' })).body;
    const management = (await owner.post('/api/departments', { name: 'مدیریت' })).body;
    await owner.put(`/api/departments/${management.id}/oversight`, {
      resources: ['task', 'project'],
    });
    const dept = (departmentId: string, deptRole = 'member') => [
      { departmentId, deptRole, isPrimary: true },
    ];
    lead = await memberSession(app, env, owner, { departments: dept(support.id, 'manager') });
    agent = await memberSession(app, env, owner, { departments: dept(support.id) });
    colleague = await memberSession(app, env, owner, { departments: dept(support.id) });
    director = await memberSession(app, env, owner, { departments: dept(management.id) });

    worker = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(ENV)
      .useValue({ ...loadEnv(), QUEUE_PREFIX: unique('test-n-'), RELAY_INTERVAL_MS: 100 })
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

  it('notifies the assignee, not the person who assigned', async () => {
    const task = (
      await lead.c.post('/api/tasks', { title: 'پیگیری تیکت ۴۲', assigneeId: agent.memberId })
    ).body;
    const [n] = await eventually(() => notificationsOf(agent.memberId, 'task_assigned'));
    expect(n).toMatchObject({
      subjectId: task.id,
      actorId: lead.memberId,
      payload: { title: 'پیگیری تیکت ۴۲' },
    });
    await settle();
    expect(await notificationsOf(lead.memberId, 'task_assigned')).toHaveLength(0);
    // Assigning a task to yourself does not notify you.
    await agent.c.post('/api/tasks', { title: 'کار خودم' });
    await settle();
    expect(await notificationsOf(agent.memberId, 'task_assigned')).toHaveLength(1);
  });

  it('tells everyone involved about a comment except its author', async () => {
    const task = (
      await lead.c.post('/api/tasks', { title: 'پاسخ به شکایت', assigneeId: agent.memberId })
    ).body;
    await lead.c.put(`/api/tasks/${task.id}/collaborators`, {
      members: [{ memberId: colleague.memberId, kind: 'watcher' }],
    });
    await agent.c.post(`/api/tasks/${task.id}/comments`, { body: 'انجام شد' });
    const forLead = await eventually(() => notificationsOf(lead.memberId, 'task_commented'));
    expect(forLead.map((n) => n.subjectId)).toContain(task.id);
    expect(
      (await eventually(() => notificationsOf(colleague.memberId, 'task_commented'))).length,
    ).toBe(1);
    await settle();
    expect(await notificationsOf(agent.memberId, 'task_commented')).toHaveLength(0);
  });

  it('never tells a manager about a private-project task they cannot see', async () => {
    const project = (
      await agent.c.post('/api/projects', {
        name: 'محرمانه',
        departmentId: support.id,
        visibility: 'private',
      })
    ).body;
    const task = (
      await agent.c.post('/api/tasks', {
        title: 'کار محرمانه',
        projectId: project.id,
        dueOn: '2026-10-15',
      })
    ).body;
    await settle();
    await worker.get(RemindersService).runForTenant(tenantId, tehran('2026-10-19', '09:15'));
    const forLead = await notificationsOf(lead.memberId, 'task_overdue_escalation');
    expect(forLead.some((n) => n.subjectId === task.id)).toBe(false);
    const forAgent = await notificationsOf(agent.memberId, 'task_overdue');
    expect(forAgent.some((n) => n.subjectId === task.id)).toBe(true);
  });

  it('respects muted kinds', async () => {
    await withTenant(handle.db, { tenantId }, (tx) =>
      tx
        .insert(s.notificationPreferences)
        .values({ memberId: colleague.memberId, mutedKinds: ['task_assigned'] }),
    );
    await lead.c.post('/api/tasks', { title: 'بی‌صدا', assigneeId: colleague.memberId });
    await settle();
    expect(await notificationsOf(colleague.memberId, 'task_assigned')).toHaveLength(0);
  });

  it('tells new project members, not existing ones', async () => {
    const project = (
      await lead.c.post('/api/projects', {
        name: 'کمپین',
        departmentId: support.id,
        memberIds: [agent.memberId],
      })
    ).body;
    await eventually(() => notificationsOf(agent.memberId, 'project_member_added'));
    await lead.c.put(`/api/projects/${project.id}/members`, {
      members: [
        { memberId: agent.memberId, role: 'member' },
        { memberId: colleague.memberId, role: 'member' },
      ],
    });
    await eventually(() => notificationsOf(colleague.memberId, 'project_member_added'));
    await settle();
    expect(await notificationsOf(agent.memberId, 'project_member_added')).toHaveLength(1);
    expect(await notificationsOf(lead.memberId, 'project_member_added')).toHaveLength(0);
  });

  it('holds notifications created at night until the next working morning', async () => {
    const task = (await lead.c.post('/api/tasks', { title: 'شبانه', assigneeId: agent.memberId }))
      .body;
    await settle();
    const notifier = worker.get(Notifier);
    // Thursday 20:00 (after the half day) → Saturday 09:00
    await withTenant(handle.db, { tenantId }, (tx) =>
      notifier.notify(tx, {
        tenantId,
        recipientId: agent.memberId,
        kind: 'task_commented',
        subjectType: 'task',
        subjectId: task.id,
        actorId: lead.memberId,
        payload: { title: 'شبانه' },
        dedupeKey: `night:${task.id}`,
        now: tehran('2026-10-22', '20:00'),
      }),
    );
    const [n] = (await notificationsOf(agent.memberId)).filter(
      (x) => x.dedupeKey === `night:${task.id}`,
    );
    expect(n?.deliverAfter.toISOString()).toBe(tehran('2026-10-24', '09:00').toISOString());
  });

  it('sends due-date reminders once, at the start of the working day, and escalates to managers', async () => {
    const reminders = worker.get(RemindersService);
    // "Now" is Monday 2026-10-19.
    const soon = (
      await lead.c.post('/api/tasks', {
        title: 'سررسید فردا',
        assigneeId: agent.memberId,
        dueOn: '2026-10-20',
      })
    ).body;
    const late = (
      await lead.c.post('/api/tasks', {
        title: 'سه روز عقب',
        assigneeId: agent.memberId,
        dueOn: '2026-10-15',
      })
    ).body;
    const slightly = (
      await lead.c.post('/api/tasks', {
        title: 'یک روز عقب',
        assigneeId: agent.memberId,
        dueOn: '2026-10-18',
      })
    ).body;
    const own = (await lead.c.post('/api/tasks', { title: 'کار مدیر', dueOn: '2026-10-11' })).body;
    await settle();

    expect(await reminders.runForTenant(tenantId, tehran('2026-10-19', '08:30'))).toBe(0);
    await reminders.runForTenant(tenantId, tehran('2026-10-19', '09:15'));
    const ids = async (memberId: string, kind: string) =>
      (await notificationsOf(memberId, kind)).map((n) => n.subjectId);

    expect(await ids(agent.memberId, 'task_due_soon')).toContain(soon.id);
    expect(await ids(agent.memberId, 'task_overdue')).toEqual(
      expect.arrayContaining([late.id, slightly.id]),
    );
    // Thursday half day, Saturday and Sunday... Monday: 3 working days late → the manager is told.
    expect(await ids(lead.memberId, 'task_overdue_escalation')).toContain(late.id);
    expect(await ids(lead.memberId, 'task_overdue_escalation')).not.toContain(slightly.id);
    // Oversight readers are not managers of the department: no escalation for them.
    expect(await ids(director.memberId, 'task_overdue_escalation')).toEqual([]);
    // A manager is not "escalated" about their own task.
    expect(await ids(lead.memberId, 'task_overdue_escalation')).not.toContain(own.id);

    // Running again (every 15 minutes) creates nothing new.
    expect(await reminders.runForTenant(tenantId, tehran('2026-10-19', '09:30'))).toBe(0);
    // Friday: no working day, no reminders.
    expect(await reminders.runForTenant(tenantId, tehran('2026-10-23', '10:00'))).toBe(0);
  });

  describe('API', () => {
    it('lists only my notifications, marks them read, and hides others (also across companies)', async () => {
      await lead.c.post('/api/tasks', { title: 'برای فهرست', assigneeId: agent.memberId });
      await eventually(async () => {
        const res = await agent.c.get('/api/notifications');
        return res.body.items.filter((n: { title: string }) => n.title === 'برای فهرست');
      });
      const list = await agent.c.get('/api/notifications?limit=50');
      expect(list.status).toBe(200);
      const item = list.body.items.find((n: { title: string }) => n.title === 'برای فهرست');
      expect(item).toMatchObject({ kind: 'task_assigned', subjectType: 'task', readAt: null });
      expect(item.actor.id).toBe(lead.memberId);
      expect(list.body.unreadCount).toBeGreaterThan(0);

      // Someone else, in the same company or another one, cannot read or mark it.
      expect((await colleague.c.post(`/api/notifications/${item.id}/read`)).status).toBe(404);
      const other = await ownerSession(app, env);
      expect((await other.c.post(`/api/notifications/${item.id}/read`)).status).toBe(404);
      expect((await other.c.get('/api/notifications')).body.items).toEqual([]);

      expect((await agent.c.post(`/api/notifications/${item.id}/read`)).status).toBe(204);
      const after = await agent.c.get('/api/notifications?limit=50');
      expect(after.body.items.find((n: { id: string }) => n.id === item.id).readAt).not.toBeNull();

      const colleagueUnread = (await colleague.c.get('/api/notifications/unread-count')).body
        .unreadCount;
      expect((await agent.c.post('/api/notifications/read-all')).status).toBe(204);
      expect((await agent.c.get('/api/notifications/unread-count')).body.unreadCount).toBe(0);
      // read-all touched only my own notifications.
      expect((await colleague.c.get('/api/notifications/unread-count')).body.unreadCount).toBe(
        colleagueUnread,
      );
    });

    it('orders by when things happened and pages with a cursor', async () => {
      const all = (await agent.c.get('/api/notifications?limit=100')).body.items as Array<{
        id: string;
        createdAt: string;
      }>;
      expect(all.length).toBeGreaterThan(2);
      const times = all.map((n) => n.createdAt);
      expect([...times].sort().reverse()).toEqual(times);
      const first = (await agent.c.get('/api/notifications?limit=2')).body.items;
      const next = (await agent.c.get(`/api/notifications?limit=2&before=${first[1].id}`)).body
        .items;
      expect(next[0].id).toBe(all[2]?.id);
    });

    it('saves my preferences', async () => {
      const initial = await agent.c.get('/api/me/notification-preferences');
      expect(initial.body).toEqual({ mutedKinds: [], offHours: false });
      const saved = await agent.c.put('/api/me/notification-preferences', {
        mutedKinds: ['task_commented'],
        offHours: true,
      });
      expect(saved.body).toEqual({ mutedKinds: ['task_commented'], offHours: true });
      expect((await agent.c.get('/api/me/notification-preferences')).body.offHours).toBe(true);
      expect(
        (
          await agent.c.put('/api/me/notification-preferences', {
            mutedKinds: ['nope'],
            offHours: false,
          })
        ).status,
      ).toBe(400);
    });

    it('lets everyone read the work calendar and only the owner change it (audited)', async () => {
      const read = await agent.c.get('/api/work-calendar');
      expect(read.body.weeklyHours[5]).toEqual({ start: '09:00', end: '13:00' }); // Thursday half day
      expect(read.body.weeklyHours[6]).toBeNull(); // Friday
      const calendar = { ...read.body, holidays: ['2026-11-01'], overdueEscalationDays: 3 };
      expect((await lead.c.put('/api/work-calendar', calendar)).status).toBe(403);
      const saved = await owner.put('/api/work-calendar', calendar);
      expect(saved.status).toBe(200);
      expect(saved.body.overdueEscalationDays).toBe(3);
      expect((await agent.c.get('/api/work-calendar')).body.holidays).toEqual(['2026-11-01']);
      const bad = {
        ...calendar,
        weeklyHours: [{ start: '18:00', end: '09:00' }, ...calendar.weeklyHours.slice(1)],
      };
      expect((await owner.put('/api/work-calendar', bad)).status).toBe(400);
      const audit = await owner.get('/api/audit-logs');
      expect(audit.body.map((e: { action: string }) => e.action)).toContain(
        'work_calendar.updated',
      );
    });
  });
});
