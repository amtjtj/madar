import { schema as s, type Tx } from '@madar/db';
import { mentionIdsIn, mentionsAsText, type MessageEvidenceSummary } from '@madar/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { visibleConversations } from '../chat/access.js';
import { attachmentRows, toAttachment } from '../files/attachments-db.js';
import type { PinCheck } from './letter-provider.js';

/**
 * The `message` evidence provider (plan phase-2-step-15c, ADR 0021): who may pin a chat message,
 * and the read-only card and text a task viewer sees. Never the rest of the conversation.
 */

/** A live message in a conversation the person reads (ADR 0022). */
export async function checkMessagePin(
  tx: Tx,
  memberId: string,
  messageId: string,
): Promise<PinCheck> {
  const [row] = await tx
    .select({ id: s.messages.id })
    .from(s.messages)
    .innerJoin(s.conversations, eq(s.conversations.id, s.messages.conversationId))
    .where(
      and(
        eq(s.messages.id, messageId),
        isNull(s.messages.deletedAt),
        visibleConversations(memberId),
      ),
    );
  return row ? 'ok' : 'not_found';
}

/** Names for the mention tokens in these bodies. */
async function namesFor(tx: Tx, bodies: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(bodies.flatMap((b) => mentionIdsIn(b)))];
  if (!ids.length) return new Map();
  const people = await tx
    .select({ id: s.members.id, displayName: s.members.displayName })
    .from(s.members)
    .where(inArray(s.members.id, ids));
  return new Map(people.map((p) => [p.id, p.displayName]));
}

/**
 * Cards by message id. A deleted message gets none («no longer available»). A direct
 * conversation is named by its kind only, so a task viewer does not learn who talked.
 */
export async function messageSummaries(
  tx: Tx,
  messageIds: string[],
): Promise<Map<string, MessageEvidenceSummary>> {
  const ids = [...new Set(messageIds)];
  if (!ids.length) return new Map();
  const rows = await tx
    .select({
      message: s.messages,
      authorName: s.members.displayName,
      kind: s.conversations.kind,
      groupTitle: s.conversations.title,
      project: s.projects.name,
      department: s.departments.name,
    })
    .from(s.messages)
    .innerJoin(s.members, eq(s.members.id, s.messages.authorId))
    .innerJoin(s.conversations, eq(s.conversations.id, s.messages.conversationId))
    .leftJoin(s.projects, eq(s.projects.id, s.conversations.projectId))
    .leftJoin(s.departments, eq(s.departments.id, s.conversations.departmentId))
    .where(and(inArray(s.messages.id, ids), isNull(s.messages.deletedAt)));
  const names = await namesFor(
    tx,
    rows.map((r) => r.message.body),
  );
  const files = await tx
    .select({ subjectId: s.attachments.subjectId, n: sql<number>`count(*)::int` })
    .from(s.attachments)
    .where(
      and(
        eq(s.attachments.subjectType, 'message'),
        inArray(s.attachments.subjectId, ids),
        eq(s.attachments.status, 'ready'),
        isNull(s.attachments.deletedAt),
      ),
    )
    .groupBy(s.attachments.subjectId);
  const count = new Map(files.map((f) => [f.subjectId, f.n]));
  return new Map(
    rows.map((r) => {
      const text = mentionsAsText(r.message.body, names).replace(/\s+/g, ' ').trim();
      return [
        r.message.id,
        {
          conversation: {
            kind: r.kind,
            title: r.kind === 'direct' ? null : (r.project ?? r.department ?? r.groupTitle ?? null),
          },
          author: { id: r.message.authorId, displayName: r.authorName },
          date: r.message.createdAt.toISOString(),
          excerpt: text.length > 200 ? `${text.slice(0, 199)}…` : text,
          attachmentCount: count.get(r.message.id) ?? 0,
          edited: Boolean(r.message.editedAt),
        },
      ];
    }),
  );
}

/** The full text (mentions as names) and files of a live message. */
export async function messageBodyOf(tx: Tx, messageId: string) {
  const [row] = await tx
    .select({ body: s.messages.body })
    .from(s.messages)
    .where(and(eq(s.messages.id, messageId), isNull(s.messages.deletedAt)));
  if (!row) return null;
  const names = await namesFor(tx, [row.body]);
  const files = await attachmentRows(
    tx,
    and(eq(s.attachments.subjectType, 'message'), eq(s.attachments.subjectId, messageId)),
  );
  return {
    messageText: mentionsAsText(row.body, names),
    attachments: files.map((f) => toAttachment(f.row, f.uploaderName, false)),
  };
}

/** A message pinned (actively) to a live task the viewer sees: its files open through the pin. */
export function messagePinnedToVisibleTask(messageId: string, visibleTask: ReturnType<typeof sql>) {
  return sql`exists (select 1 from task_evidence e join tasks on tasks.id = e.task_id
    join messages m on m.id = e.subject_id
    where e.kind = 'message' and e.subject_id = ${messageId} and e.unpinned_at is null
      and tasks.deleted_at is null and m.deleted_at is null and ${visibleTask})`;
}
