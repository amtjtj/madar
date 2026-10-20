import { schema as s, type Tx } from '@madar/db';
import type { EvidenceSummary, Letter } from '@madar/shared';
import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';

import { attachmentRows, toAttachment } from '../files/attachments-db.js';
import { visibleLetters } from '../letters/access.js';

/**
 * The `letter` evidence provider (ADR 0021): who may pin a letter, and the read-only summary and
 * body a task viewer sees. Minutes (step 13) and messages (step 15) add providers of their own.
 */
export type PinCheck = 'ok' | 'not_found' | 'not_allowed';

type LetterRow = typeof s.letters.$inferSelect;
type Person = { id: string; displayName: string };

/**
 * A letter that may be shown as evidence: sent, and neither it nor any letter of its thread is
 * confidential (a reply may quote a confidential letter). Used for pinning, summaries, bodies and
 * downloads alike, so no path depends on another one's check.
 */
export function pinnableLetter(): SQL {
  return sql`(${s.letters.sentAt} is not null and ${s.letters.deletedAt} is null and not ${s.letters.confidential} and not exists (
    select 1 from letters t where t.thread_id = ${s.letters.threadId} and t.confidential))`;
}

/** A pinnable letter the person sees (ADR 0021). */
export async function checkLetterPin(
  tx: Tx,
  memberId: string,
  letterId: string,
): Promise<PinCheck> {
  const [letter] = await tx
    .select({ pinnable: sql<boolean>`${pinnableLetter()}` })
    .from(s.letters)
    .where(and(eq(s.letters.id, letterId), isNull(s.letters.deletedAt), visibleLetters(memberId)));
  if (!letter) return 'not_found';
  return letter.pinnable ? 'ok' : 'not_allowed';
}

async function recipientsOf(tx: Tx, letterIds: string[]) {
  if (!letterIds.length) return [];
  return tx
    .select({
      letterId: s.letterRecipients.letterId,
      kind: s.letterRecipients.kind,
      readAt: s.letterRecipients.readAt,
      id: s.members.id,
      displayName: s.members.displayName,
    })
    .from(s.letterRecipients)
    .innerJoin(s.members, eq(s.members.id, s.letterRecipients.memberId))
    .where(
      and(
        inArray(s.letterRecipients.letterId, letterIds),
        inArray(s.letterRecipients.kind, ['to', 'cc']),
      ),
    )
    .orderBy(asc(s.letterRecipients.createdAt), asc(s.letterRecipients.id));
}

/**
 * Read-only summaries by letter id. Read state is one flag (every «to» recipient opened it), never
 * who did (ADR 0020). Letters that are gone, unsent or confidential get no summary.
 */
export async function letterSummaries(
  tx: Tx,
  letterIds: string[],
): Promise<Map<string, EvidenceSummary>> {
  const ids = [...new Set(letterIds)];
  if (!ids.length) return new Map();
  const sender = s.members;
  const [rows, people, files] = await Promise.all([
    tx
      .select({ letter: s.letters, senderName: sender.displayName })
      .from(s.letters)
      .innerJoin(sender, eq(sender.id, s.letters.senderId))
      .where(and(inArray(s.letters.id, ids), isNull(s.letters.deletedAt), pinnableLetter())),
    recipientsOf(tx, ids),
    tx
      .select({ subjectId: s.attachments.subjectId, n: sql<number>`count(*)::int` })
      .from(s.attachments)
      .where(
        and(
          eq(s.attachments.subjectType, 'letter'),
          inArray(s.attachments.subjectId, ids),
          eq(s.attachments.status, 'ready'),
          isNull(s.attachments.deletedAt),
        ),
      )
      .groupBy(s.attachments.subjectId),
  ]);
  const counts = new Map(files.map((f) => [f.subjectId, f.n]));
  return new Map(
    rows.map(({ letter, senderName }) => {
      const to = people.filter((p) => p.letterId === letter.id && p.kind === 'to');
      return [
        letter.id,
        {
          subject: letter.subject,
          number: letter.number,
          sender: { id: letter.senderId, displayName: senderName },
          to: to.map(({ id, displayName }) => ({ id, displayName })),
          date: (letter.sentAt ?? letter.createdAt).toISOString(),
          urgency: letter.urgency,
          read: to.length > 0 && to.every((p) => p.readAt !== null),
          attachmentCount: counts.get(letter.id) ?? 0,
        },
      ];
    }),
  );
}

/** The body, copies and files of a pinned letter (never its thread or referrals). */
export async function letterBodyOf(tx: Tx, letterId: string) {
  const [letter]: Array<Pick<LetterRow, 'body'>> = await tx
    .select({ body: s.letters.body })
    .from(s.letters)
    .where(and(eq(s.letters.id, letterId), isNull(s.letters.deletedAt), pinnableLetter()));
  if (!letter) return null;
  const cc: Person[] = (await recipientsOf(tx, [letterId]))
    .filter((p) => p.kind === 'cc')
    .map(({ id, displayName }) => ({ id, displayName }));
  const files = await attachmentRows(
    tx,
    and(eq(s.attachments.subjectType, 'letter'), eq(s.attachments.subjectId, letterId)),
  );
  return {
    body: letter.body as Letter['body'],
    cc,
    attachments: files.map(({ row, uploaderName }) => toAttachment(row, uploaderName, false)),
  };
}

/** For downloads: the letter is pinned to a live task the person sees (ADR 0021). */
export function pinnedToVisibleTask(letterId: string, visibleTask: ReturnType<typeof sql>) {
  return sql`exists (select 1 from task_evidence e join tasks on tasks.id = e.task_id
    join letters on letters.id = e.subject_id
    where e.kind = 'letter' and e.subject_id = ${letterId} and e.unpinned_at is null
      and tasks.deleted_at is null and ${visibleTask} and ${pinnableLetter()})`;
}
