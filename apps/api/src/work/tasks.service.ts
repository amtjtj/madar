import { HttpStatus, Injectable } from '@nestjs/common';
import { emitEvent, recordActivity, schema as s, type ActivityChanges, type Tx } from '@madar/db';
import {
  calendarDateIn,
  categoryOf,
  mergeManualOrder,
  displayProgress,
  type Activity,
  type Attachment,
  type Comment,
  type CommentBody,
  type CreateCommentRequest,
  type CreateTaskRequest,
  type ListTasksQuery,
  type MoveTaskRequest,
  type SetCollaboratorsRequest,
  type SetTaskProgressRequest,
  type SetTaskOrderRequest,
  type StatusCategory,
  type Task,
  type UpdateTaskRequest,
} from '@madar/shared';
import { and, asc, desc, eq, ilike, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

import type { TenantContext } from '../common/context.js';
import { ApiError, forbidden, notFound } from '../common/errors.js';
import { overdueTask, stuckTask } from '../dashboard/conditions.js';
import { TenantDb } from '../database/tenant-db.service.js';
import { keyResultRefs, requireLinkableKeyResult } from '../goals/links.js';
import {
  canCreateIn,
  canDeleteTask,
  canEditTask,
  canSetWeight,
  usableProjects,
  visibleProjects,
  visibleTasks,
} from './access.js';
import { attachmentRows, bindUploads, toAttachment } from '../files/attachments-db.js';
import { hasSubtasks, recomputeParentProgress } from './progress.js';
import { loadRanking, rankOf, sourceFor, type Ranking } from './ranking.js';

type TaskRow = typeof s.tasks.$inferSelect;

const assignee = alias(s.members, 'assignee');
const reporter = alias(s.members, 'reporter');
const sourceMember = alias(s.members, 'source_member');
/** Rows considered before ordering by priority (lists show at most 500). */
const RANK_POOL = 2000;

const OPEN: StatusCategory[] = ['todo', 'in_progress'];

function badRequest(message: string) {
  return new ApiError(HttpStatus.BAD_REQUEST, 'validation_failed', message);
}

/** Status side effects: category and completion time. */
function statusFields(statusKey: string, current?: TaskRow) {
  const category = categoryOf(statusKey);
  if (!category) throw badRequest(`Unknown status ${statusKey}`);
  const wasDone = current?.statusCategory === 'done';
  const isDone = category === 'done';
  return {
    statusKey,
    statusCategory: category,
    completedAt: isDone ? (wasDone ? (current?.completedAt ?? new Date()) : new Date()) : null,
  };
}

@Injectable()
export class TasksService {
  constructor(private readonly db: TenantDb) {}

  list(ctx: TenantContext, query: ListTasksQuery): Promise<Task[]> {
    return this.db.run(ctx, async (tx) => {
      const filters: SQL[] = [isNull(s.tasks.deletedAt), visibleTasks(ctx.actor)];
      const me = ctx.memberId;
      const drillDown =
        query.due === 'overdue' || query.stuck === true || query.subtasks === 'include';
      switch (query.view) {
        case 'mine':
          filters.push(eq(s.tasks.assigneeId, me));
          break;
        case 'department': {
          const departmentIds = query.departmentId
            ? [query.departmentId]
            : ctx.actor.departments.map((d) => d.id);
          if (departmentIds.length === 0) return [];
          filters.push(inArray(s.tasks.departmentId, departmentIds));
          if (!query.parentId && !drillDown) filters.push(isNull(s.tasks.parentId));
          break;
        }
        case 'project':
          if (!query.projectId) throw badRequest('projectId is required for the project view');
          filters.push(eq(s.tasks.projectId, query.projectId));
          if (!query.parentId) filters.push(isNull(s.tasks.parentId));
          break;
        case 'visible':
          if (query.departmentId) filters.push(eq(s.tasks.departmentId, query.departmentId));
          break;
      }
      const ranking = await loadRanking(tx, ctx.tenantId);
      if (query.due === 'overdue') filters.push(overdueTask(ranking.today));
      if (query.stuck) {
        filters.push(stuckTask(ranking.calendar, ranking.timeZone, ranking.today));
      }
      if (query.source) filters.push(eq(s.tasks.source, query.source));
      if (query.parentId) filters.push(eq(s.tasks.parentId, query.parentId));
      if (query.assigneeId) filters.push(eq(s.tasks.assigneeId, query.assigneeId));
      if (query.status === 'open') filters.push(inArray(s.tasks.statusCategory, OPEN));
      if (query.status === 'done') filters.push(eq(s.tasks.statusCategory, 'done'));
      if (query.q) {
        filters.push(ilike(s.tasks.title, `%${query.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`));
      }
      // Ordered by automatic priority (ADR 0017); «my tasks» keep the member's own order.
      const rows = await tx
        .select({
          id: s.tasks.id,
          dueOn: s.tasks.dueOn,
          priority: s.tasks.priority,
          source: s.tasks.source,
          sourceCeo: s.tasks.sourceCeo,
          keyResultId: s.tasks.keyResultId,
          weight: s.tasks.weight,
          createdAt: s.tasks.createdAt,
          statusCategory: s.tasks.statusCategory,
          finishedAt: sql<Date>`coalesce(${s.tasks.completedAt}, ${s.tasks.updatedAt})`,
        })
        .from(s.tasks)
        .where(and(...filters))
        // A coarse version of the score in SQL, so the pool cut never drops the tasks that
        // matter most (open, overdue, urgent, from the CEO); the exact score is applied below.
        .orderBy(
          sql`(${s.tasks.statusCategory} in ('todo', 'in_progress')) desc`,
          sql`(${s.tasks.dueOn} < ${ranking.today}) desc`,
          sql`array_position(array['urgent','high','normal','low']::task_priority[], ${s.tasks.priority})`,
          desc(s.tasks.sourceCeo),
          sql`${s.tasks.dueOn} asc nulls last`,
          desc(s.tasks.createdAt),
        )
        .limit(RANK_POOL);
      // Open work by score; finished work after it, most recently finished first.
      const open = rows.filter((r) => OPEN.includes(r.statusCategory));
      const finished = rows
        .filter((r) => !OPEN.includes(r.statusCategory))
        .sort((a, b) => new Date(b.finishedAt).getTime() - new Date(a.finishedAt).getTime())
        .map((r) => ({ id: r.id, score: 0 }));
      let ranked = open
        .map((r) => ({ id: r.id, score: rankOf(r, ranking).score, createdAt: r.createdAt }))
        .sort((a, b) => b.score - a.score || b.createdAt.getTime() - a.createdAt.getTime());
      if (query.view === 'mine') {
        ranked = mergeManualOrder(ranked, await this.personalOrder(tx, ctx));
      }
      return this.hydrate(
        tx,
        ctx,
        [...ranked, ...finished].slice(0, query.limit).map((r) => r.id),
        ranking,
      );
    });
  }

  get(ctx: TenantContext, id: string): Promise<Task> {
    return this.db.run(ctx, async (tx) => {
      await this.requireVisible(tx, ctx, id);
      return this.one(tx, ctx, id);
    });
  }

  create(ctx: TenantContext, input: CreateTaskRequest): Promise<Task> {
    return this.db.run(ctx, async (tx) => {
      const departmentId = input.departmentId ?? (await this.primaryDepartment(tx, ctx));
      if (!departmentId) {
        throw new ApiError(
          HttpStatus.BAD_REQUEST,
          'no_department',
          'Join a department to create tasks',
        );
      }
      await this.requireActiveDepartment(tx, departmentId);
      if (!canCreateIn(ctx.actor, departmentId)) {
        throw forbidden('You can create tasks in your own departments');
      }
      if (
        input.weight !== undefined &&
        input.weight !== 1 &&
        !canSetWeight(ctx.actor, departmentId)
      ) {
        throw forbidden('Only department managers set the weight');
      }
      // A subtask belongs to its parent's project, so it passes the same check (observers of a
      // private project add no work to it, not even under an existing task).
      const parent = input.parentId ? await this.requireVisible(tx, ctx, input.parentId) : null;
      if (parent?.parentId) throw badRequest('Subtasks have no subtasks of their own');
      if (parent && input.projectId !== undefined && input.projectId !== parent.projectId) {
        throw badRequest("A subtask is in its parent's project");
      }
      const projectId = parent ? parent.projectId : (input.projectId ?? null);
      if (projectId) await this.requireUsableProject(tx, ctx, projectId);
      if (input.assigneeId) await requireActiveMember(tx, input.assigneeId);

      const status = statusFields(input.statusKey ?? 'todo');
      const [last] = await tx
        .select({ sortKey: s.tasks.sortKey })
        .from(s.tasks)
        .where(and(eq(s.tasks.departmentId, departmentId), eq(s.tasks.statusKey, status.statusKey)))
        .orderBy(desc(s.tasks.sortKey))
        .limit(1);

      const assigneeId = input.assigneeId === undefined ? ctx.memberId : input.assigneeId;
      // Where it came from is decided now, once (ADR 0017).
      const source = assigneeId
        ? await sourceFor(tx, { actorId: ctx.memberId, assigneeId, departmentId })
        : null;
      const [row] = await tx
        .insert(s.tasks)
        .values({
          title: input.title,
          description: input.description ?? null,
          departmentId,
          projectId,
          parentId: input.parentId ?? null,
          assigneeId,
          reporterId: ctx.memberId,
          ...source,
          dueOn: input.dueOn ?? null,
          priority: input.priority ?? 'normal',
          weight: input.weight ?? 1,
          sortKey: generateKeyBetween(last?.sortKey ?? null, null),
          ...status,
        })
        .returning();
      if (!row) throw new Error('task insert failed');

      await recordActivity(tx, {
        subjectType: 'task',
        subjectId: row.id,
        actorId: ctx.memberId,
        verb: 'created',
      });
      await emitEvent(tx, 'task.created', taskEventPayload(row), ctx.memberId);
      if (row.assigneeId && row.assigneeId !== ctx.memberId) {
        await emitEvent(
          tx,
          'task.assigned',
          { taskId: row.id, assigneeId: row.assigneeId, source: row.source },
          ctx.memberId,
        );
      }
      if (input.addToToday) {
        const tenant = await tx
          .select({ timezone: s.tenants.timezone })
          .from(s.tenants)
          .where(eq(s.tenants.id, ctx.tenantId));
        const today = calendarDateIn(new Date(), tenant[0]?.timezone);
        // No sort key: placed by priority among the member's own order.
        await tx
          .insert(s.dailyPlanItems)
          .values({ memberId: ctx.memberId, planDate: today, taskId: row.id })
          .onConflictDoNothing();
        await emitEvent(
          tx,
          'daily_plan.updated',
          { memberId: ctx.memberId, planDate: today },
          ctx.memberId,
        );
      }
      if (row.parentId) await this.subtaskAdded(tx, row.parentId, row.id, ctx.memberId);
      return this.one(tx, ctx, row.id);
    });
  }

  /**
   * A parent whose progress was recorded by hand keeps it when its first subtask arrives (it
   * switches to manual); otherwise it follows its subtasks (ADR 0018).
   */
  private async subtaskAdded(tx: Tx, parentId: string, childId: string, actorId: string) {
    const [parent] = await tx
      .select({ progress: s.tasks.progress, mode: s.tasks.progressMode })
      .from(s.tasks)
      .where(eq(s.tasks.id, parentId));
    if (!parent) return;
    const [sibling] = await tx
      .select({ id: s.tasks.id })
      .from(s.tasks)
      .where(
        // Deleted ones too: a parent that ever had subtasks holds a computed value.
        and(eq(s.tasks.parentId, parentId), sql`${s.tasks.id} <> ${childId}`),
      )
      .limit(1);
    if (!sibling && parent.mode === 'auto' && parent.progress > 0) {
      await tx.update(s.tasks).set({ progressMode: 'manual' }).where(eq(s.tasks.id, parentId));
      return;
    }
    await recomputeParentProgress(tx, parentId, actorId);
  }

  update(ctx: TenantContext, id: string, input: UpdateTaskRequest): Promise<Task> {
    return this.db.run(ctx, async (tx) => {
      const current = await this.requireVisible(tx, ctx, id);
      const collaboratorIds = await collaboratorsOf(tx, id, 'collaborator');
      if (!canEditTask(ctx.actor, { ...current, collaboratorIds })) throw forbidden();
      if (
        input.weight !== undefined &&
        input.weight !== current.weight &&
        !canSetWeight(ctx.actor, current.departmentId)
      ) {
        throw forbidden('Only department managers set the weight');
      }
      if (input.projectId) await this.requireUsableProject(tx, ctx, input.projectId);
      if (input.assigneeId) await requireActiveMember(tx, input.assigneeId);
      if (input.keyResultId && input.keyResultId !== current.keyResultId) {
        await requireLinkableKeyResult(tx, ctx.actor, input.keyResultId);
      }

      const patch: Partial<typeof s.tasks.$inferInsert> = {};
      const changes: ActivityChanges = {};
      const fields = [
        'title',
        'description',
        'projectId',
        'assigneeId',
        'dueOn',
        'priority',
        'weight',
        'keyResultId',
      ] as const;
      for (const field of fields) {
        const next = input[field];
        if (next !== undefined && next !== current[field]) {
          (patch as Record<string, unknown>)[field] = next;
          changes[field] = { from: current[field], to: next };
        }
      }
      if (input.statusKey !== undefined && input.statusKey !== current.statusKey) {
        Object.assign(patch, statusFields(input.statusKey, current));
        changes.status = { from: current.statusKey, to: input.statusKey };
      }
      if (input.progressMode !== undefined && input.progressMode !== current.progressMode) {
        patch.progressMode = input.progressMode;
        changes.progressMode = { from: current.progressMode, to: input.progressMode };
      }
      // The first assignee decides the source; later reassignments keep it (ADR 0017).
      if (patch.assigneeId && current.source === null) {
        Object.assign(
          patch,
          await sourceFor(tx, {
            actorId: ctx.memberId,
            assigneeId: patch.assigneeId,
            departmentId: current.departmentId,
          }),
        );
      }

      const [updated] = await tx
        .update(s.tasks)
        .set({ ...patch, version: sql`${s.tasks.version} + 1` })
        .where(and(eq(s.tasks.id, id), eq(s.tasks.version, input.version)))
        .returning();
      if (!updated) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'version_conflict',
          'The task was changed by someone else',
          {
            task: await this.one(tx, ctx, id),
          },
        );
      }
      if (Object.keys(changes).length) {
        await this.afterChange(tx, ctx, current, updated, changes);
      }
      // Progress computed from subtasks follows them (ADR 0018).
      if (changes.status || changes.weight)
        await recomputeParentProgress(tx, current.parentId, ctx.memberId);
      if (changes.progressMode?.to === 'auto') await recomputeParentProgress(tx, id, ctx.memberId);
      return this.one(tx, ctx, id);
    });
  }

  /**
   * Record progress (ADR 0018), with an optional note in the history. The first progress moves a
   * task out of «to do»; 100 % changes nothing by itself (the app asks whether it is done).
   */
  setProgress(ctx: TenantContext, id: string, input: SetTaskProgressRequest): Promise<Task> {
    return this.db.run(ctx, async (tx) => {
      const current = await this.requireVisible(tx, ctx, id);
      const collaboratorIds = await collaboratorsOf(tx, id, 'collaborator');
      if (!canEditTask(ctx.actor, { ...current, collaboratorIds })) throw forbidden();
      if (current.statusCategory === 'done' || current.statusCategory === 'canceled') {
        throw new ApiError(HttpStatus.BAD_REQUEST, 'progress_closed', 'The task is closed');
      }
      if (current.progressMode === 'auto' && (await hasSubtasks(tx, id))) {
        throw new ApiError(
          HttpStatus.BAD_REQUEST,
          'progress_auto',
          'Progress comes from the subtasks; switch to manual first',
        );
      }
      const note = input.note?.trim() || null;
      if (input.value === current.progress && !note) return this.one(tx, ctx, id);

      const patch: Partial<typeof s.tasks.$inferInsert> = { progress: input.value };
      const statusChanges: ActivityChanges = {};
      if (input.value > 0 && current.statusCategory === 'todo') {
        Object.assign(patch, statusFields('in_progress', current));
        statusChanges.status = { from: current.statusKey, to: 'in_progress' };
      }
      const [updated] = await tx
        .update(s.tasks)
        .set({ ...patch, version: sql`${s.tasks.version} + 1` })
        .where(and(eq(s.tasks.id, id), eq(s.tasks.version, input.version)))
        .returning();
      if (!updated) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'version_conflict',
          'The task was changed by someone else',
          { task: await this.one(tx, ctx, id) },
        );
      }
      await recordActivity(tx, {
        subjectType: 'task',
        subjectId: id,
        actorId: ctx.memberId,
        verb: 'progress',
        changes: {
          progress: { from: current.progress, to: input.value },
          ...(note ? { note: { from: null, to: note } } : {}),
        },
      });
      await emitEvent(
        tx,
        'task.progress_updated',
        { taskId: id, from: current.progress, to: input.value },
        ctx.memberId,
      );
      if (statusChanges.status) await this.afterChange(tx, ctx, current, updated, statusChanges);
      await recomputeParentProgress(tx, current.parentId, ctx.memberId);
      return this.one(tx, ctx, id);
    });
  }

  move(ctx: TenantContext, id: string, input: MoveTaskRequest): Promise<Task> {
    return this.db.run(ctx, async (tx) => {
      const current = await this.requireVisible(tx, ctx, id);
      const collaboratorIds = await collaboratorsOf(tx, id, 'collaborator');
      if (!canEditTask(ctx.actor, { ...current, collaboratorIds })) throw forbidden();

      const neighbour = async (taskId: string | null | undefined) => {
        if (!taskId) return null;
        const [row] = await tx
          .select({ sortKey: s.tasks.sortKey })
          .from(s.tasks)
          .where(eq(s.tasks.id, taskId));
        return row?.sortKey ?? null;
      };
      const after = await neighbour(input.afterTaskId);
      const before = await neighbour(input.beforeTaskId);
      let sortKey: string;
      try {
        sortKey = generateKeyBetween(after, before && after && before <= after ? null : before);
      } catch {
        sortKey = generateKeyBetween(after, null);
      }

      const changes: ActivityChanges = {};
      const patch: Partial<typeof s.tasks.$inferInsert> = { sortKey };
      if (input.statusKey !== current.statusKey) {
        Object.assign(patch, statusFields(input.statusKey, current));
        changes.status = { from: current.statusKey, to: input.statusKey };
      }
      const [updated] = await tx
        .update(s.tasks)
        .set({ ...patch, version: sql`${s.tasks.version} + 1` })
        .where(eq(s.tasks.id, id))
        .returning();
      if (!updated) throw notFound('Task');
      if (Object.keys(changes).length) {
        await this.afterChange(tx, ctx, current, updated, changes);
        await recomputeParentProgress(tx, current.parentId, ctx.memberId);
      }
      return this.one(tx, ctx, id);
    });
  }

  /** Soft delete (with sub-tasks); a sensitive action, so it is also audited (ADR 0009). */
  remove(ctx: TenantContext, id: string): Promise<void> {
    return this.db.run(ctx, async (tx) => {
      const current = await this.requireVisible(tx, ctx, id);
      const collaboratorIds = await collaboratorsOf(tx, id, 'collaborator');
      if (!canDeleteTask(ctx.actor, { ...current, collaboratorIds })) throw forbidden();
      const now = new Date();
      await tx
        .update(s.tasks)
        .set({ deletedAt: now })
        .where(and(eq(s.tasks.parentId, id), isNull(s.tasks.deletedAt)));
      await tx
        .update(s.tasks)
        .set({ deletedAt: now, version: sql`${s.tasks.version} + 1` })
        .where(eq(s.tasks.id, id));
      await recordActivity(tx, {
        subjectType: 'task',
        subjectId: id,
        actorId: ctx.memberId,
        verb: 'deleted',
      });
      await emitEvent(tx, 'task.deleted', { taskId: id }, ctx.memberId);
      await recomputeParentProgress(tx, current.parentId, ctx.memberId);
      await this.db.audit(tx, ctx, {
        action: 'task.deleted',
        subjectType: 'task',
        subjectId: id,
        before: {
          title: current.title,
          departmentId: current.departmentId,
          assigneeId: current.assigneeId,
        },
      });
    });
  }

  setCollaborators(ctx: TenantContext, id: string, input: SetCollaboratorsRequest): Promise<Task> {
    return this.db.run(ctx, async (tx) => {
      const current = await this.requireVisible(tx, ctx, id);
      const before = await tx
        .select({ memberId: s.taskCollaborators.memberId, kind: s.taskCollaborators.kind })
        .from(s.taskCollaborators)
        .where(eq(s.taskCollaborators.taskId, id));
      if (
        !canEditTask(ctx.actor, {
          ...current,
          collaboratorIds: before.filter((c) => c.kind === 'collaborator').map((c) => c.memberId),
        })
      ) {
        throw forbidden();
      }
      const unique = new Map(input.members.map((m) => [m.memberId, m]));
      for (const memberId of unique.keys()) await requireActiveMember(tx, memberId);
      await tx.delete(s.taskCollaborators).where(eq(s.taskCollaborators.taskId, id));
      if (unique.size) {
        await tx
          .insert(s.taskCollaborators)
          .values(
            [...unique.values()].map((m) => ({ taskId: id, memberId: m.memberId, kind: m.kind })),
          );
      }
      await recordActivity(tx, {
        subjectType: 'task',
        subjectId: id,
        actorId: ctx.memberId,
        verb: 'collaborators_changed',
        changes: { collaborators: { from: before.map((c) => c.memberId), to: [...unique.keys()] } },
      });
      return this.one(tx, ctx, id);
    });
  }

  listComments(ctx: TenantContext, taskId: string): Promise<Comment[]> {
    return this.db.run(ctx, async (tx) => {
      const task = await this.requireVisible(tx, ctx, taskId);
      const rows = await tx
        .select({ comment: s.comments, authorName: s.members.displayName })
        .from(s.comments)
        .innerJoin(s.members, eq(s.members.id, s.comments.authorId))
        .where(and(eq(s.comments.subjectType, 'task'), eq(s.comments.subjectId, taskId)))
        .orderBy(asc(s.comments.createdAt));
      const files = await this.commentFiles(
        tx,
        ctx,
        task,
        rows.map((r) => r.comment.id),
      );
      return rows.map(({ comment, authorName }) =>
        toComment(comment, authorName, ctx.memberId, files.get(comment.id) ?? []),
      );
    });
  }

  /** Files on these comments (a deleted comment shows none), by comment id. */
  private async commentFiles(
    tx: Tx,
    ctx: TenantContext,
    task: TaskRow,
    commentIds: string[],
  ): Promise<Map<string, Attachment[]>> {
    const byComment = new Map<string, Attachment[]>();
    if (commentIds.length === 0) return byComment;
    const rows = await attachmentRows(
      tx,
      and(eq(s.attachments.subjectType, 'comment'), inArray(s.attachments.subjectId, commentIds)),
    );
    if (rows.length === 0) return byComment;
    const editsTask = canEditTask(ctx.actor, {
      ...task,
      collaboratorIds: await collaboratorsOf(tx, task.id, 'collaborator'),
    });
    for (const { row, uploaderName } of rows) {
      const list = byComment.get(row.subjectId ?? '') ?? [];
      list.push(toAttachment(row, uploaderName, editsTask || row.uploadedBy === ctx.memberId));
      byComment.set(row.subjectId ?? '', list);
    }
    return byComment;
  }

  addComment(ctx: TenantContext, taskId: string, input: CreateCommentRequest): Promise<Comment> {
    return this.db.run(ctx, async (tx) => {
      const task = await this.requireVisible(tx, ctx, taskId);
      const [row] = await tx
        .insert(s.comments)
        .values({
          subjectType: 'task',
          subjectId: taskId,
          authorId: ctx.memberId,
          body: input.body,
        })
        .returning();
      if (!row) throw new Error('comment insert failed');
      // The person's own fresh uploads go with the comment (ADR 0019).
      if (input.attachmentIds?.length) {
        await bindUploads(tx, ctx, input.attachmentIds, { type: 'comment', id: row.id });
      }
      await emitEvent(tx, 'comment.created', { commentId: row.id, taskId }, ctx.memberId);
      const [author] = await tx
        .select({ name: s.members.displayName })
        .from(s.members)
        .where(eq(s.members.id, ctx.memberId));
      const files = await this.commentFiles(tx, ctx, task, [row.id]);
      return toComment(row, author?.name ?? '', ctx.memberId, files.get(row.id) ?? []);
    });
  }

  /** Edit or soft-delete a comment; only its author may. */
  updateComment(ctx: TenantContext, id: string, input: CommentBody | null): Promise<Comment> {
    return this.db.run(ctx, async (tx) => {
      const [current] = await tx.select().from(s.comments).where(eq(s.comments.id, id));
      if (!current || current.deletedAt) throw notFound('Comment');
      const task = await this.requireVisible(tx, ctx, current.subjectId);
      if (current.authorId !== ctx.memberId)
        throw forbidden('Only the author can change a comment');
      const [row] = await tx
        .update(s.comments)
        .set(input ? { body: input.body, editedAt: new Date() } : { deletedAt: new Date() })
        .where(eq(s.comments.id, id))
        .returning();
      if (!row) throw notFound('Comment');
      const [author] = await tx
        .select({ name: s.members.displayName })
        .from(s.members)
        .where(eq(s.members.id, ctx.memberId));
      const files = row.deletedAt ? new Map() : await this.commentFiles(tx, ctx, task, [row.id]);
      return toComment(row, author?.name ?? '', ctx.memberId, files.get(row.id) ?? []);
    });
  }

  activity(ctx: TenantContext, taskId: string): Promise<Activity[]> {
    return this.db.run(ctx, async (tx) => {
      await this.requireVisible(tx, ctx, taskId);
      const rows = await tx
        .select({ activity: s.activities, actorName: s.members.displayName })
        .from(s.activities)
        .leftJoin(s.members, eq(s.members.id, s.activities.actorId))
        .where(and(eq(s.activities.subjectType, 'task'), eq(s.activities.subjectId, taskId)))
        .orderBy(desc(s.activities.createdAt))
        .limit(200);
      return rows.map(({ activity: a, actorName }) => ({
        id: a.id,
        actor: a.actorId && actorName ? { id: a.actorId, displayName: actorName } : null,
        verb: a.verb,
        changes: a.changes ?? null,
        createdAt: a.createdAt.toISOString(),
      }));
    });
  }

  /** Activity + events after a status/assignee/field change. */
  private async afterChange(
    tx: Tx,
    ctx: TenantContext,
    before: TaskRow,
    after: TaskRow,
    changes: ActivityChanges,
  ) {
    const onlyStatus = Object.keys(changes).length === 1 && 'status' in changes;
    await recordActivity(tx, {
      subjectType: 'task',
      subjectId: after.id,
      actorId: ctx.memberId,
      verb: onlyStatus ? 'status_changed' : 'updated',
      changes,
    });
    if (changes.status) {
      await emitEvent(
        tx,
        'task.status_changed',
        { taskId: after.id, from: before.statusKey, to: after.statusKey },
        ctx.memberId,
      );
      if (after.statusCategory === 'done' && before.statusCategory !== 'done') {
        await emitEvent(tx, 'task.completed', taskEventPayload(after), ctx.memberId);
      }
      if (before.statusCategory === 'done' && after.statusCategory !== 'done') {
        await emitEvent(tx, 'task.reopened', taskEventPayload(after), ctx.memberId);
      }
    }
    if (changes.assigneeId && after.assigneeId) {
      await emitEvent(
        tx,
        'task.assigned',
        { taskId: after.id, assigneeId: after.assigneeId },
        ctx.memberId,
      );
    }
  }

  async requireVisible(tx: Tx, ctx: TenantContext, id: string): Promise<TaskRow> {
    const [row] = await tx
      .select()
      .from(s.tasks)
      .where(and(eq(s.tasks.id, id), isNull(s.tasks.deletedAt), visibleTasks(ctx.actor)));
    if (!row) throw notFound('Task');
    return row;
  }

  private async requireUsableProject(tx: Tx, ctx: TenantContext, projectId: string) {
    const [row] = await tx
      .select({ id: s.projects.id })
      .from(s.projects)
      .where(
        and(
          eq(s.projects.id, projectId),
          eq(s.projects.status, 'active'),
          visibleProjects(ctx.actor),
          usableProjects(ctx.actor),
        ),
      );
    if (!row) throw notFound('Project');
  }

  private async requireActiveDepartment(tx: Tx, departmentId: string) {
    const [row] = await tx
      .select({ id: s.departments.id })
      .from(s.departments)
      .where(and(eq(s.departments.id, departmentId), isNull(s.departments.archivedAt)));
    if (!row) throw notFound('Department');
  }

  private async primaryDepartment(tx: Tx, ctx: TenantContext): Promise<string | null> {
    const [row] = await tx
      .select({ id: s.departmentMemberships.departmentId })
      .from(s.departmentMemberships)
      .innerJoin(s.departments, eq(s.departments.id, s.departmentMemberships.departmentId))
      .where(
        and(eq(s.departmentMemberships.memberId, ctx.memberId), isNull(s.departments.archivedAt)),
      )
      .orderBy(desc(s.departmentMemberships.isPrimary))
      .limit(1);
    return row?.id ?? null;
  }

  /** The member's own order of «my tasks», task id to sort key. */
  private async personalOrder(tx: Tx, ctx: TenantContext): Promise<Map<string, string>> {
    const rows = await tx
      .select({ taskId: s.memberTaskOrder.taskId, sortKey: s.memberTaskOrder.sortKey })
      .from(s.memberTaskOrder)
      .where(eq(s.memberTaskOrder.memberId, ctx.memberId));
    return new Map(rows.map((r) => [r.taskId, r.sortKey]));
  }

  /** Tasks in the member's own order (ids); empty when «my tasks» follow the automatic order. */
  orderedIds(ctx: TenantContext): Promise<string[]> {
    return this.db.run(ctx, async (tx) =>
      [...(await this.personalOrder(tx, ctx)).entries()]
        .sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
        .map(([id]) => id),
    );
  }

  /** Set the member's own order of «my tasks» (drag and drop); only tasks they can see. */
  setOrder(ctx: TenantContext, input: SetTaskOrderRequest): Promise<string[]> {
    return this.db.run(ctx, async (tx) => {
      const taskIds = [...new Set(input.taskIds)];
      if (taskIds.length) {
        const visible = await tx
          .select({ id: s.tasks.id })
          .from(s.tasks)
          .where(
            and(inArray(s.tasks.id, taskIds), isNull(s.tasks.deletedAt), visibleTasks(ctx.actor)),
          );
        if (visible.length !== taskIds.length) throw notFound('Task');
      }
      // The list sends what it shows; tasks ordered earlier but not shown keep their relative
      // order after them instead of losing their place.
      const sent = new Set(taskIds);
      const kept = [...(await this.personalOrder(tx, ctx)).entries()]
        .sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
        .map(([id]) => id)
        .filter((id) => !sent.has(id));
      taskIds.push(...kept);
      await tx.delete(s.memberTaskOrder).where(eq(s.memberTaskOrder.memberId, ctx.memberId));
      if (taskIds.length) {
        const keys = generateNKeysBetween(null, null, taskIds.length);
        await tx.insert(s.memberTaskOrder).values(
          taskIds.map((taskId, i) => ({
            memberId: ctx.memberId,
            taskId,
            sortKey: keys[i] ?? 'a0',
          })),
        );
      }
      return taskIds;
    });
  }

  /** Back to the automatic order. */
  clearOrder(ctx: TenantContext): Promise<void> {
    return this.db.run(ctx, async (tx) => {
      await tx.delete(s.memberTaskOrder).where(eq(s.memberTaskOrder.memberId, ctx.memberId));
    });
  }

  private async one(tx: Tx, ctx: TenantContext, id: string): Promise<Task> {
    const [task] = await this.hydrate(tx, ctx, [id]);
    if (!task) throw notFound('Task');
    return task;
  }

  /** Full task objects (names, counts, collaborators, permissions) in the order of `ids`. */
  async hydrate(tx: Tx, ctx: TenantContext, ids: string[], ranking?: Ranking): Promise<Task[]> {
    if (ids.length === 0) return [];
    const rank = ranking ?? (await loadRanking(tx, ctx.tenantId));
    const rows = await tx
      .select({
        task: s.tasks,
        departmentName: s.departments.name,
        projectName: s.projects.name,
        assigneeName: assignee.displayName,
        reporterName: reporter.displayName,
        sourceName: sourceMember.displayName,
        sourceTitle: sourceMember.title,
        subtaskTotal: sql<number>`(select count(*)::int from tasks st where st.parent_id = ${s.tasks.id} and st.deleted_at is null)`,
        subtaskDone: sql<number>`(select count(*)::int from tasks st where st.parent_id = ${s.tasks.id} and st.deleted_at is null and st.status_category = 'done')`,
        commentCount: sql<number>`(select count(*)::int from comments c where c.subject_type = 'task' and c.subject_id = ${s.tasks.id} and c.deleted_at is null)`,
        // Files on the task and on its live comments (ADR 0019).
        attachmentCount: sql<number>`(select count(*)::int from attachments a where a.status = 'ready' and a.deleted_at is null and ((a.subject_type = 'task' and a.subject_id = ${s.tasks.id}) or (a.subject_type = 'comment' and a.subject_id in (select c.id from comments c where c.subject_type = 'task' and c.subject_id = ${s.tasks.id} and c.deleted_at is null))))`,
      })
      .from(s.tasks)
      .innerJoin(s.departments, eq(s.departments.id, s.tasks.departmentId))
      .leftJoin(s.projects, eq(s.projects.id, s.tasks.projectId))
      .leftJoin(assignee, eq(assignee.id, s.tasks.assigneeId))
      .innerJoin(reporter, eq(reporter.id, s.tasks.reporterId))
      .leftJoin(sourceMember, eq(sourceMember.id, s.tasks.sourceMemberId))
      .where(inArray(s.tasks.id, ids));
    const collaborators = await tx
      .select({
        taskId: s.taskCollaborators.taskId,
        id: s.members.id,
        displayName: s.members.displayName,
        kind: s.taskCollaborators.kind,
      })
      .from(s.taskCollaborators)
      .innerJoin(s.members, eq(s.members.id, s.taskCollaborators.memberId))
      .where(inArray(s.taskCollaborators.taskId, ids));
    const keyResults = await keyResultRefs(
      tx,
      ctx.actor,
      rows.map((r) => r.task.keyResultId),
    );

    const byId = new Map(
      rows.map((r) => {
        const taskCollaborators = collaborators.filter((c) => c.taskId === r.task.id);
        const access = {
          ...r.task,
          collaboratorIds: taskCollaborators
            .filter((c) => c.kind === 'collaborator')
            .map((c) => c.id),
        };
        const task: Task = {
          id: r.task.id,
          title: r.task.title,
          description: r.task.description,
          department: { id: r.task.departmentId, name: r.departmentName },
          project:
            r.task.projectId && r.projectName
              ? { id: r.task.projectId, name: r.projectName }
              : null,
          parentId: r.task.parentId,
          statusKey: r.task.statusKey,
          statusCategory: r.task.statusCategory,
          priority: r.task.priority,
          assignee:
            r.task.assigneeId && r.assigneeName
              ? { id: r.task.assigneeId, displayName: r.assigneeName }
              : null,
          reporter: { id: r.task.reporterId, displayName: r.reporterName },
          collaborators: taskCollaborators.map(({ id, displayName, kind }) => ({
            id,
            displayName,
            kind,
          })),
          dueOn: r.task.dueOn,
          completedAt: r.task.completedAt?.toISOString() ?? null,
          weight: r.task.weight,
          sortKey: r.task.sortKey,
          version: r.task.version,
          subtasks: { total: r.subtaskTotal, done: r.subtaskDone },
          progress: displayProgress(r.task.statusCategory, r.task.progress),
          progressMode: r.task.progressMode,
          commentCount: r.commentCount,
          attachmentCount: r.attachmentCount,
          keyResult: (r.task.keyResultId && keyResults.get(r.task.keyResultId)) || null,
          source: r.task.source
            ? {
                kind: r.task.source,
                by:
                  r.task.sourceMemberId && r.sourceName
                    ? {
                        id: r.task.sourceMemberId,
                        displayName: r.sourceName,
                        title: r.sourceTitle,
                      }
                    : null,
                ceo: r.task.sourceCeo,
              }
            : null,
          rank: rankOf(r.task, rank),
          createdAt: r.task.createdAt.toISOString(),
          updatedAt: r.task.updatedAt.toISOString(),
          can: {
            edit: canEditTask(ctx.actor, access),
            setWeight: canSetWeight(ctx.actor, r.task.departmentId),
            delete: canDeleteTask(ctx.actor, access),
          },
        };
        return [task.id, task] as const;
      }),
    );
    return ids.map((id) => byId.get(id)).filter((t): t is Task => Boolean(t));
  }
}

