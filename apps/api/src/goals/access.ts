import { schema as s } from '@madar/db';
import { scopeFor, type Actor, type GoalLevel } from '@madar/shared';
import { sql, type SQL } from 'drizzle-orm';

import { isDepartmentManager } from '../work/access.js';

/**
 * Goal access (ADR 0013, plan phase-1-step-7 §2): company goals are visible to everyone;
 * department goals to the department, oversight and tenant-wide readers; personal goals only to
 * their owner, the department's head and managers, oversight and tenant-wide readers.
 */

function uuidList(ids: string[]): SQL {
  return sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
}

/** Company goals (goal.manage at tenant scope: owner, executive). */
export function managesCompanyGoals(actor: Actor): boolean {
  return scopeFor(actor, 'goal.manage') === 'tenant';
}

/** SQL condition on `goals`: rows the actor may see (archived rows are filtered separately). */
export function visibleGoals(actor: Actor): SQL {
  if (scopeFor(actor, 'goal.read') === 'tenant') return sql`true`;
  const company = sql`${s.goals.level} = 'company'`;
  const own = sql`${s.goals.ownerId} = ${actor.memberId}`;
  const departmentIds = actor.departments.map((d) => d.id);
  const managed = actor.departments
    .filter((d) => d.deptRole === 'head' || d.deptRole === 'manager')
    .map((d) => d.id);
  const department =
    departmentIds.length > 0 && scopeFor(actor, 'goal.read') !== null
      ? sql`(${s.goals.level} = 'department' and ${s.goals.departmentId} in (${uuidList(departmentIds)}))`
      : sql`false`;
  const team =
    managed.length > 0
      ? sql`(${s.goals.level} = 'individual' and ${s.goals.departmentId} in (${uuidList(managed)}))`
      : sql`false`;
  return sql`(${company} or ${own} or ${department} or ${team})`;
}

export interface GoalForAccess {
  level: GoalLevel;
  departmentId: string | null;
  ownerId: string;
}

/**
 * Define a goal: title, owner, parent, key results, archive (plan phase-3-step-17a). Only the
 * leadership and the goal's department managers; the owner records progress but does not
 * redefine the goal.
 */
export function canDefineGoal(actor: Actor, goal: GoalForAccess): boolean {
  if (managesCompanyGoals(actor)) return true;
  return goal.level !== 'company' && goal.departmentId !== null
    ? isDepartmentManager(actor, goal.departmentId)
    : false;
}

/** Record progress on a goal's key results: its owner and whoever defines it. */
export function canCheckIn(actor: Actor, goal: GoalForAccess): boolean {
  return goal.ownerId === actor.memberId || canDefineGoal(actor, goal);
}

/**
 * Who may create a goal at this level, in this department: the leadership anywhere, a
 * department's managers for that department and its people (17a; employees create none).
 */
export function canCreateGoal(
  actor: Actor,
  goal: { level: GoalLevel; departmentId: string | null; ownerId: string },
): boolean {
  if (managesCompanyGoals(actor)) return true;
  if (goal.level === 'company' || !goal.departmentId) return false;
  return isDepartmentManager(actor, goal.departmentId);
}
