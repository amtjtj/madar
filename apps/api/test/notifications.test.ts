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
});
