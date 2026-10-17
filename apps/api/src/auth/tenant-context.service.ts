import { Inject, Injectable } from '@nestjs/common';
import {
  listMemberships,
  schema as s,
  withTenant,
  type DbHandle,
  type Membership,
  type Tx,
} from '@madar/db';
import {
  OVERSIGHT_RESOURCES,
  type Actor,
  type DeptRole,
  type Grant,
  type OversightResource,
} from '@madar/shared';
import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm';

import { DB_HANDLE } from '../database/tokens.js';

export interface LoadedMember {
  memberId: string;
  displayName: string;
  title: string | null;
  status: 'active' | 'suspended' | 'left';
  actor: Actor;
}

@Injectable()
export class TenantContextService {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  memberships(userId: string): Promise<Membership[]> {
    return listMemberships(this.handle.db, userId);
  }

  async tenantStatus(tenantId: string) {
    const [tenant] = await this.handle.db
      .select({
        id: s.tenants.id,
        name: s.tenants.name,
        slug: s.tenants.slug,
        status: s.tenants.status,
        timezone: s.tenants.timezone,
      })
      .from(s.tenants)
      .where(eq(s.tenants.id, tenantId));
    return tenant ?? null;
  }

  /** The member row for `userId` in `tenantId` with roles, grants, departments and oversight. */
  async loadMember(tenantId: string, userId: string): Promise<LoadedMember | null> {
    return withTenant(this.handle.db, { tenantId, userId }, (tx) =>
      loadMemberInTx(tx, eq(s.members.userId, userId)),
    );
  }
}

/** A member with their actor (roles, grants, departments, oversight), inside a tenant transaction. */
export async function loadMemberInTx(tx: Tx, where: SQL): Promise<LoadedMember | null> {
  const [member] = await tx
    .select({
      id: s.members.id,
      displayName: s.members.displayName,
      title: s.members.title,
      status: s.members.status,
    })
    .from(s.members)
    .where(where);
  if (!member) return null;

  const roleRows = await tx
    .select({ id: s.roles.id, key: s.roles.key })
    .from(s.memberRoles)
    .innerJoin(s.roles, eq(s.roles.id, s.memberRoles.roleId))
    .where(eq(s.memberRoles.memberId, member.id));

  const grantRows = roleRows.length
    ? await tx
        .select({ permission: s.roleGrants.permission, scope: s.roleGrants.scope })
        .from(s.roleGrants)
        .where(
          inArray(
            s.roleGrants.roleId,
            roleRows.map((r) => r.id),
          ),
        )
    : [];

  const deptRows = await tx
    .select({
      id: s.departments.id,
      deptRole: s.departmentMemberships.deptRole,
      oversight: s.departments.oversight,
    })
    .from(s.departmentMemberships)
    .innerJoin(s.departments, eq(s.departments.id, s.departmentMemberships.departmentId))
    .where(and(eq(s.departmentMemberships.memberId, member.id), isNull(s.departments.archivedAt)));

  const oversight = new Set<OversightResource>();
  for (const d of deptRows) {
    for (const resource of d.oversight?.resources ?? []) {
      if ((OVERSIGHT_RESOURCES as readonly string[]).includes(resource)) {
        oversight.add(resource as OversightResource);
      }
    }
  }

  const actor: Actor = {
    memberId: member.id,
    roles: roleRows.map((r) => r.key),
    grants: grantRows.map((g) => [g.permission, g.scope] as unknown as Grant),
    departments: deptRows.map((d) => ({ id: d.id, deptRole: d.deptRole as DeptRole })),
    oversight: [...oversight],
  };
  return {
    memberId: member.id,
    displayName: member.displayName,
    title: member.title,
    status: member.status,
    actor,
  };
}
