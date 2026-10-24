import { Injectable } from '@nestjs/common';
import { schema as s, type OutboxEvent, type Tx } from '@madar/db';
import { GOAL_CHECKIN_XP, calendarDateIn, taskXp, weekStartOf } from '@madar/shared';
import { eq } from 'drizzle-orm';

import type { EventConsumer } from '../events/consumer.js';
import { loadWorkCalendar } from '../notifications/calendar.js';
import { grant, reverseTask } from './ledger.js';
import { loadGamificationSettings } from './settings.js';
import { excuseLeaveDays } from './streaks.js';

const HANDLED = [
  'task.completed',
  'task.reopened',
  'task.deleted',
  'key_result.checked_in',
  'request.decided',
];

/** XP from finished work and goal check-ins, and late leave corrections (ADR 0029). */
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
      await reverseTask(tx, String(p.taskId), event.id, today);
      return;
    }
    if (event.type === 'request.decided') {
      if (p.status === 'approved') await excuseLeaveDays(tx, event.tenantId, String(p.requestId));
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
  }
}
