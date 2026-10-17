import { randomUUID } from 'node:crypto';

import { createDb, type DbHandle } from '../client.js';
import { loadRootEnv } from '../env.js';
import * as s from '../schema/index.js';
import { uuidv7 } from '../schema/columns.js';
import { withTenant } from '../tenant.js';

loadRootEnv();

export const hasDatabase = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);

/** Connection as the application role (subject to RLS). */
export function appDb(): DbHandle {
  return createDb(process.env.APP_DATABASE_URL ?? '', { max: 4 });
}

/** Connection as the owner role (bypasses nothing in app code; used only to simulate tampering). */
export function ownerDb(): DbHandle {
  return createDb(process.env.DATABASE_URL ?? '', { max: 2 });
}

export interface TenantFixture {
  tenantId: string;
  userId: string;
  memberId: string;
  departmentId: string;
  roleId: string;
}

/** Creates a tenant with one row in every data-plane table, through the app role only. */
export async function createTenantFixture(handle: DbHandle, label = 't'): Promise<TenantFixture> {
  const suffix = randomUUID().slice(0, 8);
  const [tenant] = await handle.db
    .insert(s.tenants)
    .values({ name: `${label}-${suffix}`, slug: `${label}-${suffix}` })
    .returning({ id: s.tenants.id });
  const [user] = await handle.db
    .insert(s.users)
    .values({
      name: `user ${suffix}`,
      email: `${uuidv7()}@users.madar.invalid`,
      username: `${label}.${suffix}`,
    })
    .returning({ id: s.users.id });
  if (!tenant || !user) throw new Error('fixture insert failed');

  return withTenant(handle.db, { tenantId: tenant.id, userId: user.id }, async (tx) => {
    const [member] = await tx
      .insert(s.members)
      .values({ userId: user.id, displayName: `member ${suffix}` })
      .returning({ id: s.members.id });
    const [department] = await tx
      .insert(s.departments)
      .values({ name: `dept ${suffix}`, headMemberId: member?.id })
      .returning({ id: s.departments.id });
    const [role] = await tx
      .insert(s.roles)
      .values({ key: 'member', name: 'Member', isSystem: true })
      .returning({ id: s.roles.id });
    if (!member || !department || !role) throw new Error('fixture insert failed');
    await tx.insert(s.departmentMemberships).values({
      departmentId: department.id,
      memberId: member.id,
      deptRole: 'head',
      isPrimary: true,
    });
    await tx
      .insert(s.roleGrants)
      .values({ roleId: role.id, permission: 'task.read', scope: 'department' });
    await tx.insert(s.memberRoles).values({ memberId: member.id, roleId: role.id });
    return {
      tenantId: tenant.id,
      userId: user.id,
      memberId: member.id,
      departmentId: department.id,
      roleId: role.id,
    };
  });
}
