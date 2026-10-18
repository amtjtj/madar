import { Injectable } from '@nestjs/common';
import { schema as s, type Tx } from '@madar/db';
import {
  DASHBOARD_RULES,
  calendarDateIn,
  elapsedShare,
  helpReasons,
  isDepartmentBehind,
  weekStarts,
  type CompanyDashboard,
  type DepartmentDashboard,
  type GoalBrief,
  type WorkCalendar,
} from '@madar/shared';
import { and, asc, count, eq, gte, inArray, isNull, sql, type SQL } from 'drizzle-orm';

import type { TenantContext } from '../common/context.js';
import { forbidden, notFound } from '../common/errors.js';
import { TenantDb } from '../database/tenant-db.service.js';
import { visibleGoals } from '../goals/access.js';
import { ensurePeriods, listPeriods } from '../goals/periods.js';
import { loadWorkCalendar } from '../notifications/calendar.js';
import { isDepartmentManager, readsCompany, visibleTasks } from '../work/access.js';
import { atRiskProjects, viewerScope } from './at-risk.js';
import { openTask, overdueTask, stuckOverdueBefore, stuckTask } from './conditions.js';

interface Clock {
  today: string;
  calendar: WorkCalendar;
  timeZone: string;
  season: { id: string; year: number; quarter: number; share: number } | null;
}

const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const byName = (a: { displayName: string }, b: { displayName: string }) =>
  a.displayName.localeCompare(b.displayName, 'fa');

/** Dashboards: every number goes through the same visibility rules as the lists it links to. */
@Injectable()
export class DashboardService {
  constructor(private readonly db: TenantDb) {}

  /** Tenant-wide readers of work and goals: owner, executives, oversight departments. */
  static seesCompany(ctx: TenantContext): boolean {
    return readsCompany(ctx.actor);
  }

  company(ctx: TenantContext): Promise<CompanyDashboard> {
    if (!DashboardService.seesCompany(ctx)) throw forbidden();
    return this.db.run(ctx, async (tx) => {
      const clock = await this.clock(tx, ctx);
      const visible = and(isNull(s.tasks.deletedAt), visibleTasks(ctx.actor));
      const goals = clock.season
        ? await this.goals(tx, ctx, clock.season.id, sql`${s.goals.level} = 'company'`)
        : [];

      const departments = await tx
        .select({ id: s.departments.id, name: s.departments.name })
        .from(s.departments)
        .where(isNull(s.departments.archivedAt))
        .orderBy(asc(s.departments.name));
      const taskCounts = await tx
        .select({
          departmentId: s.tasks.departmentId,
          open: sql<number>`count(*) filter (where ${openTask})::int`,
          overdue: sql<number>`count(*) filter (where ${overdueTask(clock.today)})::int`,
        })
        .from(s.tasks)
        .where(visible)
        .groupBy(s.tasks.departmentId);
      const departmentGoals = clock.season
        ? await tx
            .select({ departmentId: s.goals.departmentId, progress: s.goals.progress })
            .from(s.goals)
            .where(
              and(
                eq(s.goals.periodId, clock.season.id),
                eq(s.goals.level, 'department'),
                isNull(s.goals.archivedAt),
                visibleGoals(ctx.actor),
              ),
            )
        : [];

      const atRisk = await atRiskProjects(tx, viewerScope(ctx.actor), clock.today, clock.timeZone);
      return {
        today: clock.today,
        season: clock.season,
        headline: {
          goalProgress: mean(goals.map((g) => g.progress)),
          // Only departments in the list, so the bars add up to the tile.
          overdueTasks: taskCounts
            .filter((row) => departments.some((d) => d.id === row.departmentId))
            .reduce((sum, row) => sum + row.overdue, 0),
          atRiskProjects: atRisk.length,
        },
        goals,
        departments: departments.map((d) => {
          const counts = taskCounts.find((c) => c.departmentId === d.id);
          const goalProgress = mean(
            departmentGoals.filter((g) => g.departmentId === d.id).map((g) => g.progress),
          );
          const openTasks = counts?.open ?? 0;
          const overdueTasks = counts?.overdue ?? 0;
          return {
            ...d,
            goalProgress,
            openTasks,
            overdueTasks,
            behind: isDepartmentBehind({
              goalProgress,
              seasonShare: clock.season?.share ?? 0,
              openTasks,
              overdueTasks,
            }),
          };
        }),
        weeklyDone: await this.weeklyDone(tx, clock, visible),
        atRiskProjects: atRisk.slice(0, 10),
      };
    });
  }

