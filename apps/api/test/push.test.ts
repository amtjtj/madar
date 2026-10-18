import { schema as s, withTenant, type DbHandle } from '@madar/db';
import type { PushPayload } from '@madar/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import { count, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ENV } from '../src/config/config.module.js';
import { loadEnv, type Env } from '../src/config/env.js';
import { DB_HANDLE } from '../src/database/tokens.js';
import { ConsumerRunner } from '../src/events/consumer-runner.service.js';
import { RelayService } from '../src/events/relay.service.js';
import { PushDeliveries } from '../src/push/push-deliveries.service.js';
import {
  PUSH_SENDER,
  type PushResult,
  type PushSender,
  type PushTarget,
} from '../src/push/push-sender.js';
import { WorkerModule } from '../src/worker.module.js';
import {
  createTestApp,
  hasDatabase,
  memberSession,
  ownerSession,
  unique,
  type Client,
} from './helpers.js';

/** Records pushes instead of calling a browser push service. */
class FakeSender implements PushSender {
  readonly enabled = true;
  readonly publicKey = 'BFakePublicKey';
  readonly sent: { endpoint: string; payload: PushPayload; raw: string }[] = [];
  readonly gone = new Set<string>();

  async send(target: PushTarget, payload: PushPayload): Promise<PushResult> {
    this.sent.push({ endpoint: target.endpoint, payload, raw: JSON.stringify(payload) });
    return this.gone.has(target.endpoint) ? 'gone' : 'sent';
  }

  to(endpoint: string) {
    return this.sent.filter((p) => p.endpoint === endpoint);
  }
}

const endpoint = () => `https://fcm.googleapis.com/fcm/send/${unique('d')}`;
const keys = {
  p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQ',
  auth: 'tBHItJI5svbpez7KI4CCXg',
};
const subscribe = (c: Client, url: string) =>
  c.post('/api/push/subscriptions', { endpoint: url, keys });

interface Person {
  c: Client;
  memberId: string;
  endpoint: string;
}

