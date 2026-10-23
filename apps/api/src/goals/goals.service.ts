import { HttpStatus, Injectable } from '@nestjs/common';
import { emitEvent, schema as s, type Tx } from '@madar/db';
import {
  keyResultRange,
  GOAL_DEPTH_MAX,
  PARENT_LEVELS,
  type CreateGoalRequest,
  type GoalDetail,
  type GoalLevel,
  type GoalPeriod,
  type GoalSummary,
  type KeyResult,
  type ListGoalsQuery,
  type UpdateGoalRequest,
} from '@madar/shared';
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { generateKeyBetween } from 'fractional-indexing';

import type { TenantContext } from '../common/context.js';
import { ApiError, forbidden, notFound } from '../common/errors.js';
import { TenantDb } from '../database/tenant-db.service.js';
import { visibleProjects, visibleTasks } from '../work/access.js';
import { canCheckIn, canCreateGoal, canDefineGoal, visibleGoals } from './access.js';
import { ensurePeriods, listPeriods, tenantToday } from './periods.js';
import { recomputeGoalChain } from './rollup.js';

type GoalRow = typeof s.goals.$inferSelect;
type KeyResultRow = typeof s.keyResults.$inferSelect;

export const archivedError = () =>
  new ApiError(HttpStatus.CONFLICT, 'goal_archived', 'Goal or key result is archived');

export const invalid = (message: string) =>
  new ApiError(HttpStatus.BAD_REQUEST, 'validation_failed', message);

const parentInvalid = (message: string) =>
  new ApiError(HttpStatus.BAD_REQUEST, 'goal_parent_invalid', message);

@Injectable()
export class GoalsService {
  constructor(private readonly db: TenantDb) {}

  periods(ctx: TenantContext): Promise<GoalPeriod[]> {
    return this.db.run(ctx, async (tx) => {
      const today = await tenantToday(tx, ctx.tenantId);
      await ensurePeriods(tx, today);
      return listPeriods(tx, today);
    });
  }

  list(ctx: TenantContext, query: ListGoalsQuery): Promise<GoalSummary[]> {
    return this.db.run(ctx, async (tx) => {
      const periodId = query.periodId ?? (await this.currentPeriodId(tx, ctx));
      const myDepartments = query.departmentId
        ? [query.departmentId]
        : ctx.actor.departments.map((d) => d.id);
      const view =
        query.view === 'mine'
          ? eq(s.goals.ownerId, ctx.memberId)
          : query.view === 'department'
            ? myDepartments.length
              ? and(
                  inArray(s.goals.departmentId, myDepartments),
                  inArray(s.goals.level, ['department', 'individual']),
                )
              : sql`false`
            : undefined;
      const rows = await tx
        .select()
        .from(s.goals)
        .where(
          and(
            eq(s.goals.periodId, periodId),
            isNull(s.goals.archivedAt),
            visibleGoals(ctx.actor),
            view,
          ),
        )
        .orderBy(
          sql`case ${s.goals.level} when 'company' then 0 when 'department' then 1 else 2 end`,
          asc(s.goals.createdAt),
        );
      return this.summaries(tx, ctx, rows);
    });
  }

  get(ctx: TenantContext, id: string): Promise<GoalDetail> {
    return this.db.run(ctx, (tx) => this.detail(tx, ctx, id));
  }

  create(ctx: TenantContext, input: CreateGoalRequest): Promise<GoalDetail> {
    return this.db.run(ctx, async (tx) => {
      const level = input.level;
      const departmentId =
        level === 'company' ? null : (input.departmentId ?? ctx.actor.departments[0]?.id ?? null);
      if (level !== 'company' && !departmentId) {
        throw new ApiError(HttpStatus.BAD_REQUEST, 'no_department', 'A department is required');
      }
      const ownerId = input.ownerId ?? ctx.memberId;
      const [period] = await tx
        .select({ id: s.goalPeriods.id })
        .from(s.goalPeriods)
        .where(eq(s.goalPeriods.id, input.periodId));
      if (!period) throw notFound('Period');
      if (departmentId) await requireActiveDepartment(tx, departmentId);
      if (!canCreateGoal(ctx.actor, { level, departmentId, ownerId })) throw forbidden();
      await requireOwner(tx, ownerId, level === 'individual' ? departmentId : null);
      const parentId = input.parentId ?? null;
      if (parentId) await this.requireParent(tx, ctx, parentId, level, input.periodId);

      const [goal] = await tx
        .insert(s.goals)
        .values({
          periodId: input.periodId,
          level,
          departmentId,
          ownerId,
          parentId,
          title: input.title,
          description: input.description ?? null,
          createdBy: ctx.memberId,
        })
        .returning();
      if (!goal) throw new Error('goal insert failed');
      let sortKey: string | null = null;
      for (const kr of input.keyResults ?? []) {
        sortKey = generateKeyBetween(sortKey, null);
        await insertKeyResult(tx, goal.id, kr, sortKey);
      }
      await recomputeGoalChain(tx, goal.id, ctx.memberId);
      await emitEvent(tx, 'goal.created', { goalId: goal.id }, ctx.memberId);
      if (level === 'company') {
        await this.db.audit(tx, ctx, {
          action: 'goal.created',
          subjectType: 'goal',
          subjectId: goal.id,
          after: { title: goal.title, level },
        });
      }
      return this.detail(tx, ctx, goal.id);
    });
  }

