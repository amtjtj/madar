/**
 * Files (phase 2, step 11; ADR 0019). One table for every kind of attachment: a fresh upload has
 * no subject until it is attached (task, comment; later letter, message, minutes). The bytes live
 * in the file storage under `tenants/{tenantId}/…`; this row is the only way to reach them.
 */
import {
  bigint,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, id, tenantId } from './columns.js';
import { tenants } from './control.js';
import { members } from './org.js';

export const attachmentSubject = pgEnum('attachment_subject', [
  'task',
  'comment',
  'letter',
  'message',
]);
export const attachmentStatus = pgEnum('attachment_status', ['pending', 'ready']);

export const attachments = pgTable(
  'attachments',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    /** Null while it is a fresh upload; the API checks the subject exists in the same company. */
    subjectType: attachmentSubject('subject_type'),
    subjectId: uuid('subject_id'),
    uploadedBy: uuid('uploaded_by').notNull(),
    /** Display name only (sanitized); never part of a storage path. */
    fileName: text('file_name').notNull(),
    extension: text('extension').notNull(),
    mime: text('mime').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    /** SHA-256, hex. */
    checksum: text('checksum').notNull(),
    objectKey: text('object_key').notNull(),
    status: attachmentStatus('status').notNull().default('pending'),
    createdAt: createdAt(),
    attachedAt: timestamp('attached_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /** Removed from the file storage by the daily cleanup. */
    purgedAt: timestamp('purged_at', { withTimezone: true }),
  },
  (t) => [
    unique('attachments_tenant_id_id_key').on(t.tenantId, t.id),
    unique('attachments_object_key_key').on(t.objectKey),
    index('attachments_tenant_subject_idx').on(t.tenantId, t.subjectType, t.subjectId),
    index('attachments_tenant_status_idx').on(t.tenantId, t.status, t.createdAt),
    foreignKey({
      name: 'attachments_uploaded_by_fk',
      columns: [t.tenantId, t.uploadedBy],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
  ],
);
