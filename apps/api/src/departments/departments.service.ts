import { HttpStatus, Injectable } from '@nestjs/common';
import { schema as s, type Tx } from '@madar/db';
import type {
  CreateDepartmentRequest,
  Department,
  OversightResource,
  SetOversightRequest,
  UpdateDepartmentRequest,
} from '@madar/shared';
import { and, count, eq, isNull, sql } from 'drizzle-orm';

import { createChannel } from '../chat/channels.js';
import type { TenantContext } from '../common/context.js';
import { ApiError, notFound } from '../common/errors.js';
import { TenantDb } from '../database/tenant-db.service.js';

type DepartmentRow = typeof s.departments.$inferSelect;

@Injectable()
export class DepartmentsService {
  constructor(private readonly db: TenantDb) {}

  list(ctx: TenantContext, includeArchived = false): Promise<Department[]> {
    return this.db.run(ctx, async (tx) => {
      const rows = await tx
        .select({
          department: s.departments,
          headName: s.members.displayName,
          memberCount: sql<number>`(
            select count(*)::int from ${s.departmentMemberships} dm
            where dm.department_id = ${s.departments.id}
          )`,
        })
        .from(s.departments)
        .leftJoin(s.members, eq(s.members.id, s.departments.headMemberId))
        .where(includeArchived ? undefined : isNull(s.departments.archivedAt))
        .orderBy(s.departments.sort, s.departments.name);
      return rows.map((r) => toDepartment(r.department, r.headName, r.memberCount));
    });
  }

  create(ctx: TenantContext, input: CreateDepartmentRequest): Promise<Department> {
    return this.db.run(ctx, async (tx) => {
      if (input.parentId) await this.requireActive(tx, input.parentId);
      if (input.headMemberId) await requireActiveMember(tx, input.headMemberId);
      const [row] = await tx
        .insert(s.departments)
        .values({
          name: input.name,
          parentId: input.parentId ?? null,
          headMemberId: input.headMemberId ?? null,
          color: input.color ?? null,
          templateKey: input.templateKey ?? null,
        })
        .returning();
      if (!row) throw new Error('department insert failed');
      await createChannel(tx, { departmentId: row.id });
      if (row.headMemberId) await setHeadMembership(tx, row.id, row.headMemberId, null);
      await this.db.audit(tx, ctx, {
        action: 'department.created',
        subjectType: 'department',
        subjectId: row.id,
        after: snapshot(row),
      });
      return this.get(tx, row.id);
    });
  }

  update(ctx: TenantContext, id: string, input: UpdateDepartmentRequest): Promise<Department> {
    return this.db.run(ctx, async (tx) => {
      const before = await this.requireActive(tx, id);
      if (input.parentId) {
        await this.requireActive(tx, input.parentId);
        await assertNoCycle(tx, id, input.parentId);
      }
      if (input.headMemberId) await requireActiveMember(tx, input.headMemberId);

      const [after] = await tx
        .update(s.departments)
        .set({
          ...(input.name !== undefined && { name: input.name }),
          ...(input.parentId !== undefined && { parentId: input.parentId }),
          ...(input.headMemberId !== undefined && { headMemberId: input.headMemberId }),
          ...(input.color !== undefined && { color: input.color }),
        })
        .where(eq(s.departments.id, id))
        .returning();
      if (!after) throw notFound('Department');
      if (input.headMemberId !== undefined && input.headMemberId !== before.headMemberId) {
        await setHeadMembership(tx, id, input.headMemberId, before.headMemberId);
      }
      await this.db.audit(tx, ctx, {
        action: 'department.updated',
        subjectType: 'department',
        subjectId: id,
        before: snapshot(before),
        after: snapshot(after),
      });
      return this.get(tx, id);
    });
  }

