import { schema as s, withTenant, type DbHandle } from '@madar/db';
import {
  addDays,
  calendarDateIn,
  currentStreak,
  dayStatus,
  longestStreak,
  taskXp,
  type StreakStatus,
} from '@madar/shared';
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import { grant } from '../gamification/ledger.js';
import { loadGamificationSettings } from '../gamification/settings.js';
import { loadWorkCalendar } from '../notifications/calendar.js';

/** Days of streak history the demo company gets. */
const STREAK_DAYS = 21;

/**
 * The demo company's XP and streaks (plan phase-3-step-18a): XP from the eight weeks of finished
 * work through the same ledger rules the worker uses (daily cap included), and three weeks of
 * closed days with a few missed ones. The seed's own events are then marked as handled, so the
 * worker neither pays the same work twice nor sends twenty «level up» notifications at start.
 */
export async function seedGamification(handle: DbHandle, tenantId: string): Promise<void> {
  await withTenant(handle.db, { tenantId }, async (tx) => {
    const { calendar, timeZone } = await loadWorkCalendar(tx, tenantId);
    const settings = await loadGamificationSettings(tx, tenantId);
    const finished = await tx
      .select({
        id: s.tasks.id,
        assigneeId: s.tasks.assigneeId,
        weight: s.tasks.weight,
        dueOn: s.tasks.dueOn,
        source: s.tasks.source,
        completedAt: s.tasks.completedAt,
      })
      .from(s.tasks)
      .where(
        and(
          eq(s.tasks.statusCategory, 'done'),
          isNotNull(s.tasks.assigneeId),
          isNotNull(s.tasks.completedAt),
          isNull(s.tasks.deletedAt),
        ),
      )
      .orderBy(asc(s.tasks.completedAt));
    for (const task of finished) {
      if (!task.assigneeId || !task.completedAt) continue;
      const completedOn = calendarDateIn(task.completedAt, timeZone);
      const xp = taskXp({ ...task, completedOn });
      const key = `task:${task.id}:${task.completedAt.toISOString()}`;
      const base = { memberId: task.assigneeId, taskId: task.id, day: completedOn, sourceKey: key };
      await grant(
        tx,
        { ...base, reason: 'task_completed', amount: xp.completed },
        settings.dailyXpCap,
      );
      if (xp.onTime) {
        await grant(tx, { ...base, reason: 'on_time', amount: xp.onTime }, settings.dailyXpCap);
      }
    }

    // Three weeks of closed days: mostly complete, a missed day here and there further back.
    const today = calendarDateIn(new Date(), timeZone);
    const yesterday = addDays(today, -1);
    const people = await tx
      .select({ id: s.members.id })
      .from(s.members)
      .where(eq(s.members.status, 'active'))
      .orderBy(asc(s.members.createdAt));
    for (const [index, person] of people.entries()) {
      const days: Array<{ day: string; status: StreakStatus }> = [];
      for (let back = STREAK_DAYS; back >= 1; back--) {
        const day = addDays(today, -back);
        const miss = back > 6 && (back + index * 3) % 9 === 0;
        const facts = miss
          ? { planned: 3, done: 1, onLeave: false }
          : { planned: 4, done: 3, onLeave: false };
        const status = dayStatus(calendar, day, facts, settings.completeDayPercent);
        const working = status === 'completed' || status === 'missed';
        await tx.insert(s.streakDays).values({
          memberId: person.id,
          day,
          status,
          planned: working ? facts.planned : 0,
          done: working ? facts.done : 0,
        });
        days.push({ day, status });
      }
      const first = addDays(today, -STREAK_DAYS);
      const stats = {
        currentStreak: currentStreak(days, yesterday, calendar, first),
        longestStreak: longestStreak(days),
        streakThrough: yesterday,
      };
      await tx
        .insert(s.memberStats)
        .values({ memberId: person.id, ...stats })
        .onConflictDoUpdate({
          target: [s.memberStats.tenantId, s.memberStats.memberId],
          set: stats,
        });
    }

    // Everything so far is history: the worker skips it.
    for (const consumer of ['gamification', 'notifications', 'push']) {
      await tx.execute(sql`
        insert into processed_events (tenant_id, consumer, event_id)
        select tenant_id, ${consumer}, id from domain_events
        where ${consumer} = 'gamification' or type like 'member.%'
        on conflict do nothing`);
    }
  });
}
