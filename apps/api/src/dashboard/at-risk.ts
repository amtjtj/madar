import { schema as s, type Tx } from '@madar/db';
import { calendarDateIn, isProjectAtRisk, type Actor } from '@madar/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { visibleProjects, visibleTasks } from '../work/access.js';

/**
 * Active projects the viewer can see that trail their schedule or carry overdue tasks. Counts use
 * top-level tasks the viewer can see, like the project page, so a card never shows hidden work.
 * The rule runs per project in code; fine at pilot scale (tens of projects).
 */
export async function atRiskProjects(tx: Tx, actor: Actor, today: string, timeZone: string) {
  const projects = await tx
    .select({
      id: s.projects.id,
      name: s.projects.name,
      departmentId: s.projects.departmentId,
      departmentName: s.departments.name,
      startOn: s.projects.startOn,
      dueOn: s.projects.dueOn,
      createdAt: s.projects.createdAt,
    })
    .from(s.projects)
    .leftJoin(s.departments, eq(s.departments.id, s.projects.departmentId))
    .where(and(eq(s.projects.status, 'active'), visibleProjects(actor)))
    .orderBy(sql`${s.projects.dueOn} asc nulls last`, asc(s.projects.name));
  if (projects.length === 0) return [];
  const counts = await tx
    .select({
      projectId: s.tasks.projectId,
      total: sql<number>`count(*) filter (where ${s.tasks.statusCategory} <> 'canceled')::int`,
      done: sql<number>`count(*) filter (where ${s.tasks.statusCategory} = 'done')::int`,
      overdue: sql<number>`count(*) filter (where ${s.tasks.statusCategory} in ('todo', 'in_progress') and ${s.tasks.dueOn} < ${today})::int`,
    })
    .from(s.tasks)
    .where(
      and(
        inArray(
          s.tasks.projectId,
          projects.map((p) => p.id),
        ),
        isNull(s.tasks.deletedAt),
        isNull(s.tasks.parentId),
        visibleTasks(actor),
      ),
    )
    .groupBy(s.tasks.projectId);

  return projects
    .map((p) => {
      const c = counts.find((row) => row.projectId === p.id);
      return { ...p, total: c?.total ?? 0, done: c?.done ?? 0, overdue: c?.overdue ?? 0 };
    })
    .filter((p) =>
      isProjectAtRisk({
        startOn: p.startOn ?? calendarDateIn(p.createdAt, timeZone),
        dueOn: p.dueOn,
        today,
        done: p.done,
        total: p.total,
        overdue: p.overdue,
      }),
    )
    .map((p) => ({
      id: p.id,
      name: p.name,
      department:
        p.departmentId && p.departmentName ? { id: p.departmentId, name: p.departmentName } : null,
      dueOn: p.dueOn,
      done: p.done,
      total: p.total,
      overdue: p.overdue,
    }));
}
