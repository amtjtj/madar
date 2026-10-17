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
