import { Injectable } from '@nestjs/common';
import { emitEvent, schema as s, type Tx } from '@madar/db';
import {
  calendarDateIn,
  type CreateProjectRequest,
  type Project,
  type SetProjectMembersRequest,
  type UpdateProjectRequest,
} from '@madar/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { TenantContext } from '../common/context.js';
import { forbidden, notFound } from '../common/errors.js';
import { atRiskProjects } from '../dashboard/at-risk.js';
import { TenantDb } from '../database/tenant-db.service.js';
import { keyResultRefs, requireLinkableKeyResult } from '../goals/links.js';
import { loadWorkCalendar } from '../notifications/calendar.js';
import { canCreateIn, canEditProject, visibleProjects } from './access.js';

type ProjectRow = typeof s.projects.$inferSelect;

@Injectable()
export class ProjectsService {
  constructor(private readonly db: TenantDb) {}

  list(ctx: TenantContext, includeArchived = false): Promise<Project[]> {
    return this.db.run(ctx, async (tx) => {
      const rows = await tx
        .select({ id: s.projects.id })
        .from(s.projects)
        .where(
          and(
            visibleProjects(ctx.actor),
            includeArchived ? undefined : eq(s.projects.status, 'active'),
          ),
        )
        .orderBy(asc(s.projects.name));
      return this.hydrate(
        tx,
        ctx,
        rows.map((r) => r.id),
      );
    });
  }

  /** Projects at risk (dashboard drill-down): the same rule and rows as the dashboard card. */
  atRisk(ctx: TenantContext): Promise<Project[]> {
    return this.db.run(ctx, async (tx) => {
      const { timeZone } = await loadWorkCalendar(tx, ctx.tenantId);
      const rows = await atRiskProjects(
        tx,
        ctx.actor,
        calendarDateIn(new Date(), timeZone),
        timeZone,
      );
      return this.hydrate(
        tx,
        ctx,
        rows.map((r) => r.id),
      );
    });
  }

  get(ctx: TenantContext, id: string): Promise<Project> {
    return this.db.run(ctx, async (tx) => {
      await this.requireVisible(tx, ctx, id);
      return this.one(tx, ctx, id);
    });
  }

  create(ctx: TenantContext, input: CreateProjectRequest): Promise<Project> {
    return this.db.run(ctx, async (tx) => {
      const departmentId = input.departmentId ?? null;
      if (departmentId) {
        await requireActiveDepartment(tx, departmentId);
        if (!canCreateIn(ctx.actor, departmentId)) {
          throw forbidden('You can create projects in your own departments');
        }
      }
      const [row] = await tx
        .insert(s.projects)
        .values({
          name: input.name,
          description: input.description ?? null,
          departmentId,
          // A project without a department cannot be department-visible.
          visibility:
            !departmentId && (input.visibility ?? 'department') === 'department'
              ? 'private'
              : (input.visibility ?? 'department'),
          ownerId: ctx.memberId,
          color: input.color ?? null,
          startOn: input.startOn ?? null,
          dueOn: input.dueOn ?? null,
        })
        .returning();
      if (!row) throw new Error('project insert failed');
      const members = new Map<string, 'owner' | 'member'>([[ctx.memberId, 'owner']]);
      for (const memberId of input.memberIds ?? []) {
        if (!members.has(memberId)) members.set(memberId, 'member');
      }
      await this.writeMembers(tx, ctx, row.id, members);
      return this.one(tx, ctx, row.id);
    });
  }

  update(ctx: TenantContext, id: string, input: UpdateProjectRequest): Promise<Project> {
    return this.db.run(ctx, async (tx) => {
      const current = await this.requireEditable(tx, ctx, id);
      const departmentId =
        input.departmentId === undefined ? current.departmentId : input.departmentId;
      if (input.keyResultId && input.keyResultId !== current.keyResultId) {
        await requireLinkableKeyResult(tx, ctx.actor, input.keyResultId);
      }
      if (input.departmentId && input.departmentId !== current.departmentId) {
        await requireActiveDepartment(tx, input.departmentId);
        if (!canCreateIn(ctx.actor, input.departmentId)) throw forbidden();
      }
      const visibility = input.visibility ?? current.visibility;
      await tx
        .update(s.projects)
        .set({
          name: input.name,
          description: input.description,
          departmentId,
          visibility: !departmentId && visibility === 'department' ? 'private' : visibility,
          color: input.color,
          startOn: input.startOn,
          dueOn: input.dueOn,
          keyResultId: input.keyResultId,
        })
        .where(eq(s.projects.id, id));
      return this.one(tx, ctx, id);
    });
  }

  archive(ctx: TenantContext, id: string): Promise<void> {
    return this.db.run(ctx, async (tx) => {
      await this.requireEditable(tx, ctx, id);
      await tx.update(s.projects).set({ status: 'archived' }).where(eq(s.projects.id, id));
    });
  }

  setMembers(ctx: TenantContext, id: string, input: SetProjectMembersRequest): Promise<Project> {
    return this.db.run(ctx, async (tx) => {
      const current = await this.requireEditable(tx, ctx, id);
      const members = new Map(input.members.map((m) => [m.memberId, m.role]));
      // The owner always stays a member.
      members.set(current.ownerId, 'owner');
      await this.writeMembers(tx, ctx, id, members);
      return this.one(tx, ctx, id);
    });
  }

