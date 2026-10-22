import { schema as s } from '@madar/db';
import type { Actor } from '@madar/shared';
import { sql, type SQL } from 'drizzle-orm';

/** The organizer or a participant: they may write minutes and decisions (ADR 0023). */
export function takesPart(memberId: string): SQL {
  return sql`exists (select 1 from meeting_participants mp
    where mp.meeting_id = ${s.meetings.id} and mp.member_id = ${memberId})`;
}

/**
 * Who sees a meeting (ADR 0023): the organizer and the participants, plus members of a department
 * that oversees `meeting`, except for a one-on-one, which only its two people see. No role is an
 * exception, not even the owner.
 */
export function visibleMeetings(actor: Actor): SQL {
  const oversees = actor.oversight.includes('meeting');
  return oversees
    ? sql`(${s.meetings.type} <> 'one_on_one' or ${takesPart(actor.memberId)})`
    : takesPart(actor.memberId);
}