  archive(ctx: TenantContext, id: string): Promise<void> {
    return this.db.run(ctx, async (tx) => {
      const before = await this.requireActive(tx, id);
      const [children] = await tx
        .select({ n: count() })
        .from(s.departments)
        .where(and(eq(s.departments.parentId, id), isNull(s.departments.archivedAt)));
      if ((children?.n ?? 0) > 0) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'conflict',
          'Archive or move sub-departments first',
        );
      }
      await tx
        .update(s.departments)
        .set({ archivedAt: new Date() })
        .where(eq(s.departments.id, id));
      await this.db.audit(tx, ctx, {
        action: 'department.archived',
        subjectType: 'department',
        subjectId: id,
        before: snapshot(before),
      });
    });
  }

  setOversight(ctx: TenantContext, id: string, input: SetOversightRequest): Promise<Department> {
    return this.db.run(ctx, async (tx) => {
      const before = await this.requireActive(tx, id);
      const resources = [...new Set(input.resources)].sort();
      await tx
        .update(s.departments)
        .set({ oversight: resources.length ? { resources } : null })
        .where(eq(s.departments.id, id));
      await this.db.audit(tx, ctx, {
        action: 'department.oversight_changed',
        subjectType: 'department',
        subjectId: id,
        before: { resources: before.oversight?.resources ?? [] },
        after: { resources },
      });
      return this.get(tx, id);
    });
  }

  private async get(tx: Tx, id: string): Promise<Department> {
    const [row] = await tx
      .select({
        department: s.departments,
        headName: s.members.displayName,
        memberCount: sql<number>`(
          select count(*)::int from ${s.departmentMemberships} dm where dm.department_id = ${id}
        )`,
      })
      .from(s.departments)
      .leftJoin(s.members, eq(s.members.id, s.departments.headMemberId))
      .where(eq(s.departments.id, id));
    if (!row) throw notFound('Department');
    return toDepartment(row.department, row.headName, row.memberCount);
  }

  private async requireActive(tx: Tx, id: string): Promise<DepartmentRow> {
    const [row] = await tx
      .select()
      .from(s.departments)
      .where(and(eq(s.departments.id, id), isNull(s.departments.archivedAt)));
    if (!row) throw notFound('Department');
    return row;
  }
}

function toDepartment(
  row: DepartmentRow,
  headName: string | null,
  memberCount: number,
): Department {
  return {
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    templateKey: row.templateKey,
    color: row.color,
    head: row.headMemberId && headName ? { id: row.headMemberId, displayName: headName } : null,
    memberCount,
    oversight: (row.oversight?.resources ?? []) as OversightResource[],
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

function snapshot(row: DepartmentRow) {
  return {
    name: row.name,
    parentId: row.parentId,
    headMemberId: row.headMemberId,
    color: row.color,
  };
}

export async function requireActiveMember(tx: Tx, memberId: string): Promise<void> {
  const [row] = await tx
    .select({ id: s.members.id })
    .from(s.members)
    .where(and(eq(s.members.id, memberId), eq(s.members.status, 'active')));
  if (!row) throw notFound('Member');
}

/** Moving `id` under `newParentId` must not make it its own ancestor. */
async function assertNoCycle(tx: Tx, id: string, newParentId: string): Promise<void> {
  const result = await tx.execute<{ id: string }>(sql`
    with recursive ancestors as (
      select id, parent_id from departments where id = ${newParentId}
      union all
      select d.id, d.parent_id from departments d join ancestors a on d.id = a.parent_id
    )
    select id from ancestors where id = ${id} limit 1`);
  if (result.rows.length > 0) {
    throw new ApiError(
      HttpStatus.BAD_REQUEST,
      'validation_failed',
      'A department cannot be moved under itself',
    );
  }
}

/** Keeps department_memberships in step with the department head. */
export async function setHeadMembership(
  tx: Tx,
  departmentId: string,
  newHeadId: string | null,
  oldHeadId: string | null,
): Promise<void> {
  if (oldHeadId && oldHeadId !== newHeadId) {
    await tx
      .update(s.departmentMemberships)
      .set({ deptRole: 'manager' })
      .where(
        and(
          eq(s.departmentMemberships.departmentId, departmentId),
          eq(s.departmentMemberships.memberId, oldHeadId),
          eq(s.departmentMemberships.deptRole, 'head'),
        ),
      );
  }
  if (newHeadId) {
    await tx
      .insert(s.departmentMemberships)
      .values({ departmentId, memberId: newHeadId, deptRole: 'head' })
      .onConflictDoUpdate({
        target: [
          s.departmentMemberships.tenantId,
          s.departmentMemberships.departmentId,
          s.departmentMemberships.memberId,
        ],
        set: { deptRole: 'head' },
      });
  }
}
