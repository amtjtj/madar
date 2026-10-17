import { z } from 'zod';

import { SYSTEM_ROLES } from '../permissions.js';
import { displayNameSchema, usernameSchema } from './common.js';

export const deptRoleSchema = z.enum(['head', 'manager', 'member', 'viewer']);

export const memberDepartment = z.object({
  departmentId: z.uuid(),
  deptRole: deptRoleSchema,
  isPrimary: z.boolean(),
});
export type MemberDepartment = z.infer<typeof memberDepartment>;

export const member = z.object({
  id: z.uuid(),
  displayName: z.string(),
  title: z.string().nullable(),
  status: z.enum(['active', 'suspended', 'left']),
  managerId: z.uuid().nullable(),
  departments: z.array(memberDepartment.extend({ name: z.string() })),
  /** Present only for viewers allowed to manage members. */
  account: z
    .object({
      username: z.string().nullable(),
      roles: z.array(z.string()),
      twoFactorEnabled: z.boolean(),
      mustChangePassword: z.boolean(),
    })
    .optional(),
});
export type Member = z.infer<typeof member>;

const titleSchema = z.string().trim().max(80).nullable().optional();

export const createMemberRequest = z.object({
  displayName: displayNameSchema,
  username: usernameSchema,
  title: titleSchema,
  roles: z.array(z.enum(SYSTEM_ROLES)).min(1).max(SYSTEM_ROLES.length),
  departments: z.array(memberDepartment).max(10).default([]),
  managerId: z.uuid().nullable().optional(),
});
export type CreateMemberRequest = z.input<typeof createMemberRequest>;

export const createMemberResponse = z.object({
  member,
  /** Shown once to the admin, who hands it to the employee. */
  temporaryPassword: z.string(),
});
export type CreateMemberResponse = z.infer<typeof createMemberResponse>;

export const updateMemberRequest = z.object({
  displayName: displayNameSchema.optional(),
  title: titleSchema,
  managerId: z.uuid().nullable().optional(),
  roles: z.array(z.enum(SYSTEM_ROLES)).min(1).max(SYSTEM_ROLES.length).optional(),
  departments: z.array(memberDepartment).max(10).optional(),
});
export type UpdateMemberRequest = z.infer<typeof updateMemberRequest>;

export const temporaryPasswordResponse = z.object({ temporaryPassword: z.string() });
export type TemporaryPasswordResponse = z.infer<typeof temporaryPasswordResponse>;

export const orgChartNode = z.object({
  id: z.uuid(),
  displayName: z.string(),
  title: z.string().nullable(),
  managerId: z.uuid().nullable(),
  primaryDepartment: z.object({ id: z.uuid(), name: z.string() }).nullable(),
});
export type OrgChartNode = z.infer<typeof orgChartNode>;
