import { schema as s } from '@madar/db';
import type { Actor } from '@madar/shared';
import { sql, type SQL } from 'drizzle-orm';

/**
 * SQL condition on `members`: whose calendar the actor may open (plan phase-2-step-14b, ADR 0024).
 * Themselves; the people of departments they head or manage; everyone with tenant-wide task reading.
 * Oversight is not enough: it reads pages, not people's calendars. What each calendar then shows is
 * still filtered by the viewer's own visibility conditions.
 */
export function calendarPeople(actor: Actor): SQL {
  const me = actor.memberId;
  // Role grants only: `scopeFor` would also count oversight as tenant-wide reading.
  if (
    actor.grants.some(([permission, scope]) => permission === 'task.read' && scope === 'tenant')
  ) {
    return sql`(${s.members.id} = ${me} or ${s.members.status} = 'active')`;
  }
  const managed = actor.departments
    .filter((d) => d.deptRole === 'head' || d.deptRole === 'manager')
    .map((d) => d.id);
  if (managed.length === 0) return sql`${s.members.id} = ${me}`;
  const ids = sql.join(
    managed.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  return sql`(${s.members.id} = ${me} or (${s.members.status} = 'active' and exists (
    select 1 from department_memberships dm
    where dm.member_id = ${s.members.id} and dm.department_id in (${ids}))))`;
}
