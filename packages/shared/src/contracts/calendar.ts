import { z } from 'zod';

import { CALENDAR_LAYERS, CALENDAR_MAX_DAYS } from '../calendar.js';
import { MEETING_RESPONSES, MEETING_TYPES } from '../meetings.js';
import { calendarDate, STATUS_CATEGORIES, TASK_PRIORITIES } from './work.js';

/** The personal calendar (plan phase-2-step-14a, ADR 0024): existing data, nothing stored. */
export const calendarQuery = z
  .object({
    from: calendarDate,
    to: calendarDate,
    /** Comma-separated layers; all when omitted. */
    layers: z
      .string()
      .optional()
      .transform((value) =>
        value === undefined
          ? [...CALENDAR_LAYERS]
          : value
              .split(',')
              .filter((l): l is (typeof CALENDAR_LAYERS)[number] =>
                (CALENDAR_LAYERS as readonly string[]).includes(l),
              ),
      ),
    /** Someone else's calendar (plan phase-2-step-14b); mine when omitted. */
    member: z.uuid().optional(),
  })
  .refine((q) => q.from <= q.to, { message: 'from after to' })
  .refine(
    (q) =>
      (new Date(`${q.to}T00:00:00Z`).getTime() - new Date(`${q.from}T00:00:00Z`).getTime()) /
        86_400_000 <
      CALENDAR_MAX_DAYS,
    { message: 'range too long' },
  );
export type CalendarQuery = z.infer<typeof calendarQuery>;

export const calendarItem = z.object({
  kind: z.enum(['task', 'meeting', 'project', 'period', 'leave']),
  id: z.uuid(),
  /** Null for a goal period (the web names it from its year and quarter). */
  title: z.string().nullable(),
  task: z
    .object({
      priority: z.enum(TASK_PRIORITIES),
      statusCategory: z.enum(STATUS_CATEGORIES),
      /** Due that day. */
      due: z.boolean(),
      /** On that day's plan. */
      planned: z.boolean(),
      overdue: z.boolean(),
      dueOn: calendarDate.nullable(),
      /** For moving the due date with `PATCH /api/tasks/:id`. */
      version: z.number().int(),
      /** The viewer may change it (drag or «تغییر سررسید»). */
      editable: z.boolean(),
    })
    .nullable(),
  meeting: z
    .object({
      startsAt: z.iso.datetime(),
      endsAt: z.iso.datetime(),
      type: z.enum(MEETING_TYPES),
      canceled: z.boolean(),
      myResponse: z.enum(MEETING_RESPONSES).nullable(),
    })
    .nullable(),
  project: z.object({ color: z.string().nullable() }).nullable(),
  period: z.object({ year: z.number().int(), quarter: z.number().int() }).nullable(),
  /** An approved leave: daily, or hourly with its times. */
  leave: z
    .object({
      kind: z.enum(['daily', 'hourly']),
      startsAt: z.iso.datetime().nullable(),
      endsAt: z.iso.datetime().nullable(),
    })
    .nullable()
    .optional(),
});
export type CalendarItem = z.infer<typeof calendarItem>;

export const calendarDay = z.object({
  date: calendarDate,
  /** A weekday the company does not work (e.g. Friday). */
  off: z.boolean(),
  /** One of the company's holidays. */
  holiday: z.boolean(),
  /** The company's working hours that day; null on a day off or holiday. */
  hours: z.object({ start: z.string(), end: z.string() }).nullable(),
  items: z.array(calendarItem),
});
export type CalendarDay = z.infer<typeof calendarDay>;

export const calendarRange = z.object({
  days: z.array(calendarDay),
  /** My open tasks past due (only when today is in the range), shown once above today. */
  overdue: z.array(calendarItem),
  /** Layers cut at CALENDAR_LAYER_MAX items. */
  truncated: z.array(z.enum(CALENDAR_LAYERS)),
  /** Whose calendar this is. */
  member: z.object({ id: z.uuid(), displayName: z.string() }),
});
export type CalendarRange = z.infer<typeof calendarRange>;

/** Someone whose calendar the viewer may open (themselves first). */
export const calendarPerson = z.object({
  id: z.uuid(),
  displayName: z.string(),
  department: z.string().nullable(),
});
export type CalendarPerson = z.infer<typeof calendarPerson>;
