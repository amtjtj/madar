import { schema as s, withTenant, type DbHandle, type OutboxEvent, type Tx } from '@madar/db';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ENV } from '../src/config/config.module.js';
import { loadEnv } from '../src/config/env.js';
import { DB_HANDLE } from '../src/database/tokens.js';
import { ConsumerRunner } from '../src/events/consumer-runner.service.js';
import { EVENT_CONSUMERS, type EventConsumer, type EventJob } from '../src/events/consumer.js';
import { RelayService } from '../src/events/relay.service.js';
import { WorkerModule } from '../src/worker.module.js';
import { hasDatabase, unique } from './helpers.js';

/** Records what it saw; fails on demand to test retries. */
class RecordingConsumer implements EventConsumer {
  readonly name = 'test-recorder';
  seen: OutboxEvent[] = [];
  failNext = false;
  handles(type: string) {
    return type.startsWith('test.');
  }
  async handle(tx: Tx, event: OutboxEvent) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('consumer failed');
    }
    // A real effect in the same transaction as the processed_events row.
    await tx.insert(s.activities).values({
      subjectType: 'test',
      subjectId: event.id,
      verb: 'consumed',
    });
    this.seen.push(event);
  }
}

async function waitFor<T>(check: () => Promise<T | undefined> | T | undefined, ms = 10_000) {
  const until = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe.skipIf(!hasDatabase)('worker: outbox relay and consumers', () => {
  let moduleRef: TestingModule;
  let handle: DbHandle;
  let relay: RelayService;
  let runner: ConsumerRunner;
  const consumer = new RecordingConsumer();
  let tenantA: string;
  let tenantB: string;

  const newTenant = async () => {
    const slug = unique('ev-');
    const [row] = await handle.db
      .insert(s.tenants)
      .values({ name: slug, slug })
      .returning({ id: s.tenants.id });
    return row?.id ?? '';
  };
  const emit = (tenantId: string, type: string) =>
    withTenant(handle.db, { tenantId }, async (tx) => {
      const [row] = await tx
        .insert(s.domainEvents)
        .values({ type, payload: { n: 1 } })
        .returning({ id: s.domainEvents.id });
      return row?.id ?? '';
    });
  const effects = (tenantId: string, eventId: string) =>
    withTenant(handle.db, { tenantId }, (tx) =>
      tx.select().from(s.activities).where(eq(s.activities.subjectId, eventId)),
    );

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(ENV)
      .useValue({ ...loadEnv(), QUEUE_PREFIX: unique('test-q-') })
      .overrideProvider(EVENT_CONSUMERS)
      .useValue([consumer])
      .compile();
    await moduleRef.init();
    handle = moduleRef.get<DbHandle>(DB_HANDLE);
    relay = moduleRef.get(RelayService);
    runner = moduleRef.get(ConsumerRunner);
    tenantA = await newTenant();
    tenantB = await newTenant();
  });
  afterAll(() => moduleRef?.close());

  it('relays events of every tenant to the consumer, each in its own tenant', async () => {
    runner.start();
    const a = await emit(tenantA, 'test.ping');
    const b = await emit(tenantB, 'test.ping');
    const ignored = await emit(tenantA, 'task.created');
    expect(await relay.runOnce([tenantA, tenantB])).toBe(3);
    await waitFor(() => (consumer.seen.some((e) => e.id === b) ? true : undefined));
    await waitFor(() => (consumer.seen.some((e) => e.id === a) ? true : undefined));
    expect(consumer.seen.find((e) => e.id === a)?.tenantId).toBe(tenantA);
    expect(consumer.seen.some((e) => e.id === ignored)).toBe(false);

    // The effect landed in the right tenant only.
    expect(await effects(tenantA, a)).toHaveLength(1);
    expect(await effects(tenantB, a)).toHaveLength(0);
    // Published events are not relayed again.
    expect(await relay.runOnce([tenantA, tenantB])).toBe(0);
  });

  const jobFor = async (tenantId: string, type = 'test.ping'): Promise<EventJob> => {
    const id = await emit(tenantId, type);
    return {
      tenantId,
      event: {
        id,
        tenantId,
        type,
        version: 1,
        payload: {},
        actorId: null,
        occurredAt: new Date().toISOString(),
      },
    };
  };

  it('handles a redelivered event once', async () => {
    const job = await jobFor(tenantA);
    expect(await runner.process(consumer, job)).toBe('done');
    expect(await runner.process(consumer, job)).toBe('duplicate');
    expect(await effects(tenantA, job.event.id)).toHaveLength(1);
  });

  it('rolls back a failed attempt so the retry runs', async () => {
    const job = await jobFor(tenantA);
    consumer.failNext = true;
    await expect(runner.process(consumer, job)).rejects.toThrow('consumer failed');
    expect(await effects(tenantA, job.event.id)).toHaveLength(0);
    expect(await runner.process(consumer, job)).toBe('done');
    expect(await effects(tenantA, job.event.id)).toHaveLength(1);
  });

  it('rejects jobs without a tenant or with a mismatched one', async () => {
    const job = await jobFor(tenantA);
    await expect(runner.process(consumer, { ...job, tenantId: '' })).rejects.toThrow(/tenant/);
    await expect(runner.process(consumer, { ...job, tenantId: tenantB })).rejects.toThrow(/tenant/);
  });
});
