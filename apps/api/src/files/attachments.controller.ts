import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { schema as s } from '@madar/db';
import {
  attachUploadsRequest,
  fileSettings,
  type Attachment,
  type AttachUploadsRequest,
  type FileSettings,
  type Upload,
} from '@madar/shared';
import { sql } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { pipeline } from 'node:stream/promises';

import { RequirePermission, Tenant, type TenantContext } from '../common/context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { TenantDb } from '../database/tenant-db.service.js';
import { isInline } from './attachments-db.js';
import { AttachmentsService, loadFileSettings } from './attachments.service.js';
import { contentDisposition } from './disposition.js';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly attachments: AttachmentsService) {}

  /** One multipart file; attach it afterwards to a task or a comment (ADR 0019). */
  @Post()
  upload(@Tenant() ctx: TenantContext, @Req() req: Request): Promise<Upload> {
    return this.attachments.upload(ctx, req);
  }
}

@Controller('tasks/:id/attachments')
export class TaskAttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Get()
  list(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Attachment[]> {
    return this.attachments.list(ctx, id);
  }

  @Post()
  attach(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(attachUploadsRequest)) body: AttachUploadsRequest,
  ): Promise<Attachment[]> {
    return this.attachments.attachToTask(ctx, id, body.uploadIds);
  }
}

@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  /**
   * The file itself. `?inline=1` previews images and PDFs in the browser; everything else always
   * downloads. The type comes from our allowlist, never from the uploader's browser.
   */
  @Get(':id/file')
  async file(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('inline') inline: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const { row, stream } = await this.attachments.open(ctx, id);
    const disposition = inline === '1' && isInline(row) ? 'inline' : 'attachment';
    res.status(200);
    res.setHeader('Content-Type', row.mime);
    res.setHeader('Content-Length', String(row.size));
    res.setHeader('Content-Disposition', contentDisposition(disposition, row.fileName));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Browsers refuse to show a PDF in a sandboxed document, so an inline PDF gets a strict
    // policy without `sandbox` (the PDF viewer runs isolated); everything else is sandboxed.
    res.setHeader(
      'Content-Security-Policy',
      disposition === 'inline' && row.extension === 'pdf'
        ? "default-src 'none'; frame-ancestors 'none'"
        : "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    );
    // Revalidated every time: a deleted file must not stay viewable from the cache.
    res.setHeader('Cache-Control', 'private, no-cache');
    await pipeline(stream, res).catch(() => res.destroy());
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.attachments.remove(ctx, id);
  }
}

/** The company's file settings: everyone reads them, the owner changes them. */
@Controller('settings/files')
export class FileSettingsController {
  constructor(private readonly db: TenantDb) {}

  @Get()
  get(@Tenant() ctx: TenantContext): Promise<FileSettings> {
    return this.db.run(ctx, (tx) => loadFileSettings(tx, ctx.tenantId));
  }

  @Put()
  @RequirePermission('tenant.manage')
  set(
    @Tenant() ctx: TenantContext,
    @Body(new ZodPipe(fileSettings)) body: FileSettings,
  ): Promise<FileSettings> {
    return this.db.run(ctx, async (tx) => {
      const before = await loadFileSettings(tx, ctx.tenantId);
      await tx
        .update(s.tenants)
        .set({ settings: sql`${s.tenants.settings} || ${JSON.stringify({ files: body })}::jsonb` })
        // `tenants` is control-plane (no RLS): the session's tenant guards the row as well.
        .where(
          sql`${s.tenants.id} = ${ctx.tenantId} and ${s.tenants.id} = app.current_tenant_id()`,
        );
      await this.db.audit(tx, ctx, {
        action: 'file_settings.updated',
        subjectType: 'tenant',
        subjectId: ctx.tenantId,
        before: before as unknown as Record<string, unknown>,
        after: body as unknown as Record<string, unknown>,
      });
      return body;
    });
  }
}
