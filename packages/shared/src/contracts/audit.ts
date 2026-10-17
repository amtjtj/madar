import { z } from 'zod';

export const auditLogEntry = z.object({
  id: z.uuid(),
  seq: z.number().int(),
  action: z.string(),
  subjectType: z.string(),
  subjectId: z.uuid().nullable(),
  actor: z.object({ memberId: z.uuid(), displayName: z.string() }).nullable(),
  before: z.unknown(),
  after: z.unknown(),
  createdAt: z.iso.datetime(),
});
export type AuditLogEntry = z.infer<typeof auditLogEntry>;

export const auditLogQuery = z.object({
  /** Return entries with seq lower than this (pagination). */
  beforeSeq: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AuditLogQuery = z.infer<typeof auditLogQuery>;
