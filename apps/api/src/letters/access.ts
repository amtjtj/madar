import { schema as s } from '@madar/db';
import { sql, type SQL } from 'drizzle-orm';

/**
 * Who sees a letter (ADR 0020): its sender, and once it is sent, everyone on its recipient list
 * (to, cc, referral). No role or permission is an exception, not even the owner. Deleted drafts
 * are filtered separately.
 */
export function visibleLetters(memberId: string): SQL {
  return sql`(${s.letters.senderId} = ${memberId} or (${s.letters.sentAt} is not null and exists (
    select 1 from letter_recipients lr where lr.letter_id = ${s.letters.id} and lr.member_id = ${memberId})))`;
}
