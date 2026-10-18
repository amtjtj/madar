import { Injectable } from '@nestjs/common';
import { emitEvent, schema as s, type Tx } from '@madar/db';
import {
  keyResultProgress,
  keyResultRange,
  type Checkin,
  type CreateCheckinRequest,
  type KeyResult,
  type KeyResultOption,
  type NewKeyResultRequest,
  type UpdateKeyResultRequest,
} from '@madar/shared';
import { and, asc, desc, eq, gte, ilike, isNull, or } from 'drizzle-orm';
import { generateKeyBetween } from 'fractional-indexing';

import type { TenantContext } from '../common/context.js';
import { forbidden, notFound } from '../common/errors.js';
import { TenantDb } from '../database/tenant-db.service.js';
import { canEditGoal, visibleGoals } from './access.js';
import { ensurePeriods, tenantToday } from './periods.js';
import { GoalsService, insertKeyResult, invalid, toKeyResult } from './goals.service.js';
import { recomputeGoalChain } from './rollup.js';

type KeyResultRow = typeof s.keyResults.$inferSelect;

@Injectable()
export class KeyResultsService {
  constructor(
    private readonly db: TenantDb,
    private readonly goals: GoalsService,
  ) {}

  create(ctx: TenantContext, goalId: string, input: NewKeyResultRequest): Promise<KeyResult> {
    return this.db.run(ctx, async (tx) => {
      const goal = await this.goals.requireEditable(tx, ctx, goalId);
      if (goal.archivedAt) throw invalid('Goal is archived');
      const [last] = await tx
        .select({ sortKey: s.keyResults.sortKey })
        .from(s.keyResults)
        .where(eq(s.keyResults.goalId, goalId))
        .orderBy(desc(s.keyResults.sortKey))
        .limit(1);
      const row = await insertKeyResult(
        tx,
        goalId,
        input,
        generateKeyBetween(last?.sortKey ?? null, null),
      );
      await recomputeGoalChain(tx, goalId, ctx.memberId);
      return toKeyResult(row, { tasks: [], projects: 0 });
    });
  }

  update(ctx: TenantContext, id: string, input: UpdateKeyResultRequest): Promise<KeyResult> {
    return this.db.run(ctx, async (tx) => {
      const kr = await this.requireEditable(tx, ctx, id);
      const range =
        input.startValue !== undefined || input.targetValue !== undefined
          ? keyResultRange({
              kind: kr.kind,
              startValue: input.startValue ?? kr.startValue,
              targetValue: input.targetValue ?? kr.targetValue,
            })
          : { startValue: kr.startValue, targetValue: kr.targetValue };
      if (!range) throw invalid('Invalid key result range');
      const progress = keyResultProgress({ ...kr, ...range });
      const [row] = await tx
        .update(s.keyResults)
        .set({
          title: input.title,
          unit: kr.kind === 'number' ? input.unit : undefined,
          weight: input.weight,
          ...range,
          progress,
        })
        .where(eq(s.keyResults.id, id))
        .returning();
      await recomputeGoalChain(tx, kr.goalId, ctx.memberId);
      if (!row) throw notFound('Key result');
      return toKeyResult(row, { tasks: [], projects: 0 });
    });
  }

  archive(ctx: TenantContext, id: string): Promise<void> {
    return this.db.run(ctx, async (tx) => {
      const kr = await this.requireEditable(tx, ctx, id);
      await tx.update(s.keyResults).set({ archivedAt: new Date() }).where(eq(s.keyResults.id, id));
      await recomputeGoalChain(tx, kr.goalId, ctx.memberId);
    });
  }

