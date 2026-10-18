import { z } from 'zod';

import { CHECKIN_STATUSES, GOAL_LEVELS, KEY_RESULT_KINDS } from './goals.js';
import { calendarDate } from './work.js';

/**
 * The weekly report (plan phase-1-step-8b): stored as a snapshot at the end of each Saturday-based
 * week, or built live for the current week. It never contains private-project tasks or personal
 * goals, and never counts or compares people (names appear only next to finished work).
 */
const personRef = z.object({ id: z.uuid(), displayName: z.string() });
const departmentRef = z.object({ id: z.uuid(), name: z.string() });

export const REPORT_SCOPES = ['company', 'department'] as const;
export type ReportScope = (typeof REPORT_SCOPES)[number];

const totals = z.object({
  done: z.number().int(),
  created: z.number().int(),
  /** Open tasks past due at the end of the week. */
  overdue: z.number().int(),
});

export const weeklyReport = z.object({
  version: z.literal(1),
  scope: z.enum(REPORT_SCOPES),
  department: departmentRef.nullable(),
  weekStart: calendarDate,
  weekEnd: calendarDate,
  generatedAt: z.iso.datetime(),
  /** The current week, built live («تا امروز»). */
  partial: z.boolean(),
  totals,
  /** The week before; overdue is null when no snapshot exists for it. */
  previous: totals.extend({ overdue: z.number().int().nullable() }),
  departments: z.array(
    departmentRef.extend({
      done: z.number().int(),
      created: z.number().int(),
      overdue: z.number().int(),
      goalProgress: z.number().nullable(),
      behind: z.boolean(),
    }),
  ),
  goals: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      level: z.enum(GOAL_LEVELS),
      progress: z.number(),
      /** Change in this week, from its key results' check-ins (null without key results). */
      change: z.number().nullable(),
      checkins: z.number().int(),
      status: z.enum(CHECKIN_STATUSES).nullable(),
    }),
  ),
  keyResults: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      goalTitle: z.string(),
      kind: z.enum(KEY_RESULT_KINDS),
      unit: z.string().nullable(),
      from: z.number(),
      to: z.number(),
      target: z.number(),
      status: z.enum(CHECKIN_STATUSES),
    }),
  ),
  atRiskProjects: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      department: departmentRef.nullable(),
      dueOn: calendarDate.nullable(),
      done: z.number().int(),
      total: z.number().int(),
      overdue: z.number().int(),
    }),
  ),
  /** Important finished work, heaviest first, with who did it (recognition, not ranking). */
  highlights: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      weight: z.number().int(),
      department: departmentRef,
      assignee: personRef.nullable(),
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
});
export type WeeklyReport = z.infer<typeof weeklyReport>;

export const weeklyReportQuery = z.object({
  scope: z.enum(REPORT_SCOPES),
  departmentId: z.uuid().optional(),
  /** Saturday of the week; defaults to the current week. */
  week: calendarDate.optional(),
});
export type WeeklyReportQuery = z.infer<typeof weeklyReportQuery>;

export const reportWeeksQuery = weeklyReportQuery.omit({ week: true });
export type ReportWeeksQuery = z.infer<typeof reportWeeksQuery>;
