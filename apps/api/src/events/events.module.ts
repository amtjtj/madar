import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { ConsumerRunner } from './consumer-runner.service.js';
import { EVENT_CONSUMERS, REDIS } from './consumer.js';
import { redisProvider } from './redis.provider.js';
import { RelayService } from './relay.service.js';

/** Outbox relay and consumers (worker process). Consumers are registered in EVENT_CONSUMERS. */
@Module({
  providers: [
    redisProvider,
    { provide: EVENT_CONSUMERS, useValue: [] },
    RelayService,
    ConsumerRunner,
  ],
  exports: [RelayService, ConsumerRunner, REDIS],
})
export class EventsModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}
