import { Injectable } from '@nestjs/common';
import { schema as s } from '@madar/db';
import {
  addDays,
  CALENDAR_LAYER_MAX,
  calendarDateIn,
  daysInRange,
  hoursOn,
  zonedInstant,
  type CalendarDay,
  type CalendarItem,
  type CalendarLayer,
  type CalendarQuery,
  type CalendarRange,
} from '@madar/shared';
import { and, asc, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';

import type { TenantContext } from '../common/context.js';
import { TenantDb } from '../database/tenant-db.service.js';
import { takesPart, visibleMeetings } from '../meetings/access.js';
import { loadWorkCalendar } from '../notifications/calendar.js';
import { visibleProjects, visibleTasks } from '../work/access.js';

const OPEN = ['todo', 'in_progress'] as const;
type TaskRow = Pick<
  typeof s.tasks.$inferSelect,
  'id' | 'title' | 'priority' | 'statusCategory' | 'dueOn'
>;

/**
 * The personal calendar (plan phase-2-step-14a, ADR 0024): an aggregate over existing data. Every
 * layer reuses its own visibility condition, so the calendar never shows what its page would not.
 */
@Injectable()
export class CalendarService {
  constructor(private readonly db: TenantDb) {}

  get(ctx: TenantContext, query: CalendarQuery): Promise<CalendarRange> {
    return this.db.run(ctx, async (tx) => {
      const { calendar, timeZone } = await loadWorkCalendar(tx, ctx.tenantId);
      const today = calendarDateIn(new Date(), timeZone);
      const on = new Set<CalendarLayer>(query.layers);
      const byDay = new Map<string, CalendarItem[]>(
        daysInRange(query.from, query.to).map((d) => [d, []]),
      );
      const truncated: CalendarLayer[] = [];
      const cut = <T>(layer: CalendarLayer, rows: T[]): T[] => {
        if (rows.length <= CALENDAR_LAYER_MAX) return rows;
        truncated.push(layer);
        return rows.slice(0, CALENDAR_LAYER_MAX);
      };
      const push = (day: string, item: CalendarItem) => byDay.get(day)?.push(item);

      // Tasks: due that day, on that day's plan, or both (one item).
      const taskItems = new Map<string, CalendarItem>();
      const taskItem = (day: string, row: TaskRow, due: boolean, planned: boolean) => {
        const key = `${day}:${row.id}`;
        const found = taskItems.get(key);
        if (found?.task) {
          found.task.due ||= due;
          found.task.planned ||= planned;
          return;
        }
        const item: CalendarItem = {
          kind: 'task',
          id: row.id,
          title: row.title,
          task: {
            priority: row.priority,
            statusCategory: row.statusCategory,
            due,
            planned,
            overdue:
              row.dueOn !== null && row.dueOn < today && OPEN.includes(row.statusCategory as never),
            dueOn: row.dueOn,
          },
          meeting: null,
          project: null,
          period: null,
        };
        taskItems.set(key, item);
        push(day, item);
      };
      const taskColumns = {
        id: s.tasks.id,
        title: s.tasks.title,
        priority: s.tasks.priority,
        statusCategory: s.tasks.statusCategory,
        dueOn: s.tasks.dueOn,
      };
      if (on.has('tasks')) {
        const rows = await tx
          .select(taskColumns)
          .from(s.tasks)
          .where(
            and(
              this.myOpenTasks(ctx),
              gte(s.tasks.dueOn, query.from),
              lte(s.tasks.dueOn, query.to),
            ),
          )
          .orderBy(asc(s.tasks.dueOn), asc(s.tasks.id))
          .limit(CALENDAR_LAYER_MAX + 1);
        // Past due days show nothing: those tasks appear once, above today.
        for (const row of cut('tasks', rows)) {
          if (row.dueOn && row.dueOn >= today) taskItem(row.dueOn, row, true, false);
        }
      }
      if (on.has('plan')) {
        const rows = await tx
          .select({ ...taskColumns, planDate: s.dailyPlanItems.planDate })
          .from(s.dailyPlanItems)
          .innerJoin(s.tasks, eq(s.tasks.id, s.dailyPlanItems.taskId))
          .where(
            and(
              eq(s.dailyPlanItems.memberId, ctx.memberId),
              gte(s.dailyPlanItems.planDate, query.from),
              lte(s.dailyPlanItems.planDate, query.to),
              isNull(s.tasks.deletedAt),
              visibleTasks(ctx.actor),
            ),
          )
          .orderBy(asc(s.dailyPlanItems.planDate))
          .limit(CALENDAR_LAYER_MAX + 1);
        for (const row of cut('plan', rows)) {
          taskItem(row.planDate, row, row.dueOn === row.planDate, true);
        }
      }
      let overdue: CalendarItem[] = [];
      if (on.has('tasks') && query.from <= today && today <= query.to) {
        const rows = await tx
          .select(taskColumns)
          .from(s.tasks)
          .where(and(this.myOpenTasks(ctx), lt(s.tasks.dueOn, today)))
          .orderBy(asc(s.tasks.dueOn), asc(s.tasks.id))
          .limit(100);
        overdue = rows.map((row) => ({
          kind: 'task',
          id: row.id,
          title: row.title,
          task: {
            priority: row.priority,
            statusCategory: row.statusCategory,
            due: true,
            planned: false,
            overdue: true,
            dueOn: row.dueOn,
          },
          meeting: null,
          project: null,
          period: null,
        }));
      }

      if (on.has('meetings')) {
        // Mine only: a personal calendar, not what oversight lets me read.
        const rows = await tx
          .select({
            id: s.meetings.id,
            title: s.meetings.title,
            type: s.meetings.type,
            startsAt: s.meetings.startsAt,
            endsAt: s.meetings.endsAt,
            canceledAt: s.meetings.canceledAt,
            myResponse: s.meetingParticipants.response,
          })
          .from(s.meetings)
          .innerJoin(
            s.meetingParticipants,
            and(
              eq(s.meetingParticipants.meetingId, s.meetings.id),
              eq(s.meetingParticipants.memberId, ctx.memberId),
            ),
          )
          .where(
            and(
              takesPart(ctx.memberId),
              visibleMeetings(ctx.actor),
              gte(s.meetings.startsAt, zonedInstant(query.from, '00:00', timeZone)),
              lt(s.meetings.startsAt, zonedInstant(addDays(query.to, 1), '00:00', timeZone)),
            ),
          )
          .orderBy(asc(s.meetings.startsAt))
          .limit(CALENDAR_LAYER_MAX + 1);
        for (const row of cut('meetings', rows)) {
          push(calendarDateIn(row.startsAt, timeZone), {
            kind: 'meeting',
            id: row.id,
            title: row.title,
            task: null,
            meeting: {
              startsAt: row.startsAt.toISOString(),
              endsAt: row.endsAt.toISOString(),
              type: row.type,
              canceled: row.canceledAt !== null,
              myResponse: row.myResponse,
            },
            project: null,
            period: null,
          });
        }
      }

      if (on.has('projects')) {
        const rows = await tx
          .select({
            id: s.projects.id,
            name: s.projects.name,
            color: s.projects.color,
            dueOn: s.projects.dueOn,
          })
          .from(s.projects)
          .where(
            and(
              eq(s.projects.status, 'active'),
              gte(s.projects.dueOn, query.from),
              lte(s.projects.dueOn, query.to),
              visibleProjects(ctx.actor),
              or(
                eq(s.projects.ownerId, ctx.memberId),
                sql`exists (select 1 from project_members pm where pm.project_id = ${s.projects.id} and pm.member_id = ${ctx.memberId})`,
              ),
            ),
          )
          .limit(CALENDAR_LAYER_MAX + 1);
        for (const row of cut('projects', rows)) {
          if (!row.dueOn) continue;
          push(row.dueOn, {
            kind: 'project',
            id: row.id,
            title: row.name,
            task: null,
            meeting: null,
            project: { color: row.color },
            period: null,
          });
        }
      }

      if (on.has('periods')) {
        const rows = await tx
          .select()
          .from(s.goalPeriods)
          .where(and(gte(s.goalPeriods.endOn, query.from), lte(s.goalPeriods.endOn, query.to)));
        for (const row of rows) {
          push(row.endOn, {
            kind: 'period',
            id: row.id,
            title: null,
            task: null,
            meeting: null,
            project: null,
            period: { year: row.year, quarter: row.quarter },
          });
        }
      }

      const holidays = new Set(on.has('holidays') ? calendar.holidays : []);
      const days: CalendarDay[] = [...byDay.entries()].map(([date, items]) => ({
        date,
        off: on.has('holidays') && hoursOn({ ...calendar, holidays: [] }, date) === null,
        holiday: holidays.has(date),
        items,
      }));
      return { days, overdue, truncated };
    });
  }

  /** Open tasks assigned to me that I still see. */
  private myOpenTasks(ctx: TenantContext) {
    return and(
      eq(s.tasks.assigneeId, ctx.memberId),
      inArray(s.tasks.statusCategory, [...OPEN]),
      isNull(s.tasks.deletedAt),
      visibleTasks(ctx.actor),
    );
  }
}
