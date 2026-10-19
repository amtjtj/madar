import { schema as s, type Tx } from '@madar/db';
import {
  calendarDateIn,
  DEFAULT_PRIORITY_WEIGHTS,
  deriveTaskSource,
  dueBucket,
  priorityScore,
  priorityWeights,
  type PriorityWeights,
  type RankReason,
  type TaskSource,
  type WorkCalendar,
} from '@madar/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { loadWorkCalendar } from '../notifications/calendar.js';

/**
 * Task source and automatic priority (plan phase-2-step-10a, ADR 0017). The rules live in
 * packages/shared; this file feeds them the company's data.
 */

export interface Ranking {
  today: string;
  timeZone: string;
  calendar: WorkCalendar;
  weights: PriorityWeights;
}

type RankFields = Pick<
  typeof s.tasks.$inferSelect,
  'dueOn' | 'priority' | 'source' | 'sourceCeo' | 'keyResultId' | 'weight'
>;

/** The company's priority weights (`tenants.settings.priority`), or the defaults. */
export async function loadPriorityWeights(tx: Tx, tenantId: string): Promise<PriorityWeights> {
  const [tenant] = await tx
    .select({ settings: s.tenants.settings })
    .from(s.tenants)
    .where(eq(s.tenants.id, tenantId));
  const parsed = priorityWeights.safeParse(tenant?.settings?.priority);
  return parsed.success ? parsed.data : DEFAULT_PRIORITY_WEIGHTS;
}

export async function loadRanking(tx: Tx, tenantId: string, now = new Date()): Promise<Ranking> {
  const [{ calendar, timeZone }, weights] = await Promise.all([
    loadWorkCalendar(tx, tenantId),
    loadPriorityWeights(tx, tenantId),
  ]);
  return { today: calendarDateIn(now, timeZone), timeZone, calendar, weights };
}

export function rankOf(
  task: RankFields,
  ranking: Ranking,
): { score: number; reasons: RankReason[] } {
  return priorityScore(
    {
      due: dueBucket(task.dueOn, ranking.today, ranking.calendar),
      priority: task.priority,
      source: task.source,
      ceo: task.sourceCeo,
      keyResult: task.keyResultId !== null,
      weight: task.weight,
    },
    ranking.weights,
  );
}

/**
 * The source of a task that gets its first assignee now, set by `actorId` (ADR 0017): personal,
 * assigned (from the assignee's management chain or the task's department managers; the CEO
 * marked) or a colleague's request.
 */
export async function sourceFor(
  tx: Tx,
  input: { actorId: string; assigneeId: string; departmentId: string },
): Promise<{ source: TaskSource; sourceMemberId: string; sourceCeo: boolean }> {
  const chain = await tx.execute<{ manager_id: string }>(sql`
    with recursive chain (manager_id, depth) as (
      select m.manager_id, 1 from members m where m.id = ${input.assigneeId}
      union all
      select m.manager_id, c.depth + 1 from chain c
      join members m on m.id = c.manager_id
      where c.manager_id is not null and c.depth < 20
    )
    select manager_id from chain where manager_id is not null`);
  const departmentManagers = await tx
    .select({ id: s.departmentMemberships.memberId })
    .from(s.departmentMemberships)
    .where(
      and(
        eq(s.departmentMemberships.departmentId, input.departmentId),
        inArray(s.departmentMemberships.deptRole, ['head', 'manager']),
      ),
    );
  const [actor] = await tx
    .select({ managerId: s.members.managerId })
    .from(s.members)
    .where(eq(s.members.id, input.actorId));
  const topRoles = actor?.managerId
    ? []
    : await tx
        .select({ key: s.roles.key })
        .from(s.memberRoles)
        .innerJoin(s.roles, eq(s.roles.id, s.memberRoles.roleId))
        .where(
          and(
            eq(s.memberRoles.memberId, input.actorId),
            inArray(s.roles.key, ['owner', 'executive']),
          ),
        );
  const { source, ceo } = deriveTaskSource({
    actorId: input.actorId,
    assigneeId: input.assigneeId,
    assigneeManagers: chain.rows.map((r) => r.manager_id),
    departmentManagers: departmentManagers.map((r) => r.id),
    actorIsTop: topRoles.length > 0,
  });
  return { source, sourceMemberId: input.actorId, sourceCeo: ceo };
}
