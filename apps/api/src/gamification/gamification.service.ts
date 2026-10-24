import { Injectable } from '@nestjs/common';
import { schema as s } from '@madar/db';
import {
  XP_PAGE,
  calendarDateIn,
  isCompleteDay,
  isWorkingDay,
  levelOf,
  neededForCompleteDay,
  type GamificationSettings,
  type ListXpQuery,
  type MyProgress,
  type StreakDay,
  type StreakQuery,
  type XpEntry,
} from '@madar/shared';
import { and, desc, eq, gte, inArray, isNull, lt, lte, ne, sql } from 'drizzle-orm';

import type { TenantContext } from '../common/context.js';
import { TenantDb } from '../database/tenant-db.service.js';
import { loadWorkCalendar } from '../notifications/calendar.js';
import { visibleTasks } from '../work/access.js';
import { loadGamificationSettings } from './settings.js';
import { planCounts } from './streaks.js';

/**
 * My own progress (ADR 0029). Every read here is filtered to `ctx.memberId`: no method takes a
 * member id, and nothing returns, compares or orders anyone else's XP or streak.
 */
@Injectable()
export class GamificationService {
  constructor(private readonly db: TenantDb) {}

  progress(ctx: TenantContext, now = new Date()): Promise<MyProgress> {
    return this.db.run(ctx, async (tx) => {
      const me = ctx.memberId;
      const settings = await loadGamificationSettings(tx, ctx.tenantId);
      const { calendar, timeZone } = await loadWorkCalendar(tx, ctx.tenantId);
      const today = calendarDateIn(now, timeZone);
      const [stats] = await tx.select().from(s.memberStats).where(eq(s.memberStats.memberId, me));
      const count = (await planCounts(tx, [me], today, timeZone, now)).get(me) ?? {
        planned: 0,
        done: 0,
      };
      const [earned] = await tx
        .select({ n: sql<number>`coalesce(sum(${s.xpLedger.amount}), 0)::int` })
        .from(s.xpLedger)
        .where(
          and(
            eq(s.xpLedger.memberId, me),
            eq(s.xpLedger.day, today),
            ne(s.xpLedger.reason, 'reversal'),
          ),
        );
      const xp = stats?.xpTotal ?? 0;
      const level = levelOf(xp);
      const working = isWorkingDay(calendar, today);
      const complete =
        working && isCompleteDay(count.planned, count.done, settings.completeDayPercent);
      const current = stats?.currentStreak ?? 0;
      // Today never breaks the streak; once complete it already counts.
      const streak = current + (complete ? 1 : 0);
      return {
        enabled: settings.enabled,
        xp,
        level: level.level,
        levelInto: level.into,
        levelSpan: level.span,
        currentStreak: streak,
        longestStreak: Math.max(stats?.longestStreak ?? 0, streak),
        today: {
          date: today,
          working,
          planned: count.planned,
          done: count.done,
          needed: neededForCompleteDay(count.planned, count.done, settings.completeDayPercent),
          complete,
          xp: earned?.n ?? 0,
          capReached: (earned?.n ?? 0) >= settings.dailyXpCap,
        },
        completeDayPercent: settings.completeDayPercent,
      };
    });
  }

  xp(ctx: TenantContext, query: ListXpQuery): Promise<XpEntry[]> {
    return this.db.run(ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(s.xpLedger)
        .where(
          and(
            eq(s.xpLedger.memberId, ctx.memberId),
            query.before ? lt(s.xpLedger.id, query.before) : undefined,
          ),
        )
        .orderBy(desc(s.xpLedger.id))
        .limit(XP_PAGE);
      const taskIds = [...new Set(rows.flatMap((r) => (r.taskId ? [r.taskId] : [])))];
      // A task's title only while I can still see it.
      const tasks = taskIds.length
        ? await tx
            .select({ id: s.tasks.id, title: s.tasks.title, weight: s.tasks.weight })
            .from(s.tasks)
            .where(
              and(inArray(s.tasks.id, taskIds), isNull(s.tasks.deletedAt), visibleTasks(ctx.actor)),
            )
        : [];
      const byId = new Map(tasks.map((t) => [t.id, t]));
      return rows.map((r) => ({
        id: r.id,
        amount: r.amount,
        reason: r.reason,
        task: r.taskId ? (byId.get(r.taskId) ?? null) : null,
        reversed: r.reason === 'reversal' && r.taskId ? 'task_completed' : null,
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }

  streak(ctx: TenantContext, query: StreakQuery): Promise<StreakDay[]> {
    return this.db.run(ctx, (tx) =>
      tx
        .select({
          day: s.streakDays.day,
          status: s.streakDays.status,
          planned: s.streakDays.planned,
          done: s.streakDays.done,
        })
        .from(s.streakDays)
        .where(
          and(
            eq(s.streakDays.memberId, ctx.memberId),
            gte(s.streakDays.day, query.from),
            lte(s.streakDays.day, query.to),
          ),
        )
        .orderBy(s.streakDays.day),
    );
  }

  settings(ctx: TenantContext): Promise<GamificationSettings> {
    return this.db.run(ctx, (tx) => loadGamificationSettings(tx, ctx.tenantId));
  }

  setSettings(ctx: TenantContext, body: GamificationSettings): Promise<GamificationSettings> {
    return this.db.run(ctx, async (tx) => {
      const before = await loadGamificationSettings(tx, ctx.tenantId);
      await tx
        .update(s.tenants)
        .set({
          settings: sql`${s.tenants.settings} || ${JSON.stringify({ gamification: body })}::jsonb`,
        })
        // `tenants` is control-plane (no RLS): the session's tenant guards the row as well.
        .where(and(eq(s.tenants.id, ctx.tenantId), sql`${s.tenants.id} = app.current_tenant_id()`));
      await this.db.audit(tx, ctx, {
        action: 'gamification_settings.updated',
        subjectType: 'tenant',
        subjectId: ctx.tenantId,
        before: { ...before },
        after: { ...body },
      });
      return body;
    });
  }
}
