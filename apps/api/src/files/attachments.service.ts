import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
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
import { canEditTask } from '../work/access.js';
import { TasksService } from '../work/tasks.service.js';
import { attachmentRows, bindUploads, toAttachment, type AttachmentRow } from './attachments-db.js';
import { FILE_STORAGE, objectKeyFor, writeStream, type FileStorage } from './storage.js';

/** Uploads per member per minute (plan phase-2-step-11 §2). */
const UPLOADS_PER_MINUTE = 60;

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
export class AttachmentsService {
  private readonly recent = new Map<string, number[]>();

  constructor(
    private readonly db: TenantDb,
    private readonly tasks: TasksService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  async upload(ctx: TenantContext, req: Request): Promise<Upload> {
    this.limitRate(ctx);
    const { maxSizeMb } = await this.db.run(ctx, (tx) => loadFileSettings(tx, ctx.tenantId));
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

  /** Streams one multipart file into a temp file, stopping at `maxBytes`. */
  private async receive(req: Request, maxBytes: number): Promise<Received> {
    if (!req.headers['content-type']?.startsWith('multipart/form-data')) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'validation_failed',
        'Expected multipart/form-data',
      );
    }
    const dir = join(tmpdir(), 'madar-uploads');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const tempPath = join(dir, uuidv7());
    return new Promise<Received>((resolve, reject) => {
      let parser: busboy.Busboy;
      try {
        parser = busboy({
          headers: req.headers,
          defParamCharset: 'utf8',
          limits: { files: 1, fileSize: maxBytes, fields: 0, parts: 1 },
        });
      } catch {
        reject(new ApiError(HttpStatus.BAD_REQUEST, 'validation_failed', 'Bad multipart body'));
        return;
      }
      let got: Promise<Received> | null = null;
      let tooLarge = false;
      parser.on('file', (_field, stream, info) => {
        got = new Promise<Received>((done, fail) => {
          const hash = createHash('sha256');
          const out = writeStream(tempPath);
          const headChunks: Buffer[] = [];
          let headBytes = 0;
          let size = 0;
          stream.on('data', (chunk: Buffer) => {
            size += chunk.length;
            hash.update(chunk);
            if (headBytes < SIGNATURE_BYTES) {
              headChunks.push(chunk);
              headBytes += chunk.length;
            }
          });
          stream.on('limit', () => {
            tooLarge = true;
            stream.unpipe(out);
            stream.resume();
          });
          stream.pipe(out);
          out.on('error', fail);
          out.on('finish', () =>
            done({
              tempPath,
              // Browsers send " CR LF in a multipart name as %22 %0D %0A (HTML spec).
              fileName: sanitizeFileName((info.filename ?? '').replace(/%22/g, '"')),
              size,
              checksum: hash.digest('hex'),
              head: new Uint8Array(Buffer.concat(headChunks).subarray(0, SIGNATURE_BYTES)),
            }),
          );
          stream.on('end', () => {
            if (tooLarge) out.end();
          });
        });
      });
      parser.on('error', () =>
        reject(new ApiError(HttpStatus.BAD_REQUEST, 'validation_failed', 'Bad multipart body')),
      );
      parser.on('close', () => {
        if (!got) {
          reject(
            new ApiError(HttpStatus.BAD_REQUEST, 'validation_failed', 'No file in the request'),
          );
          return;
        }
        got.then(
          async (result) => {
            if (tooLarge) {
              await rm(tempPath, { force: true });
              reject(
                new ApiError(HttpStatus.PAYLOAD_TOO_LARGE, 'file_too_large', 'File too large'),
              );
              return;
            }
            if (result.size === 0) {
              await rm(tempPath, { force: true });
              reject(new ApiError(HttpStatus.BAD_REQUEST, 'validation_failed', 'Empty file'));
              return;
            }
            resolve(result);
          },
          async (error: unknown) => {
            await rm(tempPath, { force: true });
            reject(error);
          },
        );
      });
      req.pipe(parser);
    });
  }

  private limitRate(ctx: TenantContext): void {
    const key = `${ctx.tenantId}:${ctx.memberId}`;
    const now = Date.now();
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
        before: { fileName: row.fileName, size: row.size, subject: row.subjectType, taskId },
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
    const taskId = await this.taskOf(tx, row);
    if (!taskId) throw notFound('Attachment');
    await this.tasks.requireVisible(tx, ctx, taskId);
    return row;
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
