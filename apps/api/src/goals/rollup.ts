import { emitEvent, schema as s, type Tx } from '@madar/db';
import { goalProgress, worstStatus } from '@madar/shared';
import { and, eq, isNull } from 'drizzle-orm';

/**
 * Recomputes a goal's progress and status from its active key results and child goals, then
 * walks up the parent chain. Rows are locked so concurrent check-ins do not overwrite each other.
 * The first time a goal reaches 100 % it gets `completed_at` and a `goal.completed` event.
 */
export async function recomputeGoalChain(
  tx: Tx,
  goalId: string,
  actorId: string | null,
): Promise<void> {
  let current: string | null = goalId;
  for (let depth = 0; current && depth < 5; depth++) {
    const [goal] = await tx
      .select({
        id: s.goals.id,
        parentId: s.goals.parentId,
        completedAt: s.goals.completedAt,
      })
      .from(s.goals)
      .where(eq(s.goals.id, current))
      .for('update');
    if (!goal) return;
    const keyResults = await tx
      .select({
        progress: s.keyResults.progress,
        weight: s.keyResults.weight,
        status: s.keyResults.status,
      })
      .from(s.keyResults)
      .where(and(eq(s.keyResults.goalId, goal.id), isNull(s.keyResults.archivedAt)));
    const children = await tx
      .select({ progress: s.goals.progress })
      .from(s.goals)
      .where(and(eq(s.goals.parentId, goal.id), isNull(s.goals.archivedAt)));
    const progress = goalProgress([
      ...keyResults.map((kr) => ({ progress: kr.progress, weight: kr.weight })),
      ...children.map((child) => ({ progress: child.progress, weight: 1 })),
    ]);
    const completes = progress >= 1 && !goal.completedAt;
    await tx
      .update(s.goals)
      .set({
        progress,
        status: worstStatus(keyResults.map((kr) => kr.status)),
        ...(completes ? { completedAt: new Date() } : {}),
      })
      .where(eq(s.goals.id, goal.id));
    if (completes) await emitEvent(tx, 'goal.completed', { goalId: goal.id }, actorId);
    current = goal.parentId;
  }
}
