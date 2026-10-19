import { Inject, Injectable, Logger } from '@nestjs/common';
import { listActiveTenants, schema as s, withTenant, type DbHandle } from '@madar/db';
import { and, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';

import { DB_HANDLE } from '../database/tokens.js';
import { FILE_STORAGE, type FileStorage } from './storage.js';

/** A fresh upload nobody attached within this time is abandoned. */
export const ABANDONED_AFTER_MS = 24 * 60 * 60_000;
const BATCH = 200;

/**
 * Removes bytes nobody can reach any more (ADR 0019): deleted attachments and uploads abandoned
 * for a day. The row stays (with `purged_at`) for the audit trail. Runs with the worker's
 * scheduled jobs, a batch per company each time.
 */
@Injectable()
export class FilesCleanupJob {
  private readonly logger = new Logger('FilesCleanup');

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  async runAll(now = new Date()): Promise<void> {
    for (const tenant of await listActiveTenants(this.handle.db)) {
      try {
        await this.runForTenant(tenant.id, now);
      } catch (error) {
        this.logger.error(`tenant ${tenant.id}: ${String(error)}`);
      }
    }
  }

  /** Returns how many files were removed from storage. */
  runForTenant(tenantId: string, now = new Date()): Promise<number> {
    return withTenant(this.handle.db, { tenantId }, async (tx) => {
      const abandonedBefore = new Date(now.getTime() - ABANDONED_AFTER_MS);
      const rows = await tx
        .select({ id: s.attachments.id, objectKey: s.attachments.objectKey })
        .from(s.attachments)
        .where(
          and(
            isNull(s.attachments.purgedAt),
            or(
              isNotNull(s.attachments.deletedAt),
              and(
                eq(s.attachments.status, 'pending'),
                lt(s.attachments.createdAt, abandonedBefore),
              ),
            ),
          ),
        )
        .limit(BATCH);
      for (const row of rows) {
        await this.storage.delete(row.objectKey);
        await tx
          .update(s.attachments)
          .set({ purgedAt: now, deletedAt: sql`coalesce(${s.attachments.deletedAt}, ${now})` })
          .where(eq(s.attachments.id, row.id));
      }
      return rows.length;
    });
  }
}
