import { emitEvent, schema as s, type Tx } from '@madar/db';
import { levelOf, underCap, type XpReason } from '@madar/shared';
import { and, eq, ne, sql } from 'drizzle-orm';

/**
 * The XP ledger (ADR 0029). The only writer of `xp_ledger` and `member_stats.xp_total`: every
 * grant goes through `grant` (daily cap, one row per source, level-up event) and every take-back
 * through `reverseTask`. Runs in the worker's transaction for the event that caused it.
 */

export interface Grant {
  memberId: string;
  reason: Exclude<XpReason, 'reversal'>;
  amount: number;
  sourceKey: string;
  taskId?: string | null;
  /** The company's calendar day it counts on. */
  day: string;
  /** When it was earned, if not now (the demo history). */
  at?: Date;
}

/** XP earned on `day` so far (reversals do not free room under the cap). */
async function earnedOn(tx: Tx, memberId: string, day: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`coalesce(sum(${s.xpLedger.amount}), 0)::int` })
    .from(s.xpLedger)
    .where(
      and(
        eq(s.xpLedger.memberId, memberId),
        eq(s.xpLedger.day, day),
        ne(s.xpLedger.reason, 'reversal'),
      ),
    );
  return row?.n ?? 0;
}

/** Adds to the cached total and tells the member (and the notifier on a new level). */
async function addToTotal(tx: Tx, memberId: string, amount: number): Promise<void> {
  if (amount === 0) return;
  const [before] = await tx
    .select({ xp: s.memberStats.xpTotal, best: s.memberStats.bestLevel })
    .from(s.memberStats)
    .where(eq(s.memberStats.memberId, memberId))
    .for('update');
  const total = (before?.xp ?? 0) + amount;
  const best = before?.best ?? 1;
  const level = levelOf(total).level;
  await tx
    .insert(s.memberStats)
    .values({ memberId, xpTotal: total, bestLevel: Math.max(best, level) })
    .onConflictDoUpdate({
      target: [s.memberStats.tenantId, s.memberStats.memberId],
      set: { xpTotal: total, bestLevel: Math.max(best, level), updatedAt: new Date() },
    });
  // Only a level never reached before: finishing, reopening and finishing again near a threshold
  // celebrates once.
  if (level > best) await emitEvent(tx, 'member.level_up', { memberId, level }, null);
  await emitEvent(tx, 'member.progress_changed', { memberId }, null);
}

/**
 * Grants XP under the daily cap. Returns what was actually granted (0 when capped or when the
 * source already paid: the unique key makes a repeated event harmless).
 */
export async function grant(tx: Tx, input: Grant, dailyCap: number): Promise<number> {
  // One grant per member at a time, so two events cannot both slip under the cap.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`xp:${input.memberId}`}, 0))`,
  );
  const amount = underCap(input.amount, await earnedOn(tx, input.memberId, input.day), dailyCap);
  if (amount <= 0) return 0;
  const inserted = await tx
    .insert(s.xpLedger)
    .values({
      memberId: input.memberId,
      amount,
      reason: input.reason,
      sourceKey: input.sourceKey,
      taskId: input.taskId ?? null,
      day: input.day,
      ...(input.at ? { createdAt: input.at } : {}),
    })
    .onConflictDoNothing()
    .returning({ id: s.xpLedger.id });
  if (!inserted.length) return 0;
  await addToTotal(tx, input.memberId, amount);
  return amount;
}

/**
 * Takes back whatever a task (and, when it is deleted, its subtasks, which go with it) still holds
 * for each member, as one negative row per member keyed by the event, so a repeated event takes
 * nothing twice. Returns the members it took from.
 */
export async function reverseTask(
  tx: Tx,
  taskId: string,
  eventId: string,
  day: string,
  withSubtasks = false,
): Promise<string[]> {
  const held = await tx
    .select({
      memberId: s.xpLedger.memberId,
      net: sql<number>`sum(${s.xpLedger.amount})::int`,
    })
    .from(s.xpLedger)
    .where(
      withSubtasks
        ? sql`${s.xpLedger.taskId} in (select ${taskId}::uuid union select id from tasks where parent_id = ${taskId})`
        : eq(s.xpLedger.taskId, taskId),
    )
    .groupBy(s.xpLedger.memberId);
  for (const { memberId, net } of held) {
    if (net <= 0) continue;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`xp:${memberId}`}, 0))`);
    const inserted = await tx
      .insert(s.xpLedger)
      .values({
        memberId,
        amount: -net,
        reason: 'reversal',
        sourceKey: `${eventId}:${memberId}`,
        taskId,
        day,
      })
      .onConflictDoNothing()
      .returning({ id: s.xpLedger.id });
    if (inserted.length) await addToTotal(tx, memberId, -net);
  }
  return held.filter((h) => h.net > 0).map((h) => h.memberId);
}
