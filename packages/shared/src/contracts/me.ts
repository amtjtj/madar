import { z } from 'zod';

import { PERMISSIONS, SCOPES } from '../permissions.js';

export const passwordSchema = z.string().min(10).max(128);

export const changePasswordRequest = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequest>;

export const setActiveTenantRequest = z.object({ tenantId: z.uuid() });
export type SetActiveTenantRequest = z.infer<typeof setActiveTenantRequest>;

export const meResponse = z.object({
  user: z.object({
    id: z.uuid(),
    name: z.string(),
    username: z.string().nullable(),
    twoFactorEnabled: z.boolean(),
  }),
  memberships: z.array(
    z.object({ tenantId: z.uuid(), tenantName: z.string(), tenantSlug: z.string() }),
  ),
  tenant: z
    .object({
      id: z.uuid(),
      name: z.string(),
      slug: z.string(),
      status: z.enum(['active', 'read_only', 'locked']),
      timezone: z.string(),
    })
    .nullable(),
  member: z
    .object({
      id: z.uuid(),
      displayName: z.string(),
      title: z.string().nullable(),
      roles: z.array(z.string()),
      departments: z.array(
        z.object({ id: z.uuid(), deptRole: z.enum(['head', 'manager', 'member', 'viewer']) }),
      ),
      permissions: z.partialRecord(z.enum(PERMISSIONS), z.enum(SCOPES)),
    })
    .nullable(),
  /** Steps the user must finish before using the app. */
  pending: z.object({
    passwordChange: z.boolean(),
    twoFactorSetup: z.boolean(),
    tenantSelection: z.boolean(),
  }),
});
export type MeResponse = z.infer<typeof meResponse>;
