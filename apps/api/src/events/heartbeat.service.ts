import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TTL_SECONDS, heartbeatKey } from '../health/heartbeat.js';
import { REDIS } from './consumer.js';

/** Tells the API's health check (and the container healthcheck) that the worker is alive. */
@Injectable()
export class HeartbeatService implements OnApplicationShutdown {
  private readonly logger = new Logger('Heartbeat');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  start(): void {
    const beat = () =>
      this.redis
        .set(heartbeatKey(this.env.QUEUE_PREFIX), String(Date.now()), 'EX', HEARTBEAT_TTL_SECONDS)
        .catch((error: unknown) => this.logger.warn(`heartbeat failed: ${String(error)}`));
    void beat();
    this.timer = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
