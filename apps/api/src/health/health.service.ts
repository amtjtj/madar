import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { pingDb, type DbHandle } from '@madar/db';
import type { DependencyStatus, HealthResponse } from '@madar/shared';
import type { Redis } from 'ioredis';

import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DB_HANDLE } from '../database/tokens.js';
import { heartbeatKey } from './heartbeat.js';
import { HEALTH_REDIS } from './health.redis.js';

const up = (ok: boolean): DependencyStatus => (ok ? 'up' : 'down');

@Injectable()
export class HealthService implements OnApplicationShutdown {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(HEALTH_REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async check(): Promise<HealthResponse> {
    const [database, beat] = await Promise.all([pingDb(this.handle.pool), this.heartbeat()]);
    const dependencies = { database: up(database), redis: up(beat !== null), worker: up(!!beat) };
    const ok = Object.values(dependencies).every((status) => status === 'up');
    return {
      status: ok ? 'ok' : 'degraded',
      service: 'madar-api',
      version: this.env.APP_VERSION,
      time: new Date().toISOString(),
      dependencies,
    };
  }

  /** null: Redis is unreachable; '' or a timestamp: Redis answers (empty = no live worker). */
  private async heartbeat(): Promise<string | null> {
    try {
      if (this.redis.status === 'wait' || this.redis.status === 'end') await this.redis.connect();
      return (await this.redis.get(heartbeatKey(this.env.QUEUE_PREFIX))) ?? '';
    } catch {
      return null;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}
