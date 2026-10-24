import { schema as s, type Tx } from '@madar/db';
import {
  addDays,
  calendarDateIn,
  currentStreak,
  dayStatus,
  longestStreak,
  zonedInstant,
  type StreakStatus,
} from '@madar/shared';
import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';

import { loadWorkCalendar } from '../notifications/calendar.js';
import { refreshCounters } from './counters.js';
import { loadGamificationSettings } from './settings.js';

/**
 * Streak days (ADR 0029): each member's finished day is closed once into `streak_days`, and the
 * streak in `member_stats` follows. Only `closeDays` writes new days; only `excuseLeaveDays`
 * changes one (missed → excused leave, the one change RLS allows).
 */

/** A worker that was down catches up this far back, no further. */
export const CLOSE_BACKFILL_DAYS = 14;

export interface DayCount {
  planned: number;
  done: number;
}

/** «برنامه امروز» items and how many were done by the end of `day`, per member. */
export async function planCounts(
  tx: Tx,
  memberIds: string[],
  day: string,
  timeZone: string,
  until?: Date,
): Promise<Map<string, DayCount>> {
  if (!memberIds.length) return new Map();
  const end = until ?? zonedInstant(addDays(day, 1), '00:00', timeZone);
  const rows = await tx
    .select({
      memberId: s.dailyPlanItems.memberId,
      planned: sql<number>`count(*)::int`,
      done: sql<number>`(count(*) filter (where ${s.tasks.statusCategory} = 'done' and ${s.tasks.completedAt} < ${end}))::int`,
    })
    .from(s.dailyPlanItems)
    .innerJoin(s.tasks, and(eq(s.tasks.id, s.dailyPlanItems.taskId), isNull(s.tasks.deletedAt)))
    .where(and(eq(s.dailyPlanItems.planDate, day), inArray(s.dailyPlanItems.memberId, memberIds)))
    .groupBy(s.dailyPlanItems.memberId);
  return new Map(rows.map((r) => [r.memberId, { planned: r.planned, done: r.done }]));
}

/** Members with an approved daily leave covering `day`. */
async function onLeave(tx: Tx, memberIds: string[], day: string): Promise<Set<string>> {
  if (!memberIds.length) return new Set();
  const rows = await tx
    .select({ memberId: s.leaves.memberId })
    .from(s.leaves)
    .where(
      and(
        eq(s.leaves.kind, 'daily'),
        lte(s.leaves.startsOn, day),
        gte(s.leaves.endsOn, day),
        inArray(s.leaves.memberId, memberIds),
      ),
    );
  return new Set(rows.map((r) => r.memberId));
}

