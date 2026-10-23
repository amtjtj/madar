import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';

import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { FilesCleanupJob } from '../files/cleanup-job.js';
import { MeetingJobs } from '../meetings/meeting-jobs.js';
import { RemindersService } from '../notifications/reminders.service.js';
import { WeeklyReportsJob } from '../reports/weekly-job.js';
import { REDIS } from './consumer.js';

const QUEUE = 'scheduled';
const MEETING_QUEUE = 'meeting-reminders';
const EVERY_MS = 15 * 60_000;
/** Meeting reminders need minute precision («۱۰ دقیقه دیگر»). */
const MEETING_REMINDERS_MS = 60_000;

/**
 * Recurring jobs (BullMQ job schedulers). Every 15 minutes: due reminders, weekly report snapshots,
 * the cleanup of unreachable files and making weekly meetings ahead. Every minute: meeting
 * reminders.
 */
@Injectable()
export class SchedulerService implements OnModuleDestroy {
  private readonly logger = new Logger('Scheduler');
  private queue: Queue | undefined;
  private worker: Worker | undefined;
  /** Its own queue and worker, so a long 15-minute run never holds a reminder back. */
  private remindersQueue: Queue | undefined;
  private remindersWorker: Worker | undefined;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
    private readonly reminders: RemindersService,
    private readonly weeklyReports: WeeklyReportsJob,
    private readonly filesCleanup: FilesCleanupJob,
    private readonly meetings: MeetingJobs,
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
        if (job.name !== 'due-reminders') return;
        // Each step on its own: one failing never skips the others.
        const steps: Array<[string, () => Promise<void>]> = [
          ['reminders', () => this.reminders.runAll()],
          ['weekly reports', () => this.weeklyReports.runAll()],
          ['files cleanup', () => this.filesCleanup.runAll()],
          ['weekly meetings', () => this.meetings.generateAll()],
        ];
        for (const [name, run] of steps) {
          await run().catch((error: unknown) => this.logger.error(`${name}: ${String(error)}`));
        }
      },
      options,
    );
    this.worker.on('failed', (job, error) => this.logger.error(`${job?.name}: ${error.message}`));

    this.remindersQueue = new Queue(MEETING_QUEUE, options);
    await this.remindersQueue.upsertJobScheduler(
      'meeting-reminders',
      { every: MEETING_REMINDERS_MS },
      { name: 'meeting-reminders' },
    );
    this.remindersWorker = new Worker(MEETING_QUEUE, () => this.meetings.remindAll(), options);
    this.remindersWorker.on('failed', (job, error) =>
      this.logger.error(`${job?.name}: ${error.message}`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.remindersWorker?.close();
    await this.queue?.close();
    await this.remindersQueue?.close();
  }
}
