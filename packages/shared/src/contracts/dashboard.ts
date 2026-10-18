import { z } from 'zod';

import { CHECKIN_STATUSES, GOAL_LEVELS } from './goals.js';
import { calendarDate } from './work.js';

const personRef = z.object({ id: z.uuid(), displayName: z.string() });
const departmentRef = z.object({ id: z.uuid(), name: z.string() });

const goalBrief = z.object({
  id: z.uuid(),
  title: z.string(),
  level: z.enum(GOAL_LEVELS),
  owner: personRef,
  progress: z.number(),
  status: z.enum(CHECKIN_STATUSES).nullable(),
  completedAt: z.iso.datetime().nullable(),
});
export type GoalBrief = z.infer<typeof goalBrief>;

const weeklyDone = z.array(z.object({ weekStart: calendarDate, count: z.number().int() }));

export const atRiskProject = z.object({
  id: z.uuid(),
  name: z.string(),
  department: departmentRef.nullable(),
  dueOn: calendarDate.nullable(),
  done: z.number().int(),
  total: z.number().int(),
  overdue: z.number().int(),
});

const season = z
  .object({ id: z.uuid(), year: z.number().int(), quarter: z.number().int(), share: z.number() })
  .nullable();

export const companyDashboard = z.object({
  today: calendarDate,
  season,
  headline: z.object({
    /** Mean progress of the season's company goals; null when there are none. */
    goalProgress: z.number().nullable(),
    overdueTasks: z.number().int(),
    atRiskProjects: z.number().int(),
  }),
  goals: z.array(goalBrief),
  departments: z.array(
    departmentRef.extend({
      goalProgress: z.number().nullable(),
      openTasks: z.number().int(),
      overdueTasks: z.number().int(),
      behind: z.boolean(),
    }),
  ),
  weeklyDone,
  atRiskProjects: z.array(atRiskProject),
});
export type CompanyDashboard = z.infer<typeof companyDashboard>;

export const helpReason = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('overdue'), count: z.number().int() }),
  z.object({ kind: z.literal('stuck'), count: z.number().int() }),
  z.object({ kind: z.literal('overloaded'), count: z.number().int() }),
]);

export const departmentDashboard = z.object({
  department: departmentRef,
  today: calendarDate,
  season,
  headline: z.object({
    openTasks: z.number().int(),
    overdueTasks: z.number().int(),
    stuckTasks: z.number().int(),
    goalProgress: z.number().nullable(),
  }),
  /** Open work per member, alphabetical (never ranked). */
  workload: z.array(
    z.object({
      member: personRef,
      todo: z.number().int(),
      inProgress: z.number().int(),
      /** Null unless the viewer manages the department. */
      overdue: z.number().int().nullable(),
    }),
  ),
  stuck: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      assignee: personRef.nullable(),
      dueOn: calendarDate.nullable(),
      reason: z.enum(['idle', 'overdue']),
    }),
  ),
  goals: z.array(goalBrief),
  /** Only for the department's own head and managers; alphabetical, reasons not scores. */
  needsHelp: z.array(z.object({ member: personRef, reasons: z.array(helpReason) })).nullable(),
  weeklyDone,
});
export type DepartmentDashboard = z.infer<typeof departmentDashboard>;