/** One streak update per member at a time (the job and a late leave approval). */
async function lockStreak(tx: Tx, memberId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`streak:${memberId}`}, 0))`);
}

/** Moves the cached streak forward by one closed day. */
function step(
  stats: { current: number; longest: number },
  status: StreakStatus,
): { current: number; longest: number } {
  if (status === 'completed') {
    const current = stats.current + 1;
    return { current, longest: Math.max(stats.longest, current) };
  }
  return status === 'missed' ? { current: 0, longest: stats.longest } : stats;
}

/**
 * Closes every finished day not yet closed for each active member, up to yesterday in the
 * company's time zone (at most `CLOSE_BACKFILL_DAYS` back). Returns how many days were written.
 * Idempotent: a day is written once (primary key) and the streak only moves past `streak_through`.
 */
export async function closeDays(tx: Tx, tenantId: string, now: Date): Promise<number> {
  const { calendar, timeZone } = await loadWorkCalendar(tx, tenantId);
  const settings = await loadGamificationSettings(tx, tenantId);
  const yesterday = addDays(calendarDateIn(now, timeZone), -1);
  const people = await tx
    .select({
      id: s.members.id,
      joinedAt: s.members.joinedAt,
      through: s.memberStats.streakThrough,
    })
    .from(s.members)
    .leftJoin(s.memberStats, eq(s.memberStats.memberId, s.members.id))
    .where(eq(s.members.status, 'active'));
  // Each person's first day to close: the day after joining, or after the last closed day.
  const firstOf = (p: (typeof people)[number]) => {
    const afterJoin = addDays(calendarDateIn(p.joinedAt, timeZone), 1);
    const afterClosed = p.through ? addDays(p.through, 1) : afterJoin;
    const floor = addDays(yesterday, -(CLOSE_BACKFILL_DAYS - 1));
    return [afterJoin, afterClosed, floor].sort().at(-1) ?? floor;
  };
  const start = people.map(firstOf).sort()[0];
  if (!start || start > yesterday) return 0;
  let written = 0;
  for (let day = start; day <= yesterday; day = addDays(day, 1)) {
    const due = people.filter((p) => firstOf(p) <= day).map((p) => p.id);
    if (!due.length) continue;
    const counts = await planCounts(tx, due, day, timeZone);
    const away = await onLeave(tx, due, day);
    for (const memberId of due) {
      const count = counts.get(memberId) ?? { planned: 0, done: 0 };
      const status: StreakStatus = settings.enabled
        ? dayStatus(
            calendar,
            day,
            { ...count, onLeave: away.has(memberId) },
            settings.completeDayPercent,
          )
        : 'off_day';
      const inserted = await tx
        .insert(s.streakDays)
        .values({ memberId, day, status, planned: count.planned, done: count.done })
        .onConflictDoNothing()
        .returning({ day: s.streakDays.day });
      if (!inserted.length) continue;
      written++;
      // Read under the member's lock: a leave approved meanwhile may have recounted the streak.
      await lockStreak(tx, memberId);
      const [stats] = await tx
        .select({ current: s.memberStats.currentStreak, longest: s.memberStats.longestStreak })
        .from(s.memberStats)
        .where(eq(s.memberStats.memberId, memberId));
      const next = step(stats ?? { current: 0, longest: 0 }, status);
      await tx
        .insert(s.memberStats)
        .values({
          memberId,
          currentStreak: next.current,
          longestStreak: next.longest,
          streakThrough: day,
        })
        .onConflictDoUpdate({
          target: [s.memberStats.tenantId, s.memberStats.memberId],
          set: {
            currentStreak: next.current,
            longestStreak: next.longest,
            streakThrough: day,
            updatedAt: new Date(),
          },
        });
      // A longer best streak may reach a badge.
      if (next.longest > (stats?.longest ?? 0)) await refreshCounters(tx, memberId, timeZone);
    }
  }
  return written;
}

/** Recounts a member's streak from all their closed days (after a day changed). */
export async function rebuildStreak(tx: Tx, memberId: string) {
  await lockStreak(tx, memberId);
  const days = await tx
    .select({ day: s.streakDays.day, status: s.streakDays.status })
    .from(s.streakDays)
    .where(eq(s.streakDays.memberId, memberId))
    .orderBy(s.streakDays.day);
  if (!days.length) return;
  const current = currentStreak(days);
  const longest = longestStreak(days);
  await tx
    .update(s.memberStats)
    .set({ currentStreak: current, longestStreak: longest, updatedAt: new Date() })
    .where(eq(s.memberStats.memberId, memberId));
}

/**
 * A daily leave approved after its days were closed: those missed days become excused, and the
 * streak is recounted (the same event's transaction).
 */
export async function excuseLeaveDays(tx: Tx, requestId: string): Promise<void> {
  const [leave] = await tx
    .select({
      memberId: s.leaves.memberId,
      kind: s.leaves.kind,
      startsOn: s.leaves.startsOn,
      endsOn: s.leaves.endsOn,
    })
    .from(s.leaves)
    .where(eq(s.leaves.requestId, requestId));
  if (leave?.kind !== 'daily') return;
  const changed = await tx
    .update(s.streakDays)
    .set({ status: 'excused_leave' })
    .where(
      and(
        eq(s.streakDays.memberId, leave.memberId),
        eq(s.streakDays.status, 'missed'),
        gte(s.streakDays.day, leave.startsOn),
        lte(s.streakDays.day, leave.endsOn),
      ),
    )
    .returning({ day: s.streakDays.day });
  if (!changed.length) return;
  await rebuildStreak(tx, leave.memberId);
}
