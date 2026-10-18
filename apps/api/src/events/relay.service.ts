import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { lockUnpublishedEvents, markEventsPublished, type DbHandle } from '@madar/db';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DB_HANDLE } from '../database/tokens.js';
import { EVENT_CONSUMERS, REDIS, type EventConsumer, type EventJob } from './consumer.js';

const BATCH = 100;

export const queueName = (consumer: string) => `events-${consumer}`;

/**
 * Outbox relay: locks unpublished events of every tenant (platform function), enqueues one job per
 * interested consumer, then marks them published in the same transaction. A crash before commit
 * releases the locks and the events are relayed again; job ids and processed_events dedupe.
 */
@Injectable()
export class RelayService implements OnModuleDestroy {
  private readonly logger = new Logger('Relay');
  private readonly queues = new Map<string, Queue<EventJob>>();
  private running = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(EVENT_CONSUMERS) private readonly consumers: EventConsumer[],
    @Inject(ENV) private readonly env: Env,
  ) {}

  private queue(consumer: string): Queue<EventJob> {
    let queue = this.queues.get(consumer);
    if (!queue) {
      queue = new Queue<EventJob>(queueName(consumer), {
        connection: this.redis,
        prefix: this.env.QUEUE_PREFIX,
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      });
      this.queues.set(consumer, queue);
    }
    return queue;
  }

  /** Relays one batch (optionally of some tenants only, for tests); returns how many were published. */
  async runOnce(tenantIds?: string[]): Promise<number> {
    return this.handle.db.transaction(async (tx) => {
      const events = await lockUnpublishedEvents(tx, BATCH, tenantIds);
      // One round trip per consumer queue while the rows are locked.
      const byConsumer = new Map<string, Parameters<Queue<EventJob>['addBulk']>[0]>();
      for (const event of events) {
        const job: EventJob = {
          tenantId: event.tenantId,
          event: { ...event, occurredAt: event.occurredAt.toISOString() },
        };
        for (const consumer of this.consumers) {
          if (!consumer.handles(event.type)) continue;
          const jobs = byConsumer.get(consumer.name) ?? [];
          jobs.push({
            name: event.type,
            data: job,
            opts: { jobId: `${consumer.name}-${event.id}` },
          });
          byConsumer.set(consumer.name, jobs);
        }
      }
      for (const [consumer, jobs] of byConsumer) await this.queue(consumer).addBulk(jobs);
      await markEventsPublished(
        tx,
        events.map((e) => e.id),
      );
      return events.length;
    });
  }

  /** Polls continuously: drains full batches at once, waits when the outbox is empty. */
  start(tenantIds?: string[]): void {
    if (this.running) return;
    this.running = true;
    // While the database is unreachable, wait longer each time (up to 30 s) instead of logging
    // the same error twice a second.
    let failures = 0;
    const loop = async () => {
      if (!this.running) return;
      let relayed = 0;
      try {
        relayed = await this.runOnce(tenantIds);
        failures = 0;
      } catch (error) {
        failures++;
        this.logger.error(error);
      }
      if (this.running) {
        const delay = failures
          ? Math.min(30_000, this.env.RELAY_INTERVAL_MS * 2 ** failures)
          : relayed === BATCH
            ? 0
            : this.env.RELAY_INTERVAL_MS;
        this.timer = setTimeout(() => void loop(), delay);
      }
    };
    void loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    clearTimeout(this.timer);
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    this.queues.clear();
  }

  onModuleDestroy(): Promise<void> {
    return this.stop();
  }
}
