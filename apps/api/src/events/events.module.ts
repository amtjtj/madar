import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { NotificationsConsumer } from '../notifications/notifications.consumer.js';
import { NotificationsCoreModule } from '../notifications/notifications.module.js';
import { ConsumerRunner } from './consumer-runner.service.js';
import { EVENT_CONSUMERS, REDIS, type EventConsumer } from './consumer.js';
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
      inject: [NotificationsConsumer],
      useFactory: (...consumers: EventConsumer[]) => consumers,
    },
    RelayService,
    ConsumerRunner,
    SchedulerService,
  ],
  exports: [RelayService, ConsumerRunner, SchedulerService, REDIS],
})
export class EventsModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}