  update(ctx: TenantContext, id: string, input: UpdateGoalRequest): Promise<GoalDetail> {
    return this.db.run(ctx, async (tx) => {
      const goal = await this.requireEditable(tx, ctx, id);
      if (goal.archivedAt) throw archivedError();
      if (input.ownerId && input.ownerId !== goal.ownerId) {
        await requireOwner(
          tx,
          input.ownerId,
          goal.level === 'individual' ? goal.departmentId : null,
        );
        // Handing a personal goal to someone else is a manager's call.
        if (!canCreateGoal(ctx.actor, { ...goal, ownerId: input.ownerId })) throw forbidden();
      }
      const parentChanged = input.parentId !== undefined && input.parentId !== goal.parentId;
      if (parentChanged && input.parentId) {
        await this.requireParent(tx, ctx, input.parentId, goal.level, goal.periodId, goal.id);
      }
      await tx
        .update(s.goals)
        .set({
          title: input.title,
          description: input.description,
          ownerId: input.ownerId,
          parentId: input.parentId,
        })
        .where(eq(s.goals.id, id));
      if (parentChanged) {
        await recomputeGoalChain(tx, id, ctx.memberId);
        if (goal.parentId) await recomputeGoalChain(tx, goal.parentId, ctx.memberId);
      }
      if (goal.level === 'company') {
        await this.db.audit(tx, ctx, {
          action: 'goal.updated',
          subjectType: 'goal',
          subjectId: id,
          before: { title: goal.title, ownerId: goal.ownerId, parentId: goal.parentId },
          after: input,
        });
      }
      return this.detail(tx, ctx, id);
    });
  }

  archive(ctx: TenantContext, id: string): Promise<void> {
    return this.db.run(ctx, async (tx) => {
      const goal = await this.requireEditable(tx, ctx, id);
      if (goal.archivedAt) return;
      // Children would silently become roots: they are archived or moved first.
      const [child] = await tx
        .select({ id: s.goals.id })
        .from(s.goals)
        .where(and(eq(s.goals.parentId, id), isNull(s.goals.archivedAt)))
        .limit(1);
      if (child) {
        throw new ApiError(HttpStatus.CONFLICT, 'goal_has_children', 'Goal has active children');
      }
      await tx.update(s.goals).set({ archivedAt: new Date() }).where(eq(s.goals.id, id));
      if (goal.parentId) await recomputeGoalChain(tx, goal.parentId, ctx.memberId);
      await this.db.audit(tx, ctx, {
        action: 'goal.archived',
        subjectType: 'goal',
        subjectId: id,
        before: { title: goal.title, level: goal.level },
      });
    });
  }

  // --- shared with key results ---

  async requireVisible(tx: Tx, ctx: TenantContext, id: string): Promise<GoalRow> {
    const [goal] = await tx
      .select()
      .from(s.goals)
      .where(and(eq(s.goals.id, id), visibleGoals(ctx.actor)));
    if (!goal) throw notFound('Goal');
    return goal;
  }

  /** Visible, editable and locked for the rest of the transaction. */
  async requireEditable(tx: Tx, ctx: TenantContext, id: string): Promise<GoalRow> {
    await tx.select({ id: s.goals.id }).from(s.goals).where(eq(s.goals.id, id)).for('update');
    const goal = await this.requireVisible(tx, ctx, id);
    if (!canDefineGoal(ctx.actor, goal)) throw forbidden();
    return goal;
  }

