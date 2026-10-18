import type { Provider } from '@nestjs/common';
import { Redis } from 'ioredis';

import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

export const HEALTH_REDIS = Symbol('HEALTH_REDIS');

/** A small connection for health checks only: fails fast instead of queueing commands. */
export const healthRedisProvider: Provider = {
  provide: HEALTH_REDIS,
  inject: [ENV],
  useFactory: (env: Env) => {
    const redis = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2_000,
    });
    // Outages are reported by the health check itself; don't crash or spam the log.
    redis.on('error', () => undefined);
    return redis;
  },
};
