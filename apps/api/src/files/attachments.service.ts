import { createHash } from 'node:crypto';
import type { WriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

import { HttpStatus, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { emitEvent, recordActivity, schema as s, uuidv7, type Tx } from '@madar/db';
import {
  DEFAULT_FILE_SETTINGS,
  SIGNATURE_BYTES,
  fileSettings,
  fileTypeFor,
  sanitizeFileName,
  type Attachment,
  type FileSettings,
  type Upload,
} from '@madar/shared';
import busboy from 'busboy';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Request } from 'express';

import type { TenantContext } from '../common/context.js';
import { ApiError, forbidden, notFound } from '../common/errors.js';
import { TenantDb } from '../database/tenant-db.service.js';
import { visibleConversations } from '../chat/access.js';
import { visibleLetters } from '../letters/access.js';
import { pinnedToVisibleTask } from '../evidence/letter-provider.js';
import { canEditTask, visibleTasks } from '../work/access.js';
import { TasksService } from '../work/tasks.service.js';
import { attachmentRows, bindUploads, toAttachment, type AttachmentRow } from './attachments-db.js';
import { FILE_STORAGE, objectKeyFor, writeStream, type FileStorage } from './storage.js';

/** Uploads per member per minute (plan phase-2-step-11 §2). */
const UPLOADS_PER_MINUTE = 60;
/** Unattached uploads a member may hold at once. */
const MAX_PENDING_BYTES = 1024 * 1024 * 1024;

/** Temp files for uploads in progress: next to the storage when it is on disk (same file system). */
export function uploadTempDir(): string {
  return process.env.UPLOAD_TMP_DIR || join(tmpdir(), 'madar-uploads');
}

export async function loadFileSettings(tx: Tx, tenantId: string): Promise<FileSettings> {
  const [tenant] = await tx
    .select({ settings: s.tenants.settings })
    .from(s.tenants)
    .where(eq(s.tenants.id, tenantId));
  const parsed = fileSettings.safeParse(tenant?.settings?.files);
  return parsed.success ? parsed.data : DEFAULT_FILE_SETTINGS;
}

interface Received {
  tempPath: string;
  fileName: string;
  size: number;
  checksum: string;
  head: Uint8Array;
}

/**
 * Attachments (ADR 0019): uploads stream through the API into a temp file (counted, hashed,
 * checked by their first bytes), then into the file storage; downloads stream back after the
 * same visibility check as the task they belong to.
 */
@Injectable()
export class AttachmentsService implements OnModuleInit {
  private readonly recent = new Map<string, number[]>();

  constructor(
    private readonly db: TenantDb,
    private readonly tasks: TasksService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  /** Uploads cut off by a restart leave temp files; nothing else uses that folder. */
  async onModuleInit(): Promise<void> {
    await rm(uploadTempDir(), { recursive: true, force: true });
  }

  async upload(ctx: TenantContext, req: Request): Promise<Upload> {
    this.limitRate(ctx);
    const { maxSizeMb, pendingBytes } = await this.db.run(ctx, async (tx) => {
      const [pending] = await tx
        .select({ bytes: sql<number>`coalesce(sum(${s.attachments.size}), 0)::bigint` })
        .from(s.attachments)
        .where(
          and(
            eq(s.attachments.uploadedBy, ctx.memberId),
            eq(s.attachments.status, 'pending'),
            isNull(s.attachments.deletedAt),
          ),
        );
      return {
        ...(await loadFileSettings(tx, ctx.tenantId)),
        pendingBytes: Number(pending?.bytes ?? 0),
      };
    });
    // Uploads nobody attached yet wait up to a day; they may not fill the disk meanwhile.
    if (pendingBytes >= MAX_PENDING_BYTES) {
      throw new ApiError(
        HttpStatus.TOO_MANY_REQUESTS,
        'rate_limited',
        'Too many unattached uploads',
      );
    }
    const received = await this.receive(req, maxSizeMb * 1024 * 1024);
    try {
      const type = fileTypeFor(received.fileName, received.head);
      if (!type) {
        throw new ApiError(
          HttpStatus.UNSUPPORTED_MEDIA_TYPE,
          'file_type_not_allowed',
          'This kind of file is not accepted',
        );
      }
      const id = uuidv7();
      const objectKey = objectKeyFor(ctx.tenantId, id);
      await this.storage.put(objectKey, received.tempPath, received.size, type.mime);
      try {
        await this.db.run(ctx, (tx) =>
          tx.insert(s.attachments).values({
            id,
            uploadedBy: ctx.memberId,
            fileName: received.fileName,
            extension: type.extension,
            mime: type.mime,
            size: received.size,
            checksum: received.checksum,
            objectKey,
          }),
        );
      } catch (error) {
        await this.storage.delete(objectKey).catch(() => undefined);
        throw error;
      }
      return {
        id,
        fileName: received.fileName,
        size: received.size,
        mime: type.mime,
        kind: type.kind,
      };
    } finally {
      await rm(received.tempPath, { force: true });
    }
  }

  /**
   * Streams one multipart file into a temp file, stopping at `maxBytes`. Every way out (done,
   * too large, bad body, client gone) closes the file and settles once; failures remove it.
   */
  private async receive(req: Request, maxBytes: number): Promise<Received> {
    if (!req.headers['content-type']?.startsWith('multipart/form-data')) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'validation_failed',
        'Expected multipart/form-data',
      );
    }
    const dir = uploadTempDir();
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const tempPath = join(dir, uuidv7());
    const badBody = () =>
      new ApiError(HttpStatus.BAD_REQUEST, 'validation_failed', 'Bad multipart body');

    return new Promise<Received>((resolve, reject) => {
      let settled = false;
      let out: WriteStream | null = null;
      let file: Readable | null = null;
      let parser: busboy.Busboy;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        req.unpipe(parser);
        file?.destroy();
        out?.destroy();
        void rm(tempPath, { force: true });
        reject(error);
      };
      try {
        parser = busboy({
          headers: req.headers,
          defParamCharset: 'utf8',
          limits: { files: 1, fileSize: maxBytes, fields: 0, parts: 1 },
        });
      } catch {
        reject(badBody());
        return;
      }
      // The browser cancelled («لغو»), the connection dropped, or a proxy gave up.
      req.on('aborted', () => fail(badBody()));
      req.on('error', () => fail(badBody()));
      req.on('close', () => {
        if (!req.complete) fail(badBody());
      });
      parser.on('error', () => fail(badBody()));

      let got = false;
      parser.on('file', (_field, stream, info) => {
        got = true;
        file = stream;
        const hash = createHash('sha256');
        const head: Buffer[] = [];
        let headBytes = 0;
        let size = 0;
        const target = writeStream(tempPath);
        out = target;
        stream.on('data', (chunk: Buffer) => {
          size += chunk.length;
          hash.update(chunk);
          if (headBytes < SIGNATURE_BYTES) {
            head.push(chunk);
            headBytes += chunk.length;
          }
        });
        stream.on('limit', () =>
          fail(new ApiError(HttpStatus.PAYLOAD_TOO_LARGE, 'file_too_large', 'File too large')),
        );
        stream.on('error', fail);
        target.on('error', fail);
        target.on('finish', () => {
          if (settled) return;
          if (size === 0) {
            fail(new ApiError(HttpStatus.BAD_REQUEST, 'validation_failed', 'Empty file'));
            return;
          }
          settled = true;
          resolve({
            tempPath,
            // Browsers send " CR LF in a multipart name as %22 %0D %0A (HTML spec).
            fileName: sanitizeFileName((info.filename ?? '').replace(/%22/g, '"')),
            size,
            checksum: hash.digest('hex'),
            head: new Uint8Array(Buffer.concat(head).subarray(0, SIGNATURE_BYTES)),
          });
        });
        stream.pipe(target);
      });
      parser.on('close', () => {
        if (!got) fail(new ApiError(HttpStatus.BAD_REQUEST, 'validation_failed', 'No file'));
      });
      req.pipe(parser);
    });
  }

  private limitRate(ctx: TenantContext): void {
    const key = `${ctx.tenantId}:${ctx.memberId}`;
    const now = Date.now();
    // Forget people who have not uploaded for a minute, so the map stays small.
    for (const [other, list] of this.recent) {
      if (list.every((t) => now - t >= 60_000)) this.recent.delete(other);
    }
    const times = (this.recent.get(key) ?? []).filter((t) => now - t < 60_000);
    if (times.length >= UPLOADS_PER_MINUTE) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limited', 'Too many uploads');
    }
    times.push(now);
    this.recent.set(key, times);
  }

  /** Attaches the person's uploads to a task; anyone who sees the task may (like a comment). */
  attachToTask(ctx: TenantContext, taskId: string, uploadIds: string[]): Promise<Attachment[]> {
    return this.db.run(ctx, async (tx) => {
      await this.tasks.requireVisible(tx, ctx, taskId);
      const rows = await bindUploads(tx, ctx, uploadIds, { type: 'task', id: taskId });
      await recordActivity(tx, {
        subjectType: 'task',
        subjectId: taskId,
        actorId: ctx.memberId,
        verb: 'attachments_added',
        changes: { files: { from: null, to: rows.map((r) => r.fileName) } },
      });
      await emitEvent(tx, 'attachment.added', { taskId, count: rows.length }, ctx.memberId);
      return this.listIn(tx, ctx, taskId);
    });
  }

  list(ctx: TenantContext, taskId: string): Promise<Attachment[]> {
    return this.db.run(ctx, (tx) => this.listIn(tx, ctx, taskId));
  }

  /** The task's own files and those on its live comments, newest first. */
  private async listIn(tx: Tx, ctx: TenantContext, taskId: string): Promise<Attachment[]> {
    const task = await this.tasks.requireVisible(tx, ctx, taskId);
    const rows = await attachmentRows(
      tx,
      sql`((${s.attachments.subjectType} = 'task' and ${s.attachments.subjectId} = ${taskId}) or (${s.attachments.subjectType} = 'comment' and ${s.attachments.subjectId} in (select c.id from comments c where c.subject_type = 'task' and c.subject_id = ${taskId} and c.deleted_at is null)))`,
    );
    const editsTask = await this.editsTask(tx, ctx, task);
    return rows
      .map(({ row, uploaderName }) =>
        toAttachment(row, uploaderName, editsTask || row.uploadedBy === ctx.memberId),
      )
      .reverse();
  }

  /**
   * The bytes of one file, after checking the person may see what it is attached to. A fresh
   * upload opens only for its uploader.
   */
  open(ctx: TenantContext, id: string): Promise<{ row: AttachmentRow; stream: Readable }> {
    return this.db.run(ctx, async (tx) => {
      const row = await this.visible(tx, ctx, id);
      const stream = await this.storage.get(row.objectKey).catch(() => {
        throw notFound('Attachment');
      });
      return { row, stream };
    });
  }

  /** Soft delete (audited); the daily cleanup removes the bytes. */
  remove(ctx: TenantContext, id: string): Promise<void> {
    return this.db.run(ctx, async (tx) => {
      const row = await this.visible(tx, ctx, id);
      // A message's files go with the message (deleting the message removes them).
      if (row.subjectType === 'message') throw forbidden();
      if (row.subjectType === 'letter') {
        // A sent letter is permanent, files included; a draft's files are its sender's.
        const letter = await this.letterOf(tx, ctx, row, true);
        if (!letter || letter.sentAt || row.uploadedBy !== ctx.memberId) throw forbidden();
      }
      const taskId = await this.taskOf(tx, row);
      if (row.uploadedBy !== ctx.memberId) {
        const task = taskId ? await this.tasks.requireVisible(tx, ctx, taskId) : null;
        if (!task || !(await this.editsTask(tx, ctx, task))) throw forbidden();
      }
      await tx.update(s.attachments).set({ deletedAt: new Date() }).where(eq(s.attachments.id, id));
      await this.db.audit(tx, ctx, {
        action: 'attachment.deleted',
        subjectType: 'attachment',
        subjectId: id,
        // A draft letter's file names can be confidential; the log keeps only the size.
        before:
          row.subjectType === 'letter'
            ? { size: row.size, subject: row.subjectType }
            : { fileName: row.fileName, size: row.size, subject: row.subjectType, taskId },
      });
      if (taskId) {
        await recordActivity(tx, {
          subjectType: 'task',
          subjectId: taskId,
          actorId: ctx.memberId,
          verb: 'attachment_removed',
          changes: { files: { from: [row.fileName], to: null } },
        });
        await emitEvent(tx, 'attachment.removed', { taskId }, ctx.memberId);
      }
    });
  }

  private async visible(tx: Tx, ctx: TenantContext, id: string): Promise<AttachmentRow> {
    const [row] = await tx
      .select()
      .from(s.attachments)
      .where(and(eq(s.attachments.id, id), isNull(s.attachments.deletedAt)));
    if (!row) throw notFound('Attachment');
    if (row.status === 'pending') {
      if (row.uploadedBy !== ctx.memberId) throw notFound('Attachment');
      return row;
    }
    if (row.subjectType === 'letter') {
      // The people on the letter, or anyone who sees a task it is pinned to (ADR 0021).
      if (!(await this.letterOf(tx, ctx, row)) && !(await this.pinnedForViewer(tx, ctx, row))) {
        throw notFound('Attachment');
      }
      return row;
    }
    if (row.subjectType === 'message') {
      // Whoever reads the conversation now; a deleted message's files are gone (ADR 0022).
      if (!(await this.messageVisible(tx, ctx, row))) throw notFound('Attachment');
      return row;
    }
    const taskId = await this.taskOf(tx, row);
    if (!taskId) throw notFound('Attachment');
    await this.tasks.requireVisible(tx, ctx, taskId);
    return row;
  }

  private async messageVisible(tx: Tx, ctx: TenantContext, row: AttachmentRow) {
    if (!row.subjectId) return false;
    const [message] = await tx
      .select({ id: s.messages.id })
      .from(s.messages)
      .innerJoin(s.conversations, eq(s.conversations.id, s.messages.conversationId))
      .where(
        and(
          eq(s.messages.id, row.subjectId),
          isNull(s.messages.deletedAt),
          visibleConversations(ctx.memberId),
        ),
      );
    return Boolean(message);
  }

  /** The letter a file belongs to, when the person may open it (ADR 0020). */
  private async letterOf(tx: Tx, ctx: TenantContext, row: AttachmentRow, lock = false) {
    if (row.subjectType !== 'letter' || !row.subjectId) return null;
    const query = tx
      .select({ id: s.letters.id, sentAt: s.letters.sentAt })
      .from(s.letters)
      .where(
        and(
          eq(s.letters.id, row.subjectId),
          isNull(s.letters.deletedAt),
          visibleLetters(ctx.memberId),
        ),
      );
    // Locked when deleting, so a send running at the same time cannot slip in between.
    const [letter] = lock ? await query.for('update') : await query;
    return letter ?? null;
  }

  private async pinnedForViewer(tx: Tx, ctx: TenantContext, row: AttachmentRow) {
    if (!row.subjectId) return false;
    const result = await tx.execute<{ ok: boolean }>(
      sql`select ${pinnedToVisibleTask(row.subjectId, visibleTasks(ctx.actor))} as ok`,
    );
    return Boolean(result.rows[0]?.ok);
  }

  /** The task a file belongs to (directly, or through a live comment). */
  private async taskOf(tx: Tx, row: AttachmentRow): Promise<string | null> {
    if (row.subjectType === 'task') return row.subjectId;
    if (row.subjectType === 'comment' && row.subjectId) {
      const [comment] = await tx
        .select({ taskId: s.comments.subjectId })
        .from(s.comments)
        .where(
          and(
            eq(s.comments.id, row.subjectId),
            eq(s.comments.subjectType, 'task'),
            isNull(s.comments.deletedAt),
          ),
        );
      return comment?.taskId ?? null;
    }
    return null;
  }

  private async editsTask(
    tx: Tx,
    ctx: TenantContext,
    task: typeof s.tasks.$inferSelect,
  ): Promise<boolean> {
    const collaborators = await tx
      .select({ memberId: s.taskCollaborators.memberId })
      .from(s.taskCollaborators)
      .where(
        and(eq(s.taskCollaborators.taskId, task.id), eq(s.taskCollaborators.kind, 'collaborator')),
      );
    return canEditTask(ctx.actor, {
      ...task,
      collaboratorIds: collaborators.map((c) => c.memberId),
    });
  }
}
