import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDb, type DbHandle } from '@madar/db';

import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { TenantDb } from './tenant-db.service.js';
import { DB_HANDLE } from './tokens.js';

export { DB_HANDLE };

@Global()
@Module({
  providers: [
    {
      provide: DB_HANDLE,
      inject: [ENV],
      useFactory: (env: Env): DbHandle => createDb(env.APP_DATABASE_URL),
    },
    TenantDb,
  ],
  exports: [DB_HANDLE, TenantDb],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}

/**
 * The worker's connection (ADR 0011): the madar_worker role, the only one allowed to read the
 * outbox across tenants. Used instead of DatabaseModule by the worker process.
 */
@Global()
@Module({
  providers: [
    {
      provide: DB_HANDLE,
      inject: [ENV],
      useFactory: (env: Env): DbHandle => {
        if (!env.WORKER_DATABASE_URL)
          throw new Error('WORKER_DATABASE_URL is required for the worker');
        return createDb(env.WORKER_DATABASE_URL);
      },
    },
    TenantDb,
  ],
  exports: [DB_HANDLE, TenantDb],
})
export class WorkerDatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}
