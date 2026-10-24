import { schema as s, withTenant, type DbHandle } from '@madar/db';
import {
  addDays,
  calendarDateIn,
  persianWeekdayOfCalendarDate,
  zonedInstant,
  type GoalPeriod,
  type MyProgress,
  type StreakDay,
  type XpEntry,
} from '@madar/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import { count, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ENV } from '../src/config/config.module.js';
import { loadEnv, type Env } from '../src/config/env.js';
import { DB_HANDLE } from '../src/database/tokens.js';
import { ConsumerRunner } from '../src/events/consumer-runner.service.js';
import { RelayService } from '../src/events/relay.service.js';
import { GamificationConsumer } from '../src/gamification/gamification.consumer.js';
import { StreakJob } from '../src/gamification/streak-job.js';
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

const TZ = 'Asia/Tehran';

describe.skipIf(!hasDatabase)('gamification: XP, levels and streaks (ADR 0029)', () => {
  let app: NestExpressApplication;
  let env: Env;
  let worker: TestingModule;
  let handle: DbHandle;
  let tenantId: string;
  let owner: Client;
  let head: Person; // support head, the agent's manager
  let agent: Person;
  let other: Client; // another company
  const today = calendarDateIn(new Date(), TZ);

  const progressOf = async (p: { c: Client }) =>
    (await p.c.get('/api/me/progress')).body as MyProgress;

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

  async function xpBecomes(p: { c: Client }, xp: number): Promise<MyProgress> {
    const until = Date.now() + 10_000;
    for (;;) {
      const progress = await progressOf(p);
      if (progress.xp === xp || Date.now() > until) return progress;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const task = async (by: Client, body: object) =>
    (await by.post('/api/tasks', { title: 'کار', ...body })).body as {
      id: string;
      version: number;
    };
  const finish = async (by: Client, t: { id: string }) => {
    const current = (await by.get(`/api/tasks/${t.id}`)).body;
    return by.patch(`/api/tasks/${t.id}`, { statusKey: 'done', version: current.version });
  };
  const reopen = async (by: Client, t: { id: string }) => {
    const current = (await by.get(`/api/tasks/${t.id}`)).body;
    return by.patch(`/api/tasks/${t.id}`, { statusKey: 'todo', version: current.version });
  };

  beforeAll(async () => {
    ({ app, env } = await createTestApp());
    const session = await ownerSession(app, env);
    owner = session.c;
    tenantId = session.tenantId;
    const support = (await owner.post('/api/departments', { name: 'پشتیبانی' })).body;
    const dept = (deptRole: string) => [{ departmentId: support.id, deptRole, isPrimary: true }];
    head = await memberSession(app, env, owner, { departments: dept('head') });
    agent = await memberSession(app, env, owner, {
      departments: dept('member'),
      managerId: head.memberId,
    });
    other = (await ownerSession(app, env)).c;
    // A roomy cap while the XP rules are tested; the cap has its own test.
    await owner.put('/api/settings/gamification', {
      enabled: true,
      completeDayPercent: 70,
      dailyXpCap: 1000,
    });

    worker = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(ENV)
      .useValue({ ...loadEnv(), QUEUE_PREFIX: unique('test-g-'), RELAY_INTERVAL_MS: 100 })
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

  let weighted: { id: string };

  it('pays for finished work by the manager’s weight, with a little extra on time', async () => {
    weighted = await task(head.c, { assigneeId: agent.memberId, weight: 3, dueOn: today });
    expect((await finish(agent.c, weighted)).status).toBe(200);
    const progress = await xpBecomes(agent, 45);
    expect(progress).toMatchObject({ enabled: true, xp: 45, level: 1, levelInto: 45 });
    expect(progress.today.xp).toBe(45);
    const history = (await agent.c.get('/api/me/xp')).body as XpEntry[];
    expect(history.map((e) => [e.reason, e.amount]).sort()).toEqual([
      ['on_time', 15],
      ['task_completed', 30],
    ]);
    expect(history[0]?.task).toMatchObject({ id: weighted.id, weight: 3 });
    // The manager who gave the work earns nothing from it.
    expect((await progressOf(head)).xp).toBe(0);
  });

  it('gives a self-made task almost nothing', async () => {
    const mine = await task(agent.c, { assigneeId: agent.memberId, dueOn: today });
    await finish(agent.c, mine);
    expect((await xpBecomes(agent, 47)).xp).toBe(47);
  });

  it('takes XP back when work is reopened, and pays again when it is finished again', async () => {
    await reopen(agent.c, weighted);
    expect((await xpBecomes(agent, 2)).xp).toBe(2);
    const history = (await agent.c.get('/api/me/xp')).body as XpEntry[];
    expect(history[0]).toMatchObject({
      reason: 'reversal',
      amount: -45,
      reversed: 'task_completed',
    });
    await finish(agent.c, weighted);
    expect((await xpBecomes(agent, 47)).xp).toBe(47);
  });

  it('a repeated event pays once', async () => {
    const consumer = worker.get(GamificationConsumer);
    const event = {
      id: randomUUID(),
      tenantId,
      type: 'task.completed',
      version: 1,
      payload: {
        taskId: weighted.id,
        assigneeId: agent.memberId,
        weight: 1,
        dueOn: null,
        source: 'assigned',
        completedAt: '2026-01-03T08:00:00.000Z',
      },
      actorId: agent.memberId,
      occurredAt: new Date(),
    };
    for (let i = 0; i < 2; i++) {
      await withTenant(handle.db, { tenantId }, (tx) => consumer.handle(tx, event));
    }
    const rows = await withTenant(handle.db, { tenantId }, (tx) =>
      tx
        .select()
        .from(s.xpLedger)
        .where(eq(s.xpLedger.sourceKey, `task:${weighted.id}:2026-01-03T08:00:00.000Z`)),
    );
    expect(rows).toHaveLength(1);
    expect((await xpBecomes(agent, 57)).xp).toBe(57);
  });

  let big: { id: string };

  it('reaching a new level tells only that person', async () => {
    big = await task(head.c, { assigneeId: agent.memberId, weight: 5, dueOn: today });
    await finish(agent.c, big);
    const progress = await xpBecomes(agent, 132);
    expect(progress).toMatchObject({ level: 2, levelInto: 32, levelSpan: 200 });
    await settle();
    const notes = await withTenant(handle.db, { tenantId }, (tx) =>
      tx.select().from(s.notifications).where(eq(s.notifications.kind, 'level_up')),
    );
    expect(notes.map((n) => n.recipientId)).toEqual([agent.memberId]);
    expect(notes[0]?.payload).toMatchObject({ data: { level: 2 } });
    // Reopening drops below level 2 and finishing again climbs back: no second celebration.
    await reopen(agent.c, big);
    await xpBecomes(agent, 57);
    await finish(agent.c, big);
    await xpBecomes(agent, 132);
    await settle();
    const again = await withTenant(handle.db, { tenantId }, (tx) =>
      tx.select().from(s.notifications).where(eq(s.notifications.kind, 'level_up')),
    );
    expect(again).toHaveLength(1);
  });

  it('deleting finished work takes its XP back', async () => {
    expect((await head.c.delete(`/api/tasks/${big.id}`)).status).toBe(204);
    expect((await xpBecomes(agent, 57)).xp).toBe(57);
  });

  it('deleting finished work takes back its subtasks’ XP too', async () => {
    const parent = await task(head.c, { assigneeId: agent.memberId, title: 'آماده‌سازی گزارش' });
    const sub = await task(head.c, {
      parentId: parent.id,
      assigneeId: agent.memberId,
      title: 'جمع‌آوری آمار',
    });
    await finish(agent.c, sub);
    expect((await xpBecomes(agent, 67)).xp).toBe(67);
    expect((await head.c.delete(`/api/tasks/${parent.id}`)).status).toBe(204);
    expect((await xpBecomes(agent, 57)).xp).toBe(57);
  });

  it('pays the goal owner for the first check-in of a key result in a week', async () => {
    const periods: GoalPeriod[] = (await agent.c.get('/api/goal-periods')).body;
    const period = periods.find((p) => p.current) as GoalPeriod;
    const goal = (
      await head.c.post('/api/goals', {
        periodId: period.id,
        level: 'individual',
        ownerId: agent.memberId,
        title: 'یادگیری ابزار تازه',
        keyResults: [{ title: 'دوره آموزشی', kind: 'percent' }],
      })
    ).body;
    const krId = goal.keyResults[0].id as string;
    await agent.c.post(`/api/key-results/${krId}/check-ins`, { value: 20, status: 'on_track' });
    await agent.c.post(`/api/key-results/${krId}/check-ins`, { value: 30, status: 'on_track' });
    // The manager's check-in on someone else's goal pays nobody.
    await head.c.post(`/api/key-results/${krId}/check-ins`, { value: 40, status: 'on_track' });
    await settle();
    expect((await progressOf(agent)).xp).toBe(62);
    expect((await progressOf(head)).xp).toBe(0);
  });

  it('stops at the daily cap, and pays nothing while switched off', async () => {
    expect(
      (
        await agent.c.put('/api/settings/gamification', {
          enabled: true,
          completeDayPercent: 70,
          dailyXpCap: 100,
        })
      ).status,
    ).toBe(403);
    await owner.put('/api/settings/gamification', {
      enabled: true,
      completeDayPercent: 70,
      dailyXpCap: 100,
    });
    // Today so far: 45 + 2 + 45 + 75 + 5 = 172 (taking back frees no room).
    await finish(agent.c, await task(head.c, { assigneeId: agent.memberId, weight: 2 }));
    await settle();
    const capped = await progressOf(agent);
    expect(capped.xp).toBe(62);
    expect(capped.today.capReached).toBe(true);

    await owner.put('/api/settings/gamification', {
      enabled: false,
      completeDayPercent: 70,
      dailyXpCap: 1000,
    });
    await finish(agent.c, await task(head.c, { assigneeId: agent.memberId, weight: 2 }));
    await settle();
    const off = await progressOf(agent);
    expect(off).toMatchObject({ enabled: false, xp: 62 });
    await owner.put('/api/settings/gamification', {
      enabled: true,
      completeDayPercent: 70,
      dailyXpCap: 1000,
    });
  });

  it('closes days into a streak; leave and days off never break it', async () => {
    // A Saturday at least a week ahead, so the leave request below is in the future.
    let saturday = addDays(today, 8);
    while (persianWeekdayOfCalendarDate(saturday) !== 0) saturday = addDays(saturday, 1);
    const wednesday = addDays(saturday, -3);
    const thursday = addDays(saturday, -2);
    const done = [
      await task(agent.c, { assigneeId: agent.memberId }),
      await task(agent.c, { assigneeId: agent.memberId }),
    ];
    for (const t of done) await finish(agent.c, t);
    await withTenant(handle.db, { tenantId }, async (tx) => {
      await tx
        .update(s.members)
        .set({ joinedAt: zonedInstant(addDays(saturday, -20), '09:00', TZ) })
        .where(eq(s.members.id, agent.memberId));
      for (const [t, day] of [
        [done[0], wednesday],
        [done[1], saturday],
      ] as const) {
        await tx
          .update(s.tasks)
          .set({ completedAt: zonedInstant(day, '12:00', TZ) })
          .where(eq(s.tasks.id, t?.id ?? ''));
        await tx
          .insert(s.dailyPlanItems)
          .values({ memberId: agent.memberId, planDate: day, taskId: t?.id ?? '' });
      }
    });
    const job = worker.get(StreakJob);
    const after = zonedInstant(addDays(saturday, 1), '01:00', TZ);
    expect(await job.runForTenant(tenantId, after)).toBeGreaterThan(0);
    expect(await job.runForTenant(tenantId, after)).toBe(0);

    const days = (await agent.c.get(`/api/me/streak?from=${addDays(saturday, -13)}&to=${saturday}`))
      .body as StreakDay[];
    expect(days).toHaveLength(14);
    const statusOf = (day: string) => days.find((d) => d.day === day)?.status;
    expect(statusOf(wednesday)).toBe('completed');
    expect(statusOf(thursday)).toBe('missed');
    expect(statusOf(addDays(saturday, -1))).toBe('off_day');
    expect(statusOf(saturday)).toBe('completed');
    expect((await progressOf(agent)).currentStreak).toBe(1);

    // Thursday's leave is approved afterwards: the missed day is excused and the streak heals.
    const leave = (
      await agent.c.post('/api/requests', {
        kind: 'leave',
        data: { kind: 'daily', startsOn: thursday, endsOn: thursday, note: '' },
      })
    ).body;
    expect(
      (await head.c.post(`/api/requests/${leave.id}/decide`, { decision: 'approved' })).status,
    ).toBe(200);
    await settle();
    const healed = (await agent.c.get(`/api/me/streak?from=${thursday}&to=${thursday}`))
      .body as StreakDay[];
    expect(healed[0]?.status).toBe('excused_leave');
    expect((await progressOf(agent)).currentStreak).toBe(2);
    expect((await progressOf(agent)).longestStreak).toBe(2);
  });

  it('is only ever my own; another company sees none of it', async () => {
    const mine = (await head.c.get('/api/me/xp')).body as XpEntry[];
    expect(mine).toEqual([]);
    expect((await progressOf({ c: other })).xp).toBe(0);
    expect((await other.get('/api/me/xp')).body).toEqual([]);
    expect((await other.get(`/api/me/streak?from=${addDays(today, -7)}&to=${today}`)).body).toEqual(
      [],
    );
    expect((await other.get('/api/me/streak?from=2026-01-01&to=2026-12-31')).status).toBe(400);
  });
});
