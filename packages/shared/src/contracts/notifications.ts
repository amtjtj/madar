import { z } from 'zod';

import { calendarDate } from './work.js';

export const NOTIFICATION_SUBJECTS = ['task', 'project', 'goal', 'report', 'letter'] as const;
export type NotificationSubject = (typeof NOTIFICATION_SUBJECTS)[number];

export const NOTIFICATION_KINDS = [
  'task_assigned',
  'task_commented',
  'task_due_soon',
  'task_overdue',
  'task_overdue_escalation',
  'project_member_added',
  'task_progress',
  'task_evidence_pinned',
  'letter_received',
  'letter_referred',
  'key_result_checkin_due',
  'weekly_report_ready',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const notification = z.object({
  id: z.uuid(),
  kind: z.enum(NOTIFICATION_KINDS),
  subjectType: z.enum(NOTIFICATION_SUBJECTS),
  subjectId: z.uuid(),
  actor: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
  /** Title of the task or project at the time (shown in the list). */
  title: z.string(),
  /** Extra values for the message, e.g. the due date or how many working days overdue. */
  data: z.record(z.string(), z.union([z.string(), z.number()])),
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
});
export type Notification = z.infer<typeof notification>;

export const notificationList = z.object({
  items: z.array(notification),
  unreadCount: z.number().int(),
});
export type NotificationList = z.infer<typeof notificationList>;

export const listNotificationsQuery = z.object({
  /** Return notifications created before this one (pagination). */
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuery>;

export const notificationPreferences = z.object({
  mutedKinds: z.array(z.enum(NOTIFICATION_KINDS)).max(NOTIFICATION_KINDS.length),
  /** Also interrupt outside working hours (default off, brief §gamification). */
  offHours: z.boolean(),
});
export type NotificationPreferences = z.infer<typeof notificationPreferences>;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const dayHours = z
  .object({ start: hhmm, end: hhmm })
  .refine((d) => d.start < d.end, { message: 'start must be before end' })
  .nullable();

export const workCalendar = z.object({
  /** Seven entries, Saturday first; null for a day off. */
  weeklyHours: z.array(dayHours).length(7),
  holidays: z.array(calendarDate).max(100),
  overdueEscalationDays: z.number().int().min(0).max(30),
});
export type WorkCalendarDto = z.infer<typeof workCalendar>;
