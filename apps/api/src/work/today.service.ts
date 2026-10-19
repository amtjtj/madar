import { Injectable } from '@nestjs/common';
import { emitEvent, schema as s, type Tx } from '@madar/db';
import {
  addDays,
  calendarDateIn,
  mergeManualOrder,
  type SetTodayItemsRequest,
  type Today,
  type TodaySuggestionReason,
} from '@madar/shared';
import { and, asc, desc, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import { generateNKeysBetween } from 'fractional-indexing';

import type { TenantContext } from '../common/context.js';
import { TenantDb } from '../database/tenant-db.service.js';
import { visibleTasks } from './access.js';
import { loadRanking } from './ranking.js';
import { TasksService } from './tasks.service.js';

const MAX_ITEMS = 50;
const MAX_SUGGESTIONS = 20;

/** "Today" (plan step 5): the member's own plan for the tenant-local day. */
@Injectable()
export class TodayService {
  constructor(
    private readonly db: TenantDb,
    private readonly tasks: TasksService,
  ) {}

  get(ctx: TenantContext, now = new Date()): Promise<Today> {
    return this.db.run(ctx, (tx) => this.build(tx, ctx, now));
  }

  /** Replace the plan (used for reordering). Tasks the member cannot see are rejected. */
  set(ctx: TenantContext, input: SetTodayItemsRequest, now = new Date()): Promise<Today> {
    return this.db.run(ctx, async (tx) => {
      const date = await this.localDate(tx, ctx, now);
      const taskIds = [...new Set(input.taskIds)];
      for (const id of taskIds) await this.tasks.requireVisible(tx, ctx, id);
      await tx
        .delete(s.dailyPlanItems)
        .where(
          and(eq(s.dailyPlanItems.memberId, ctx.memberId), eq(s.dailyPlanItems.planDate, date)),
        );
      if (taskIds.length) {
        const keys = generateNKeysBetween(null, null, taskIds.length);
        await tx.insert(s.dailyPlanItems).values(
          taskIds.map((taskId, i) => ({
            memberId: ctx.memberId,
            planDate: date,
            taskId,
            sortKey: keys[i] ?? 'a0',
          })),
        );
      }
      await emitEvent(
        tx,
        'daily_plan.updated',
        { memberId: ctx.memberId, planDate: date },
        ctx.memberId,
      );
      return this.build(tx, ctx, now);
    });
  }

  add(ctx: TenantContext, taskId: string, now = new Date()): Promise<Today> {
    return this.db.run(ctx, async (tx) => {
      const date = await this.localDate(tx, ctx, now);
      await this.tasks.requireVisible(tx, ctx, taskId);
      const existing = await this.planned(tx, ctx, date);
      if (!existing.some((i) => i.taskId === taskId)) {
        if (existing.length >= MAX_ITEMS) return this.build(tx, ctx, now);
        // No sort key: placed by priority among the member's own order (ADR 0017).
        await tx
          .insert(s.dailyPlanItems)
          .values({ memberId: ctx.memberId, planDate: date, taskId })
          .onConflictDoNothing();
        await emitEvent(
          tx,
          'daily_plan.updated',
          { memberId: ctx.memberId, planDate: date },
          ctx.memberId,
        );
      }
      return this.build(tx, ctx, now);
    });
  }

  /** Forget the member's own order: today follows automatic priority again. */
  autoOrder(ctx: TenantContext, now = new Date()): Promise<Today> {
    return this.db.run(ctx, async (tx) => {
      const date = await this.localDate(tx, ctx, now);
      await tx
        .update(s.dailyPlanItems)
        .set({ sortKey: null })
        .where(
          and(eq(s.dailyPlanItems.memberId, ctx.memberId), eq(s.dailyPlanItems.planDate, date)),
        );
      await emitEvent(
        tx,
        'daily_plan.updated',
        { memberId: ctx.memberId, planDate: date },
        ctx.memberId,
      );
      return this.build(tx, ctx, now);
    });
  }

  remove(ctx: TenantContext, taskId: string, now = new Date()): Promise<Today> {
    return this.db.run(ctx, async (tx) => {
      const date = await this.localDate(tx, ctx, now);
      const removed = await tx
        .delete(s.dailyPlanItems)
        .where(
          and(
            eq(s.dailyPlanItems.memberId, ctx.memberId),
            eq(s.dailyPlanItems.planDate, date),
            eq(s.dailyPlanItems.taskId, taskId),
          ),
        )
        .returning();
      if (removed.length) {
        await emitEvent(
          tx,
          'daily_plan.updated',
          { memberId: ctx.memberId, planDate: date },
          ctx.memberId,
        );
      }
      return this.build(tx, ctx, now);
    });
  }

  private async build(tx: Tx, ctx: TenantContext, now: Date): Promise<Today> {
    const date = await this.localDate(tx, ctx, now);
    const ranking = await loadRanking(tx, ctx.tenantId, now);
    const planned = await this.planned(tx, ctx, date);
    const plannedIds = planned.map((i) => i.taskId);
    const manual = new Map(
      planned.flatMap((i) => (i.sortKey === null ? [] : [[i.taskId, i.sortKey] as const])),
    );
    // Deleted, canceled or no-longer-visible tasks drop out of the plan. The member's own order
    // first, the rest placed by priority.
    const hydratedItems = (
      await this.tasks.hydrate(tx, ctx, await this.visibleIds(tx, ctx, plannedIds), ranking)
    )
      .filter((t) => t.statusCategory !== 'canceled')
      .map((t) => ({ ...t, score: t.rank.score }))
      .sort((a, b) => b.score - a.score);
    const items = mergeManualOrder(hydratedItems, manual).map(({ score: _score, ...t }) => t);

    const yesterday = addDays(date, -1);
    const yesterdayIds = new Set(
      (
        await tx
          .select({ taskId: s.dailyPlanItems.taskId })
          .from(s.dailyPlanItems)
          .where(
            and(
              eq(s.dailyPlanItems.memberId, ctx.memberId),
              eq(s.dailyPlanItems.planDate, yesterday),
            ),
          )
      ).map((r) => r.taskId),
    );
    const candidates = await tx
      .select({ id: s.tasks.id, dueOn: s.tasks.dueOn, statusCategory: s.tasks.statusCategory })
      .from(s.tasks)
      .where(
        and(
          eq(s.tasks.assigneeId, ctx.memberId),
          isNull(s.tasks.deletedAt),
          inArray(s.tasks.statusCategory, ['todo', 'in_progress']),
          plannedIds.length ? notInArray(s.tasks.id, plannedIds) : undefined,
        ),
      )
      .orderBy(asc(s.tasks.dueOn), desc(s.tasks.updatedAt))
      .limit(200);

    const reasonFor = (c: (typeof candidates)[number]): TodaySuggestionReason | null => {
      if (yesterdayIds.has(c.id)) return 'from_yesterday';
      if (c.dueOn && c.dueOn < date) return 'overdue';
      if (c.dueOn === date) return 'due_today';
      if (c.statusCategory === 'in_progress') return 'in_progress';
      return null;
    };
    const order: TodaySuggestionReason[] = [
      'from_yesterday',
      'overdue',
      'due_today',
      'in_progress',
    ];
    const picked = candidates
      .map((c) => ({ id: c.id, reason: reasonFor(c) }))
      .filter((c): c is { id: string; reason: TodaySuggestionReason } => c.reason !== null)
      .sort((a, b) => order.indexOf(a.reason) - order.indexOf(b.reason))
      .slice(0, MAX_SUGGESTIONS);
    const hydrated = new Map(
      (
        await this.tasks.hydrate(
          tx,
          ctx,
          picked.map((p) => p.id),
          ranking,
        )
      ).map((t) => [t.id, t]),
    );

    return {
      date,
      items,
      ordered: items.some((t) => manual.has(t.id)),
      progress: {
        done: items.filter((t) => t.statusCategory === 'done').length,
        total: items.length,
      },
      // Grouped by reason, by priority within each reason.
      suggestions: picked
        .flatMap((p) => {
          const task = hydrated.get(p.id);
          return task ? [{ reason: p.reason, task }] : [];
        })
        .sort(
          (a, b) =>
            order.indexOf(a.reason) - order.indexOf(b.reason) ||
            b.task.rank.score - a.task.rank.score,
        ),
    };
  }

  private planned(tx: Tx, ctx: TenantContext, date: string) {
    return tx
      .select({ taskId: s.dailyPlanItems.taskId, sortKey: s.dailyPlanItems.sortKey })
      .from(s.dailyPlanItems)
      .where(and(eq(s.dailyPlanItems.memberId, ctx.memberId), eq(s.dailyPlanItems.planDate, date)))
      .orderBy(asc(s.dailyPlanItems.sortKey));
  }

  /** Keeps the order of `ids`, dropping deleted or invisible tasks. */
  private async visibleIds(tx: Tx, ctx: TenantContext, ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await tx
      .select({ id: s.tasks.id })
      .from(s.tasks)
      .where(and(inArray(s.tasks.id, ids), isNull(s.tasks.deletedAt), visibleTasks(ctx.actor)));
    const visible = new Set(rows.map((r) => r.id));
    return ids.filter((id) => visible.has(id));
  }

  private async localDate(tx: Tx, ctx: TenantContext, now: Date): Promise<string> {
    const [tenant] = await tx
      .select({ timezone: s.tenants.timezone })
      .from(s.tenants)
      .where(eq(s.tenants.id, ctx.tenantId));
    return calendarDateIn(now, tenant?.timezone);
  }
}