describe.skipIf(!hasDatabase)('device push', () => {
  const sender = new FakeSender();
  let app: NestExpressApplication;
  let env: Env;
  let worker: TestingModule;
  let handle: DbHandle;
  let tenantId: string;
  let owner: Client;
  let lead: Person;
  let agent: Person;
  let night: Person; // default quiet hours; the company is never at work during the test
  let other: { c: Client; tenantId: string; endpoint: string }; // another company
  let support: { id: string };

  async function eventually<T>(check: () => T[] | Promise<T[]>, n = 1): Promise<T[]> {
    const until = Date.now() + 10_000;
    for (;;) {
      const rows = await check();
      if (rows.length >= n || Date.now() > until) return rows;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async function settle(tenant = tenantId) {
    const until = Date.now() + 10_000;
    for (;;) {
      const [pending] = await withTenant(handle.db, { tenantId: tenant }, (tx) =>
        tx.select({ n: count() }).from(s.domainEvents).where(isNull(s.domainEvents.publishedAt)),
      );
      if ((pending?.n ?? 0) === 0 || Date.now() > until) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }

  const assign = (by: Client, to: string, title = 'پیگیری تیکت ۴۲') =>
    by.post('/api/tasks', { title, assigneeId: to }).then((r) => r.body as { id: string });

  beforeAll(async () => {
    ({ app, env } = await createTestApp({}, [[PUSH_SENDER, sender]]));
    const session = await ownerSession(app, env);
    owner = session.c;
    tenantId = session.tenantId;
    support = (await owner.post('/api/departments', { name: 'پشتیبانی' })).body;
    const dept = (deptRole = 'member') => [{ departmentId: support.id, deptRole, isPrimary: true }];
    const person = async (deptRole?: string): Promise<Person> => {
      const m = await memberSession(app, env, owner, { departments: dept(deptRole) });
      const url = endpoint();
      expect((await subscribe(m.c, url)).status).toBe(204);
      return { c: m.c, memberId: m.memberId, endpoint: url };
    };
    lead = await person('manager');
    agent = await person();
    night = await person();
    // Everyone but `night` asks to be told at once, so these tests do not depend on the clock.
    for (const p of [lead, agent]) {
      await p.c.put('/api/me/notification-preferences', { mutedKinds: [], offHours: true });
    }
    // Working hours are a half-hour window two hours from now: `night` is always in quiet hours.
    const hour = Number(
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hourCycle: 'h23',
        timeZone: 'Asia/Tehran',
      }).format(new Date()),
    );
    const start = `${String((hour + 2) % 24).padStart(2, '0')}:00`;
    const window = { start, end: start.replace(':00', ':30') };
    const res = await owner.put('/api/work-calendar', {
      weeklyHours: Array.from({ length: 7 }, () => window),
      holidays: [],
      overdueEscalationDays: 0,
    });
    expect(res.status).toBe(200);

    const second = await ownerSession(app, env);
    other = { c: second.c, tenantId: second.tenantId, endpoint: endpoint() };
    expect((await subscribe(other.c, other.endpoint)).status).toBe(204);

    worker = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(ENV)
      .useValue({
        ...loadEnv(),
        QUEUE_PREFIX: unique('test-p-'),
        RELAY_INTERVAL_MS: 100,
        PUSH_BATCH_MS: 1500,
      })
      .overrideProvider(PUSH_SENDER)
      .useValue(sender)
      .compile();
    await worker.init();
    handle = worker.get<DbHandle>(DB_HANDLE);
    worker.get(ConsumerRunner).start();
    worker.get(PushDeliveries).start();
    worker.get(RelayService).start([tenantId, other.tenantId]);
  });
  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  it('tells the browser the public key', async () => {
    const res = await agent.c.get('/api/push/config');
    expect(res.body).toEqual({ enabled: true, publicKey: 'BFakePublicKey' });
  });

  it('accepts only the browsers’ push services as endpoints', async () => {
    for (const bad of ['https://evil.example/hook', 'http://fcm.googleapis.com/x']) {
      const res = await subscribe(agent.c, bad);
      expect(res.status).toBe(400);
    }
    const res = await subscribe(agent.c, 'https://192.168.1.10/push');
    expect(res.body.error.code).toBe('push_endpoint_not_allowed');
    expect((await agent.c.post('/api/push/subscriptions', { endpoint: 'x' })).status).toBe(400);
  });

  it('pushes a new assignment to the assignee’s device without any title', async () => {
    const task = await assign(lead.c, agent.memberId, 'قرارداد محرمانه بانک');
    const [push] = await eventually(() => sender.to(agent.endpoint));
    expect(push?.payload).toEqual({
      v: 1,
      kind: 'task_assigned',
      count: 1,
      subject: { type: 'task', id: task.id },
    });
    expect(push?.raw).not.toContain('قرارداد');
    // The person who assigned gets nothing.
    expect(sender.to(lead.endpoint)).toHaveLength(0);
  });

  it('sends a burst of notifications as one push with a count', async () => {
    const before = sender.to(agent.endpoint).length;
    await assign(lead.c, agent.memberId, 'کار اول');
    await assign(lead.c, agent.memberId, 'کار دوم');
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const pushes = sender.to(agent.endpoint).slice(before);
    expect(pushes.length).toBeGreaterThanOrEqual(1);
    expect(pushes.reduce((sum, p) => sum + p.payload.count, 0)).toBe(2);
    expect(pushes.some((p) => p.payload.count === 2 && p.payload.subject === null)).toBe(true);
  });

  it('holds pushes back during quiet hours and skips what was read meanwhile', async () => {
    await assign(lead.c, night.memberId, 'کار شبانه');
    await assign(lead.c, night.memberId, 'کار شبانه دوم');
    await settle();
    expect(sender.to(night.endpoint)).toHaveLength(0);
    const held = await withTenant(handle.db, { tenantId }, (tx) =>
      tx.select().from(s.notifications).where(eq(s.notifications.recipientId, night.memberId)),
    );
    expect(held).toHaveLength(2);
    expect(held.every((n) => !n.pushedAt && n.deliverAfter.getTime() > Date.now())).toBe(true);
    const deliveries = worker.get(PushDeliveries);
    expect(await deliveries.deliver({ tenantId, memberId: night.memberId })).toBe(0);

    // Morning comes; one of the two was already read in the app.
    await night.c.post(`/api/notifications/${held[0]?.id}/read`);
    await withTenant(handle.db, { tenantId }, (tx) =>
      tx
        .update(s.notifications)
        .set({ deliverAfter: new Date(Date.now() - 1000) })
        .where(eq(s.notifications.recipientId, night.memberId)),
    );
    expect(await deliveries.deliver({ tenantId, memberId: night.memberId })).toBe(1);
    expect(sender.to(night.endpoint).map((p) => p.payload.count)).toEqual([1]);
    // Never twice.
    expect(await deliveries.deliver({ tenantId, memberId: night.memberId })).toBe(0);
  });

  it('drops a subscription the browser has given up (404/410)', async () => {
    const m = await memberSession(app, env, owner, {
      departments: [{ departmentId: support.id, deptRole: 'member', isPrimary: true }],
    });
    await m.c.put('/api/me/notification-preferences', { mutedKinds: [], offHours: true });
    const url = endpoint();
    await subscribe(m.c, url);
    sender.gone.add(url);
    await assign(lead.c, m.memberId);
    await eventually(() => sender.to(url));
    const rows = await eventually(async () => {
      const left = await withTenant(handle.db, { tenantId }, (tx) =>
        tx.select().from(s.pushSubscriptions).where(eq(s.pushSubscriptions.endpoint, url)),
      );
      return left.length === 0 ? [true] : [];
    });
    expect(rows).toEqual([true]);
  });

  it('pushes nothing to a suspended member', async () => {
    const m = await memberSession(app, env, owner, {
      departments: [{ departmentId: support.id, deptRole: 'member', isPrimary: true }],
    });
    await m.c.put('/api/me/notification-preferences', { mutedKinds: [], offHours: true });
    const url = endpoint();
    await subscribe(m.c, url);
    await withTenant(handle.db, { tenantId }, async (tx) => {
      const [n] = await tx
        .insert(s.notifications)
        .values({
          recipientId: m.memberId,
          kind: 'task_assigned',
          subjectType: 'task',
          subjectId: (await assign(lead.c, lead.memberId)).id,
          dedupeKey: unique('k'),
          deliverAfter: new Date(Date.now() - 1000),
        })
        .returning();
      return n;
    });
    expect((await owner.post(`/api/members/${m.memberId}/suspend`)).status).toBeLessThan(300);
    expect(await worker.get(PushDeliveries).deliver({ tenantId, memberId: m.memberId })).toBe(0);
    expect(sender.to(url)).toHaveLength(0);
  });

  it('keeps companies apart: no push crosses tenants, nobody removes another’s device', async () => {
    await assign(lead.c, agent.memberId, 'فقط شرکت الف');
    await settle();
    await settle(other.tenantId);
    expect(sender.to(other.endpoint)).toHaveLength(0);
    // Tenant A cannot see tenant B's devices at all.
    const seen = await withTenant(handle.db, { tenantId }, (tx) =>
      tx.select().from(s.pushSubscriptions).where(eq(s.pushSubscriptions.endpoint, other.endpoint)),
    );
    expect(seen).toHaveLength(0);
    // A colleague "unsubscribing" someone else's endpoint changes nothing.
    await lead.c.delete('/api/push/subscriptions').send({ endpoint: agent.endpoint });
    const mine = await withTenant(handle.db, { tenantId }, (tx) =>
      tx.select().from(s.pushSubscriptions).where(eq(s.pushSubscriptions.endpoint, agent.endpoint)),
    );
    expect(mine).toHaveLength(1);
    // A test push from company B reaches only B's device.
    const before = sender.sent.length;
    expect((await other.c.post('/api/push/test')).body).toEqual({ sent: 1 });
    expect(sender.sent.slice(before).map((p) => p.endpoint)).toEqual([other.endpoint]);
    expect(sender.sent.at(-1)?.payload.kind).toBe('test');
  });

  it('removes this device’s subscription on request (sign-out)', async () => {
    const url = endpoint();
    await subscribe(lead.c, url);
    const res = await lead.c.delete('/api/push/subscriptions').send({ endpoint: url });
    expect(res.status).toBe(204);
    const left = await withTenant(handle.db, { tenantId }, (tx) =>
      tx.select().from(s.pushSubscriptions).where(eq(s.pushSubscriptions.endpoint, url)),
    );
    expect(left).toHaveLength(0);
  });
});

describe.skipIf(!hasDatabase)('device push without VAPID keys', () => {
  let app: NestExpressApplication;
  let c: Client;

  beforeAll(async () => {
    let env: Env;
    ({ app, env } = await createTestApp({ VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '' }));
    c = (await ownerSession(app, env)).c;
  });
  afterAll(() => app?.close());

  it('reports push as off and refuses subscriptions', async () => {
    expect((await c.get('/api/push/config')).body).toEqual({ enabled: false, publicKey: null });
    const res = await subscribe(c, endpoint());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('push_disabled');
  });
});
