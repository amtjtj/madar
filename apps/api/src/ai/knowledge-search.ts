import { schema as s, type Tx } from '@madar/db';
import { ASK_SOURCES_MAX, type Actor, type KnowledgeKind } from '@madar/shared';
import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

import { visibleConversations } from '../chat/access.js';
import { visibleLetters } from '../letters/access.js';
import { visibleMeetings } from '../meetings/access.js';
import { visibleTasks } from '../work/access.js';
import { sourceKey } from './knowledge-sources.js';

/** Chunks read before grouping them by source. */
const CANDIDATES = 24;
/** Text of one source sent to the model. */
const SOURCE_TEXT_MAX = 2000;

export interface FoundSource {
  kind: KnowledgeKind;
  id: string;
  day: string | null;
  title: string;
  text: string;
  distance: number;
}

/**
 * The chunks nearest to the question among those the person may see, grouped by source (best
 * first, at most ASK_SOURCES_MAX). Each source kind is joined to its own visibility condition, the
 * same SQL its pages use (ADR 0010), so the index never shows more than the person's own screens;
 * RLS keeps it to the company. An exact scan of the company's chunks: an approximate index would
 * filter after it searched and could lose the only chunks this person may see (ADR 0026).
 */
export async function searchKnowledge(
  tx: Tx,
  actor: Actor,
  vector: number[],
  model: string,
  /** `AI_ASK_MAX_DISTANCE`: cosine distance above which a chunk is unrelated (0 = same direction). */
  maxDistance: number,
): Promise<FoundSource[]> {
  const k = s.knowledgeChunks;
  const distance = sql<number>`(${k.embedding} <=> ${JSON.stringify(vector)}::vector)`;
  const rows = await tx
    .select({
      kind: k.sourceType,
      id: k.sourceId,
      day: k.day,
      chunkNo: k.chunkNo,
      title: k.title,
      text: k.text,
      distance,
    })
    .from(k)
    .leftJoin(s.tasks, and(eq(k.sourceType, 'task'), eq(s.tasks.id, k.sourceId)))
    .leftJoin(s.letters, and(eq(k.sourceType, 'letter'), eq(s.letters.id, k.sourceId)))
    .leftJoin(s.meetings, and(eq(k.sourceType, 'meeting'), eq(s.meetings.id, k.sourceId)))
    .leftJoin(s.conversations, and(eq(k.sourceType, 'channel'), eq(s.conversations.id, k.sourceId)))
    .where(
      and(
        eq(k.model, model),
        sql`${distance} < ${maxDistance}`,
        or(
          and(
            eq(k.sourceType, 'task'),
            isNotNull(s.tasks.id),
            isNull(s.tasks.deletedAt),
            visibleTasks(actor),
          ),
          and(
            eq(k.sourceType, 'letter'),
            isNotNull(s.letters.sentAt),
            eq(s.letters.confidential, false),
            visibleLetters(actor.memberId),
          ),
          and(eq(k.sourceType, 'meeting'), isNotNull(s.meetings.id), visibleMeetings(actor)),
          and(
            eq(k.sourceType, 'channel'),
            inArray(s.conversations.kind, ['project', 'department']),
            visibleConversations(actor.memberId),
          ),
        ),
      ),
    )
    .orderBy(distance)
    .limit(CANDIDATES);

  const found = new Map<string, FoundSource & { chunks: Array<{ no: number; text: string }> }>();
  for (const row of rows) {
    const key = sourceKey(row);
    const source = found.get(key);
    if (source) {
      source.chunks.push({ no: row.chunkNo, text: row.text });
      continue;
    }
    if (found.size === ASK_SOURCES_MAX) continue;
    found.set(key, {
      kind: row.kind,
      id: row.id,
      day: row.day,
      title: row.title,
      text: '',
      distance: Number(row.distance),
      chunks: [{ no: row.chunkNo, text: row.text }],
    });
  }
  return [...found.values()].map(({ chunks, ...source }) => ({
    ...source,
    // A source's matching chunks in reading order; overlaps are repeated, which the model ignores.
    text: chunks
      .sort((a, b) => a.no - b.no)
      .map((c) => c.text)
      .join('\n')
      .slice(0, SOURCE_TEXT_MAX),
  }));
}

/** The first live message of each channel day, so a source opens the conversation there. */
export async function firstMessages(
  tx: Tx,
  days: Array<{ id: string; day: string }>,
  timeZone: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const { id, day } of days) {
    const result = await tx.execute<{ id: string }>(sql`
      select m.id from messages m
      where m.conversation_id = ${id} and m.deleted_at is null
        and (m.created_at at time zone ${timeZone})::date = ${day}::date
      order by m.id limit 1`);
    const first = result.rows[0];
    if (first) out.set(`${id}:${day}`, first.id);
  }
  return out;
}
