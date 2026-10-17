import { Global, Module } from '@nestjs/common';
import type { DbHandle } from '@madar/db';

import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DB_HANDLE } from '../database/database.module.js';
import { AccountsService } from './accounts.service.js';
import { createAuth, type Auth } from './auth.js';
import { AuthGuard } from './auth.guard.js';
import { AUTH } from './auth.tokens.js';
import { TenantContextService } from './tenant-context.service.js';

@Global()
@Module({
  providers: [
    {
      provide: AUTH,
      inject: [DB_HANDLE, ENV],
      useFactory: (handle: DbHandle, env: Env): Auth => createAuth(handle.db, env),
    },
    AccountsService,
    TenantContextService,
    AuthGuard,
  ],
  exports: [AUTH, AccountsService, TenantContextService, AuthGuard],
})
export class AuthModule {}
