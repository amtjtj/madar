import type { Provider } from '@nestjs/common';
import { Redis } from 'ioredis';

import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { REDIS } from './consumer.js';

/** One shared connection; BullMQ duplicates it for blocking commands (needs maxRetriesPerRequest null). */
export const redisProvider: Provider = {
  provide: REDIS,
  inject: [ENV],
  useFactory: (env: Env) => new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }),
};
