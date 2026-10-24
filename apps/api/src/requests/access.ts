import { schema as s } from '@madar/db';
import type { Actor } from '@madar/shared';
import { sql, type SQL } from 'drizzle-orm';

import { leadsCompany } from '../work/access.js';

/**
 * Who sees a request (plan phase-3-step-17b, ADR 0028): its requester and the approvers in its
 * snapshot; the leadership and an oversight department over `approval` see all; HR (the
 * `hr_manager` role, or oversight over `leave`) sees leave requests. No other role is an
 * exception, the system admin included.
 */
export function visibleRequests(actor: Actor): SQL {
  if (readsAllRequests(actor)) return sql`true`;
  const me = actor.memberId;
  const own = sql`(${s.approvalRequests.requesterId} = ${me} or (${s.approvalRequests.snapshot} -> 'approvers') ? ${me})`;
  return readsLeaves(actor) ? sql`(${own} or ${s.approvalRequests.kind} = 'leave')` : own;
}

export function readsAllRequests(actor: Actor): boolean {
  return leadsCompany(actor) || actor.oversight.includes('approval');
}

/** HR: by role or oversight, not the `leave.read` grant the administrator also holds (ADR 0028). */
function readsLeaves(actor: Actor): boolean {
  return actor.roles.includes('hr_manager') || actor.oversight.includes('leave');
}

/** The approver whose decision an open request waits on (SQL text of a member id). */
export const currentApprover = sql`(${s.approvalRequests.snapshot} -> 'approvers' ->> ${s.approvalRequests.currentStep})`;

/**
 * Open requests that wait on me: my step, or, for the leadership, a step whose approver is no
 * longer active (they may stand in, ADR 0028).
 */
export function waitingOn(actor: Actor): SQL {
  const mine = sql`${currentApprover} = ${actor.memberId}::text`;
  const orphaned = leadsCompany(actor)
    ? sql` or not exists (select 1 from members m where m.id::text = ${currentApprover} and m.status = 'active')`
    : sql``;
  return sql`(${s.approvalRequests.status} = 'pending' and (${mine}${orphaned}))`;
}
