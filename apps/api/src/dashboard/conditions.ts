import { schema as s } from '@madar/db';
import { DASHBOARD_RULES, workingDaysBefore, zonedInstant, type WorkCalendar } from '@madar/shared';
import { sql, type SQL } from 'drizzle-orm';

/**
 * SQL conditions on `tasks` shared by the dashboards and the filtered task lists, so a card and the
 * list it opens always count the same rows (plan phase-1-step-8 §1).
 */
export const openTask = sql`${s.tasks.statusCategory} in ('todo', 'in_progress')`;

export function overdueTask(today: string): SQL {
  return sql`(${openTask} and ${s.tasks.dueOn} < ${today})`;
}

/** In progress with no change or comment for N working days, or open and well past due. */
export function stuckTask(calendar: WorkCalendar, timeZone: string, today: string): SQL {
  const idleSince = zonedInstant(
    workingDaysBefore(calendar, today, DASHBOARD_RULES.stuckIdleWorkingDays),
    '00:00',
    timeZone,
  );
  const overdueBefore = workingDaysBefore(calendar, today, DASHBOARD_RULES.stuckOverdueWorkingDays);
  const lastTouched = sql`greatest(${s.tasks.updatedAt}, coalesce((
    select max(c.created_at) from comments c
    where c.subject_type = 'task' and c.subject_id = ${s.tasks.id}), ${s.tasks.updatedAt}))`;
  return sql`(${openTask} and (
    (${s.tasks.statusCategory} = 'in_progress' and ${lastTouched} < ${idleSince})
    or ${s.tasks.dueOn} < ${overdueBefore}))`;
}
