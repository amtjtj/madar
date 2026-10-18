import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { withTenant, type DbHandle } from '@madar/db';
import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';

import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DB_HANDLE } from '../database/tokens.js';
import { REDIS } from '../events/consumer.js';
import { PUSH_SENDER, type PushSender } from './push-sender.js';
import { claimDue, recordResults, releaseClaim, sendToDevices } from './push-store.js';

const QUEUE = 'push-deliveries';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DeliveryJob {
  tenantId: string;
  memberId: string;
}

/**
 * Delayed push deliveries (worker). One job per member and time slot: notifications that become
 * due together (a burst, or everything held back by quiet hours) go out as a single push.
 */
@Injectable()
export class PushDeliveries implements OnModuleDestroy {
  private readonly logger = new Logger('Push');
  private queue: Queue<DeliveryJob> | undefined;
  private worker: Worker<DeliveryJob> | undefined;

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(PUSH_SENDER) private readonly sender: PushSender,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get options() {
    return { connection: this.redis, prefix: this.env.QUEUE_PREFIX };
  }

  /** Schedules a push for the member once `deliverAfter` has passed (quiet hours). */
  async schedule(tenantId: string, memberId: string, deliverAfter: Date): Promise<void> {
    this.queue ??= new Queue<DeliveryJob>(QUEUE, {
      ...this.options,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        // Completed ids are not kept: a later notification in the same slot schedules again.
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    });
    const now = Date.now();
    const at = Math.max(deliverAfter.getTime(), now);
    const window = this.env.PUSH_BATCH_MS;
    // The slot strictly after `at`, so a job already running never swallows a newer notification.
    const slot = window > 0 ? Math.floor(at / window) * window + window : at;
    await this.queue.add(
      'deliver',
      { tenantId, memberId },
      { jobId: `${tenantId}-${memberId}-${slot}`, delay: Math.max(0, slot - now) },
    );
  }

  /**
   * Pushes whatever is due for one member; safe to run twice (claimed notifications are marked).
   * Throws when every device failed, after putting the notifications back, so the job is retried.
   */
  async deliver({ tenantId, memberId }: DeliveryJob): Promise<number> {
    if (!UUID.test(tenantId) || !UUID.test(memberId)) throw new Error('invalid push job');
    const claim = await withTenant(this.handle.db, { tenantId }, (tx) =>
      claimDue(tx, memberId, new Date()),
    );
    if (!claim) return 0;
    const results = await sendToDevices(this.sender, claim.devices, claim.payload);
    const allFailed = results.every((r) => r.result === 'failed');
    await withTenant(this.handle.db, { tenantId }, async (tx) => {
      await recordResults(tx, results, new Date());
      if (allFailed) await releaseClaim(tx, claim.ids);
    });
    // Retried by BullMQ (attempts, backoff); older than PUSH_MAX_AGE_MS they are dropped.
    if (allFailed) throw new Error('every device failed');
    return results.filter((r) => r.result === 'sent').length;
  }

  start(): void {
    if (!this.sender.enabled) return;
    this.worker = new Worker<DeliveryJob>(
      QUEUE,
      async (job) => {
        await this.deliver(job.data);
      },
      { ...this.options, concurrency: 8 },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.error(`push ${job?.id ?? '?'} failed: ${error.message}`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
