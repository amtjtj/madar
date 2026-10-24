import { schema as s } from '@madar/db';
import { sql, type SQL } from 'drizzle-orm';

/**
 * Who reads a kudos (plan phase-3-step-18b): a public one, everyone in the company; a private one,
 * only its giver and receiver. No role or oversight is an exception.
 */
export function visibleKudos(memberId: string): SQL {
  return sql`(${s.kudos.private} = false or ${s.kudos.fromMemberId} = ${memberId} or ${s.kudos.toMemberId} = ${memberId})`;
}