  department(ctx: TenantContext, departmentId: string): Promise<DepartmentDashboard> {
    const manages = isDepartmentManager(ctx.actor, departmentId);
    if (!manages && !DashboardService.seesCompany(ctx)) throw forbidden();
    return this.db.run(ctx, async (tx) => {
      const [department] = await tx
        .select({ id: s.departments.id, name: s.departments.name })
        .from(s.departments)
        .where(and(eq(s.departments.id, departmentId), isNull(s.departments.archivedAt)));
      if (!department) throw notFound('Department');
      const clock = await this.clock(tx, ctx);
      const inDepartment = and(
        eq(s.tasks.departmentId, departmentId),
        isNull(s.tasks.deletedAt),
        visibleTasks(ctx.actor),
      );
      const stuck = stuckTask(clock.calendar, clock.timeZone, clock.today);
      const overdue = overdueTask(clock.today);

      const [totals] = await tx
        .select({
          open: sql<number>`count(*) filter (where ${openTask})::int`,
          overdue: sql<number>`count(*) filter (where ${overdue})::int`,
          stuck: sql<number>`count(*) filter (where ${stuck})::int`,
        })
        .from(s.tasks)
        .where(inDepartment);

      const members = await tx
        .select({ id: s.members.id, displayName: s.members.displayName })
        .from(s.departmentMemberships)
        .innerJoin(s.members, eq(s.members.id, s.departmentMemberships.memberId))
        .where(
          and(
            eq(s.departmentMemberships.departmentId, departmentId),
            eq(s.members.status, 'active'),
          ),
        );
      members.sort(byName);
      const perMember = members.length
        ? await tx
            .select({
              assigneeId: s.tasks.assigneeId,
              todo: sql<number>`count(*) filter (where ${s.tasks.statusCategory} = 'todo')::int`,
              inProgress: sql<number>`count(*) filter (where ${s.tasks.statusCategory} = 'in_progress')::int`,
              overdue: sql<number>`count(*) filter (where ${overdue})::int`,
              stuck: sql<number>`count(*) filter (where ${stuck})::int`,
            })
            .from(s.tasks)
            .where(
              and(
                inDepartment,
                inArray(
                  s.tasks.assigneeId,
                  members.map((m) => m.id),
                ),
              ),
            )
            .groupBy(s.tasks.assigneeId)
        : [];

      const stuckRows = await tx
        .select({
          id: s.tasks.id,
          title: s.tasks.title,
          dueOn: s.tasks.dueOn,
          statusCategory: s.tasks.statusCategory,
          assigneeId: s.tasks.assigneeId,
          assigneeName: s.members.displayName,
        })
        .from(s.tasks)
        .leftJoin(s.members, eq(s.members.id, s.tasks.assigneeId))
        .where(and(inDepartment, stuck))
        .orderBy(sql`${s.tasks.dueOn} asc nulls last`, asc(s.tasks.createdAt))
        .limit(10);

      const goals = clock.season
        ? await this.goals(
            tx,
            ctx,
            clock.season.id,
            and(eq(s.goals.level, 'department'), eq(s.goals.departmentId, departmentId)) as SQL,
          )
        : [];

      return {
        department,
        today: clock.today,
        season: clock.season,
        headline: {
          openTasks: totals?.open ?? 0,
          overdueTasks: totals?.overdue ?? 0,
          stuckTasks: totals?.stuck ?? 0,
          goalProgress: mean(goals.map((g) => g.progress)),
        },
        workload: members.map((m) => {
          const row = perMember.find((r) => r.assigneeId === m.id);
          return {
            member: m,
            todo: row?.todo ?? 0,
            inProgress: row?.inProgress ?? 0,
            // Person-level concerns are for the department's own managers only (plan §2).
            overdue: manages ? (row?.overdue ?? 0) : null,
          };
        }),
        stuck: stuckRows.map((r) => ({
          id: r.id,
          title: r.title,
          dueOn: r.dueOn,
          assignee:
            r.assigneeId && r.assigneeName
              ? { id: r.assigneeId, displayName: r.assigneeName }
              : null,
          reason:
            r.dueOn && r.dueOn < stuckOverdueBefore(clock.calendar, clock.today)
              ? ('overdue' as const)
              : ('idle' as const),
        })),
        goals,
        // People only for the department's own head and managers (plan §2, owner's decision).
        needsHelp: manages
          ? members
              .map((m) => {
                const row = perMember.find((r) => r.assigneeId === m.id);
                return {
                  member: m,
                  reasons: helpReasons({
                    open: (row?.todo ?? 0) + (row?.inProgress ?? 0),
                    overdue: row?.overdue ?? 0,
                    stuck: row?.stuck ?? 0,
                  }),
                };
              })
              .filter((entry) => entry.reasons.length > 0)
          : null,
        weeklyDone: await this.weeklyDone(tx, clock, inDepartment),
      };
    });
  }

