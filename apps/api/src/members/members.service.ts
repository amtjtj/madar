import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { schema as s, type Tx } from '@madar/db';
import {
  can,
  type AuditLogEntry,
  type AuditLogQuery,
  type CreateMemberRequest,
  type CreateMemberResponse,
  type Member,
  type MemberDepartment,
  type OrgChartNode,
  type SystemRole,
  type UpdateMemberRequest,
} from '@madar/shared';
import { and, desc, eq, ilike, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';

import { AccountsService, generateTemporaryPassword } from '../auth/accounts.service.js';
import type { TenantContext } from '../common/context.js';
import { ApiError, forbidden, notFound } from '../common/errors.js';
import { TenantDb } from '../database/tenant-db.service.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import { setHeadMembership } from '../departments/departments.service.js';
import { assertCanAssignRoles, assertCanManage } from './authority.js';

export interface ListMembersQuery {
  q?: string;
  departmentId?: string;
  includeInactive?: boolean;
}

@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(
    private readonly db: TenantDb,
    private readonly accounts: AccountsService,
    private readonly realtime: RealtimePublisher,
  ) {}

  list(ctx: TenantContext, query: ListMembersQuery = {}): Promise<Member[]> {
    return this.db.run(ctx, async (tx) => {
      const filters = [];
      if (!query.includeInactive) filters.push(eq(s.members.status, 'active'));
      if (query.q) {
        const term = `%${query.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
        filters.push(or(ilike(s.members.displayName, term), ilike(s.members.title, term)));
      }
      if (query.departmentId) {
        filters.push(
          inArray(
            s.members.id,
            tx
              .select({ id: s.departmentMemberships.memberId })
              .from(s.departmentMemberships)
              .where(eq(s.departmentMemberships.departmentId, query.departmentId)),
          ),
        );
      }
      const rows = await tx
        .select()
        .from(s.members)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(s.members.displayName);
      return this.hydrate(tx, ctx, rows);
    });
  }

  get(ctx: TenantContext, id: string): Promise<Member> {
    return this.db.run(ctx, (tx) => this.getIn(tx, ctx, id));
  }

  async create(ctx: TenantContext, input: CreateMemberRequest): Promise<CreateMemberResponse> {
    const roles = [...new Set(input.roles)] as SystemRole[];
    if (roles.some((r) => r !== 'member') && !can(ctx.actor, 'member.change_role')) {
      throw forbidden('Assigning roles requires member.change_role');
    }
    assertCanAssignRoles(ctx.actor, [], roles);
    if (await this.accounts.findByUsername(input.username)) {
      throw new ApiError(HttpStatus.CONFLICT, 'username_taken', 'Username is taken');
    }

    const temporaryPassword = generateTemporaryPassword();
    const user = await this.accounts.createUser({
      name: input.displayName,
      username: input.username,
      password: temporaryPassword,
      mustChangePassword: true,
    });

    try {
      const member = await this.db.run(ctx, async (tx) => {
        if (input.managerId) await requireMember(tx, input.managerId);
        const [row] = await tx
          .insert(s.members)
          .values({
            userId: user.id,
            displayName: input.displayName,
            title: input.title ?? null,
            managerId: input.managerId ?? null,
          })
          .returning({ id: s.members.id });
        if (!row) throw new Error('member insert failed');
        await setRoles(tx, row.id, roles);
        await setDepartments(tx, row.id, input.departments ?? []);
        await this.db.audit(tx, ctx, {
          action: 'member.created',
          subjectType: 'member',
          subjectId: row.id,
          after: {
            displayName: input.displayName,
            username: input.username,
            title: input.title ?? null,
            managerId: input.managerId ?? null,
          },
        });
        await this.db.audit(tx, ctx, {
          action: 'member.roles_changed',
          subjectType: 'member',
          subjectId: row.id,
          before: { roles: [] },
          after: { roles },
        });
        if (input.departments?.length) {
          await this.db.audit(tx, ctx, {
            action: 'member.departments_changed',
            subjectType: 'member',
            subjectId: row.id,
            before: { departments: [] },
            after: { departments: input.departments },
          });
        }
        return this.getIn(tx, ctx, row.id);
      });
      return { member, temporaryPassword };
    } catch (error) {
      await this.accounts.deleteUser(user.id).catch((e: unknown) => this.logger.error(e));
      throw error;
    }
  }

  update(ctx: TenantContext, id: string, input: UpdateMemberRequest): Promise<Member> {
    return this.db.run(ctx, async (tx) => {
      const before = await requireMember(tx, id);
      const beforeRoles = await rolesOf(tx, id);
      if (id !== ctx.memberId) assertCanManage(ctx.actor, beforeRoles);

      const profile: Partial<typeof s.members.$inferInsert> = {};
      if (input.displayName !== undefined) profile.displayName = input.displayName;
      if (input.title !== undefined) profile.title = input.title;
      if (input.managerId !== undefined) {
        if (input.managerId) {
          if (input.managerId === id) throw badRequest('A member cannot report to themselves');
          await requireMember(tx, input.managerId);
          await assertNoManagerCycle(tx, id, input.managerId);
        }
        profile.managerId = input.managerId;
      }
      if (Object.keys(profile).length) {
        const [after] = await tx
          .update(s.members)
          .set(profile)
          .where(eq(s.members.id, id))
          .returning();
        await this.db.audit(tx, ctx, {
          action: 'member.updated',
          subjectType: 'member',
          subjectId: id,
          before: profileSnapshot(before),
          after: after ? profileSnapshot(after) : null,
        });
      }

      if (input.roles) {
        if (!can(ctx.actor, 'member.change_role'))
          throw forbidden('Changing roles requires member.change_role');
        const roles = [...new Set(input.roles)] as SystemRole[];
        assertCanAssignRoles(ctx.actor, beforeRoles, roles);
        if (beforeRoles.includes('owner') && !roles.includes('owner'))
          await assertNotLastOwner(tx, id);
        await setRoles(tx, id, roles);
        await this.db.audit(tx, ctx, {
          action: 'member.roles_changed',
          subjectType: 'member',
          subjectId: id,
          before: { roles: beforeRoles },
          after: { roles },
        });
      }

      if (input.departments) {
        const beforeDepartments = await departmentsOf(tx, id);
        await setDepartments(tx, id, input.departments);
        await this.db.audit(tx, ctx, {
          action: 'member.departments_changed',
          subjectType: 'member',
          subjectId: id,
          before: { departments: beforeDepartments },
          after: { departments: input.departments },
        });
      }
      return this.getIn(tx, ctx, id);
    });
  }

  /** New temporary password; the member must change it at next sign-in. All sessions end. */
  async resetPassword(ctx: TenantContext, id: string): Promise<{ temporaryPassword: string }> {
    const userId = await this.guardCredentialChange(ctx, id);
    const temporaryPassword = generateTemporaryPassword();
    await this.accounts.setPassword(userId, temporaryPassword, true);
    await this.db.run(ctx, (tx) =>
      this.db.audit(tx, ctx, {
        action: 'member.password_reset',
        subjectType: 'member',
        subjectId: id,
      }),
    );
    return { temporaryPassword };
  }

  /** Removes the member's authenticator (lost phone); they set it up again at next sign-in. */
  async resetTwoFactor(ctx: TenantContext, id: string): Promise<void> {
    const userId = await this.guardCredentialChange(ctx, id);
    await this.accounts.resetTwoFactor(userId);
    await this.db.run(ctx, (tx) =>
      this.db.audit(tx, ctx, {
        action: 'member.two_factor_reset',
        subjectType: 'member',
        subjectId: id,
      }),
    );
  }

  async setStatus(ctx: TenantContext, id: string, status: 'active' | 'suspended'): Promise<Member> {
    if (id === ctx.memberId) throw forbidden('You cannot change your own status');
    const result = await this.db.run(ctx, async (tx) => {
      const before = await requireMember(tx, id);
      const roles = await rolesOf(tx, id);
      assertCanManage(ctx.actor, roles);
      if (status === 'suspended' && roles.includes('owner')) await assertNotLastOwner(tx, id);
      await tx.update(s.members).set({ status }).where(eq(s.members.id, id));
      await this.db.audit(tx, ctx, {
        action: status === 'suspended' ? 'member.suspended' : 'member.activated',
        subjectType: 'member',
        subjectId: id,
        before: { status: before.status },
        after: { status },
      });
      return { member: await this.getIn(tx, ctx, id), userId: before.userId };
    });
    if (status === 'suspended') {
      await this.accounts.revokeSessions(result.userId);
      await this.realtime.disconnectMember(ctx.tenantId, id);
    }
    return result.member;
  }

  orgChart(ctx: TenantContext): Promise<OrgChartNode[]> {
    return this.db.run(ctx, async (tx) => {
      const rows = await tx
        .select({
          id: s.members.id,
          displayName: s.members.displayName,
          title: s.members.title,
          managerId: s.members.managerId,
          departmentId: s.departments.id,
          departmentName: s.departments.name,
        })
        .from(s.members)
        .leftJoin(
          s.departmentMemberships,
          and(
            eq(s.departmentMemberships.memberId, s.members.id),
            eq(s.departmentMemberships.isPrimary, true),
          ),
        )
        .leftJoin(
          s.departments,
          and(
            eq(s.departments.id, s.departmentMemberships.departmentId),
            isNull(s.departments.archivedAt),
          ),
        )
        .where(eq(s.members.status, 'active'))
        .orderBy(s.members.displayName);
      const seen = new Set<string>();
      return rows
        .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
        .map((r) => ({
          id: r.id,
          displayName: r.displayName,
          title: r.title,
          managerId: r.managerId,
          primaryDepartment:
            r.departmentId && r.departmentName
              ? { id: r.departmentId, name: r.departmentName }
              : null,
        }));
    });
  }

  auditLog(ctx: TenantContext, query: AuditLogQuery): Promise<AuditLogEntry[]> {
    return this.db.run(ctx, async (tx) => {
      const rows = await tx
        .select({ log: s.auditLogs, actorName: s.members.displayName })
        .from(s.auditLogs)
        .leftJoin(s.members, eq(s.members.id, s.auditLogs.actorMemberId))
        .where(query.beforeSeq ? lt(s.auditLogs.seq, query.beforeSeq) : undefined)
        .orderBy(desc(s.auditLogs.seq))
        .limit(query.limit);
      return rows.map(({ log, actorName }) => ({
        id: log.id,
        seq: log.seq,
        action: log.action,
        subjectType: log.subjectType,
        subjectId: log.subjectId,
        actor:
          log.actorMemberId && actorName
            ? { memberId: log.actorMemberId, displayName: actorName }
            : null,
        before: log.before ?? null,
        after: log.after ?? null,
        createdAt: log.createdAt.toISOString(),
      }));
    });
  }

  private async guardCredentialChange(ctx: TenantContext, id: string): Promise<string> {
    if (id === ctx.memberId) throw forbidden('Use your own account settings instead');
    return this.db.run(ctx, async (tx) => {
      const target = await requireMember(tx, id);
      assertCanManage(ctx.actor, await rolesOf(tx, id));
      return target.userId;
    });
  }

  private async getIn(tx: Tx, ctx: TenantContext, id: string): Promise<Member> {
    const [row] = await tx.select().from(s.members).where(eq(s.members.id, id));
    if (!row) throw notFound('Member');
    const [member] = await this.hydrate(tx, ctx, [row]);
    if (!member) throw notFound('Member');
    return member;
  }

  /** Adds departments, and account details for viewers who manage members. */
  private async hydrate(
    tx: Tx,
    ctx: TenantContext,
    rows: Array<typeof s.members.$inferSelect>,
  ): Promise<Member[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const memberships = await tx
      .select({
        memberId: s.departmentMemberships.memberId,
        departmentId: s.departmentMemberships.departmentId,
        deptRole: s.departmentMemberships.deptRole,
        isPrimary: s.departmentMemberships.isPrimary,
        name: s.departments.name,
      })
      .from(s.departmentMemberships)
      .innerJoin(s.departments, eq(s.departments.id, s.departmentMemberships.departmentId))
      .where(and(inArray(s.departmentMemberships.memberId, ids), isNull(s.departments.archivedAt)));

    const showAccount = can(ctx.actor, 'member.update');
    const accounts = new Map<string, NonNullable<Member['account']>>();
    if (showAccount) {
      const roleRows = await tx
        .select({ memberId: s.memberRoles.memberId, key: s.roles.key })
        .from(s.memberRoles)
        .innerJoin(s.roles, eq(s.roles.id, s.memberRoles.roleId))
        .where(inArray(s.memberRoles.memberId, ids));
      const users = await tx
        .select({
          id: s.users.id,
          username: s.users.username,
          twoFactorEnabled: s.users.twoFactorEnabled,
          mustChangePassword: s.users.mustChangePassword,
        })
        .from(s.users)
        .where(
          inArray(
            s.users.id,
            rows.map((r) => r.userId),
          ),
        );
      const userById = new Map(users.map((u) => [u.id, u]));
      for (const r of rows) {
        const u = userById.get(r.userId);
        accounts.set(r.id, {
          username: u?.username ?? null,
          roles: roleRows.filter((x) => x.memberId === r.id).map((x) => x.key),
          twoFactorEnabled: u?.twoFactorEnabled ?? false,
          mustChangePassword: u?.mustChangePassword ?? false,
        });
      }
    }

    return rows.map((r) => ({
      id: r.id,
      displayName: r.displayName,
      title: r.title,
      status: r.status,
      managerId: r.managerId,
      departments: memberships
        .filter((m) => m.memberId === r.id)
        .map((m) => ({
          departmentId: m.departmentId,
          deptRole: m.deptRole,
          isPrimary: m.isPrimary,
          name: m.name,
        })),
      ...(showAccount ? { account: accounts.get(r.id) } : {}),
    }));
  }
}

function badRequest(message: string) {
  return new ApiError(HttpStatus.BAD_REQUEST, 'validation_failed', message);
}

function profileSnapshot(row: typeof s.members.$inferSelect) {
  return { displayName: row.displayName, title: row.title, managerId: row.managerId };
}

async function requireMember(tx: Tx, id: string) {
  const [row] = await tx.select().from(s.members).where(eq(s.members.id, id));
  if (!row) throw notFound('Member');
  return row;
}

async function rolesOf(tx: Tx, memberId: string): Promise<string[]> {
  const rows = await tx
    .select({ key: s.roles.key })
    .from(s.memberRoles)
    .innerJoin(s.roles, eq(s.roles.id, s.memberRoles.roleId))
    .where(eq(s.memberRoles.memberId, memberId));
  return rows.map((r) => r.key);
}

async function departmentsOf(tx: Tx, memberId: string): Promise<MemberDepartment[]> {
  return tx
    .select({
      departmentId: s.departmentMemberships.departmentId,
      deptRole: s.departmentMemberships.deptRole,
      isPrimary: s.departmentMemberships.isPrimary,
    })
    .from(s.departmentMemberships)
    .where(eq(s.departmentMemberships.memberId, memberId));
}

async function setRoles(tx: Tx, memberId: string, roles: SystemRole[]): Promise<void> {
  const roleRows = await tx
    .select({ id: s.roles.id, key: s.roles.key })
    .from(s.roles)
    .where(inArray(s.roles.key, roles));
  if (roleRows.length !== roles.length) throw badRequest('Unknown role');
  await tx.delete(s.memberRoles).where(eq(s.memberRoles.memberId, memberId));
  await tx.insert(s.memberRoles).values(roleRows.map((r) => ({ memberId, roleId: r.id })));
}

/** Replaces the member's departments; keeps department heads consistent; one primary at most. */
async function setDepartments(tx: Tx, memberId: string, input: MemberDepartment[]): Promise<void> {
  const unique = new Map(input.map((d) => [d.departmentId, d]));
  const departments = [...unique.values()];
  if (departments.filter((d) => d.isPrimary).length > 1)
    throw badRequest('Only one primary department');
  if (departments.length) {
    const found = await tx
      .select({ id: s.departments.id })
      .from(s.departments)
      .where(
        and(
          inArray(
            s.departments.id,
            departments.map((d) => d.departmentId),
          ),
          isNull(s.departments.archivedAt),
        ),
      );
    if (found.length !== departments.length) throw notFound('Department');
  }

  // Departments this member headed but no longer heads lose their head.
  const headed = await tx
    .select({ id: s.departments.id })
    .from(s.departments)
    .where(eq(s.departments.headMemberId, memberId));
  for (const { id } of headed) {
    const stillHead = departments.some((d) => d.departmentId === id && d.deptRole === 'head');
    if (!stillHead)
      await tx.update(s.departments).set({ headMemberId: null }).where(eq(s.departments.id, id));
  }

  await tx.delete(s.departmentMemberships).where(eq(s.departmentMemberships.memberId, memberId));
  if (departments.length) {
    await tx.insert(s.departmentMemberships).values(
      departments.map((d) => ({
        departmentId: d.departmentId,
        memberId,
        deptRole: d.deptRole,
        isPrimary: d.isPrimary,
      })),
    );
  }
  for (const d of departments.filter((x) => x.deptRole === 'head')) {
    const [dept] = await tx
      .select({ headMemberId: s.departments.headMemberId })
      .from(s.departments)
      .where(eq(s.departments.id, d.departmentId));
    if (dept?.headMemberId !== memberId) {
      await tx
        .update(s.departments)
        .set({ headMemberId: memberId })
        .where(eq(s.departments.id, d.departmentId));
      await setHeadMembership(tx, d.departmentId, memberId, dept?.headMemberId ?? null);
    }
  }
}

async function assertNoManagerCycle(tx: Tx, memberId: string, managerId: string): Promise<void> {
  const result = await tx.execute<{ id: string }>(sql`
    with recursive chain as (
      select id, manager_id from members where id = ${managerId}
      union all
      select m.id, m.manager_id from members m join chain c on m.id = c.manager_id
    )
    select id from chain where id = ${memberId} limit 1`);
  if (result.rows.length) throw badRequest('This would create a reporting loop');
}

async function assertNotLastOwner(tx: Tx, memberId: string): Promise<void> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(s.memberRoles)
    .innerJoin(s.roles, eq(s.roles.id, s.memberRoles.roleId))
    .innerJoin(s.members, eq(s.members.id, s.memberRoles.memberId))
    .where(
      and(eq(s.roles.key, 'owner'), eq(s.members.status, 'active'), ne(s.members.id, memberId)),
    );
  if ((row?.n ?? 0) === 0) {
    throw new ApiError(
      HttpStatus.CONFLICT,
      'conflict',
      'The company must keep at least one active owner',
    );
  }
}