function taskEventPayload(task: TaskRow) {
  return {
    taskId: task.id,
    departmentId: task.departmentId,
    assigneeId: task.assigneeId,
    weight: task.weight,
    dueOn: task.dueOn,
    // For gamification later: work assigned from above can weigh differently (ADR 0017).
    source: task.source,
    sourceCeo: task.sourceCeo,
  };
}

function toComment(
  row: typeof s.comments.$inferSelect,
  authorName: string,
  me: string,
  attachments: Attachment[],
): Comment {
  const deleted = row.deletedAt !== null;
  return {
    id: row.id,
    author: { id: row.authorId, displayName: authorName },
    body: deleted ? '' : row.body,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    deleted,
    attachments: deleted ? [] : attachments,
    can: { edit: !deleted && row.authorId === me },
  };
}

async function collaboratorsOf(
  tx: Tx,
  taskId: string,
  kind: 'collaborator' | 'watcher',
): Promise<string[]> {
  const rows = await tx
    .select({ memberId: s.taskCollaborators.memberId })
    .from(s.taskCollaborators)
    .where(and(eq(s.taskCollaborators.taskId, taskId), eq(s.taskCollaborators.kind, kind)));
  return rows.map((r) => r.memberId);
}

async function requireActiveMember(tx: Tx, memberId: string): Promise<void> {
  const [row] = await tx
    .select({ id: s.members.id })
    .from(s.members)
    .where(and(eq(s.members.id, memberId), eq(s.members.status, 'active')));
  if (!row) throw notFound('Member');
}
