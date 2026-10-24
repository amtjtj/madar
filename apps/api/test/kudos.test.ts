import { schema as s, withTenant, type DbHandle } from '@madar/db';
import type { KudosItem, MemberProfile, MyBadge, MyProgress } from '@madar/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import { count, eq, isNull } from 'drizzle-orm';
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

describe.skipIf(!hasDatabase)('kudos and badges (ADR 0030)', () => {
  let app: NestExpressApplication;
  let env: Env;
  let worker: TestingModule;
  let handle: DbHandle;
  let tenantId: string;
  let owner: Client;
  let head: Person;
  let ali: Person;
  let zahra: Person;
  let reza: Person; // marketing, a third person
  let other: Client;
  let marketingId: string;
  let supportId: string;

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
  const xpOf = async (p: Person) => ((await p.c.get('/api/me/progress')).body as MyProgress).xp;
  const thank = (from: Person, to: Person, extra: object = {}) =>
    from.c.post('/api/kudos', {
      toMemberId: to.memberId,
      valueTag: 'teamwork',
      message: 'ممنون بابت کمک دیروز',
      ...extra,
    });

  beforeAll(async () => {
    ({ app, env } = await createTestApp());
    const session = await ownerSession(app, env);
    owner = session.c;
    tenantId = session.tenantId;
    const support = (await owner.post('/api/departments', { name: 'پشتیبانی' })).body;
    const marketing = (await owner.post('/api/departments', { name: 'مارکتینگ' })).body;
    marketingId = marketing.id;
    supportId = support.id;
    const dept = (id: string, deptRole = 'member') => [
      { departmentId: id, deptRole, isPrimary: true },
    ];
    head = await memberSession(app, env, owner, { departments: dept(support.id, 'head') });
    ali = await memberSession(app, env, owner, {
      displayName: 'علی رضایی',
      departments: dept(support.id),
      managerId: head.memberId,
    });
    zahra = await memberSession(app, env, owner, {
      displayName: 'زهرا محمدی',
      departments: dept(support.id),
      managerId: head.memberId,
    });
    reza = await memberSession(app, env, owner, { departments: dept(marketing.id) });
    other = (await ownerSession(app, env)).c;
    await owner.put('/api/settings/gamification', {
      enabled: true,
      completeDayPercent: 70,
      dailyXpCap: 1000,
      kudosPerWeek: 3,
    });
    worker = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(ENV)
      .useValue({ ...loadEnv(), QUEUE_PREFIX: unique('test-k-'), RELAY_INTERVAL_MS: 100 })
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

  let first: KudosItem;

  it('a thanks pays its receiver, tells them, and counts against the giver’s week', async () => {
    const res = await thank(ali, zahra);
    expect(res.status).toBe(201);
    first = res.body;
    expect(first).toMatchObject({
      from: { id: ali.memberId, displayName: 'علی رضایی' },
      to: { id: zahra.memberId },
      valueTag: 'teamwork',
      private: false,
    });
    await settle();
    expect(await xpOf(zahra)).toBe(5);
    expect(await xpOf(ali)).toBe(0); // giving pays nothing
    expect((await ali.c.get('/api/me/kudos-allowance')).body).toMatchObject({
      perWeek: 3,
      left: 2,
    });
    const notes = await withTenant(handle.db, { tenantId }, (tx) =>
      tx.select().from(s.notifications).where(eq(s.notifications.kind, 'kudos_received')),
    );
    expect(notes.map((n) => [n.recipientId, n.actorId])).toEqual([[zahra.memberId, ali.memberId]]);
    // First thanks given and the receiver's badges come from the counters.
    const aliBadges = (await ali.c.get('/api/me/badges')).body as MyBadge[];
    expect(aliBadges.find((b) => b.key === 'first_thanks')?.awardedAt).not.toBeNull();
  });

  it('refuses thanking yourself, more than twice the same person, and beyond the week', async () => {
    expect((await thank(ali, ali)).body.error.code).toBe('kudos_self');
    expect((await thank(ali, zahra)).status).toBe(201);
    expect((await thank(ali, zahra)).body.error.code).toBe('kudos_same_person');
    expect((await thank(ali, reza)).status).toBe(201);
    expect((await thank(ali, head)).body.error.code).toBe('kudos_limit');
    expect((await ali.c.get('/api/me/kudos-allowance')).body.left).toBe(0);
  });

  it('a private thanks stays between the two; a task title only for those who see it', async () => {
    const task = (
      await head.c.post('/api/tasks', { title: 'پوشش صف شب', assigneeId: zahra.memberId })
    ).body;
    const secret = (await thank(zahra, ali, { private: true, taskId: task.id })).body as KudosItem;
    expect(secret.task).toMatchObject({ title: 'پوشش صف شب' });
    const forAli = (await ali.c.get(`/api/kudos?member=${ali.memberId}`)).body as KudosItem[];
    expect(forAli.map((k) => k.id)).toContain(secret.id);
    const forReza = (await reza.c.get(`/api/kudos?member=${ali.memberId}`)).body as KudosItem[];
    expect(forReza.map((k) => k.id)).not.toContain(secret.id);
    const feed = (await reza.c.get('/api/kudos')).body as KudosItem[];
    expect(feed.map((k) => k.id)).not.toContain(secret.id);
    expect(feed.map((k) => k.id)).toContain(first.id);
    // Reza (marketing) does not see the support task: no title for him.
    const publicWithTask = (
      await head.c.post('/api/kudos', {
        toMemberId: zahra.memberId,
        valueTag: 'quality',
        message: 'صف شب عالی بود',
        taskId: task.id,
      })
    ).body as KudosItem;
    const asReza = (
      (await reza.c.get(`/api/kudos?member=${zahra.memberId}`)).body as KudosItem[]
    ).find((k) => k.id === publicWithTask.id);
    expect(asReza?.task).toBeNull();
    // A task the giver cannot see is refused.
    expect((await thank(reza, zahra, { taskId: task.id })).status).toBe(404);
  });

  it('only the receiver hides a thanks from their profile', async () => {
    expect((await ali.c.post(`/api/kudos/${first.id}/hide`)).status).toBe(404);
    expect((await zahra.c.post(`/api/kudos/${first.id}/hide`)).status).toBe(204);
    const onProfile = (await reza.c.get(`/api/kudos?member=${zahra.memberId}`)).body as KudosItem[];
    expect(onProfile.map((k) => k.id)).not.toContain(first.id);
    const mine = (await zahra.c.get(`/api/kudos?member=${zahra.memberId}`)).body as KudosItem[];
    expect(mine.find((k) => k.id === first.id)?.hidden).toBe(true);
  });

  it('helping a colleague pays a little extra, and comes back if the work is reopened', async () => {
    const project = (
      await head.c.post('/api/projects', {
        name: 'کاهش زمان پاسخ',
        departmentId: supportId,
        memberIds: [ali.memberId, zahra.memberId],
      })
    ).body;
    // Zahra asks Ali inside the shared project: a colleague's request (ADR 0017).
    const asked = (
      await zahra.c.post('/api/tasks', {
        title: 'بازبینی پاسخ‌های آماده',
        projectId: project.id,
        assigneeId: ali.memberId,
      })
    ).body;
    const before = await xpOf(ali);
    const current = (await ali.c.get(`/api/tasks/${asked.id}`)).body;
    await ali.c.patch(`/api/tasks/${asked.id}`, { statusKey: 'done', version: current.version });
    await settle();
    expect((await xpOf(ali)) - before).toBe(15); // 10 for the work + 5 for helping
    const done = (await ali.c.get(`/api/tasks/${asked.id}`)).body;
    await ali.c.patch(`/api/tasks/${asked.id}`, { statusKey: 'todo', version: done.version });
    await settle();
    expect(await xpOf(ali)).toBe(before);
  });

  it('a badge is earned once and kept even when its counter falls', async () => {
    // Reza is in marketing: the owner gives it (the leadership may assign anyone).
    const task = (
      await owner.post('/api/tasks', {
        title: 'کار اول',
        assigneeId: reza.memberId,
        departmentId: marketingId,
      })
    ).body;
    let current = (await reza.c.get(`/api/tasks/${task.id}`)).body;
    await reza.c.patch(`/api/tasks/${task.id}`, { statusKey: 'done', version: current.version });
    await settle();
    const firstTask = () =>
      reza.c
        .get('/api/me/badges')
        .then((r) => (r.body as MyBadge[]).find((b) => b.key === 'first_task'));
    expect((await firstTask())?.awardedAt).not.toBeNull();
    current = (await reza.c.get(`/api/tasks/${task.id}`)).body;
    await reza.c.patch(`/api/tasks/${task.id}`, { statusKey: 'todo', version: current.version });
    await settle();
    const after = await firstTask();
    expect(after?.awardedAt).not.toBeNull();
    expect(after?.value).toBe(0);
    current = (await reza.c.get(`/api/tasks/${task.id}`)).body;
    await reza.c.patch(`/api/tasks/${task.id}`, { statusKey: 'done', version: current.version });
    await settle();
    const notes = await withTenant(handle.db, { tenantId }, (tx) =>
      tx.select().from(s.notifications).where(eq(s.notifications.kind, 'badge_earned')),
    );
    expect(
      notes.filter(
        (n) =>
          n.recipientId === reza.memberId &&
          (n.payload as { data?: { badge?: string } }).data?.badge === 'first_task',
      ),
    ).toHaveLength(1);
  });

  it('a profile shows badges but never XP, and another company reaches none of it', async () => {
    const profile = (await zahra.c.get(`/api/members/${reza.memberId}/profile`))
      .body as MemberProfile;
    expect(profile).toMatchObject({ id: reza.memberId, me: false, gamification: true });
    expect(profile.badges.map((b) => b.key)).toContain('first_task');
    expect(JSON.stringify(profile)).not.toMatch(/xp|level|streak/i);
    expect((await other.get(`/api/members/${zahra.memberId}/profile`)).status).toBe(404);
    expect((await other.get('/api/kudos')).body).toEqual([]);
    expect((await other.post(`/api/kudos/${first.id}/hide`)).status).toBe(404);
  });

  it('nothing is given while the company has it off', async () => {
    await owner.put('/api/settings/gamification', {
      enabled: false,
      completeDayPercent: 70,
      dailyXpCap: 1000,
      kudosPerWeek: 3,
    });
    expect((await thank(reza, head)).body.error.code).toBe('gamification_off');
  });
});
