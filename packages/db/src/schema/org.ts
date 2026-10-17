/**
 * Data plane: every table has tenant_id, forced RLS (see drizzle/*_rls.sql) and composite
 * (tenant_id, id) foreign keys so rows can never point at another tenant's rows.
 * Composite FKs never use SET NULL (it would null tenant_id too); members and departments are
 * never hard-deleted — members leave, departments are archived.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, id, tenantId, updatedAt } from './columns.js';
import { tenants, users } from './control.js';

export const memberStatus = pgEnum('member_status', ['active', 'suspended', 'left']);
export const deptRole = pgEnum('dept_role', ['head', 'manager', 'member', 'viewer']);
export const grantScope = pgEnum('grant_scope', ['tenant', 'department_tree', 'department', 'own']);

/** Which resources an oversight department may read across the whole tenant (ADR 0005). */
export interface DepartmentOversight {
  resources: string[];
}

export const members = pgTable(
  'members',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    displayName: text('display_name').notNull(),
    title: text('title'),
    managerId: uuid('manager_id'),
    status: memberStatus('status').notNull().default('active'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('members_tenant_id_id_key').on(t.tenantId, t.id),
    unique('members_tenant_user_key').on(t.tenantId, t.userId),
    index('members_tenant_manager_idx').on(t.tenantId, t.managerId),
    foreignKey({
      name: 'members_manager_fk',
      columns: [t.tenantId, t.managerId],
      foreignColumns: [t.tenantId, t.id],
    }).onDelete('restrict'),
  ],
);

export const departments = pgTable(
  'departments',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    templateKey: text('template_key'),
    headMemberId: uuid('head_member_id'),
    oversight: jsonb('oversight').$type<DepartmentOversight | null>(),
    color: text('color'),
    sort: text('sort').notNull().default('a0'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('departments_tenant_id_id_key').on(t.tenantId, t.id),
    index('departments_tenant_parent_idx').on(t.tenantId, t.parentId),
    foreignKey({
      name: 'departments_parent_fk',
      columns: [t.tenantId, t.parentId],
      foreignColumns: [t.tenantId, t.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'departments_head_fk',
      columns: [t.tenantId, t.headMemberId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
  ],
);

export const departmentMemberships = pgTable(
  'department_memberships',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    departmentId: uuid('department_id').notNull(),
    memberId: uuid('member_id').notNull(),
    deptRole: deptRole('dept_role').notNull().default('member'),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.departmentId, t.memberId] }),
    index('department_memberships_member_idx').on(t.tenantId, t.memberId),
    foreignKey({
      name: 'department_memberships_department_fk',
      columns: [t.tenantId, t.departmentId],
      foreignColumns: [departments.tenantId, departments.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'department_memberships_member_fk',
      columns: [t.tenantId, t.memberId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('cascade'),
  ],
);

export const roles = pgTable(
  'roles',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('roles_tenant_id_id_key').on(t.tenantId, t.id),
    unique('roles_tenant_key_key').on(t.tenantId, t.key),
  ],
);

export const roleGrants = pgTable(
  'role_grants',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id').notNull(),
    permission: text('permission').notNull(),
    scope: grantScope('scope').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.roleId, t.permission] }),
    foreignKey({
      name: 'role_grants_role_fk',
      columns: [t.tenantId, t.roleId],
      foreignColumns: [roles.tenantId, roles.id],
    }).onDelete('cascade'),
  ],
);

export const memberRoles = pgTable(
  'member_roles',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').notNull(),
    roleId: uuid('role_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.memberId, t.roleId] }),
    foreignKey({
      name: 'member_roles_member_fk',
      columns: [t.tenantId, t.memberId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'member_roles_role_fk',
      columns: [t.tenantId, t.roleId],
      foreignColumns: [roles.tenantId, roles.id],
    }).onDelete('cascade'),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    /** Position in the tenant's hash chain (1, 2, 3, …). */
    seq: bigint('seq', { mode: 'number' }).notNull(),
    actorUserId: uuid('actor_user_id'),
    actorMemberId: uuid('actor_member_id'),
    action: text('action').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    prevHash: text('prev_hash'),
    hash: text('hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    unique('audit_logs_tenant_seq_key').on(t.tenantId, t.seq),
    index('audit_logs_tenant_created_idx').on(t.tenantId, t.createdAt),
    index('audit_logs_tenant_subject_idx').on(t.tenantId, t.subjectType, t.subjectId),
  ],
);