  async detail(tx: Tx, ctx: TenantContext, id: string): Promise<GoalDetail> {
    const goal = await this.requireVisible(tx, ctx, id);
    const [summary] = await this.summaries(tx, ctx, [goal]);
    if (!summary) throw notFound('Goal');
    const krRows = await tx
      .select()
      .from(s.keyResults)
      .where(and(eq(s.keyResults.goalId, id), isNull(s.keyResults.archivedAt)))
      .orderBy(asc(s.keyResults.sortKey));
    const krIds = krRows.map((kr) => kr.id);
    const childRows = await tx
      .select()
      .from(s.goals)
      .where(and(eq(s.goals.parentId, id), isNull(s.goals.archivedAt), visibleGoals(ctx.actor)))
      .orderBy(asc(s.goals.createdAt));
    const tasks = krIds.length
      ? await tx
          .select({
            id: s.tasks.id,
            title: s.tasks.title,
            keyResultId: s.tasks.keyResultId,
            statusCategory: s.tasks.statusCategory,
            assigneeId: s.tasks.assigneeId,
            assigneeName: s.members.displayName,
          })
          .from(s.tasks)
          .leftJoin(s.members, eq(s.members.id, s.tasks.assigneeId))
          .where(
            and(
              inArray(s.tasks.keyResultId, krIds),
              isNull(s.tasks.deletedAt),
              visibleTasks(ctx.actor),
            ),
          )
          .orderBy(asc(s.tasks.createdAt))
          .limit(100)
      : [];
    const projects = krIds.length
      ? await tx
          .select({ id: s.projects.id, name: s.projects.name, keyResultId: s.projects.keyResultId })
          .from(s.projects)
          .where(
            and(
              inArray(s.projects.keyResultId, krIds),
              eq(s.projects.status, 'active'),
              visibleProjects(ctx.actor),
            ),
          )
          .orderBy(asc(s.projects.name))
      : [];
    return {
      ...summary,
      description: goal.description,
      archivedAt: goal.archivedAt?.toISOString() ?? null,
      keyResults: krRows.map((kr) =>
        toKeyResult(kr, {
          tasks: tasks.filter((t) => t.keyResultId === kr.id),
          projects: projects.filter((p) => p.keyResultId === kr.id).length,
        }),
      ),
      children: await this.summaries(tx, ctx, childRows),
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        keyResultId: t.keyResultId as string,
        statusCategory: t.statusCategory,
        assignee:
          t.assigneeId && t.assigneeName ? { id: t.assigneeId, displayName: t.assigneeName } : null,
      })),
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        keyResultId: p.keyResultId as string,
      })),
    };
  }

  private async currentPeriodId(tx: Tx, ctx: TenantContext): Promise<string> {
    const today = await tenantToday(tx, ctx.tenantId);
    await ensurePeriods(tx, today);
    const current = (await listPeriods(tx, today)).find((p) => p.current);
    if (!current) throw new Error('current period missing');
    return current.id;
  }

  /**
   * The parent must be visible, active, in the same period and at the same level or above
   * (sub-goals, plan phase-3-step-17a). A goal never goes under itself or its own sub-goals, and
   * the whole chain stays within `GOAL_DEPTH_MAX` levels (the progress roll-up's bound).
   */
  private async requireParent(
    tx: Tx,
    ctx: TenantContext,
    parentId: string,
    level: GoalLevel,
    periodId: string,
    childId?: string,
  ): Promise<void> {
    // Held until commit, so the parent cannot be archived under the new child.
    await tx.select({ id: s.goals.id }).from(s.goals).where(eq(s.goals.id, parentId)).for('share');
    const parent = await this.requireVisible(tx, ctx, parentId);
    if (
      parent.archivedAt ||
      parent.periodId !== periodId ||
      !PARENT_LEVELS[level].includes(parent.level)
    ) {
      throw parentInvalid('Parent goal must be an active goal at this level or above, same period');
    }
    // Ancestors of the new parent (itself included), and how deep the moved goal's subtree goes.
    const chain = await tx.execute<{ id: string }>(sql`
      with recursive up as (
        select id, parent_id, 1 as depth from goals where id = ${parentId}
        union all
        select g.id, g.parent_id, up.depth + 1 from goals g join up on g.id = up.parent_id
        where up.depth < ${GOAL_DEPTH_MAX + 1}
      ) select id from up`);
    if (childId && chain.rows.some((r) => r.id === childId)) {
      throw parentInvalid('A goal cannot go under itself or its own sub-goals');
    }
    let below = 1;
    if (childId) {
      const [height] = (
        await tx.execute<{ height: number }>(sql`
          with recursive down as (
            select id, 1 as depth from goals where id = ${childId}
            union all
            select g.id, down.depth + 1 from goals g join down on g.parent_id = down.id
            where g.archived_at is null and down.depth < ${GOAL_DEPTH_MAX + 1}
          ) select max(depth)::int as height from down`)
      ).rows;
      below = height?.height ?? 1;
    }
    if (chain.rows.length + below > GOAL_DEPTH_MAX) {
      throw parentInvalid(`Goals nest at most ${GOAL_DEPTH_MAX} levels deep`);
    }
  }

  private async summaries(tx: Tx, ctx: TenantContext, rows: GoalRow[]): Promise<GoalSummary[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((g) => g.id);
    const people = await tx
      .select({ id: s.members.id, displayName: s.members.displayName })
      .from(s.members)
      .where(inArray(s.members.id, [...new Set(rows.map((g) => g.ownerId))]));
    const departmentIds = [
      ...new Set(rows.map((g) => g.departmentId).filter((d): d is string => !!d)),
    ];
    const departments = departmentIds.length
      ? await tx
          .select({ id: s.departments.id, name: s.departments.name })
          .from(s.departments)
          .where(inArray(s.departments.id, departmentIds))
      : [];
    const parentIds = [...new Set(rows.map((g) => g.parentId).filter((p): p is string => !!p))];
    const parents = parentIds.length
      ? await tx
          .select({ id: s.goals.id, title: s.goals.title })
          .from(s.goals)
          .where(and(inArray(s.goals.id, parentIds), visibleGoals(ctx.actor)))
      : [];
    const krCounts = await tx
      .select({ goalId: s.keyResults.goalId, n: count() })
      .from(s.keyResults)
      .where(and(inArray(s.keyResults.goalId, ids), isNull(s.keyResults.archivedAt)))
      .groupBy(s.keyResults.goalId);
    const childCounts = await tx
      .select({ parentId: s.goals.parentId, n: count() })
      .from(s.goals)
      .where(
        and(inArray(s.goals.parentId, ids), isNull(s.goals.archivedAt), visibleGoals(ctx.actor)),
      )
      .groupBy(s.goals.parentId);

    return rows.map((g) => {
      const owner = people.find((p) => p.id === g.ownerId);
      const department = departments.find((d) => d.id === g.departmentId);
      return {
        id: g.id,
        periodId: g.periodId,
        level: g.level,
        department: department ?? null,
        owner: { id: g.ownerId, displayName: owner?.displayName ?? '' },
        parent: parents.find((p) => p.id === g.parentId) ?? null,
        title: g.title,
        progress: g.progress,
        status: g.status,
        completedAt: g.completedAt?.toISOString() ?? null,
        keyResultCount: krCounts.find((c) => c.goalId === g.id)?.n ?? 0,
        childCount: childCounts.find((c) => c.parentId === g.id)?.n ?? 0,
        can: { edit: canDefineGoal(ctx.actor, g), checkIn: canCheckIn(ctx.actor, g) },
      };
    });
  }
}

