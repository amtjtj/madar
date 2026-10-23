import { createHash } from 'node:crypto';

import { schema as s, type Tx } from '@madar/db';
import {
  calendarDateIn,
  chunkText,
  formatCalendarDate,
  formatTime,
  mentionsAsText,
  type KnowledgeKind,
} from '@madar/shared';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';

/**
 * What goes into the company knowledge index (plan phase-3-step-16b, ADR 0026) and how each source
 * reads as text. Indexed: tasks with their comments, sent letters that are not confidential,
 * meetings with minutes or decisions, and the messages of project and department channels, one
 * chunk group per company day. Never: drafts, confidential letters, direct or group conversations,
 * deleted tasks or messages. Who may read a chunk is decided at query time (knowledge-search.ts).
 *
 * A source's `stamp` is the time it last changed; its chunks carry the stamp they were built from
 * in `updated_at`, so a source is due when it has no chunks or newer content. The text is in Persian
 * because it is what the model reads.
 */

export interface SourceRef {
  kind: KnowledgeKind;
  id: string;
  /** Company day, for a channel. */
  day: string | null;
  /** Postgres text of the source's last change, written back exactly. */
  stamp: string;
}

export interface SourceText {
  ref: SourceRef;
  title: string;
  chunks: string[];
  hash: string;
}

export const sourceKey = (ref: { kind: string; id: string; day: string | null }): string =>
  `${ref.kind}:${ref.id}:${ref.day ?? ''}`;

/** A company day of a message, in the company's time zone. */
const messageDay = (timeZone: string): SQL => sql`(m.created_at at time zone ${timeZone})::date`;

/** Every indexable source with its last change. */
function indexable(timeZone: string): SQL {
  const changed = (alias: string) =>
    sql.raw(
      `greatest(${alias}.created_at, coalesce(${alias}.edited_at, ${alias}.created_at), coalesce(${alias}.deleted_at, ${alias}.created_at))`,
    );
  return sql`
    select 'task'::text as kind, t.id, null::date as day,
      greatest(t.updated_at, max(${changed('c')})) as stamp
    from tasks t
    left join comments c on c.subject_type = 'task' and c.subject_id = t.id
    where t.deleted_at is null
    group by t.id
    union all
    select 'letter', l.id, null, l.sent_at
    from letters l
    where l.sent_at is not null and not l.confidential and l.deleted_at is null
    union all
    select 'meeting', mt.id, null, greatest(mt.updated_at, mm.updated_at, max(d.created_at))
    from meetings mt
    left join meeting_minutes mm on mm.meeting_id = mt.id
    left join meeting_decisions d on d.meeting_id = mt.id
    group by mt.id, mm.updated_at, mm.body
    having coalesce(btrim(mm.body), '') <> '' or count(d.id) > 0
    union all
    select 'channel', m.conversation_id, ${messageDay(timeZone)}, max(${changed('m')})
    from messages m
    join conversations cv on cv.id = m.conversation_id and cv.kind in ('project', 'department')
    group by 2, 3
    having bool_or(m.deleted_at is null)`;
}

const due = sql`not exists (
  select 1 from knowledge_chunks k
  where k.source_type::text = src.kind and k.source_id = src.id and k.day is not distinct from src.day
    and k.chunk_no = 0 and k.updated_at >= src.stamp)`;

/** Sources whose chunks are missing or older than the source, newest first. */
export async function dueSources(tx: Tx, timeZone: string, limit: number): Promise<SourceRef[]> {
  const result = await tx.execute<{
    kind: KnowledgeKind;
    id: string;
    day: string | null;
    stamp: string;
  }>(sql`
    with src as (${indexable(timeZone)})
    select src.kind, src.id, src.day::text as day, src.stamp::text as stamp
    from src where ${due}
    order by src.stamp desc
    limit ${limit}`);
  return result.rows;
}

