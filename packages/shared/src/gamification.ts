import { addDays } from './locale/jalali.js';
import { hoursOn, isWorkingDay, type WorkCalendar } from './locale/work-calendar.js';

/**
 * Gamification rules (ADR 0007, plan phase-3-step-18a). Pure functions shared by the API, the worker
 * and the demo seed, so every path gives the same XP and the same streak.
 */

export const XP_REASONS = ['task_completed', 'on_time', 'goal_checkin', 'reversal'] as const;
export type XpReason = (typeof XP_REASONS)[number];

export const STREAK_STATUSES = [
  'completed',
  'missed',
  'excused_leave',
  'excused_holiday',
  'off_day',
] as const;
export type StreakStatus = (typeof STREAK_STATUSES)[number];

export const XP_PER_WEIGHT = 10;
export const ON_TIME_PER_WEIGHT = 5;
/** A self-made, self-given task with weight 1: barely worth anything, so fake tasks do not pay. */
export const SELF_TASK_XP = 2;
export const GOAL_CHECKIN_XP = 5;

export interface TaskXpInput {
  weight: number;
  /** ADR 0017: `self` when the assignee made the task for themselves. */
  source: string | null;
  dueOn: string | null;
  /** The company's calendar day the task was finished on. */
  completedOn: string;
}

/** XP for finishing a task, split by reason (before the daily cap). */
export function taskXp(input: TaskXpInput): { completed: number; onTime: number } {
  const weight = Math.min(5, Math.max(1, Math.round(input.weight)));
  const selfMade = input.source === 'self' && weight === 1;
  if (selfMade) return { completed: SELF_TASK_XP, onTime: 0 };
  const onTime = input.dueOn !== null && input.completedOn <= input.dueOn;
  return { completed: XP_PER_WEIGHT * weight, onTime: onTime ? ON_TIME_PER_WEIGHT * weight : 0 };
}

/** How much of `amount` still fits under the daily cap after `earnedToday`. */
export function underCap(amount: number, earnedToday: number, cap: number): number {
  return Math.max(0, Math.min(amount, cap - earnedToday));
}

/** XP needed to reach `level` (level 1 needs none): 50 × L × (L − 1). */
export function xpForLevel(level: number): number {
  return 50 * level * (level - 1);
}

export interface LevelInfo {
  level: number;
  /** XP earned inside the current level. */
  into: number;
  /** XP the current level spans (to the next one). */
  span: number;
}

export function levelOf(xp: number): LevelInfo {
  const total = Math.max(0, xp);
  // Largest L with 50·L·(L−1) ≤ total.
  let level = Math.max(1, Math.floor((1 + Math.sqrt(1 + total / 12.5)) / 2));
  while (xpForLevel(level + 1) <= total) level++;
  while (level > 1 && xpForLevel(level) > total) level--;
  const start = xpForLevel(level);
  return { level, into: total - start, span: xpForLevel(level + 1) - start };
}

export interface DayFacts {
  /** Items on the member's «برنامه امروز» that day. */
  planned: number;
  /** Of those, finished by the end of the day. */
  done: number;
  /** An approved daily leave covers the day. */
  onLeave: boolean;
}

/** Whether a day's plan counts as complete (ADR 0007): at least one item and `percent`% done. */
export function isCompleteDay(planned: number, done: number, percent: number): boolean {
  return planned > 0 && done * 100 >= planned * percent;
}

/** Items still to finish today for a complete day (0 when it already is or nothing is planned). */
export function neededForCompleteDay(planned: number, done: number, percent: number): number {
  if (planned === 0) return 0;
  return Math.max(0, Math.ceil((planned * percent) / 100) - done);
}

/** A finished day's streak status. */
export function dayStatus(
  calendar: WorkCalendar,
  day: string,
  facts: DayFacts,
  percent: number,
): StreakStatus {
  if (calendar.holidays.includes(day)) return 'excused_holiday';
  if (hoursOn(calendar, day) === null) return 'off_day';
  if (facts.onLeave) return 'excused_leave';
  return isCompleteDay(facts.planned, facts.done, percent) ? 'completed' : 'missed';
}

/**
 * The streak ending at the latest closed day: completed days back to the first missed one;
 * excused and off days are skipped (they neither break nor add). `days` may be in any order and
 * need not be contiguous: a closed working day that is missing from it counts as missed.
 */
export function currentStreak(
  days: ReadonlyArray<{ day: string; status: StreakStatus }>,
  through: string,
  calendar: WorkCalendar,
  since: string,
): number {
  const byDay = new Map(days.map((d) => [d.day, d.status]));
  let count = 0;
  for (let day = through; day >= since; day = addDays(day, -1)) {
    const status = byDay.get(day) ?? (isWorkingDay(calendar, day) ? 'missed' : 'off_day');
    if (status === 'completed') count++;
    else if (status === 'missed') break;
  }
  return count;
}

/** The longest run of completed days (excused and off days skipped) in day order. */
export function longestStreak(days: ReadonlyArray<{ day: string; status: StreakStatus }>): number {
  let best = 0;
  let run = 0;
  for (const d of [...days].sort((a, b) => a.day.localeCompare(b.day))) {
    if (d.status === 'completed') best = Math.max(best, ++run);
    else if (d.status === 'missed') run = 0;
  }
  return best;
}
