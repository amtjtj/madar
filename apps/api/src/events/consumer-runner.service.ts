import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { schema as s, withTenant, type DbHandle, type OutboxEvent } from '@madar/db';
import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';

import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DB_HANDLE } from '../database/tokens.js';
import { EVENT_CONSUMERS, REDIS, type EventConsumer, type EventJob } from './consumer.js';
import { queueName } from './relay.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Runs every consumer on its own BullMQ queue. */
@Injectable()
export class ConsumerRunner implements OnModuleDestroy {
  private readonly logger = new Logger('Consumers');
  private readonly workers: Worker<EventJob>[] = [];

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(EVENT_CONSUMERS) private readonly consumers: EventConsumer[],
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Handles one job for one consumer. A job without a valid tenant is rejected before anything runs;
   * the effect and the processed_events row commit together, so a retried job is a no-op.
   */
  async process(consumer: EventConsumer, data: EventJob): Promise<'done' | 'duplicate'> {
    if (!UUID.test(data.tenantId) || data.event.tenantId !== data.tenantId) {
      throw new Error('event job without a valid tenant');
    }
    const event: OutboxEvent = { ...data.event, occurredAt: new Date(data.event.occurredAt) };
    const result = await withTenant(this.handle.db, { tenantId: data.tenantId }, async (tx) => {
      const [first] = await tx
        .insert(s.processedEvents)
        .values({ consumer: consumer.name, eventId: event.id })
        .onConflictDoNothing()
        .returning({ eventId: s.processedEvents.eventId });
      if (!first) return 'duplicate' as const;
      await consumer.handle(tx, event);
      return 'done' as const;
    });
    if (result === 'done' && consumer.afterCommit) await consumer.afterCommit(event);
    return result;
  }

  start(): void {
    for (const consumer of this.consumers) {
      const worker = new Worker<EventJob>(
        queueName(consumer.name),
        async (job: Job<EventJob>) => {
          await this.process(consumer, job.data);
        },
        { connection: this.redis, prefix: this.env.QUEUE_PREFIX, concurrency: 8 },
      );
      worker.on('failed', (job, error) =>
        this.logger.error(`${consumer.name} failed on ${job?.id ?? '?'}: ${error.message}`),
      );
      this.workers.push(worker);
    }
  }

  async stop(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    this.workers.length = 0;
  }

  onModuleDestroy(): Promise<void> {
    return this.stop();
  }
}