export async function countDueSources(tx: Tx, timeZone: string): Promise<number> {
  const result = await tx.execute<{ count: number }>(sql`
    with src as (${indexable(timeZone)})
    select count(*)::int as count from src where ${due}`);
  return result.rows[0]?.count ?? 0;
}

/** Removes the chunks of sources that are gone or no longer indexable (deleted, confidential…). */
export async function removeStaleChunks(tx: Tx, timeZone: string): Promise<void> {
  await tx.execute(sql`
    delete from knowledge_chunks k where
      (k.source_type = 'task' and not exists (
        select 1 from tasks t where t.id = k.source_id and t.deleted_at is null))
      or (k.source_type = 'letter' and not exists (
        select 1 from letters l where l.id = k.source_id and l.sent_at is not null
          and not l.confidential and l.deleted_at is null))
      or (k.source_type = 'meeting' and not exists (
        select 1 from meetings mt where mt.id = k.source_id and (
          exists (select 1 from meeting_minutes mm where mm.meeting_id = mt.id and btrim(mm.body) <> '')
          or exists (select 1 from meeting_decisions d where d.meeting_id = mt.id))))
      or (k.source_type = 'channel' and not exists (
        select 1 from messages m
        join conversations cv on cv.id = m.conversation_id and cv.kind in ('project', 'department')
        where m.conversation_id = k.source_id and m.deleted_at is null
          and ${messageDay(timeZone)} = k.day))`);
}

const STATUS: Record<string, string> = {
  todo: 'انجام نشده',
  in_progress: 'در حال انجام',
  done: 'انجام‌شده',
  canceled: 'لغوشده',
};
const MEETING_TYPE: Record<string, string> = {
  regular: 'جلسه',
  okr_review: 'جلسه بررسی OKR',
  one_on_one: 'جلسه یک‌به‌یک',
};

const hashOf = (chunks: string[]): string =>
  createHash('sha256').update(chunks.join('\u0000')).digest('hex');
/** Letter and minutes bodies are lite text: the bold marks mean nothing to the model. */
const plain = (text: string): string => text.replace(/\*\*/g, '');
const line = (label: string, value: string | null | undefined): string[] =>
  value && value.trim() ? [`${label}: ${value.trim()}`] : [];

function build(ref: SourceRef, title: string, heading: string, body: string[]): SourceText {
  const chunks = chunkText(heading, body.join('\n'));
  return { ref, title: title.slice(0, 200), chunks, hash: hashOf(chunks) };
}

