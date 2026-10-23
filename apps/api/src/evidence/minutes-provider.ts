import { schema as s, type Tx } from '@madar/db';
import { liteTextPreview, type Actor, type MinutesEvidenceSummary } from '@madar/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { attachmentRows, toAttachment } from '../files/attachments-db.js';
import { visibleMeetings } from '../meetings/access.js';
import type { PinCheck } from './letter-provider.js';

/**
 * The `minutes` evidence provider (plan phase-2-step-13b, ADR 0021 and 0023). The subject is the
 * meeting id. A task viewer sees the minutes' text and files, never the meeting's people or
 * decisions; a one-on-one's minutes are never pinned.
 */

/** A meeting the person sees, with minutes, that is not a one-on-one. */
export async function checkMinutesPin(tx: Tx, actor: Actor, meetingId: string): Promise<PinCheck> {
  const [row] = await tx
    .select({ type: s.meetings.type })
    .from(s.meetings)
    .innerJoin(s.meetingMinutes, eq(s.meetingMinutes.meetingId, s.meetings.id))
    .where(and(eq(s.meetings.id, meetingId), visibleMeetings(actor)));
  if (!row) return 'not_found';
  return row.type === 'one_on_one' ? 'not_allowed' : 'ok';
}

/** Cards by meeting id; none for a one-on-one (in case one was ever pinned). */
export async function minutesSummaries(
  tx: Tx,
  meetingIds: string[],
): Promise<Map<string, MinutesEvidenceSummary>> {
  const ids = [...new Set(meetingIds)];
  if (!ids.length) return new Map();
  const rows = await tx
    .select({
      meetingId: s.meetings.id,
      title: s.meetings.title,
      type: s.meetings.type,
      startsAt: s.meetings.startsAt,
      body: s.meetingMinutes.body,
      files: sql<number>`(select count(*)::int from attachments a where a.subject_type = 'minutes'
        and a.subject_id = ${s.meetingMinutes.id} and a.status = 'ready' and a.deleted_at is null)`,
    })
    .from(s.meetings)
    .innerJoin(s.meetingMinutes, eq(s.meetingMinutes.meetingId, s.meetings.id))
    .where(and(inArray(s.meetings.id, ids), sql`${s.meetings.type} <> 'one_on_one'`));
  return new Map(
    rows.map((r) => [
      r.meetingId,
      {
        meeting: { title: r.title, type: r.type },
        date: r.startsAt.toISOString(),
        excerpt: liteTextPreview(r.body, 200),
        attachmentCount: r.files,
      },
    ]),
  );
}

/** The minutes' text and files. */
export async function minutesBodyOf(tx: Tx, meetingId: string) {
  const [row] = await tx
    .select({ id: s.meetingMinutes.id, body: s.meetingMinutes.body })
    .from(s.meetingMinutes)
    .innerJoin(s.meetings, eq(s.meetings.id, s.meetingMinutes.meetingId))
    .where(and(eq(s.meetingMinutes.meetingId, meetingId), sql`${s.meetings.type} <> 'one_on_one'`));
  if (!row) return null;
  const files = await attachmentRows(
    tx,
    and(eq(s.attachments.subjectType, 'minutes'), eq(s.attachments.subjectId, row.id)),
  );
  return {
    minutesText: row.body,
    attachments: files.map((f) => toAttachment(f.row, f.uploaderName, false)),
  };
}

/** Minutes (by their row id) pinned to a live task the viewer sees: their files open through it. */
export function minutesPinnedToVisibleTask(minutesId: string, visibleTask: ReturnType<typeof sql>) {
  return sql`exists (select 1 from task_evidence e join tasks on tasks.id = e.task_id
    join meeting_minutes mm on mm.meeting_id = e.subject_id
    join meetings mt on mt.id = mm.meeting_id
    where e.kind = 'minutes' and mm.id = ${minutesId} and e.unpinned_at is null
      and tasks.deleted_at is null and mt.type <> 'one_on_one' and ${visibleTask})`;
}