  /** Records progress: value, status and note; the goal chain is recomputed in the same transaction. */
  checkIn(ctx: TenantContext, id: string, input: CreateCheckinRequest): Promise<Checkin> {
    return this.db.run(ctx, async (tx) => {
      const kr = await this.requireEditable(tx, ctx, id);
      if (kr.kind === 'boolean' && input.value !== 0 && input.value !== 1) {
        throw invalid('A done/not done key result takes 0 or 1');
      }
      if (kr.kind === 'percent' && (input.value < 0 || input.value > 100)) {
        throw invalid('A percent is between 0 and 100');
      }
      const now = new Date();
      const [row] = await tx
        .insert(s.keyResultCheckins)
        .values({
          keyResultId: id,
          value: input.value,
          status: input.status,
          note: input.note ?? null,
          authorId: ctx.memberId,
          createdAt: now,
        })
        .returning();
      if (!row) throw new Error('check-in insert failed');
      await tx
        .update(s.keyResults)
        .set({
          currentValue: input.value,
          progress: keyResultProgress({ ...kr, currentValue: input.value }),
          status: input.status,
          lastCheckinAt: now,
        })
        .where(eq(s.keyResults.id, id));
      await recomputeGoalChain(tx, kr.goalId, ctx.memberId);
      await emitEvent(
        tx,
        'key_result.checked_in',
        { goalId: kr.goalId, keyResultId: id, checkinId: row.id },
        ctx.memberId,
      );
      return this.toCheckin(tx, row);
    });
  }

  checkins(ctx: TenantContext, id: string): Promise<Checkin[]> {
    return this.db.run(ctx, async (tx) => {
      await this.requireVisible(tx, ctx, id);
      const rows = await tx
        .select({ checkin: s.keyResultCheckins, authorName: s.members.displayName })
        .from(s.keyResultCheckins)
        .innerJoin(s.members, eq(s.members.id, s.keyResultCheckins.authorId))
        .where(eq(s.keyResultCheckins.keyResultId, id))
        .orderBy(desc(s.keyResultCheckins.createdAt))
        .limit(100);
      return rows.map(({ checkin, authorName }) => serializeCheckin(checkin, authorName));
    });
  }

  /** Key results of the current and upcoming season the member can see, for linking work. */
  options(ctx: TenantContext, q?: string): Promise<KeyResultOption[]> {
    return this.db.run(ctx, async (tx) => {
      const today = await tenantToday(tx, ctx.tenantId);
      await ensurePeriods(tx, today);
      const rows = await tx
        .select({
          id: s.keyResults.id,
          title: s.keyResults.title,
          goalId: s.goals.id,
          goalTitle: s.goals.title,
          level: s.goals.level,
        })
        .from(s.keyResults)
        .innerJoin(s.goals, eq(s.goals.id, s.keyResults.goalId))
        .innerJoin(s.goalPeriods, eq(s.goalPeriods.id, s.goals.periodId))
        .where(
          and(
            isNull(s.keyResults.archivedAt),
            isNull(s.goals.archivedAt),
            visibleGoals(ctx.actor),
            // Current and future seasons only.
            gte(s.goalPeriods.endOn, today),
            q ? or(ilike(s.keyResults.title, `%${q}%`), ilike(s.goals.title, `%${q}%`)) : undefined,
          ),
        )
        .orderBy(asc(s.goals.title), asc(s.keyResults.sortKey))
        .limit(50);
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        goal: { id: r.goalId, title: r.goalTitle, level: r.level },
      }));
    });
  }

  /** A key result the member can see (through its goal), for linking and reading. */
  async requireVisible(tx: Tx, ctx: TenantContext, id: string) {
    const [row] = await tx
      .select({ kr: s.keyResults, goal: s.goals })
      .from(s.keyResults)
      .innerJoin(s.goals, eq(s.goals.id, s.keyResults.goalId))
      .where(and(eq(s.keyResults.id, id), visibleGoals(ctx.actor)));
    if (!row) throw notFound('Key result');
    return row;
  }

  private async requireEditable(tx: Tx, ctx: TenantContext, id: string): Promise<KeyResultRow> {
    const { kr, goal } = await this.requireVisible(tx, ctx, id);
    if (!canEditGoal(ctx.actor, goal)) throw forbidden();
    if (kr.archivedAt || goal.archivedAt) throw invalid('Archived');
    return kr;
  }

  private async toCheckin(tx: Tx, row: typeof s.keyResultCheckins.$inferSelect): Promise<Checkin> {
    const [author] = await tx
      .select({ displayName: s.members.displayName })
      .from(s.members)
      .where(eq(s.members.id, row.authorId));
    return serializeCheckin(row, author?.displayName ?? '');
  }
}

function serializeCheckin(
  row: typeof s.keyResultCheckins.$inferSelect,
  authorName: string,
): Checkin {
  return {
    id: row.id,
    keyResultId: row.keyResultId,
    value: row.value,
    status: row.status,
    note: row.note,
    author: { id: row.authorId, displayName: authorName },
    createdAt: row.createdAt.toISOString(),
  };
}
