import { Inject, Injectable, Logger } from '@nestjs/common';
import { listActiveTenants, withTenant, type DbHandle } from '@madar/db';

import { DB_HANDLE } from '../database/tokens.js';
import { closeDays } from './streaks.js';

/** Closes finished days into streaks (worker, every 15 minutes with the reminders; ADR 0029). */
@Injectable()
export class StreakJob {
  private readonly logger = new Logger('Streaks');

  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  async runAll(now = new Date()): Promise<void> {
    for (const tenant of await listActiveTenants(this.handle.db)) {
      try {
        await this.runForTenant(tenant.id, now);
      } catch (error) {
        this.logger.error(`tenant ${tenant.id}: ${String(error)}`);
      }
    }
  }

  runForTenant(tenantId: string, now = new Date()): Promise<number> {
    return withTenant(this.handle.db, { tenantId }, (tx) => closeDays(tx, tenantId, now));
  }
}
