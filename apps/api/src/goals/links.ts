import { schema as s, type Tx } from '@madar/db';
import type { Actor, KeyResultRef } from '@madar/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { notFound } from '../common/errors.js';
import { visibleGoals } from './access.js';

/** A task or project may only point at an active key result its editor can see. */
export async function requireLinkableKeyResult(tx: Tx, actor: Actor, id: string): Promise<void> {
  const [row] = await tx
    .select({ id: s.keyResults.id })
    .from(s.keyResults)
    .innerJoin(s.goals, eq(s.goals.id, s.keyResults.goalId))
    .where(
      and(
        eq(s.keyResults.id, id),
        isNull(s.keyResults.archivedAt),
        isNull(s.goals.archivedAt),
        visibleGoals(actor),
      ),
    );
  if (!row) throw notFound('Key result');
}

/** Key result references for display, only where the viewer can see the goal. */
export async function keyResultRefs(
  tx: Tx,
  actor: Actor,
  ids: Array<string | null>,
): Promise<Map<string, NonNullable<KeyResultRef>>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const rows = await tx
    .select({
      id: s.keyResults.id,
      title: s.keyResults.title,
      goalId: s.goals.id,
      goalTitle: s.goals.title,
    })
    .from(s.keyResults)
    .innerJoin(s.goals, eq(s.goals.id, s.keyResults.goalId))
    .where(and(inArray(s.keyResults.id, unique), visibleGoals(actor)));
  return new Map(
    rows.map((r) => [
      r.id,
      { id: r.id, title: r.title, goal: { id: r.goalId, title: r.goalTitle } },
    ]),
  );
}
