import { Inject, Injectable } from '@nestjs/common';
import { pingDb, type DbHandle } from '@madar/db';
import type { HealthResponse } from '@madar/shared';

import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DB_HANDLE } from '../database/tokens.js';

@Injectable()
export class HealthService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async check(): Promise<HealthResponse> {
    const databaseUp = await pingDb(this.handle.pool);
    return {
      status: databaseUp ? 'ok' : 'degraded',
      service: 'madar-api',
      version: this.env.APP_VERSION,
      time: new Date().toISOString(),
      dependencies: { database: databaseUp ? 'up' : 'down' },
    };
  }
}