  private async clock(tx: Tx, ctx: TenantContext): Promise<Clock> {
    const { calendar, timeZone } = await loadWorkCalendar(tx, ctx.tenantId);
    const today = calendarDateIn(new Date(), timeZone);
    await ensurePeriods(tx, today);
    const current = (await listPeriods(tx, today)).find((p) => p.current);
    return {
      today,
      calendar,
      timeZone,
      season: current
        ? {
            id: current.id,
            year: current.year,
            quarter: current.quarter,
            share: elapsedShare(current.startOn, current.endOn, today),
          }
        : null,
    };
  }

  private async goals(
    tx: Tx,
    ctx: TenantContext,
    periodId: string,
    where: SQL,
  ): Promise<GoalBrief[]> {
    const rows = await tx
      .select({ goal: s.goals, ownerName: s.members.displayName })
      .from(s.goals)
      .innerJoin(s.members, eq(s.members.id, s.goals.ownerId))
      .where(
        and(
          eq(s.goals.periodId, periodId),
          isNull(s.goals.archivedAt),
          visibleGoals(ctx.actor),
          where,
        ),
      )
      .orderBy(asc(s.goals.createdAt));
    return rows.map(({ goal, ownerName }) => ({
      id: goal.id,
      title: goal.title,
      level: goal.level,
      owner: { id: goal.ownerId, displayName: ownerName },
      progress: goal.progress,
      status: goal.status,
      completedAt: goal.completedAt?.toISOString() ?? null,
    }));
  }

  /** Tasks completed per Saturday-based week (tenant time zone), oldest first. */
  private async weeklyDone(tx: Tx, clock: Clock, where: SQL | undefined) {
    const weeks = weekStarts(clock.today, DASHBOARD_RULES.trendWeeks);
    const from = weeks[0] ?? clock.today;
    const localDate = sql<string>`to_char((${s.tasks.completedAt} at time zone ${clock.timeZone})::date, 'YYYY-MM-DD')`;
    const rows = await tx
      .select({ day: localDate, n: count() })
      .from(s.tasks)
      .where(
        and(
          where,
          eq(s.tasks.statusCategory, 'done'),
          gte(s.tasks.completedAt, new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000)),
        ),
      )
      // By position: the time zone is bound as a parameter, so the expression cannot be repeated.
      .groupBy(sql`1`);
    return weeks.map((weekStart, i) => {
      const next = weeks[i + 1];
      return {
        weekStart,
        count: rows
          .filter((r) => r.day >= weekStart && (!next || r.day < next))
          .reduce((sum, r) => sum + r.n, 0),
      };
    });
  }
}
