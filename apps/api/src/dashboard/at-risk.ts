import { schema as s, type Tx } from '@madar/db';
import { isProjectAtRisk, type Actor } from '@madar/shared';
import { and, asc, eq, sql } from 'drizzle-orm';

import { visibleProjects } from '../work/access.js';

/** Active projects the viewer can see that trail their schedule or carry overdue tasks. */
export async function atRiskProjects(tx: Tx, actor: Actor, today: string) {
  const rows = await tx
    .select({
      id: s.projects.id,
      name: s.projects.name,
      departmentId: s.projects.departmentId,
      departmentName: s.departments.name,
      startOn: s.projects.startOn,
      dueOn: s.projects.dueOn,
      createdAt: s.projects.createdAt,
      total: sql<number>`(select count(*)::int from tasks t where t.project_id = ${s.projects.id} and t.deleted_at is null and t.parent_id is null and t.status_category <> 'canceled')`,
      done: sql<number>`(select count(*)::int from tasks t where t.project_id = ${s.projects.id} and t.deleted_at is null and t.parent_id is null and t.status_category = 'done')`,
      overdue: sql<number>`(select count(*)::int from tasks t where t.project_id = ${s.projects.id} and t.deleted_at is null and t.status_category in ('todo', 'in_progress') and t.due_on < ${today})`,
    })
    .from(s.projects)
    .leftJoin(s.departments, eq(s.departments.id, s.projects.departmentId))
    .where(and(eq(s.projects.status, 'active'), visibleProjects(actor)))
    .orderBy(sql`${s.projects.dueOn} asc nulls last`, asc(s.projects.name));
  return rows
    .filter((p) =>
      isProjectAtRisk({
        startOn: p.startOn ?? p.createdAt.toISOString().slice(0, 10),
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
