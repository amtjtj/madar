import { Injectable } from '@nestjs/common';
import { schema as s, type OutboxEvent, type Tx } from '@madar/db';
import { GOAL_CHECKIN_XP, KUDOS_XP, calendarDateIn, taskXp, weekStartOf } from '@madar/shared';
import { eq } from 'drizzle-orm';

import type { EventConsumer } from '../events/consumer.js';
import { loadWorkCalendar } from '../notifications/calendar.js';
import { refreshCounters } from './counters.js';
import { grant, reverseTask } from './ledger.js';
import { loadGamificationSettings } from './settings.js';
import { excuseLeaveDays } from './streaks.js';

const HANDLED = [
  'task.completed',
  'task.reopened',
  'task.deleted',
  'key_result.checked_in',
  'request.decided',
  'kudos.given',
];

/**
 * XP from finished work, goal check-ins and a colleague's thanks, the badge counters behind them,
 * and late leave corrections (ADRs 0029 and 0030).
 */
@Injectable()
export class GamificationConsumer implements EventConsumer {
  readonly name = 'gamification';

  handles(type: string): boolean {
    return HANDLED.includes(type);
  }

  async handle(tx: Tx, event: OutboxEvent): Promise<void> {
    const p = event.payload;
    const { timeZone } = await loadWorkCalendar(tx, event.tenantId);
    const today = calendarDateIn(event.occurredAt, timeZone);
    if (event.type === 'task.reopened' || event.type === 'task.deleted') {
      // Taking back is never switched off: XP once given follows its work.
      const members = await reverseTask(
        tx,
        String(p.taskId),
        event.id,
        today,
        event.type === 'task.deleted',
      );
      for (const memberId of new Set([
        ...members,
        ...(p.assigneeId ? [String(p.assigneeId)] : []),
      ])) {
        await refreshCounters(tx, memberId, timeZone);
      }
      return;
    }
    if (event.type === 'request.decided') {
      if (p.status === 'approved') await excuseLeaveDays(tx, String(p.requestId));
      return;
    }
    const settings = await loadGamificationSettings(tx, event.tenantId);
    if (!settings.enabled) return;
    if (event.type === 'task.completed') {
      if (!p.assigneeId) return;
      const completedAt = p.completedAt ? new Date(String(p.completedAt)) : event.occurredAt;
      const completedOn = calendarDateIn(completedAt, timeZone);
      const xp = taskXp({
        weight: Number(p.weight ?? 1),
        source: p.source ? String(p.source) : null,
        dueOn: p.dueOn ? String(p.dueOn) : null,
        completedOn,
      });
      const base = {
        memberId: String(p.assigneeId),
        taskId: String(p.taskId),
        day: completedOn,
      };
      const key = `task:${String(p.taskId)}:${completedAt.toISOString()}`;
      await grant(
        tx,
        { ...base, reason: 'task_completed', amount: xp.completed, sourceKey: key },
        settings.dailyXpCap,
      );
      if (xp.onTime) {
        await grant(
          tx,
          { ...base, reason: 'on_time', amount: xp.onTime, sourceKey: key },
          settings.dailyXpCap,
        );
      }
      if (xp.helped) {
        await grant(
          tx,
          { ...base, reason: 'helped', amount: xp.helped, sourceKey: key },
          settings.dailyXpCap,
        );
      }
      await refreshCounters(tx, base.memberId, timeZone);
      return;
    }
    if (event.type === 'kudos.given') {
      const to = String(p.toMemberId);
      await grant(
        tx,
        {
          memberId: to,
          reason: 'kudos_received',
          amount: KUDOS_XP,
          sourceKey: `kudos:${String(p.kudosId)}`,
          day: today,
        },
        settings.dailyXpCap,
      );
      await refreshCounters(tx, to, timeZone);
      await refreshCounters(tx, String(p.fromMemberId), timeZone);
      return;
    }
    // A goal owner's first check-in of a key result in a week.
    const [goal] = await tx
      .select({ ownerId: s.goals.ownerId })
      .from(s.goals)
      .where(eq(s.goals.id, String(p.goalId)));
    if (!goal || goal.ownerId !== event.actorId) return;
    await grant(
      tx,
      {
        memberId: goal.ownerId,
        reason: 'goal_checkin',
        amount: GOAL_CHECKIN_XP,
        sourceKey: `checkin:${String(p.keyResultId)}:${weekStartOf(today)}`,
        day: today,
      },
      settings.dailyXpCap,
    );
    await refreshCounters(tx, goal.ownerId, timeZone);
  }
}
