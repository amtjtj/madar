import { schema as s, type Tx } from '@madar/db';
import {
  addDays,
  calendarDateIn,
  elapsedShare,
  goalProgress,
  isDepartmentBehind,
  keyResultProgress,
  weekEndOf,
  zonedInstant,
  type CheckinStatus,
  type ReportScope,
  type WeeklyReport,
} from '@madar/shared';
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql, type SQL } from 'drizzle-orm';

import { atRiskProjects } from '../dashboard/at-risk.js';
import { openTask, stuckOverdueBefore, stuckTask } from '../dashboard/conditions.js';
import { loadWorkCalendar } from '../notifications/calendar.js';

/**
 * Builds one weekly report (plan phase-1-step-8b §1). Everyone who may open a report sees the
 * same thing, so it uses a shared view: no private-project tasks, no personal goals, and no
 * per-person counts (names only next to finished work).
 */
export interface ReportTarget {
  tenantId: string;
  scope: ReportScope;
  department: { id: string; name: string } | null;
  weekStart: string;
  now?: Date;
}

const notPrivateTask = sql`(${s.tasks.projectId} is null or (select p.visibility from projects p where p.id = ${s.tasks.projectId}) <> 'private')`;
const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

export async function buildWeeklyReport(tx: Tx, target: ReportTarget): Promise<WeeklyReport> {
  const now = target.now ?? new Date();
  const { calendar, timeZone } = await loadWorkCalendar(tx, target.tenantId);
  const today = calendarDateIn(now, timeZone);
  const weekEnd = weekEndOf(target.weekStart);
  const partial = today <= weekEnd;
  const from = zonedInstant(target.weekStart, '00:00', timeZone);
  const to = partial ? now : zonedInstant(addDays(weekEnd, 1), '00:00', timeZone);
  // «Overdue at the end of the week»: due on or before Friday (or before today while it runs).
  const overdueBefore = partial ? today : addDays(weekEnd, 1);
  const departmentId = target.department?.id ?? null;

  const scoped = and(
    isNull(s.tasks.deletedAt),
    notPrivateTask,
    departmentId ? eq(s.tasks.departmentId, departmentId) : undefined,
  );
  const counts = (start: Date, end: Date, dueBefore: string) => ({
    done: sql<number>`count(*) filter (where ${s.tasks.statusCategory} = 'done' and ${s.tasks.completedAt} >= ${start} and ${s.tasks.completedAt} < ${end})::int`,
    created: sql<number>`count(*) filter (where ${s.tasks.createdAt} >= ${start} and ${s.tasks.createdAt} < ${end})::int`,
    overdue: sql<number>`count(*) filter (where ${openTask} and ${s.tasks.dueOn} < ${dueBefore})::int`,
  });

  const [totals] = await tx
    .select(counts(from, to, overdueBefore))
    .from(s.tasks)
    .where(scoped);
  const previousStart = addDays(target.weekStart, -7);
  const [previousCounts] = await tx
    .select(counts(zonedInstant(previousStart, '00:00', timeZone), from, target.weekStart))
    .from(s.tasks)
    .where(scoped);
  const [previousSnapshot] = await tx
    .select({ data: s.weeklyReports.data })
    .from(s.weeklyReports)
    .where(
      and(
        eq(s.weeklyReports.scope, target.scope),
        departmentId
          ? eq(s.weeklyReports.departmentId, departmentId)
          : isNull(s.weeklyReports.departmentId),
        eq(s.weeklyReports.weekStart, previousStart),
      ),
    );
  const previousOverdue =
    (previousSnapshot?.data as { totals?: { overdue?: number } } | undefined)?.totals?.overdue ??
    null;

  // The season the week ends in.
  const [period] = await tx
    .select()
    .from(s.goalPeriods)
    .where(and(lte(s.goalPeriods.startOn, weekEnd), gte(s.goalPeriods.endOn, target.weekStart)))
    .orderBy(desc(s.goalPeriods.startOn))
    .limit(1);

  const goalRows = period
    ? await tx
        .select()
        .from(s.goals)
        .where(
          and(
            eq(s.goals.periodId, period.id),
            isNull(s.goals.archivedAt),
            departmentId
              ? and(eq(s.goals.level, 'department'), eq(s.goals.departmentId, departmentId))
              : inArray(s.goals.level, ['company', 'department']),
          ),
        )
        .orderBy(
          sql`case ${s.goals.level} when 'company' then 0 else 1 end`,
          asc(s.goals.createdAt),
        )
    : [];
  const goalIds = goalRows.map((g) => g.id);
  const krRows = goalIds.length
    ? await tx
        .select()
        .from(s.keyResults)
        .where(and(inArray(s.keyResults.goalId, goalIds), isNull(s.keyResults.archivedAt)))
        .orderBy(asc(s.keyResults.sortKey))
    : [];
  const checkinRows = krRows.length
    ? await tx
        .select({
          keyResultId: s.keyResultCheckins.keyResultId,
          value: s.keyResultCheckins.value,
          status: s.keyResultCheckins.status,
          createdAt: s.keyResultCheckins.createdAt,
        })
        .from(s.keyResultCheckins)
        .where(
          and(
            inArray(
              s.keyResultCheckins.keyResultId,
              krRows.map((kr) => kr.id),
            ),
            lt(s.keyResultCheckins.createdAt, to),
          ),
        )
        .orderBy(asc(s.keyResultCheckins.createdAt))
    : [];
  // Each key result's value at the start and end of the week (last check-in before each).
  const valueAt = (kr: (typeof krRows)[number], before: Date) => {
    const last = checkinRows.filter((c) => c.keyResultId === kr.id && c.createdAt < before).at(-1);
    return last ? last.value : kr.startValue;
  };
  const inWeek = (krId: string) =>
    checkinRows.filter((c) => c.keyResultId === krId && c.createdAt >= from && c.createdAt < to);

  const goals = goalRows.map((goal) => {
    const krs = krRows.filter((kr) => kr.goalId === goal.id);
    const progressAt = (before: Date) =>
      goalProgress(
        krs.map((kr) => ({
          progress: keyResultProgress({ ...kr, currentValue: valueAt(kr, before) }),
          weight: kr.weight,
        })),
      );
    return {
      id: goal.id,
      title: goal.title,
      level: goal.level,
      progress: goal.progress,
      change: krs.length ? progressAt(to) - progressAt(from) : null,
      checkins: krs.reduce((sum, kr) => sum + inWeek(kr.id).length, 0),
      status: goal.status,
    };
  });

  const keyResults = krRows
    .filter((kr) => inWeek(kr.id).length > 0)
    .slice(0, 15)
    .map((kr) => {
      const week = inWeek(kr.id);
      return {
        id: kr.id,
        title: kr.title,
        goalTitle: goalRows.find((g) => g.id === kr.goalId)?.title ?? '',
        kind: kr.kind,
        unit: kr.unit,
        from: valueAt(kr, from),
        to: valueAt(kr, to),
        target: kr.targetValue,
        status: (week.at(-1)?.status ?? 'on_track') as CheckinStatus,
      };
    });

  let departments: WeeklyReport['departments'] = [];
  if (target.scope === 'company') {
    const list = await tx
      .select({ id: s.departments.id, name: s.departments.name })
      .from(s.departments)
      .where(isNull(s.departments.archivedAt))
      .orderBy(asc(s.departments.name));
    const perDepartment = await tx
      .select({
        departmentId: s.tasks.departmentId,
        open: sql<number>`count(*) filter (where ${openTask})::int`,
        ...counts(from, to, overdueBefore),
      })
      .from(s.tasks)
      .where(scoped)
      .groupBy(s.tasks.departmentId);
    const seasonShare = period ? elapsedShare(period.startOn, period.endOn, overdueBefore) : 0;
    departments = list.map((d) => {
      const c = perDepartment.find((row) => row.departmentId === d.id);
      const progress = mean(
        goalRows
          .filter((g) => g.level === 'department' && g.departmentId === d.id)
          .map((g) => g.progress),
      );
      return {
        ...d,
        done: c?.done ?? 0,
        created: c?.created ?? 0,
        overdue: c?.overdue ?? 0,
        goalProgress: progress,
        behind: isDepartmentBehind({
          goalProgress: progress,
          seasonShare,
          openTasks: c?.open ?? 0,
          overdueTasks: c?.overdue ?? 0,
        }),
      };
    });
  }

  const atRisk = await atRiskProjects(
    tx,
    {
      projects: and(
        sql`${s.projects.visibility} <> 'private'`,
        departmentId ? eq(s.projects.departmentId, departmentId) : undefined,
      ),
      tasks: notPrivateTask,
    },
    today,
    timeZone,
  );

  const assignee = sql<
    string | null
  >`(select m.display_name from members m where m.id = ${s.tasks.assigneeId})`;
  const highlights = await tx
    .select({
      id: s.tasks.id,
      title: s.tasks.title,
      weight: s.tasks.weight,
      departmentId: s.tasks.departmentId,
      departmentName: s.departments.name,
      assigneeId: s.tasks.assigneeId,
      assigneeName: assignee,
    })
    .from(s.tasks)
    .innerJoin(s.departments, eq(s.departments.id, s.tasks.departmentId))
    .where(
      and(
        scoped,
        eq(s.tasks.statusCategory, 'done'),
        gte(s.tasks.completedAt, from),
        lt(s.tasks.completedAt, to),
      ),
    )
    .orderBy(desc(s.tasks.weight), desc(s.tasks.completedAt))
    .limit(10);

  const stuck: WeeklyReport['stuck'] = [];
  if (departmentId) {
    const threshold = stuckOverdueBefore(calendar, today);
    const rows = await tx
      .select({
        id: s.tasks.id,
        title: s.tasks.title,
        dueOn: s.tasks.dueOn,
        assigneeId: s.tasks.assigneeId,
        assigneeName: assignee,
      })
      .from(s.tasks)
      .where(and(scoped, stuckTask(calendar, timeZone, today) as SQL))
      .orderBy(sql`${s.tasks.dueOn} asc nulls last`, asc(s.tasks.createdAt))
      .limit(10);
    for (const r of rows) {
      stuck.push({
        id: r.id,
        title: r.title,
        dueOn: r.dueOn,
        assignee:
          r.assigneeId && r.assigneeName ? { id: r.assigneeId, displayName: r.assigneeName } : null,
        reason: r.dueOn && r.dueOn < threshold ? 'overdue' : 'idle',
      });
    }
  }

  return {
    version: 1,
    scope: target.scope,
    department: target.department,
    weekStart: target.weekStart,
    weekEnd,
    generatedAt: now.toISOString(),
    partial,
    totals: {
      done: totals?.done ?? 0,
      created: totals?.created ?? 0,
      overdue: totals?.overdue ?? 0,
    },
    previous: {
      done: previousCounts?.done ?? 0,
      created: previousCounts?.created ?? 0,
      overdue: previousOverdue,
    },
    departments,
    goals,
    keyResults,
    atRiskProjects: atRisk,
    highlights: highlights.map((h) => ({
      id: h.id,
      title: h.title,
      weight: h.weight,
      department: { id: h.departmentId, name: h.departmentName },
      assignee:
        h.assigneeId && h.assigneeName ? { id: h.assigneeId, displayName: h.assigneeName } : null,
    })),
    stuck,
  };
}
