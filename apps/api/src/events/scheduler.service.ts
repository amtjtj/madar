import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';

import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { RemindersService } from '../notifications/reminders.service.js';
import { WeeklyReportsJob } from '../reports/weekly-job.js';
import { REDIS } from './consumer.js';

const QUEUE = 'scheduled';
const EVERY_MS = 15 * 60_000;

/** Recurring jobs (BullMQ job schedulers): reminders and weekly report snapshots every 15 minutes. */
@Injectable()
export class SchedulerService implements OnModuleDestroy {
  private readonly logger = new Logger('Scheduler');
  private queue: Queue | undefined;
  private worker: Worker | undefined;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
    private readonly reminders: RemindersService,
    private readonly weeklyReports: WeeklyReportsJob,
  ) {}

  async start(): Promise<void> {
    const options = { connection: this.redis, prefix: this.env.QUEUE_PREFIX };
    this.queue = new Queue(QUEUE, options);
    await this.queue.upsertJobScheduler(
      'due-reminders',
      { every: EVERY_MS },
      { name: 'due-reminders' },
    );
    this.worker = new Worker(
      QUEUE,
      async (job) => {
        if (job.name === 'due-reminders') {
          await this.reminders.runAll();
          await this.weeklyReports.runAll();
        }
      },
      options,
    );
    this.worker.on('failed', (job, error) => this.logger.error(`${job?.name}: ${error.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