export function toKeyResult(
  kr: KeyResultRow,
  linked: { tasks: Array<{ statusCategory: string }>; projects: number },
): KeyResult {
  return {
    id: kr.id,
    goalId: kr.goalId,
    title: kr.title,
    kind: kr.kind,
    startValue: kr.startValue,
    targetValue: kr.targetValue,
    currentValue: kr.currentValue,
    unit: kr.unit,
    weight: kr.weight,
    progress: kr.progress,
    status: kr.status,
    lastCheckinAt: kr.lastCheckinAt?.toISOString() ?? null,
    linked: {
      tasks: {
        total: linked.tasks.filter((t) => t.statusCategory !== 'canceled').length,
        done: linked.tasks.filter((t) => t.statusCategory === 'done').length,
      },
      projects: linked.projects,
    },
  };
}

export async function insertKeyResult(
  tx: Tx,
  goalId: string,
  input: {
    title: string;
    kind: KeyResultRow['kind'];
    startValue?: number;
    targetValue?: number;
    unit?: string | null;
    weight?: number;
  },
  sortKey: string,
): Promise<KeyResultRow> {
  const range = keyResultRange(input);
  if (!range) throw invalid('Invalid key result range');
  const [row] = await tx
    .insert(s.keyResults)
    .values({
      goalId,
      title: input.title,
      kind: input.kind,
      startValue: range.startValue,
      targetValue: range.targetValue,
      currentValue: range.startValue,
      unit: input.kind === 'number' ? (input.unit ?? null) : null,
      weight: input.weight ?? 1,
      sortKey,
    })
    .returning();
  if (!row) throw new Error('key result insert failed');
  return row;
}

async function requireActiveDepartment(tx: Tx, departmentId: string): Promise<void> {
  const [row] = await tx
    .select({ id: s.departments.id })
    .from(s.departments)
    .where(and(eq(s.departments.id, departmentId), isNull(s.departments.archivedAt)));
  if (!row) throw notFound('Department');
}

/** An active member; for a personal goal, a member of the goal's department. */
async function requireOwner(tx: Tx, ownerId: string, departmentId: string | null): Promise<void> {
  const [member] = await tx
    .select({ id: s.members.id })
    .from(s.members)
    .where(and(eq(s.members.id, ownerId), eq(s.members.status, 'active')));
  if (!member) throw notFound('Member');
  if (departmentId) {
    const [membership] = await tx
      .select({ memberId: s.departmentMemberships.memberId })
      .from(s.departmentMemberships)
      .where(
        and(
          eq(s.departmentMemberships.memberId, ownerId),
          eq(s.departmentMemberships.departmentId, departmentId),
        ),
      );
    if (!membership) throw invalid('The owner of a personal goal must belong to its department');
  }
}