/** The text of each source, read in the asking tenant's transaction; a vanished source is absent. */
export async function loadSources(
  tx: Tx,
  refs: SourceRef[],
  timeZone: string,
): Promise<Map<string, SourceText>> {
  const out = new Map<string, SourceText>();
  const names = new Map(
    (await tx.select({ id: s.members.id, name: s.members.displayName }).from(s.members)).map(
      (m) => [m.id, m.name] as const,
    ),
  );
  const of = (kind: KnowledgeKind) => refs.filter((r) => r.kind === kind);

  const taskRefs = of('task');
  if (taskRefs.length > 0) {
    const ids = taskRefs.map((r) => r.id);
    const rows = await tx
      .select({
        id: s.tasks.id,
        title: s.tasks.title,
        description: s.tasks.description,
        status: s.tasks.statusCategory,
        dueOn: s.tasks.dueOn,
        assigneeId: s.tasks.assigneeId,
        project: s.projects.name,
        department: s.departments.name,
      })
      .from(s.tasks)
      .innerJoin(s.departments, eq(s.departments.id, s.tasks.departmentId))
      .leftJoin(s.projects, eq(s.projects.id, s.tasks.projectId))
      .where(and(inArray(s.tasks.id, ids), sql`${s.tasks.deletedAt} is null`));
    const comments = await tx
      .select({
        taskId: s.comments.subjectId,
        authorId: s.comments.authorId,
        body: s.comments.body,
      })
      .from(s.comments)
      .where(
        and(
          eq(s.comments.subjectType, 'task'),
          inArray(s.comments.subjectId, ids),
          sql`${s.comments.deletedAt} is null`,
        ),
      )
      .orderBy(s.comments.createdAt);
    for (const ref of taskRefs) {
      const task = rows.find((r) => r.id === ref.id);
      if (!task) continue;
      const notes = comments
        .filter((c) => c.taskId === task.id)
        .map((c) => `${names.get(c.authorId) ?? ''}: ${mentionsAsText(c.body, names)}`);
      out.set(
        sourceKey(ref),
        build(ref, task.title, `کار: ${task.title}`, [
          ...line('پروژه', task.project),
          ...line('بخش', task.department),
          ...line('وضعیت', STATUS[task.status]),
          ...line('مسئول', task.assigneeId ? names.get(task.assigneeId) : null),
          ...line('سررسید', task.dueOn ? formatCalendarDate(task.dueOn, 'full') : null),
          ...line('شرح', task.description),
          ...(notes.length > 0 ? ['نظرها:', ...notes] : []),
        ]),
      );
    }
  }

  const letterRefs = of('letter');
  if (letterRefs.length > 0) {
    const rows = await tx
      .select({
        id: s.letters.id,
        number: s.letters.number,
        subject: s.letters.subject,
        body: s.letters.body,
        senderId: s.letters.senderId,
        sentAt: s.letters.sentAt,
      })
      .from(s.letters)
      .where(
        and(
          inArray(
            s.letters.id,
            letterRefs.map((r) => r.id),
          ),
          sql`${s.letters.sentAt} is not null and not ${s.letters.confidential}`,
        ),
      );
    for (const ref of letterRefs) {
      const letter = rows.find((r) => r.id === ref.id);
      if (!letter?.sentAt) continue;
      out.set(
        sourceKey(ref),
        build(ref, letter.subject, `نامه ${letter.number ?? ''}: ${letter.subject}`, [
          ...line('از', names.get(letter.senderId)),
          ...line('تاریخ', formatCalendarDate(calendarDateIn(letter.sentAt, timeZone), 'full')),
          plain(letter.body.text),
        ]),
      );
    }
  }

  const meetingRefs = of('meeting');
  if (meetingRefs.length > 0) {
    const ids = meetingRefs.map((r) => r.id);
    const rows = await tx
      .select({
        id: s.meetings.id,
        type: s.meetings.type,
        title: s.meetings.title,
        startsAt: s.meetings.startsAt,
        agenda: s.meetings.agenda,
        minutes: s.meetingMinutes.body,
      })
      .from(s.meetings)
      .leftJoin(s.meetingMinutes, eq(s.meetingMinutes.meetingId, s.meetings.id))
      .where(inArray(s.meetings.id, ids));
    const decisions = await tx
      .select({ meetingId: s.meetingDecisions.meetingId, text: s.meetingDecisions.text })
      .from(s.meetingDecisions)
      .where(inArray(s.meetingDecisions.meetingId, ids))
      .orderBy(s.meetingDecisions.createdAt);
    for (const ref of meetingRefs) {
      const meeting = rows.find((r) => r.id === ref.id);
      if (!meeting) continue;
      const day = formatCalendarDate(calendarDateIn(meeting.startsAt, timeZone), 'full');
      const list = decisions.filter((d) => d.meetingId === meeting.id).map((d) => `- ${d.text}`);
      out.set(
        sourceKey(ref),
        build(ref, meeting.title, `صورت‌جلسه: ${meeting.title} (${day})`, [
          ...line('نوع', MEETING_TYPE[meeting.type]),
          ...line('دستور جلسه', plain(meeting.agenda)),
          ...line('صورت‌جلسه', meeting.minutes ? plain(meeting.minutes) : null),
          ...(list.length > 0 ? ['مصوبه‌ها:', ...list] : []),
        ]),
      );
    }
  }

  const channelRefs = of('channel');
  if (channelRefs.length > 0) {
    const ids = [...new Set(channelRefs.map((r) => r.id))];
    const channels = await tx
      .select({
        id: s.conversations.id,
        project: s.projects.name,
        department: s.departments.name,
      })
      .from(s.conversations)
      .leftJoin(s.projects, eq(s.projects.id, s.conversations.projectId))
      .leftJoin(s.departments, eq(s.departments.id, s.conversations.departmentId))
      .where(
        and(
          inArray(s.conversations.id, ids),
          sql`${s.conversations.kind} in ('project', 'department')`,
        ),
      );
    for (const ref of channelRefs) {
      const channel = channels.find((c) => c.id === ref.id);
      if (!channel || !ref.day) continue;
      const messages = await tx.execute<{
        author_id: string;
        body: string;
        created_at: string;
      }>(sql`
        select m.author_id, m.body, m.created_at::text as created_at from messages m
        where m.conversation_id = ${ref.id} and m.deleted_at is null
          and ${messageDay(timeZone)} = ${ref.day}::date
        order by m.id`);
      if (messages.rows.length === 0) continue;
      const name = channel.project ?? channel.department ?? '';
      const lines = messages.rows.map(
        (m) =>
          `${formatTime(new Date(m.created_at), timeZone)} ${names.get(m.author_id) ?? ''}: ${mentionsAsText(m.body, names)}`,
      );
      out.set(
        sourceKey(ref),
        build(ref, name, `گفت‌وگوی کانال ${name}، ${formatCalendarDate(ref.day, 'full')}`, lines),
      );
    }
  }
  return out;
}