  /** Replaces the member list and emits `project.member_added` / `project.member_removed`. */
  private async writeMembers(
    tx: Tx,
    ctx: TenantContext,
    projectId: string,
    members: Map<string, 'owner' | 'member'>,
  ) {
    const ids = [...members.keys()];
    const before = await tx
      .select({ memberId: s.projectMembers.memberId })
      .from(s.projectMembers)
      .where(eq(s.projectMembers.projectId, projectId));
    const active = await tx
      .select({ id: s.members.id })
      .from(s.members)
      .where(and(inArray(s.members.id, ids), eq(s.members.status, 'active')));
    if (active.length !== new Set(ids).size) throw notFound('Member');
    await tx.delete(s.projectMembers).where(eq(s.projectMembers.projectId, projectId));
    await tx
      .insert(s.projectMembers)
      .values([...members].map(([memberId, role]) => ({ projectId, memberId, role })));
    const existing = new Set(before.map((m) => m.memberId));
    // Includes the actor: they join the project's live room; the notifier never notifies the actor.
    const added = ids.filter((id) => !existing.has(id));
    if (added.length) {
      await emitEvent(tx, 'project.member_added', { projectId, memberIds: added }, ctx.memberId);
    }
    const kept = new Set(ids);
    const removed = [...existing].filter((id) => !kept.has(id));
    if (removed.length) {
      await emitEvent(
        tx,
        'project.member_removed',
        { projectId, memberIds: removed },
        ctx.memberId,
      );
    }
  }

  async requireVisible(tx: Tx, ctx: TenantContext, id: string): Promise<ProjectRow> {
    const [row] = await tx
      .select()
      .from(s.projects)
      .where(and(eq(s.projects.id, id), visibleProjects(ctx.actor)));
    if (!row) throw notFound('Project');
    return row;
  }

  private async requireEditable(tx: Tx, ctx: TenantContext, id: string): Promise<ProjectRow> {
    const row = await this.requireVisible(tx, ctx, id);
    if (!canEditProject(ctx.actor, { ...row, ownerMemberIds: await ownersOf(tx, id) })) {
      throw forbidden();
    }
    return row;
  }

  private async one(tx: Tx, ctx: TenantContext, id: string): Promise<Project> {
    const [project] = await this.hydrate(tx, ctx, [id]);
    if (!project) throw notFound('Project');
    return project;
  }

  private async hydrate(tx: Tx, ctx: TenantContext, ids: string[]): Promise<Project[]> {
    if (ids.length === 0) return [];
    const rows = await tx
      .select({
        project: s.projects,
        departmentName: s.departments.name,
        ownerName: s.members.displayName,
        taskTotal: sql<number>`(select count(*)::int from tasks t where t.project_id = ${s.projects.id} and t.deleted_at is null and t.parent_id is null and t.status_category <> 'canceled')`,
        taskDone: sql<number>`(select count(*)::int from tasks t where t.project_id = ${s.projects.id} and t.deleted_at is null and t.parent_id is null and t.status_category = 'done')`,
      })
      .from(s.projects)
      .leftJoin(s.departments, eq(s.departments.id, s.projects.departmentId))
      .innerJoin(s.members, eq(s.members.id, s.projects.ownerId))
      .where(inArray(s.projects.id, ids));
    const members = await tx
      .select({
        projectId: s.projectMembers.projectId,
        id: s.members.id,
        displayName: s.members.displayName,
        role: s.projectMembers.role,
      })
      .from(s.projectMembers)
      .innerJoin(s.members, eq(s.members.id, s.projectMembers.memberId))
      .where(inArray(s.projectMembers.projectId, ids))
      .orderBy(asc(s.members.displayName));
    const keyResults = await keyResultRefs(
      tx,
      ctx.actor,
      rows.map((r) => r.project.keyResultId),
    );

    const byId = new Map(
      rows.map((r) => {
        const projectMembers = members.filter((m) => m.projectId === r.project.id);
        const project: Project = {
          id: r.project.id,
          name: r.project.name,
          description: r.project.description,
          department:
            r.project.departmentId && r.departmentName
              ? { id: r.project.departmentId, name: r.departmentName }
              : null,
          status: r.project.status,
          visibility: r.project.visibility,
          owner: { id: r.project.ownerId, displayName: r.ownerName },
          color: r.project.color,
          startOn: r.project.startOn,
          dueOn: r.project.dueOn,
          tasks: { total: r.taskTotal, done: r.taskDone },
          members: projectMembers.map(({ id, displayName, role }) => ({ id, displayName, role })),
          keyResult: (r.project.keyResultId && keyResults.get(r.project.keyResultId)) || null,
          can: {
            edit: canEditProject(ctx.actor, {
              ...r.project,
              ownerMemberIds: projectMembers.filter((m) => m.role === 'owner').map((m) => m.id),
            }),
          },
        };
        return [project.id, project] as const;
      }),
    );
    return ids.map((id) => byId.get(id)).filter((p): p is Project => Boolean(p));
  }
}

async function ownersOf(tx: Tx, projectId: string): Promise<string[]> {
  const rows = await tx
    .select({ memberId: s.projectMembers.memberId })
    .from(s.projectMembers)
    .where(and(eq(s.projectMembers.projectId, projectId), eq(s.projectMembers.role, 'owner')));
  return rows.map((r) => r.memberId);
}

async function requireActiveDepartment(tx: Tx, departmentId: string): Promise<void> {
  const [row] = await tx
    .select({ id: s.departments.id })
    .from(s.departments)
    .where(and(eq(s.departments.id, departmentId), isNull(s.departments.archivedAt)));
  if (!row) throw notFound('Department');
}
