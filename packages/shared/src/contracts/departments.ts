import { z } from 'zod';

import { OVERSIGHT_RESOURCES } from '../permissions.js';

export const departmentNameSchema = z.string().trim().min(2).max(60);

export const department = z.object({
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  name: z.string(),
  templateKey: z.string().nullable(),
  color: z.string().nullable(),
  head: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
  memberCount: z.number().int(),
  oversight: z.array(z.enum(OVERSIGHT_RESOURCES)),
  archivedAt: z.iso.datetime().nullable(),
});
export type Department = z.infer<typeof department>;

export const createDepartmentRequest = z.object({
  name: departmentNameSchema,
  parentId: z.uuid().nullable().optional(),
  headMemberId: z.uuid().nullable().optional(),
  color: z.string().max(20).nullable().optional(),
  templateKey: z.string().max(40).nullable().optional(),
});
export type CreateDepartmentRequest = z.infer<typeof createDepartmentRequest>;

export const updateDepartmentRequest = createDepartmentRequest.partial();
export type UpdateDepartmentRequest = z.infer<typeof updateDepartmentRequest>;

export const setOversightRequest = z.object({
  resources: z.array(z.enum(OVERSIGHT_RESOURCES)).max(OVERSIGHT_RESOURCES.length),
});
export type SetOversightRequest = z.infer<typeof setOversightRequest>;
