import { and, eq, sql, type SQL } from 'drizzle-orm';

import { knowledgeChunks } from './schema/knowledge.js';
import type { Tx } from './tenant.js';

/**
 * Drops a source's chunks from the company knowledge index at once (ADR 0026), in the same
 * transaction as a delete, so a removed message or comment is never answered from in the minute
 * before the index job rebuilds what is left of it.
 */
export async function forgetKnowledge(
  tx: Tx,
  sourceType: 'task' | 'letter' | 'meeting' | 'channel',
  sourceId: string,
  /** A channel's company day (date or SQL date); only that day's chunks go. */
  day?: string | SQL,
): Promise<void> {
  await tx
    .delete(knowledgeChunks)
    .where(
      and(
        eq(knowledgeChunks.sourceType, sourceType),
        eq(knowledgeChunks.sourceId, sourceId),
        day === undefined ? undefined : sql`${knowledgeChunks.day} = ${day}`,
      ),
    );
}

/** The company day (tenant time zone) of an instant, as SQL, for `forgetKnowledge`. */
export const companyDay = (at: Date): SQL =>
  sql`(select (${at.toISOString()}::timestamptz at time zone t.timezone)::date
    from tenants t where t.id = app.current_tenant_id())`;

/** The database clock, for change stamps the index compares with DB-written times. */
export const dbNow = () => sql`clock_timestamp()`;
