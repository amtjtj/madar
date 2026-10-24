import { z } from 'zod';

import { STREAK_STATUSES, XP_REASONS } from '../gamification.js';
import { calendarDate } from './work.js';

/** The company's gamification settings (in `tenants.settings.gamification`, ADR 0029). */
export const gamificationSettings = z.object({
  enabled: z.boolean().default(true),
  /** Share of «برنامه امروز» to finish for a complete day (ADR 0007). */
  completeDayPercent: z.number().int().min(10).max(100).default(70),
  /** XP one person may earn in one day from work and goals. */
  dailyXpCap: z.number().int().min(20).max(1000).default(150),
});
export type GamificationSettings = z.infer<typeof gamificationSettings>;

/** My own progress (only ever my own; no endpoint returns anyone else's). */
export const myProgress = z.object({
  enabled: z.boolean(),
  xp: z.number().int(),
  level: z.number().int(),
  /** XP inside the current level and what the level spans. */
  levelInto: z.number().int(),
  levelSpan: z.number().int(),
  currentStreak: z.number().int(),
  longestStreak: z.number().int(),
  today: z.object({
    date: calendarDate,
    working: z.boolean(),
    planned: z.number().int(),
    done: z.number().int(),
    /** Items still to finish for a complete day. */
    needed: z.number().int(),
    complete: z.boolean(),
    xp: z.number().int(),
    capReached: z.boolean(),
  }),
  completeDayPercent: z.number().int(),
});
export type MyProgress = z.infer<typeof myProgress>;

export const xpEntry = z.object({
  id: z.uuid(),
  amount: z.number().int(),
  reason: z.enum(XP_REASONS),
  /** The task, when I can still see it. */
  task: z.object({ id: z.uuid(), title: z.string(), weight: z.number().int() }).nullable(),
  /** Set on a reversal: what it took back. */
  reversed: z.enum(XP_REASONS).nullable(),
  createdAt: z.iso.datetime(),
});
export type XpEntry = z.infer<typeof xpEntry>;

export const XP_PAGE = 30;
export const listXpQuery = z.object({ before: z.uuid().optional() });
export type ListXpQuery = z.infer<typeof listXpQuery>;

export const STREAK_RANGE_MAX_DAYS = 12 * 7;
export const streakQuery = z
  .object({ from: calendarDate, to: calendarDate })
  .refine((q) => q.from <= q.to, { message: 'reversed range' })
  .refine(
    (q) =>
      (Date.parse(`${q.to}T00:00:00Z`) - Date.parse(`${q.from}T00:00:00Z`)) / 86_400_000 <
      STREAK_RANGE_MAX_DAYS,
    { message: 'range too long' },
  );
export type StreakQuery = z.infer<typeof streakQuery>;

export const streakDay = z.object({
  day: calendarDate,
  status: z.enum(STREAK_STATUSES),
  planned: z.number().int(),
  done: z.number().int(),
});
export type StreakDay = z.infer<typeof streakDay>;