/** The hash and model of each source's current chunks. */
export async function currentChunks(
  tx: Tx,
  refs: SourceRef[],
): Promise<Map<string, { hash: string; model: string }>> {
  if (refs.length === 0) return new Map();
  const rows = await tx
    .select({
      kind: s.knowledgeChunks.sourceType,
      id: s.knowledgeChunks.sourceId,
      day: s.knowledgeChunks.day,
      hash: s.knowledgeChunks.contentHash,
      model: s.knowledgeChunks.model,
    })
    .from(s.knowledgeChunks)
    .where(
      and(
        eq(s.knowledgeChunks.chunkNo, 0),
        inArray(s.knowledgeChunks.sourceId, [...new Set(refs.map((r) => r.id))]),
      ),
    );
  return new Map(rows.map((r) => [sourceKey(r), { hash: r.hash, model: r.model }] as const));
}

const sameSource = (ref: SourceRef): SQL =>
  sql`${s.knowledgeChunks.sourceType} = ${ref.kind} and ${s.knowledgeChunks.sourceId} = ${ref.id}
    and ${s.knowledgeChunks.day} is not distinct from ${ref.day}::date`;

/** The text did not change: the chunks only take the source's new stamp. */
export async function touchChunks(tx: Tx, ref: SourceRef): Promise<void> {
  await tx
    .update(s.knowledgeChunks)
    .set({ updatedAt: sql`${ref.stamp}::timestamptz` })
    .where(sameSource(ref));
}

/** Replaces a source's chunks with freshly embedded ones. */
export async function replaceChunks(
  tx: Tx,
  source: SourceText,
  vectors: number[][],
  model: string,
): Promise<void> {
  await tx.delete(s.knowledgeChunks).where(sameSource(source.ref));
  await tx.insert(s.knowledgeChunks).values(
    source.chunks.map((text, chunkNo) => ({
      sourceType: source.ref.kind,
      sourceId: source.ref.id,
      day: source.ref.day,
      chunkNo,
      title: source.title,
      text,
      embedding: vectors[chunkNo] ?? [],
      model: model.slice(0, 100),
      contentHash: source.hash,
      updatedAt: sql`${source.ref.stamp}::timestamptz`,
    })),
  );
}
