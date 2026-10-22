/**
 * «شاهد کار» (phase 2, step 12b; ADR 0021): an item pinned to a task as proof of the work. The
 * subject is polymorphic (`letter` now; `minutes` and `message` later), so the API checks it exists
 * in the same company. Unpinning is soft, so the trail stays.
 */
import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, id, tenantId } from './columns.js';
import { tenants } from './control.js';
import { members } from './org.js';
import { tasks } from './work.js';

export const evidenceKind = pgEnum('evidence_kind', ['letter', 'message']);

export const taskEvidence = pgTable(
  'task_evidence',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').notNull(),
    kind: evidenceKind('kind').notNull(),
    subjectId: uuid('subject_id').notNull(),
    pinnedBy: uuid('pinned_by').notNull(),
    createdAt: createdAt(),
    unpinnedAt: timestamp('unpinned_at', { withTimezone: true }),
    unpinnedBy: uuid('unpinned_by'),
  },
  (t) => [
    uniqueIndex('task_evidence_active_key')
      .on(t.tenantId, t.taskId, t.kind, t.subjectId)
      .where(sql`${t.unpinnedAt} is null`),
    index('task_evidence_subject_idx').on(t.tenantId, t.kind, t.subjectId),
    foreignKey({
      name: 'task_evidence_task_fk',
      columns: [t.tenantId, t.taskId],
      foreignColumns: [tasks.tenantId, tasks.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'task_evidence_pinned_by_fk',
      columns: [t.tenantId, t.pinnedBy],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'task_evidence_unpinned_by_fk',
      columns: [t.tenantId, t.unpinnedBy],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
  ],
);
