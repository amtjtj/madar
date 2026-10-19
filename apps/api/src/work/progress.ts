import { schema as s, type Tx } from '@madar/db';
import { toProgressStep, weightedProgress } from '@madar/shared';
import { and, eq, isNull } from 'drizzle-orm';

/**
 * A parent in «auto» mode takes the weighted progress of its subtasks (ADR 0018). Call it in the
 * same transaction after any change to a subtask's progress, status or weight, or to the set of
 * subtasks. The parent's version is not bumped: nobody edits a computed value.
 */
export async function recomputeParentProgress(tx: Tx, parentId: string | null): Promise<void> {
  if (!parentId) return;
  const [parent] = await tx
    .select({ mode: s.tasks.progressMode, progress: s.tasks.progress })
    .from(s.tasks)
    .where(eq(s.tasks.id, parentId));
  if (!parent || parent.mode !== 'auto') return;
  const children = await tx
    .select({
      statusCategory: s.tasks.statusCategory,
      progress: s.tasks.progress,
      weight: s.tasks.weight,
    })
    .from(s.tasks)
    .where(and(eq(s.tasks.parentId, parentId), isNull(s.tasks.deletedAt)));
  const average = weightedProgress(children);
  if (average === null) return;
  const progress = toProgressStep(average);
  if (progress !== parent.progress) {
    await tx.update(s.tasks).set({ progress }).where(eq(s.tasks.id, parentId));
  }
}

/** Live subtasks of a task (a parent in «auto» mode takes its progress from them). */
export async function hasSubtasks(tx: Tx, taskId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: s.tasks.id })
    .from(s.tasks)
    .where(and(eq(s.tasks.parentId, taskId), isNull(s.tasks.deletedAt)))
    .limit(1);
  return Boolean(row);
}
