import { hoursOn, type WorkCalendar } from './locale/work-calendar.js';

/**
 * Gamification rules (ADR 0007, plan phase-3-step-18a). Pure functions shared by the API, the worker
 * and the demo seed, so every path gives the same XP and the same streak.
 */

export const XP_REASONS = [
  'task_completed',
  'on_time',
  'goal_checkin',
  'reversal',
  'kudos_received',
  'helped',
] as const;
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
/** Receiving a colleague's thanks (step 18b); giving pays nothing, so nobody trades thanks. */
export const KUDOS_XP = 5;
/** Finishing work a colleague asked for in a shared project (source `request`, ADR 0017). */
export const HELPED_XP = 5;

export interface TaskXpInput {
  weight: number;
  /** ADR 0017: `personal` when the assignee made the task for themselves. */
  source: string | null;
  dueOn: string | null;
  /** The company's calendar day the task was finished on. */
  completedOn: string;
}

/** XP for finishing a task, split by reason (before the daily cap). */
export function taskXp(input: TaskXpInput): { completed: number; onTime: number; helped: number } {
  const weight = Math.min(5, Math.max(1, Math.round(input.weight)));
  const selfMade = input.source === 'personal' && weight === 1;
  if (selfMade) return { completed: SELF_TASK_XP, onTime: 0, helped: 0 };
  const onTime = input.dueOn !== null && input.completedOn <= input.dueOn;
  return {
    completed: XP_PER_WEIGHT * weight,
    onTime: onTime ? ON_TIME_PER_WEIGHT * weight : 0,
    helped: input.source === 'request' ? HELPED_XP : 0,
  };
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
 * need not be contiguous: a day that was never closed (before joining, a long outage) is skipped
 * too, the same as the worker's running count does.
 */
export function currentStreak(days: ReadonlyArray<{ day: string; status: StreakStatus }>): number {
  let count = 0;
  for (const d of [...days].sort((a, b) => b.day.localeCompare(a.day))) {
    if (d.status === 'completed') count++;
    else if (d.status === 'missed') break;
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

/** What badges count (plan phase-3-step-18b). Kept by the worker in `member_counters`. */
export const COUNTER_KEYS = [
  'tasks_completed',
  'on_time',
  'longest_streak',
  'kudos_received',
  'kudos_given',
  'goal_checkins',
  'level',
] as const;
export type CounterKey = (typeof COUNTER_KEYS)[number];

export const BADGE_TIERS = ['bronze', 'silver', 'gold'] as const;
export type BadgeTier = (typeof BADGE_TIERS)[number];

export interface BadgeDefinition {
  key: string;
  counter: CounterKey;
  /** Earned once the counter reaches this. */
  gte: number;
  tier: BadgeTier;
}

/** The ready-made badges, in display order. A badge once earned is kept for good. */
export const BADGES = [
  { key: 'first_task', counter: 'tasks_completed', gte: 1, tier: 'bronze' },
  { key: 'tasks_10', counter: 'tasks_completed', gte: 10, tier: 'bronze' },
  { key: 'tasks_50', counter: 'tasks_completed', gte: 50, tier: 'silver' },
  { key: 'tasks_100', counter: 'tasks_completed', gte: 100, tier: 'gold' },
  { key: 'on_time_25', counter: 'on_time', gte: 25, tier: 'silver' },
  { key: 'streak_5', counter: 'longest_streak', gte: 5, tier: 'bronze' },
  { key: 'streak_20', counter: 'longest_streak', gte: 20, tier: 'silver' },
  { key: 'streak_60', counter: 'longest_streak', gte: 60, tier: 'gold' },
  { key: 'kudos_5', counter: 'kudos_received', gte: 5, tier: 'bronze' },
  { key: 'kudos_25', counter: 'kudos_received', gte: 25, tier: 'silver' },
  { key: 'generous_10', counter: 'kudos_given', gte: 10, tier: 'silver' },
  { key: 'goals_12', counter: 'goal_checkins', gte: 12, tier: 'silver' },
  { key: 'level_5', counter: 'level', gte: 5, tier: 'silver' },
  { key: 'level_10', counter: 'level', gte: 10, tier: 'gold' },
  { key: 'first_thanks', counter: 'kudos_given', gte: 1, tier: 'bronze' },
] as const satisfies readonly BadgeDefinition[];
export type BadgeKey = (typeof BADGES)[number]['key'];

/**
 * Counters whose badges only their owner sees: a level or streak badge on a profile would show
 * the level and streak ADR 0029 keeps private.
 */
export const PRIVATE_BADGE_COUNTERS: readonly CounterKey[] = ['level', 'longest_streak'];

/** Whether colleagues may see this badge on a profile. */
export function isPublicBadge(key: string): boolean {
  const badge = BADGES.find((b) => b.key === key);
  return !!badge && !PRIVATE_BADGE_COUNTERS.includes(badge.counter);
}

/** Badges a set of counters reaches (whether or not they were awarded already). */
export function badgesReached(counters: Partial<Record<CounterKey, number>>): BadgeKey[] {
  return BADGES.filter((b) => (counters[b.counter] ?? 0) >= b.gte).map((b) => b.key);
}

export const VALUE_TAGS = [
  'teamwork',
  'help',
  'quality',
  'speed',
  'learning',
  'initiative',
] as const;
export type ValueTag = (typeof VALUE_TAGS)[number];

/** Thanks one person may give the same colleague in a week. */
export const KUDOS_SAME_PERSON_MAX = 2;
