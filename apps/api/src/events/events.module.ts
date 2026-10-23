import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { FilesCleanupJob } from '../files/cleanup-job.js';
import { FILE_STORAGE, createStorage } from '../files/storage.js';
import { MeetingJobs } from '../meetings/meeting-jobs.js';
import { NotificationsConsumer } from '../notifications/notifications.consumer.js';
import { NotificationsCoreModule } from '../notifications/notifications.module.js';
import { PushDeliveries } from '../push/push-deliveries.service.js';
import { pushSenderProvider } from '../push/push-sender.js';
import { PushConsumer } from '../push/push.consumer.js';
import { RealtimeConsumer } from '../realtime/realtime.consumer.js';
import { ConsumerRunner } from './consumer-runner.service.js';
import { EVENT_CONSUMERS, REDIS, type EventConsumer } from './consumer.js';
import { HeartbeatService } from './heartbeat.service.js';
import { redisProvider } from './redis.provider.js';
import { RelayService } from './relay.service.js';
import { SchedulerService } from './scheduler.service.js';

/** Outbox relay and consumers (worker process). Consumers are registered in EVENT_CONSUMERS. */
@Module({
  imports: [NotificationsCoreModule],
  providers: [
    redisProvider,
    {
      provide: EVENT_CONSUMERS,
      inject: [NotificationsConsumer, RealtimeConsumer, PushConsumer],
      useFactory: (...consumers: EventConsumer[]) => consumers,
    },
    RealtimeConsumer,
    pushSenderProvider,
    PushDeliveries,
    PushConsumer,
    RelayService,
    ConsumerRunner,
    SchedulerService,
    HeartbeatService,
    { provide: FILE_STORAGE, useFactory: (env: Env) => createStorage(env), inject: [ENV] },
    FilesCleanupJob,
    MeetingJobs,
  ],
  exports: [
    FilesCleanupJob,
    MeetingJobs,
    RelayService,
    ConsumerRunner,
    SchedulerService,
    PushDeliveries,
    HeartbeatService,
    REDIS,
  ],
})
export class EventsModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}
