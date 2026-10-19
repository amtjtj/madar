import { schema as s, type Tx } from '@madar/db';
import {
  opensInline,
  type Attachment,
  type AttachmentKind,
  type AttachmentSubject,
  FILE_TYPES,
} from '@madar/shared';
import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm';

import type { TenantContext } from '../common/context.js';
import { notFound } from '../common/errors.js';

export type AttachmentRow = typeof s.attachments.$inferSelect;

export function kindOf(row: Pick<AttachmentRow, 'extension'>): AttachmentKind {
  return FILE_TYPES[row.extension]?.kind ?? 'other';
}

export function isInline(row: Pick<AttachmentRow, 'extension'>): boolean {
  return opensInline(kindOf(row));
}

export function toAttachment(
  row: AttachmentRow,
  uploaderName: string,
  canDelete: boolean,
): Attachment {
  return {
    id: row.id,
    fileName: row.fileName,
    size: row.size,
    mime: row.mime,
    kind: kindOf(row),
    uploadedBy: { id: row.uploadedBy, displayName: uploaderName },
    createdAt: row.createdAt.toISOString(),
    subject: row.subjectType && row.subjectId ? { type: row.subjectType, id: row.subjectId } : null,
    can: { delete: canDelete },
  };
}

/** Live attachments matching `where`, with their uploader's name, oldest first. */
export function attachmentRows(tx: Tx, where: SQL | undefined) {
  return tx
    .select({ row: s.attachments, uploaderName: s.members.displayName })
    .from(s.attachments)
    .innerJoin(s.members, eq(s.members.id, s.attachments.uploadedBy))
    .where(and(eq(s.attachments.status, 'ready'), isNull(s.attachments.deletedAt), where))
    .orderBy(s.attachments.createdAt);
}

/**
 * Attaches the person's own fresh uploads to a subject (ADR 0019): someone else's upload, or one
 * already attached, is "not found". Returns the attached rows.
 */
export async function bindUploads(
  tx: Tx,
  ctx: TenantContext,
  uploadIds: readonly string[],
  subject: { type: AttachmentSubject; id: string },
): Promise<AttachmentRow[]> {
  const ids = [...new Set(uploadIds)];
  if (ids.length === 0) return [];
  const rows = await tx
    .update(s.attachments)
    .set({
      status: 'ready',
      subjectType: subject.type,
      subjectId: subject.id,
      attachedAt: new Date(),
    })
    .where(
      and(
        inArray(s.attachments.id, ids),
        eq(s.attachments.uploadedBy, ctx.memberId),
        eq(s.attachments.status, 'pending'),
        isNull(s.attachments.deletedAt),
      ),
    )
    .returning();
  if (rows.length !== ids.length) throw notFound('Upload');
  // In the order the person picked them (UPDATE … RETURNING has none).
  return rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
}
