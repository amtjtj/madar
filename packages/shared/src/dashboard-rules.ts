import { addDays, persianWeekdayOfCalendarDate } from './locale/jalali.js';
import { isWorkingDay, type WorkCalendar } from './locale/work-calendar.js';

/**
 * Dashboard definitions (plan phase-1-step-8 §1). Fixed for now; per-company settings after the
 * demo. Nothing here ranks people: «needs help» yields reasons, never a score.
 */
export const DASHBOARD_RULES = {
  /** An in-progress task with no activity for this many working days is stuck. */
  stuckIdleWorkingDays: 5,
  /** An open task more than this many working days past due is stuck. */
  stuckOverdueWorkingDays: 2,
  /** A department is behind when its goals trail the season by more than this… */
  behindGoalGap: 0.15,
  /** …or when more than this share of its open tasks is overdue. */
  behindOverdueShare: 0.2,
  /** A project is at risk when its done share trails its elapsed time by more than this. */
  atRiskProgressGap: 0.2,
  /** «Might need help»: this many overdue tasks… */
  helpOverdue: 3,
  /** …or more open tasks than this. */
  helpOpen: 15,
  /** Weeks in the «done per week» trend. */
  trendWeeks: 8,
} as const;

/** Share of a date range already behind us (0..1), calendar days, inclusive start. */
export function elapsedShare(startOn: string, endOn: string, today: string): number {
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  const total = day(endOn) - day(startOn) + 1;
  if (total <= 0) return today >= endOn ? 1 : 0;
  return Math.min(1, Math.max(0, (day(today) - day(startOn)) / total));
}

/** The calendar date that lies `days` working days before `today`. */
export function workingDaysBefore(calendar: WorkCalendar, today: string, days: number): string {
  let date = today;
  for (let counted = 0, guard = 0; counted < days && guard < 400; guard++) {
    date = addDays(date, -1);
    if (isWorkingDay(calendar, date)) counted++;
  }
  return date;
}

/** Saturday-based week starts, oldest first, ending with the week of `today`. */
export function weekStarts(today: string, weeks: number): string[] {
  const current = weekStartOf(today);
  return Array.from({ length: weeks }, (_, i) => addDays(current, -7 * (weeks - 1 - i)));
}

export function isDepartmentBehind(input: {
  goalProgress: number | null;
  seasonShare: number;
  openTasks: number;
  overdueTasks: number;
}): boolean {
  const goalsBehind =
    input.goalProgress !== null &&
    input.goalProgress < input.seasonShare - DASHBOARD_RULES.behindGoalGap;
  const overdueHeavy =
    input.openTasks > 0 &&
    input.overdueTasks / input.openTasks > DASHBOARD_RULES.behindOverdueShare;
  return goalsBehind || overdueHeavy;
}

/**
 * Behind schedule: overdue work, or weighted progress (0..1, ADR 0018) more than the allowed gap
 * behind the share of time elapsed. `progress` is null when no task counts.
 */
export function isProjectAtRisk(input: {
  startOn: string;
  dueOn: string | null;
  today: string;
  progress: number | null;
  overdue: number;
}): boolean {
  if (input.overdue > 0) return true;
  if (!input.dueOn || input.progress === null) return false;
  const expected = elapsedShare(input.startOn, input.dueOn, input.today);
  return input.progress < expected - DASHBOARD_RULES.atRiskProgressGap;
}

export type HelpReason =
  | { kind: 'overdue'; count: number }
  | { kind: 'stuck'; count: number }
  | { kind: 'overloaded'; count: number };

/** Why a team member might need a hand (empty: nothing to flag). */
export function helpReasons(load: { open: number; overdue: number; stuck: number }): HelpReason[] {
  const reasons: HelpReason[] = [];
  if (load.overdue >= DASHBOARD_RULES.helpOverdue)
    reasons.push({ kind: 'overdue', count: load.overdue });
  if (load.stuck > 0) reasons.push({ kind: 'stuck', count: load.stuck });
  if (load.open > DASHBOARD_RULES.helpOpen) reasons.push({ kind: 'overloaded', count: load.open });
  return reasons;
}

/** Saturday of the week that contains `date`. */
export function weekStartOf(date: string): string {
  return addDays(date, -persianWeekdayOfCalendarDate(date));
}

/** Friday that ends the week starting on `weekStart`. */
export function weekEndOf(weekStart: string): string {
  return addDays(weekStart, 6);
}
