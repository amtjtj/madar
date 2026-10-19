import { Inject, Injectable, Logger } from '@nestjs/common';
import { listActiveTenants, schema as s, withTenant, type DbHandle } from '@madar/db';
import { sql } from 'drizzle-orm';

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

  /**
   * Returns how many files were removed from storage. Rows are claimed with one conditional
   * UPDATE (a file attached meanwhile no longer matches), and the bytes go only after that commits.
   */
  async runForTenant(tenantId: string, now = new Date()): Promise<number> {
    const abandonedBefore = new Date(now.getTime() - ABANDONED_AFTER_MS);
    const claimed = await withTenant(this.handle.db, { tenantId }, (tx) =>
      tx
        .update(s.attachments)
        .set({ purgedAt: now, deletedAt: sql`coalesce(${s.attachments.deletedAt}, ${now})` })
        .where(
          sql`${s.attachments.id} in (
            select a.id from attachments a
            where a.purged_at is null and (
              a.deleted_at is not null
              or (a.status = 'pending' and a.created_at < ${abandonedBefore})
              -- The comment or task it belongs to was deleted: nobody can reach it any more.
              or (a.subject_type = 'comment' and exists (
                select 1 from comments c where c.id = a.subject_id and c.deleted_at is not null))
              or (a.subject_type = 'task' and exists (
                select 1 from tasks t where t.id = a.subject_id and t.deleted_at is not null))
              or (a.subject_type = 'letter' and exists (
                select 1 from letters l where l.id = a.subject_id and l.deleted_at is not null))
              or (a.subject_type = 'comment' and exists (
                select 1 from comments c join tasks t on t.id = c.subject_id
                where c.id = a.subject_id and c.subject_type = 'task' and t.deleted_at is not null))
            )
            order by a.created_at
            limit ${BATCH}
            for update skip locked
          )`,
        )
        .returning({ objectKey: s.attachments.objectKey }),
    );
    for (const row of claimed) {
      await this.storage.delete(row.objectKey).catch((error: unknown) => {
        this.logger.error(`could not remove ${row.objectKey}: ${String(error)}`);
      });
    }
    return claimed.length;
  }
}
