import { z } from 'zod';

import {
  BADGE_TIERS,
  BADGES,
  COUNTER_KEYS,
  STREAK_STATUSES,
  VALUE_TAGS,
  XP_REASONS,
} from '../gamification.js';
import { calendarDate } from './work.js';

/** The company's gamification settings (in `tenants.settings.gamification`, ADR 0029). */
export const gamificationSettings = z.object({
  enabled: z.boolean().default(true),
  /** Share of «برنامه امروز» to finish for a complete day (ADR 0007). */
  completeDayPercent: z.number().int().min(10).max(100).default(70),
  /** XP one person may earn in one day from work and goals. */
  dailyXpCap: z.number().int().min(20).max(1000).default(150),
  /** Thanks each person may give in a Jalali week (step 18b). */
  kudosPerWeek: z.number().int().min(1).max(20).default(5),
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

const personRef = z.object({ id: z.uuid(), displayName: z.string() });

export const giveKudosRequest = z.object({
  toMemberId: z.uuid(),
  valueTag: z.enum(VALUE_TAGS),
  message: z.string().trim().min(3).max(280),
  taskId: z.uuid().optional(),
  private: z.boolean().default(false),
});
export type GiveKudosRequest = z.infer<typeof giveKudosRequest>;

export const kudosItem = z.object({
  id: z.uuid(),
  from: personRef,
  to: personRef,
  valueTag: z.enum(VALUE_TAGS),
  message: z.string(),
  /** The task, only when the reader sees it too. */
  task: z.object({ id: z.uuid(), title: z.string() }).nullable(),
  private: z.boolean(),
  /** Hidden by the receiver from their profile (still shown to the two of them). */
  hidden: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type KudosItem = z.infer<typeof kudosItem>;

export const KUDOS_PAGE = 20;
export const listKudosQuery = z.object({
  /** Kudos received by this member; without it, the company's latest public ones. */
  member: z.uuid().optional(),
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(KUDOS_PAGE).default(KUDOS_PAGE),
});
export type ListKudosQuery = z.infer<typeof listKudosQuery>;

export const kudosAllowance = z.object({
  enabled: z.boolean(),
  perWeek: z.number().int(),
  left: z.number().int(),
  weekStart: calendarDate,
});
export type KudosAllowance = z.infer<typeof kudosAllowance>;

const badgeKey = z.enum(BADGES.map((b) => b.key) as [string, ...string[]]);

export const earnedBadge = z.object({
  key: badgeKey,
  tier: z.enum(BADGE_TIERS),
  awardedAt: z.iso.datetime(),
});
export type EarnedBadge = z.infer<typeof earnedBadge>;

/** A colleague's profile: who they are and the badges they earned (never XP, level or streak). */
export const memberProfile = z.object({
  id: z.uuid(),
  displayName: z.string(),
  departments: z.array(z.object({ id: z.uuid(), name: z.string(), deptRole: z.string() })),
  badges: z.array(earnedBadge),
  gamification: z.boolean(),
  me: z.boolean(),
});
export type MemberProfile = z.infer<typeof memberProfile>;

/** Every badge with my state and my progress towards it (only mine). */
export const myBadge = z.object({
  key: badgeKey,
  tier: z.enum(BADGE_TIERS),
  counter: z.enum(COUNTER_KEYS),
  value: z.number().int(),
  goal: z.number().int(),
  awardedAt: z.iso.datetime().nullable(),
});
export type MyBadge = z.infer<typeof myBadge>;
